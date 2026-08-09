import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient, withRpcRetry } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { fundCash, getJudgeState } from "./fund.js";
import { loadJudges } from "./judges.js";
import { runRound } from "./round.js";
import { runMarket } from "./market.js";
import { fundCustomers } from "./fund-customers.js";

// One autonomous turn of the fund, safe to run unattended on a schedule.
//
//   recycle -> market -> invest
//
// The middle step is where the money is actually made, and the fund is not in it. Four
// customer agents shop for what they need, the sellers they picked settle the fund's
// share of what they sold, and the judges find out how their portfolio did the same way
// any investor does: from the returns.
//
// Nothing here throws on an empty wallet. A cycle that cannot afford a step logs why and
// moves on, because a scheduled job that crashes when the fund is temporarily broke is
// worse than one that reports an honest quiet day.

const USDC = addresses.usdc as Address;
const fmt = (b: bigint) => formatUnits(b, 6);
const U = (n: string) => parseUnits(n, 6);

function envKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name} in environment`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

async function main() {
  const operatorKey = envKey("DEPLOYER_PRIVATE_KEY");
  const headroom = Number(process.env.CYCLE_CUSTOMER_HEADROOM ?? "1.4");
  const investFloor = U(process.env.CYCLE_INVEST_FLOOR_USDC ?? "2");

  console.log(`=== Agenture cycle · ${new Date().toISOString()} ===\n`);
  console.log(`Fund cash at start: ${fmt(await fundCash())} USDC\n`);

  // 1. Keep the buyers solvent, or there is no market to have. Money enters the economy
  // here, from the operator, which sits outside it. Nothing flows backwards from sellers.
  console.log("--- Fund the buyers ---");
  await fundCustomers(headroom, { operatorKey });

  // 2. The market runs: customers buy what they need, sellers settle the fund's share.
  const earnedBefore = new Map<string, bigint>();
  for (const j of loadJudges()) earnedBefore.set(j.key, (await getJudgeState(j.wallet)).returned);

  const { volume, cut } = await runMarket({ operatorKey });
  console.log(`\nMarket volume ${fmt(volume)} USDC; ${fmt(cut)} USDC in revenue share reached the fund.\n`);

  // Settling raises each judge's commitment onchain, so there is nothing to pay out
  // here: a judge draws its winnings itself, next time it wants to invest.
  for (const j of loadJudges()) {
    const earned = (await getJudgeState(j.wallet)).returned - (earnedBefore.get(j.key) ?? 0n);
    if (earned > 0n) console.log(`${j.key}: earned ${fmt(earned)} USDC, now callable.`);
  }
  console.log("");

  // 3. Deploy. A judge spends its own wallet, so the fund's cash is not the constraint
  // here; the floor just avoids running a round nobody can act in.
  console.log("--- Invest ---");
  // Judges spend their own wallets, so the fund's balance is irrelevant here. What
  // matters is whether anyone on the panel can actually write a cheque.
  let panelCapital = 0n;
  for (const j of loadJudges()) {
    panelCapital += (await withRpcRetry(() =>
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [j.wallet] }),
    )) as bigint;
  }
  if (panelCapital < investFloor) {
    console.log(
      `The panel holds ${fmt(panelCapital)} USDC between them, below the ${fmt(investFloor)} floor; ` +
        `no round this cycle. Allocate more with: bun run allocate`,
    );
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
