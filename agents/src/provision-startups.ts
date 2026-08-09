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
import { startups } from "./startups.js";
import type { Draft } from "./generate-startups.js";

// Turn reviewed drafts into real agents: a Circle wallet, gas, and an ERC-8004 identity
// each, appended to shared/startups.json.
//
// Deliberately a separate step from generation. Once an agent has an identity and a
// wallet, rewriting its pitch means a different company wearing the same address and the
// same reputation, so the drafts get read by a human first.

const HERE = dirname(fileURLToPath(import.meta.url));
const DRAFTS = join(HERE, "../../shared/startup-drafts.json");
const ROSTER = join(HERE, "../../shared/startups.json");

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

type RosterEntry = {
  name: string;
  wallet: string;
  walletId: string;
  agentId: number | null;
  pitch: { idea: string; monthlyRevenueUsdc: number; estimatedWorthUsdc: number; askUsdc: number };
  quality: number;
  service: { sectors: string[] };
};

async function main() {
  const operatorKey = envKey("DEPLOYER_PRIVATE_KEY");
  const op = walletFromKey(operatorKey);
  const gas = U(process.env.STARTUP_GAS_USDC ?? "0.6");

  const { drafts } = JSON.parse(readFileSync(DRAFTS, "utf8")) as { drafts: Draft[] };
  const roster = JSON.parse(readFileSync(ROSTER, "utf8")) as { startups: RosterEntry[] };

  const existing = new Set(startups.map((s) => s.name.toLowerCase()));
  const todo = drafts.filter((d) => !existing.has(d.name.toLowerCase()));

  if (todo.length === 0) {
    console.log("Every draft is already on the roster, nothing to provision.");
    return;
  }

  const opBalance = (await withRpcRetry(() =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addresses.agenture.operator as Address] }),
  )) as bigint;

  const needed = gas * BigInt(todo.length);
  console.log(`Provisioning ${todo.length} agents. Gas needed ${fmt(needed)} USDC, operator holds ${fmt(opBalance)}.\n`);
  if (opBalance < needed) throw new Error(`operator needs at least ${fmt(needed)} USDC`);

  for (const draft of todo) {
    // 1. Circle wallet: the agent's own signing identity.
    const wallet = await createWallet(WALLET_SET, labelFor("Startup", draft.name));
    await sleep(1000);

    // 2. Gas. On Arc gas is USDC, so every wallet needs a little to act at all.
    const gasHash = await withRpcRetry(() =>
      op.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [wallet.address as Address, gas] }),
    );
    await waitReceipt(gasHash);
    await sleep(1500);

    // 3. ERC-8004 identity, so judges have something to rate and read back later.
    const agentId = await registerIdentity(operatorKey, `ipfs://agenture/startup/${draft.name}`);
    await sleep(1500);

    roster.startups.push({
      name: draft.name,
      wallet: wallet.address,
      walletId: wallet.id,
      agentId: Number(agentId),
      pitch: {
        idea: draft.idea,
        monthlyRevenueUsdc: draft.monthlyRevenueUsdc,
        estimatedWorthUsdc: draft.estimatedWorthUsdc,
        askUsdc: draft.askUsdc,
      },
      // Carried through from the draft rather than left to defaults. Without quality every
      // new agent delivers at a flat 0.5 and the whole cohort feels identical to a buyer;
      // without sectors the catalog has to guess what it sells from its prose.
      quality: draft.quality,
      service: { sectors: draft.sectors },
    });
    writeFileSync(ROSTER, `${JSON.stringify(roster, null, 2)}\n`);

    console.log(
      `${draft.name.padEnd(18)} wallet ${wallet.address}  agentId ${agentId}  ` +
        `${draft.sectors.join("/")}  truth ${draft.quality.toFixed(2)}`,
    );
  }

  console.log(`\nRoster is now ${roster.startups.length} agents.`);
  const traded = todo.filter((d) => d.arrivesWithTraction).map((d) => d.name);
  if (traded.length > 0) {
    console.log(`Seed arriving traction for: ${traded.join(", ")}`);
    console.log("Run: bun run seed-traction");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
