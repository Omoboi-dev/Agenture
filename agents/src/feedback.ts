import type { Address, Hex } from "viem";
import { addresses } from "./config.js";
import { circleExecute } from "./circle.js";

const REP = addresses.erc8004.reputationRegistry as Address;
const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

// A judge (client) rates a startup (agent) on ERC-8004, signing from its own Circle
// wallet. This is the reputation half of the loop: the score a judge leaves here is what
// next round's due diligence reads back. value is a plain integer score (decimals 0).
export async function giveFeedback(
  judgeWalletId: string,
  agentId: bigint,
  value: number,
  tag1 = "agenture",
  tag2 = "deal",
): Promise<Hex> {
  return circleExecute(
    judgeWalletId,
    REP,
    "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
    [agentId.toString(), Math.round(value).toString(), "0", tag1, tag2, "", "", ZERO32],
  );
}
