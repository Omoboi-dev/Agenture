import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient, walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi, fundAbi } from "./abis.js";
import { getJudgeState, fundCash } from "./fund.js";

// Operator-only. Tops the fund up and resets every judge's mandate ceiling so a round has
// real capital to allocate.
//
// WARNING: Fund.registerJudge overwrites the whole Judge struct, so raising a mandate
// also zeroes that judge's deployed and returned counters. The fund-level totals and the
// Deal records are untouched, but a judge's own track record restarts from here. Run a
// round and then close-loop afterwards to rebuild it.

const USDC = addresses.usdc as Address;
const FUND = addresses.agenture.fund as Address;

const U = (n: string) => parseUnits(n, 6);
const fmt = (b: bigint) => formatUnits(b, 6);
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

async function main() {
  const deposit = U(process.env.DEPOSIT_USDC ?? "25");
  const mandate = U(process.env.MANDATE_USDC ?? "12");
  const dryRun = process.env.DRY_RUN === "1";

  const op = walletFromKey(envKey("DEPLOYER_PRIVATE_KEY"));
  const operator = addresses.agenture.operator as Address;

  console.log(`=== Recapitalize${dryRun ? " (dry run)" : ""} ===\n`);

  const opBalance = await balanceOf(operator);
  console.log(`Operator holds ${fmt(opBalance)} USDC`);
  console.log(`Fund cash       ${fmt(await fundCash())} USDC\n`);

  const judges = addresses.agenture.judges;
  for (const j of judges) {
    const st = await getJudgeState(j.wallet as Address);
    console.log(
      `  ${j.name.padEnd(6)} mandate ${fmt(st.mandate)} deployed ${fmt(st.deployed)} returned ${fmt(st.returned)}` +
        ` -> mandate ${fmt(mandate)}, counters reset`,
    );
    await sleep(300);
  }
  console.log("");

  if (dryRun) {
    console.log("Dry run: nothing sent.");
    return;
  }

  // 1. Deposit. approve first, the Fund pulls with transferFrom. Skippable so a retry
  // after a partial failure never deposits twice.
  if (process.env.SKIP_DEPOSIT === "1") {
    console.log("Skipping deposit (SKIP_DEPOSIT=1).\n");
  } else {
    if (opBalance < deposit) {
      throw new Error(`operator holds ${fmt(opBalance)} USDC, cannot deposit ${fmt(deposit)}`);
    }
    const approveHash = await withRpcRetry(() =>
      op.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [FUND, deposit] }),
    );
    await waitReceipt(approveHash);
    await sleep(1500);

    const depositHash = await withRpcRetry(() =>
      op.writeContract({ address: FUND, abi: fundAbi, functionName: "depositCapital", args: [deposit] }),
    );
    await waitReceipt(depositHash);
    console.log(`Deposited ${fmt(deposit)} USDC (tx ${depositHash})`);
    await sleep(1500);
  }

  // 2. Reset each judge's mandate ceiling. A judge already at the target is left alone,
  // so a retry does not needlessly wipe counters a second time.
  for (const j of judges) {
    const st = await getJudgeState(j.wallet as Address);
    if (st.mandate === mandate) {
      console.log(`${j.name}: already at ${fmt(mandate)} USDC, skipping.`);
      continue;
    }
    const h = await withRpcRetry(() =>
      op.writeContract({
        address: FUND,
        abi: fundAbi,
        functionName: "registerJudge",
        args: [j.wallet as Address, BigInt(j.agentId), mandate],
      }),
    );
    await waitReceipt(h);
    console.log(`${j.name}: mandate now ${fmt(mandate)} USDC (tx ${h})`);
    await sleep(2500);
  }

  // 3. Optionally top up the x402 customer, which pays startups for their services in
  // close-loop. Opt in with CUSTOMER_TOPUP_USDC so a plain recapitalize never moves it.
  const topUp = U(process.env.CUSTOMER_TOPUP_USDC ?? "0");
  if (topUp > 0n) {
    const customer = addresses.agenture.customer.wallet as Address;
    const h = await withRpcRetry(() =>
      op.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [customer, topUp] }),
    );
    await waitReceipt(h);
    console.log(`Topped up the x402 customer with ${fmt(topUp)} USDC, now holding ${fmt(await balanceOf(customer))}.`);
  }

  console.log(`\nFund cash now ${fmt(await fundCash())} USDC.`);
  console.log(`Update judges[].mandate to "${mandate}" in shared/addresses.json, then run: bun run round`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
