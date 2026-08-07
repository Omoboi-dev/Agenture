import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits, maxUint256 } from "viem";
import { publicClient, walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi, fundAbi } from "./abis.js";
import { fundCash, getJudgeState, judgeBudget, undrawn } from "./fund.js";
import { loadJudges } from "./judges.js";
import { circleExecute } from "./circle.js";

// Operator capital management, safe to re-run.
//
//   deposit -> register -> commit -> approve
//
// Committing moves nothing. It records what the fund has promised a judge, and the judge
// draws that down itself with a capital call when it decides it needs the money. The
// operator's job ends here: after this, capital reaches a judge only because the judge
// asked for it. Each judge also approves the Fund once, because `invest` pulls from the
// judge's wallet rather than from the pool.

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
  const deposit = U(process.env.DEPOSIT_USDC ?? "0");
  const perJudge = U(process.env.COMMIT_USDC ?? process.env.ALLOCATE_USDC ?? "0");
  const op = walletFromKey(envKey("DEPLOYER_PRIVATE_KEY"));
  const operator = addresses.agenture.operator as Address;
  const judges = loadJudges();

  console.log("=== Allocate ===\n");
  console.log(`Operator holds ${fmt(await balanceOf(operator))} USDC`);
  console.log(`Fund cash      ${fmt(await fundCash())} USDC\n`);

  // 1. Deposit LP capital into the fund.
  if (deposit > 0n) {
    const approveHash = await withRpcRetry(() =>
      op.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [FUND, deposit] }),
    );
    await waitReceipt(approveHash);
    await sleep(1500);

    const depositHash = await withRpcRetry(() =>
      op.writeContract({ address: FUND, abi: fundAbi, functionName: "depositCapital", args: [deposit] }),
    );
    await waitReceipt(depositHash);
    console.log(`Deposited ${fmt(deposit)} USDC into the fund.\n`);
    await sleep(1500);
  }

  // 2. Register each judge. Re-registering is safe: it refreshes the identity and leaves
  // committed/called/deployed/returned untouched.
  for (const j of judges) {
    const state = await getJudgeState(j.wallet);
    if (state.active && state.agentId === j.agentId) {
      console.log(`${j.key}: already registered.`);
      continue;
    }
    const h = await withRpcRetry(() =>
      op.writeContract({
        address: FUND,
        abi: fundAbi,
        functionName: "registerJudge",
        args: [j.wallet, j.agentId],
      }),
    );
    await waitReceipt(h);
    console.log(`${j.key}: registered with agentId ${j.agentId}.`);
    await sleep(2000);
  }
  console.log("");

  // 3. Commit capital to each judge. Nothing moves: the judge draws this down itself,
  // when it decides it needs to, by calling capital during a round.
  if (perJudge > 0n) {
    for (const j of judges) {
      const h = await withRpcRetry(() =>
        op.writeContract({
          address: FUND,
          abi: fundAbi,
          functionName: "commitCapital",
          args: [j.wallet, perJudge],
        }),
      );
      await waitReceipt(h);
      console.log(`${j.key}: committed ${fmt(perJudge)} USDC, ${fmt(await undrawn(j.wallet))} undrawn.`);
      await sleep(2000);
    }
    console.log("");
  }

  // 4. Each judge approves the Fund to move its USDC, signed from its own Circle wallet.
  // Without this, invest() cannot pull the judge's capital.
  for (const j of judges) {
    const allowance = (await withRpcRetry(() =>
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "allowance",
        args: [j.wallet, FUND],
      }),
    )) as bigint;

    if (allowance > U("1000000")) {
      console.log(`${j.key}: already approved the fund.`);
      continue;
    }
    await circleExecute(j.walletId, USDC, "approve(address,uint256)", [FUND, maxUint256.toString()]);
    console.log(`${j.key}: approved the fund to move its USDC.`);
    await sleep(1500);
  }

  console.log(`\nFund cash now ${fmt(await fundCash())} USDC.`);
  for (const j of judges) {
    console.log(
      `  ${j.key.padEnd(6)} holds ${fmt(await judgeBudget(j.wallet))} USDC, ` +
        `${fmt(await undrawn(j.wallet))} committed but undrawn`,
    );
  }
  console.log("\nJudges draw this themselves at the start of a round. Nothing else to send.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
