import type { Address } from "viem";
import { formatUnits } from "viem";
import { publicClient, withRpcRetry } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { readReputationSummary } from "./dd.js";
import { customers } from "./customers.js";
import type { Startup } from "./startups.js";

// The real onchain picture a judge gets on a startup, independent of what the pitch
// claims. Reputation arrives split by who wrote it, because the two sources are not
// equally worth believing.
//
// `market` is feedback from agents that paid for the service. `investor` is feedback from
// the fund's own side: judges rating companies they backed, which is an investor marking
// its own homework. On this deployment the investor average runs well above what the
// buyers say, and worst exactly where it matters: agents no customer has ever bought from
// still carry high scores written by the judges that funded them. A judge shown one
// blended number cannot see that, so it is not shown one.
export type Signal = { count: number; value: number } | null;

export type DueDiligence = {
  reputation: Signal; // everything, for the record
  market: Signal; // clients that paid for the service
  investor: Signal; // the fund's own judges
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

// ERC-8004 getSummary requires an explicit set of raters and reverts on an empty list, so
// every set below has to stay non-empty.
//
// The split is by who rated, not by the tag they used. Tags have drifted over the life of
// this deployment ("deal", "service", "purchase") and a rater's incentive has not: a
// buyer that paid is evidence, a judge that funded the deal is an opinion with a position
// behind it. Sorting by wallet stays correct whatever anyone labels their feedback.

// The fund's own side. Includes judges' pre-migration EOA wallets, so the reputation they
// already wrote still counts.
const INVESTOR_CLIENTS_RAW = [
  addresses.agenture.operator,
  ...addresses.agenture.judges.map((j) => j.wallet),
  "0x7F2733B91b12bcF2cfE99E2aa2617286b93cA7de", // alpha's old EOA
  "0xf2fD1775118E21Ea5B9507235d3556C97181a9F7", // nova's old EOA
  "0x62050AB71Cd055cD48ed4fc2aD940606F7d63467", // sable's old EOA
  "0xcA76529b251502130b8AAaD091c03b72F37e0008", // spike rater from the first integration test
];

// Agents that paid for a service and said what they thought of it. The only feedback in
// the system with nobody's investment riding on it, and what lets a newcomer arrive with
// a track record instead of every pitch being a cold start.
const MARKET_CLIENTS_RAW = [
  ...customers.map((c) => c.wallet).filter((w): w is Address => Boolean(w)),
  addresses.agenture.customer.wallet, // the original single house customer, and seed-traction's buyer
];

const lower = (xs: string[]) => Array.from(new Set(xs.map((a) => a.toLowerCase()))) as Address[];

export const INVESTOR_CLIENTS = lower(INVESTOR_CLIENTS_RAW);
export const MARKET_CLIENTS = lower(MARKET_CLIENTS_RAW);
export const KNOWN_CLIENTS = lower([...INVESTOR_CLIENTS_RAW, ...MARKET_CLIENTS_RAW]);

async function summarize(agentId: bigint, clients: Address[]): Promise<Signal> {
  const sum = await readReputationSummary(agentId, clients, "", "");
  return sum.count > 0 ? { count: sum.count, value: sum.value } : null;
}

export async function gatherDiligence(s: Startup): Promise<DueDiligence> {
  const usdcBalance = await readUsdcBalance(s.wallet);
  if (s.agentId === null) return { reputation: null, market: null, investor: null, usdcBalance };

  // Three reads rather than one. Paced, because the public Arc RPC is quota limited and a
  // round only ever does this for the cohort it is hearing.
  const reputation = await summarize(s.agentId, KNOWN_CLIENTS);
  const market = await summarize(s.agentId, MARKET_CLIENTS);
  const investor = await summarize(s.agentId, INVESTOR_CLIENTS);

  return { reputation, market, investor, usdcBalance };
}
