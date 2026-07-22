import type { Address, Hex } from "viem";
import { parseEventLogs } from "viem";
import { publicClient, walletFromKey, withRpcRetry } from "./chain.js";
import { addresses } from "./config.js";
import { fundAbi } from "./abis.js";

const FUND = addresses.agenture.fund as Address;

export type JudgeState = {
  active: boolean;
  agentId: bigint;
  mandate: bigint;
  deployed: bigint;
  returned: bigint;
};

export async function getJudgeState(judge: Address): Promise<JudgeState> {
  return (await withRpcRetry(() =>
    publicClient.readContract({
      address: FUND,
      abi: fundAbi,
      functionName: "getJudge",
      args: [judge],
    }),
  )) as JudgeState;
}

export async function fundCash(): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({
      address: FUND,
      abi: fundAbi,
      functionName: "cash",
    }),
  )) as bigint;
}

// Send an investment from the judge's own wallet and read the dealId back out of the
// Invested event. The judge authorizes its own decision onchain by signing this tx.
export async function invest(
  judgeKey: Hex,
  startup: Address,
  amount: bigint,
  revenueShareBps: number,
  pitchRef: string,
): Promise<{ dealId: bigint; txHash: Hex }> {
  const wallet = walletFromKey(judgeKey);
  const txHash = await wallet.writeContract({
    address: FUND,
    abi: fundAbi,
    functionName: "invest",
    args: [startup, amount, revenueShareBps, pitchRef],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const logs = parseEventLogs({ abi: fundAbi, eventName: "Invested", logs: receipt.logs });
  const dealId = logs[0]?.args.dealId;
  if (dealId === undefined) throw new Error(`invest tx ${txHash} did not emit Invested`);

  return { dealId, txHash };
}
