import type { Address, Hex } from "viem";
import { parseEventLogs } from "viem";
import { publicClient, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { fundAbi } from "./abis.js";
import { circleExecute } from "./circle.js";

const FUND = addresses.agenture.fund as Address;

export type JudgeState = {
  active: boolean;
  agentId: bigint;
  committed: bigint; // capital the fund has promised, grows with the judge's returns
  called: bigint; // how much of that the judge has drawn into its own wallet
  deployed: bigint;
  returned: bigint;
};

// Commitment a judge has not drawn yet: what it could call for right now.
export async function undrawn(judge: Address): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({ address: FUND, abi: fundAbi, functionName: "undrawn", args: [judge] }),
  )) as bigint;
}

// A capital call, signed by the judge itself. This is the judge deciding it needs money
// and taking it against its commitment, rather than the operator pushing capital at it.
export async function callCapital(judgeWalletId: string, amount: bigint): Promise<string> {
  return circleExecute(judgeWalletId, FUND, "callCapital(uint256)", [amount.toString()]);
}

// What a judge can actually spend: the USDC sitting in its own wallet. There is no
// mandate ceiling any more, the token balance is the limit.
export async function judgeBudget(judge: Address): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({
      address: FUND,
      abi: fundAbi,
      functionName: "judgeBudget",
      args: [judge],
    }),
  )) as bigint;
}

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

// Send an investment from the judge's own Circle wallet and read the dealId back out of
// the Invested event. The judge authorizes its own decision onchain by signing this tx
// through Circle; we then read the receipt with viem to pull the dealId.
export async function invest(
  judgeWalletId: string,
  startup: Address,
  amount: bigint,
  revenueShareBps: number,
  pitchRef: string,
): Promise<{ dealId: bigint; txHash: Hex }> {
  const txHash = await circleExecute(judgeWalletId, FUND, "invest(address,uint256,uint16,string)", [
    startup,
    amount.toString(),
    revenueShareBps.toString(),
    pitchRef,
  ]);

  const receipt = await waitReceipt(txHash);
  const logs = parseEventLogs({ abi: fundAbi, eventName: "Invested", logs: receipt.logs });
  const dealId = logs[0]?.args.dealId;
  if (dealId === undefined) throw new Error(`invest tx ${txHash} did not emit Invested`);

  return { dealId, txHash };
}
