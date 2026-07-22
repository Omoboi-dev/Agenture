import "dotenv/config";
import type { Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient, walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi, fundAbi } from "./abis.js";
import { registerIdentity } from "./identity.js";
import { getJudgeState } from "./fund.js";
import { startups } from "./startups.js";

// Operator-only, run ONCE. Adds capital, onboards the two new judges (gas + ERC-8004
// identity + Fund registration), and gives the cold-start startups their own identities
// so judges can build their reputation. Prints agentIds to paste into config.
const USDC = addresses.usdc as `0x${string}`;
const FUND = addresses.agenture.fund as `0x${string}`;

function envKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name} in environment`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

const U = (n: string) => parseUnits(n, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function balanceOf(addr: `0x${string}`): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
  )) as bigint;
}

async function main() {
  const operatorKey = envKey("DEPLOYER_PRIVATE_KEY");
  const op = walletFromKey(operatorKey);

  const deposit = U(process.env.DEPOSIT_USDC ?? "15");
  const gas = U(process.env.JUDGE_GAS_USDC ?? "1");
  const mandate = U(process.env.MANDATE_USDC ?? "6");

  const newJudges = [
    { key: "nova", envKey: "JUDGE_B_PRIVATE_KEY" },
    { key: "sable", envKey: "JUDGE_C_PRIVATE_KEY" },
  ].map((j) => ({ ...j, wallet: privateKeyToAccount(envKey(j.envKey)).address }));

  console.log("=== Agenture setup ===\n");

  // 1. Deposit capital into the Fund. Skippable on resume (SKIP_DEPOSIT=1) so a rerun
  // never double-deposits.
  if (process.env.SKIP_DEPOSIT === "1") {
    console.log("Skipping deposit (SKIP_DEPOSIT=1).");
  } else {
    const approveHash = await withRpcRetry(() =>
      op.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [FUND, deposit] }),
    );
    await waitReceipt(approveHash);
    await sleep(1500);
    const depHash = await withRpcRetry(() =>
      op.writeContract({ address: FUND, abi: fundAbi, functionName: "depositCapital", args: [deposit] }),
    );
    await waitReceipt(depHash);
    console.log(`Deposited ${formatUnits(deposit, 6)} USDC into the Fund.`);
    await sleep(1500);
  }

  // 2. Fund each new judge wallet with gas. Skip any that already hold enough.
  for (const j of newJudges) {
    if ((await balanceOf(j.wallet)) >= gas) {
      console.log(`${j.key} already funded, skipping gas.`);
      continue;
    }
    const h = await withRpcRetry(() =>
      op.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [j.wallet, gas] }),
    );
    await waitReceipt(h);
    console.log(`Sent ${formatUnits(gas, 6)} USDC gas to ${j.key} (${j.wallet}).`);
    await sleep(1500);
  }

  // 3. Register ERC-8004 identities for the new judges (owned by the operator).
  const judgeIds: Record<string, bigint> = {};
  for (const j of newJudges) {
    judgeIds[j.key] = await registerIdentity(operatorKey, `ipfs://agenture/judge/${j.key}`);
    console.log(`Registered judge ${j.key} identity -> agentId ${judgeIds[j.key]}`);
    await sleep(1500);
  }

  // 4. Register ERC-8004 identities for cold-start startups (so judges can rate them).
  const startupIds: Record<string, bigint> = {};
  for (const s of startups) {
    if (s.agentId !== null) continue;
    startupIds[s.name] = await registerIdentity(operatorKey, `ipfs://agenture/startup/${s.name}`);
    console.log(`Registered startup ${s.name} identity -> agentId ${startupIds[s.name]}`);
    await sleep(1500);
  }

  // 5. Onboard the new judges into the Fund with their mandates. Skip if already active.
  for (const j of newJudges) {
    if ((await getJudgeState(j.wallet)).active) {
      console.log(`${j.key} already registered in Fund, skipping.`);
      continue;
    }
    const h = await withRpcRetry(() =>
      op.writeContract({
        address: FUND,
        abi: fundAbi,
        functionName: "registerJudge",
        args: [j.wallet, judgeIds[j.key], mandate],
      }),
    );
    await waitReceipt(h);
    console.log(`Registered judge ${j.key} in Fund with mandate ${formatUnits(mandate, 6)} USDC.`);
    await sleep(1500);
  }

  // Summary to copy into config.
  console.log("\n--- paste into shared/addresses.json judges[] ---");
  for (const j of newJudges) {
    console.log(
      `{ "name": "${j.key}", "wallet": "${j.wallet}", "agentId": ${judgeIds[j.key]}, "mandate": "${mandate}" }`,
    );
  }
  console.log("\n--- set these agentIds in agents/src/startups.ts ---");
  for (const [name, id] of Object.entries(startupIds)) {
    console.log(`${name}: agentId ${id}n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
