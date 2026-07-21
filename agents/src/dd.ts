import type { Address } from "viem";
import { publicClient } from "./chain.js";
import { addresses } from "./config.js";
import { reputationAbi } from "./abis.js";

export type ReputationSummary = {
  count: number; // how many feedbacks matched
  value: number; // averaged score
  decimals: number;
};

// The real onchain signal the judges reason over: a startup agent's ERC-8004
// reputation, aggregated by tag. A brand-new startup returns count 0 (cold start),
// which is itself a signal the judges must weigh.
export async function readReputationSummary(
  agentId: bigint,
  clients: Address[],
  tag1: string,
  tag2 = "",
): Promise<ReputationSummary> {
  const [count, value, decimals] = (await publicClient.readContract({
    address: addresses.erc8004.reputationRegistry as Address,
    abi: reputationAbi,
    functionName: "getSummary",
    args: [agentId, clients, tag1, tag2],
  })) as [bigint, bigint, number];

  return { count: Number(count), value: Number(value), decimals };
}
