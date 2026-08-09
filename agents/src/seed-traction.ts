import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient, withRpcRetry } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { circleExecute } from "./circle.js";
import { payViaX402 } from "./x402.js";
import { experienceOf } from "./market.js";
import { startups } from "./startups.js";
import type { Draft } from "./generate-startups.js";

// Give the agents that claim existing revenue a real onchain history BEFORE they pitch.
//
// Deal flow is not all cold starts. Some founders turn up having already sold something,
// and a judge should be able to see the difference. So the customer agent actually buys
// their service over x402 and actually rates them on ERC-8004. Both are real onchain
// events; what is simulated is the demand, exactly as it is everywhere else on testnet.
//
// The rater is the customer, not a judge: it has paid these agents, which makes its
// rating an independent signal rather than the fund marking its own homework.

const HERE = dirname(fileURLToPath(import.meta.url));
const DRAFTS = join(HERE, "../../shared/startup-drafts.json");

const USDC = addresses.usdc as Address;
const REP = addresses.erc8004.reputationRegistry as Address;
const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

const U = (n: string) => parseUnits(n, 6);
const fmt = (b: bigint) => formatUnits(b, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function envKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name} in environment`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

// A seeded rating is a customer's experience of a service it paid for, no different in
// kind from one written during a market run, so it is produced by the same function over
// the same ground truth. An overvalued agent looks like one here for the same reason it
// will look like one later.
function scoreFor(d: Draft): number {
  return Math.round(experienceOf(d.quality) * 100);
}

async function main() {
  const operatorKey = envKey("DEPLOYER_PRIVATE_KEY");
  const perPayment = U(process.env.SEED_PAYMENT_USDC ?? "0.25");
  const payments = Number(process.env.SEED_PAYMENTS ?? "2");

  const { drafts } = JSON.parse(readFileSync(DRAFTS, "utf8")) as { drafts: Draft[] };
  const customer = addresses.agenture.customer;

  const targets = drafts
    .filter((d) => d.arrivesWithTraction)
    .map((d) => ({ draft: d, startup: startups.find((s) => s.name === d.name) }))
    .filter((t): t is { draft: Draft; startup: NonNullable<typeof t.startup> } => Boolean(t.startup));

  if (targets.length === 0) {
    console.log("No provisioned agent is marked as arriving with traction.");
    return;
  }

  const needed = perPayment * BigInt(payments) * BigInt(targets.length);
  const held = (await withRpcRetry(() =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [customer.wallet as Address] }),
  )) as bigint;

  console.log(`Seeding ${targets.length} agents. Customer holds ${fmt(held)} USDC, needs ${fmt(needed)}.\n`);
  if (held < needed) {
    console.log(`Customer is short. Top it up first: CUSTOMER_TOPUP_USDC=${fmt(needed)} bun run allocate\n`);
    return;
  }

  for (const { draft, startup } of targets) {
    // Real earnings: the customer signs an EIP-3009 authorization per purchase.
    for (let i = 0; i < payments; i++) {
      await payViaX402(customer.walletId, customer.wallet as Address, operatorKey, startup.wallet, perPayment);
      await sleep(1200);
    }

    // Real reputation, from a client that has actually paid it.
    const score = scoreFor(draft);
    if (startup.agentId !== null) {
      await circleExecute(
        customer.walletId,
        REP,
        "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
        [startup.agentId.toString(), String(score), "0", "agenture", "service", "", "", ZERO32],
      );
    }

    console.log(
      `${startup.name.padEnd(18)} earned ${fmt(perPayment * BigInt(payments))} USDC over ${payments} calls, rated ${score} by the customer`,
    );
    await sleep(1500);
  }

  console.log("\nSeeding complete. These agents now arrive with a record a judge can read.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
