import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { fundCash } from "./fund.js";
import { startups } from "./startups.js";
import { circleExecute } from "./circle.js";
import { runRound } from "./round.js";
import { closeDeal, getDeal, dealCount } from "./close-loop.js";

// One autonomous turn of the fund, safe to run unattended on a schedule.
//
//   recycle -> settle -> invest
//
// Nothing here throws on an empty wallet. A cycle that cannot afford a step logs why and
// moves on, because a scheduled job that crashes when the fund is temporarily broke is
// worse than one that reports an honest quiet day.

const USDC = addresses.usdc as Address;
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

// The testnet economy is closed: USDC only ever flows fund -> startup and customer ->
// startup, so the customer that buys the startups' services runs dry while the startups
// pool everything. Sending some of it back keeps the same coins circulating. This is
// plumbing for a fixed-supply testnet, not part of the fund's economics: the revenue
// share the fund earns is real either way.
async function recycle(target: bigint): Promise<void> {
  const customer = addresses.agenture.customer.wallet as Address;
  const held = await balanceOf(customer);
  if (held >= target) {
    console.log(`Customer holds ${fmt(held)} USDC, no recycling needed.\n`);
    return;
  }

  let needed = target - held;
  console.log(`Customer holds ${fmt(held)} USDC, topping up by ${fmt(needed)} from startup earnings.`);

  for (const s of startups) {
    if (needed <= 0n) break;
    const balance = await balanceOf(s.wallet);
    // Leave every startup a working balance so it can still pay gas and settle.
    const spare = balance > U("5") ? balance - U("5") : 0n;
    if (spare <= 0n) continue;

    const amount = spare < needed ? spare : needed;
    await circleExecute(s.walletId, USDC, "transfer(address,uint256)", [customer, amount.toString()]);
    console.log(`  ${s.name} returned ${fmt(amount)} USDC to the customer.`);
    needed -= amount;
    await sleep(1500);
  }

  if (needed > 0n) {
    console.log(`  still ${fmt(needed)} USDC short; startups have nothing spare.`);
  }
  console.log("");
}

// Settle revenue on live deals. A deal is never closed by the contract, so the same
// position keeps earning: this is what returns capital to the fund without new deposits.
async function settleDeals(operatorKey: Hex, revenue: bigint, max: number, score: number): Promise<bigint> {
  const count = await dealCount();
  const active: bigint[] = [];
  for (let i = 0n; i < count; i++) {
    const deal = await getDeal(i);
    if (deal.status === 0) active.push(i);
  }

  // Newest first: the deals from the most recent round are the interesting ones.
  const queue = active.reverse().slice(0, max);
  console.log(`${active.length} active deals, settling the ${queue.length} most recent.\n`);

  const customer = addresses.agenture.customer.wallet as Address;
  let recovered = 0n;

  for (const dealId of queue) {
    const funds = await balanceOf(customer);
    if (funds < revenue) {
      console.log(`Customer is down to ${fmt(funds)} USDC, stopping settlement here.`);
      break;
    }
    try {
      const cut = await closeDeal(dealId, operatorKey, revenue, score);
      if (cut !== null) recovered += cut;
    } catch (e) {
      // One bad deal must not abort the cycle.
      console.log(`Deal #${dealId} failed: ${String((e as Error).message).split("\n")[0]}`);
    }
    await sleep(1500);
  }

  return recovered;
}

async function main() {
  const operatorKey = envKey("DEPLOYER_PRIVATE_KEY");
  const revenue = U(process.env.CYCLE_REVENUE_USDC ?? "0.5");
  const settleMax = Number(process.env.CYCLE_SETTLE_MAX ?? "5");
  const customerFloat = U(process.env.CYCLE_CUSTOMER_FLOAT_USDC ?? "6");
  const investFloor = U(process.env.CYCLE_INVEST_FLOOR_USDC ?? "1");
  const score = Number(process.env.FEEDBACK_SCORE ?? "82");

  console.log(`=== Agenture cycle · ${new Date().toISOString()} ===\n`);
  console.log(`Fund cash at start: ${fmt(await fundCash())} USDC\n`);

  // 1. Keep the customer solvent so the startups have someone to sell to.
  console.log("--- Recycle ---");
  await recycle(customerFloat);

  // 2. Existing positions earn and pay their revenue share back to the fund.
  console.log("--- Settle ---");
  const recovered = await settleDeals(operatorKey, revenue, settleMax, score);
  console.log(`\nRecovered ${fmt(recovered)} USDC in revenue share.\n`);

  // 3. Deploy what the fund can afford. Below the floor there is nothing meaningful to
  // allocate, so the round is skipped rather than recording three empty abstentions.
  console.log("--- Invest ---");
  const cash = await fundCash();
  if (cash < investFloor) {
    console.log(`Fund cash ${fmt(cash)} USDC is below the ${fmt(investFloor)} floor; no round this cycle.`);
  } else {
    const deals = await runRound();
    console.log(`Round opened ${deals.length} deal${deals.length === 1 ? "" : "s"}.`);
  }

  console.log(`\nCycle complete. Fund cash: ${fmt(await fundCash())} USDC.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
