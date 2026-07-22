import type { Address } from "viem";
import { formatUnits } from "viem";
import { publicClient, withRpcRetry } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { readReputationSummary } from "./dd.js";
import type { Startup } from "./startups.js";

// The real onchain picture a judge gets on a startup, independent of what the pitch
// claims: its ERC-8004 reputation (or null if it has never been rated) and the live
// USDC balance in its wallet.
export type DueDiligence = {
  reputation: { count: number; value: number } | null;
  usdcBalance: number; // human, 6dp
};

async function readUsdcBalance(wallet: Address): Promise<number> {
  const raw = (await withRpcRetry(() =>
    publicClient.readContract({
      address: addresses.usdc as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    }),
  )) as bigint;
  return Number(formatUnits(raw, 6));
}

// ERC-8004 getSummary requires an explicit set of raters (it reverts on an empty list).
// Agenture trusts its own circle: the fund operator, every judge, and known historical
// raters from earlier rounds. Reputation is aggregated over feedback from these clients.
const KNOWN_CLIENTS: Address[] = Array.from(
  new Set(
    [
      addresses.agenture.operator,
      ...addresses.agenture.judges.map((j) => j.wallet),
      "0xcA76529b251502130b8AAaD091c03b72F37e0008", // spike rater, has prior feedback
    ].map((a) => a.toLowerCase()),
  ),
) as Address[];

export async function gatherDiligence(s: Startup): Promise<DueDiligence> {
  const usdcBalance = await readUsdcBalance(s.wallet);

  let reputation: DueDiligence["reputation"] = null;
  if (s.agentId !== null) {
    // Aggregate reputation from trusted raters, across all tags. Count 0 = cold start.
    const sum = await readReputationSummary(s.agentId, KNOWN_CLIENTS, "", "");
    reputation = sum.count > 0 ? { count: sum.count, value: sum.value } : null;
  }

  return { reputation, usdcBalance };
}
