import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient, walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { createWallet, labelFor } from "./circle.js";
import { registerIdentity } from "./identity.js";

// Give each customer agent the two things it needs to be a customer: a wallet only it can
// sign with, and enough USDC to be a buyer rather than a script.
//
// Gas matters here in a way it does not for the seller side. A customer never pays gas to
// buy, because x402 lets it sign the payment off-chain and the operator submits it. But
// the rating it leaves afterwards is its own transaction, and a buyer that cannot afford
// to say what it thought of a service is not much of a reputation source.
//
// Safe to re-run: a customer that already has a wallet is left exactly as it is.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROSTER = join(HERE, "../../shared/customers.json");

const USDC = addresses.usdc as Address;
const WALLET_SET = process.env.CIRCLE_WALLET_SET ?? addresses.agenture.circle.walletSetId;

const U = (n: string) => parseUnits(n, 6);
const fmt = (b: bigint) => formatUnits(b, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function envKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name} in environment`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

type Entry = {
  name: string;
  wallet: string | null;
  walletId: string | null;
  agentId: number | null;
  [k: string]: unknown;
};

async function main() {
  const operatorKey = envKey("DEPLOYER_PRIVATE_KEY");
  const op = walletFromKey(operatorKey);
  const gas = U(process.env.CUSTOMER_GAS_USDC ?? "0.6");
  // A first float, so the opening run is a real market rather than four empty wallets.
  //
  // It comes from the operator and it is sized to each buyer's own budget, not shared
  // out evenly. Recycling from the sellers would do the job too, but not on the first
  // run: a seller's balance is one of the signals the judges read in diligence, and a
  // market whose buyers were funded by the agents they are about to buy from is a
  // circle. After this, recycling is the right answer, because by then the money going
  // back to the buyers is money the sellers earned from them.
  const override = process.env.CUSTOMER_SEED_USDC;
  const seedFor = (e: Entry): bigint =>
    override !== undefined ? U(override) : U(String((e.budgetUsdc as number | undefined) ?? 0));

  const file = JSON.parse(readFileSync(ROSTER, "utf8")) as { customers: Entry[] };
  const todo = file.customers.filter((c) => !c.wallet || !c.walletId);

  if (todo.length === 0) {
    console.log("Every customer already has a wallet, nothing to provision.");
    return;
  }

  const opBalance = (await withRpcRetry(() =>
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addresses.agenture.operator as Address],
    }),
  )) as bigint;

  const needed = todo.reduce((a, e) => a + gas + seedFor(e), 0n);
  console.log(
    `Provisioning ${todo.length} customer agents. Needs ${fmt(needed)} USDC ` +
      `(${fmt(gas)} gas each plus a float the size of each buyer's budget); ` +
      `operator holds ${fmt(opBalance)}.\n`,
  );
  if (opBalance < needed) throw new Error(`operator needs at least ${fmt(needed)} USDC`);

  for (const entry of todo) {
    const seed = seedFor(entry);
    const wallet = await createWallet(WALLET_SET, labelFor("Customer", entry.name));
    await sleep(1000);

    const funding = gas + seed;
    const hash = await withRpcRetry(() =>
      op.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "transfer",
        args: [wallet.address as Address, funding],
      }),
    );
    await waitReceipt(hash);
    await sleep(1500);

    // An ERC-8004 identity of its own. A customer is an agent like any other here, and
    // giving it one means it can be rated in turn: a buyer that pays late or disputes
    // everything is a fact a seller should be able to record.
    const agentId = await registerIdentity(operatorKey, `ipfs://agenture/customer/${entry.name}`);
    await sleep(1500);

    entry.wallet = wallet.address;
    entry.walletId = wallet.id;
    entry.agentId = Number(agentId);
    writeFileSync(ROSTER, `${JSON.stringify(file, null, 2)}\n`);

    console.log(`${entry.name.padEnd(14)} wallet ${wallet.address}  agentId ${agentId}  funded ${fmt(funding)} USDC`);
  }

  console.log(`\n${file.customers.length} customer agents on the roster.`);
  console.log("These wallets rate the sellers they buy from, so add nothing else: reputation now has a source outside the fund.");
  console.log("\nNext: bun run market -- --dry, then bun run market. From the run after that, bun run recycle tops them up.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
