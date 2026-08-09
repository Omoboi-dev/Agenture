import type { Address, Hex } from "viem";
import { addresses } from "./config.js";
import { circleExecute } from "./circle.js";

const REP = addresses.erc8004.reputationRegistry as Address;
const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

// A client rates an agent on ERC-8004, signing from its own Circle wallet. This is the
// reputation half of the loop: what is written here is what next round's due diligence
// reads back. value is a plain integer score (decimals 0).
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

// A customer rates a seller it has paid. Tagged "purchase" rather than "deal" so the two
// kinds of feedback stay separable: a judge rating its own portfolio company is an
// investor marking its own homework, while this is a buyer reporting on what it received.
// Due diligence reads both, but only one of them is evidence.
export async function rateAfterPurchase(
  customerWalletId: string,
  agentId: bigint,
  value: number,
): Promise<Hex> {
  return giveFeedback(customerWalletId, agentId, value, "agenture", "purchase");
}
