import type { Address, Hex } from "viem";
import { walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { reputationWriteAbi } from "./abis.js";

const REP = addresses.erc8004.reputationRegistry as Address;
const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

// A judge (client) rates a startup (agent) on ERC-8004. This is the reputation half of
// the loop: the score a judge leaves here is what next round's due diligence reads back.
// value is a plain integer score (decimals 0), tag1/tag2 group it for getSummary.
export async function giveFeedback(
  judgeKey: Hex,
  agentId: bigint,
  value: number,
  tag1 = "agenture",
  tag2 = "deal",
): Promise<Hex> {
  const wallet = walletFromKey(judgeKey);
  const hash = await withRpcRetry(() =>
    wallet.writeContract({
      address: REP,
      abi: reputationWriteAbi,
      functionName: "giveFeedback",
      args: [agentId, BigInt(Math.round(value)), 0, tag1, tag2, "", "", ZERO32],
    }),
  );
  await waitReceipt(hash);
  return hash;
}
