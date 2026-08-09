import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient, walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { startups } from "./startups.js";
import { circleExecute } from "./circle.js";
import { liveCustomers, budgetOf } from "./customers.js";

// Top the buyers back up to their budgets.
//
// Money enters this economy here and nowhere else, and it enters from OUTSIDE it. The
// operator holds USDC drawn from the Arc faucet and pays it to the customer agents,
// exactly as a real buying agent is funded by its own treasury rather than by the vendors
// it shops from. From there it only ever flows one way:
//
//   operator -> buyer -> seller -> revenue share -> fund -> judge
//
// The alternative, `--from-sellers`, pulls USDC back out of the sellers' wallets instead.
// That keeps a fixed supply circulating but it is circular: the sellers end up funding
// their own customers, which makes the demand they are being measured on partly their own
// money. It is a liquidity workaround for a dry operator, not an economic model, so it is
// off by default and prints a warning when used.
//
//   bun run fund-customers                  from the operator (default, honest)
//   bun run fund-customers -- --from-sellers  recycle instead, when the operator is dry
//   bun run fund-customers -- --dry           show the shortfall, move nothing

const USDC = addresses.usdc as Address;
const OPERATOR = addresses.agenture.operator as Address;
const fmt = (b: bigint) => formatUnits(b, 6);
const U = (n: string) => parseUnits(n, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function envKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name} in environment`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

async function balanceOf(addr: Address): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
  )) as bigint;
}

export type Shortfall = { name: string; wallet: Address; held: bigint; needed: bigint };

/** Who is below their budget, and by how much. Each buyer is measured against its own
 *  number: level-funding every wallet would erase the difference between a desk with 7
 *  USDC to spend and one with 3, and that difference is half of what makes demand uneven. */
export async function shortfalls(headroom: number): Promise<Shortfall[]> {
  const out: Shortfall[] = [];
  for (const c of liveCustomers()) {
    const target = (budgetOf(c) * BigInt(Math.round(headroom * 100))) / 100n;
    const held = await balanceOf(c.wallet);
    if (held < target) out.push({ name: c.name, wallet: c.wallet, held, needed: target - held });
  }
  return out;
}

async function payFromOperator(wants: Shortfall[], operatorKey: Hex): Promise<void> {
  const op = walletFromKey(operatorKey);
  const total = wants.reduce((a, w) => a + w.needed, 0n);
  const available = await balanceOf(OPERATOR);

  console.log(`Operator holds ${fmt(available)} USDC, buyers are short ${fmt(total)}.`);
  if (available < total) {
    console.log(
      `Not enough to cover it. Fund ${OPERATOR} from the Arc faucet, or run with ` +
        `--from-sellers to recycle instead (and read what that means in the header of this file).`,
    );
    return;
  }

  for (const w of wants) {
    const hash = await withRpcRetry(() =>
      op.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [w.wallet, w.needed] }),
    );
    await waitReceipt(hash);
    console.log(`  ${w.name.padEnd(13)} +${fmt(w.needed)} USDC (held ${fmt(w.held)})`);
    await sleep(800);
  }
}

async function payFromSellers(wants: Shortfall[]): Promise<void> {
  console.log(
    "WARNING: recycling from sellers. The buyers' money is coming from the agents they are\n" +
      "about to buy from, so the demand measured this run is partly their own capital returning.\n",
  );

  const queue = [...wants];
  let want = queue.shift();
  for (const s of startups) {
    if (!want) break;
    const balance = await balanceOf(s.wallet);
    // Leave every seller a working balance so it can still pay gas and settle.
    let spare = balance > U("5") ? balance - U("5") : 0n;
    if (spare <= 0n) continue;

    while (want && spare > 0n) {
      const amount = spare < want.needed ? spare : want.needed;
      await circleExecute(s.walletId, USDC, "transfer(address,uint256)", [want.wallet, amount.toString()]);
      console.log(`  ${s.name} paid ${fmt(amount)} USDC to ${want.name}.`);
      spare -= amount;
      want.needed -= amount;
      if (want.needed <= 0n) want = queue.shift();
      await sleep(1500);
    }
  }

  const short = [want, ...queue].filter(Boolean) as Shortfall[];
  if (short.length > 0) {
    console.log(`  ${short.map((w) => `${w.name} still short ${fmt(w.needed)}`).join(", ")}; sellers have nothing spare.`);
  }
}

export async function fundCustomers(
  headroom: number,
  opts: { fromSellers?: boolean; dryRun?: boolean; operatorKey?: Hex } = {},
): Promise<void> {
  if (liveCustomers().length === 0) {
    console.log("No customer agents provisioned yet. Run: bun run provision-customers\n");
    return;
  }

  const wants = await shortfalls(headroom);
  if (wants.length === 0) {
    console.log("Every buyer is funded to its budget.\n");
    return;
  }

  console.log(`Short: ${wants.map((w) => `${w.name} +${fmt(w.needed)}`).join(", ")}`);
  if (opts.dryRun) {
    console.log("Dry run: nothing moved.\n");
    return;
  }

  if (opts.fromSellers) await payFromSellers(wants);
  else await payFromOperator(wants, opts.operatorKey ?? envKey("DEPLOYER_PRIVATE_KEY"));

  console.log("");
}

async function main() {
  const headroom = Number(process.env.CYCLE_CUSTOMER_HEADROOM ?? "1.4");
  const fromSellers = process.argv.includes("--from-sellers");
  const dryRun = process.argv.includes("--dry");

  console.log(`=== Agenture fund-customers · ${new Date().toISOString()} ===\n`);
  await fundCustomers(headroom, { fromSellers, dryRun });

  for (const c of liveCustomers()) {
    console.log(`${c.name.padEnd(13)} ${fmt(await balanceOf(c.wallet)).padStart(8)} USDC  (budget ${c.budgetUsdc})`);
  }
}

if (process.argv[1]?.endsWith("fund-customers.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
