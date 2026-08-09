import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Two things live here, and they are different in kind.
//
// `memory` is state a customer agent owns: what it has bought, from whom, and how it felt
// about it. It is private to that customer and it is the thing that makes the next
// purchase different from the last one. Nothing else may read it to make a decision.
//
// `runs` is a record of what happened, for the UI. The payments and the ratings in it are
// pointers to transactions on Arc; the reasoning is the only part that lives nowhere else.

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKET_PATH = join(HERE, "../../shared/market.json");
const KEEP = 12;

/** What one customer has learned about one seller. */
export type Experience = {
  orders: number;
  units: number;
  spentUsdc: number;
  /** 0..1, an exponential moving average so recent delivery counts for more. */
  satisfaction: number;
  lastRunId: number;
};

export type Memory = Record<string, Record<string, Experience>>;

export type Reason = "repeat" | "reputation" | "trial";

export type Order = {
  customer: string;
  provider: string;
  sector: string;
  units: number;
  unitPriceUsdc: number;
  amountUsdc: number;
  reason: Reason;
  /** Null until the payment lands, so a failed order is visibly a failed order. */
  paidTx: string | null;
  /** Which rail settled it: Circle Gateway nanopayments (batched, gasless) or a direct
   *  onchain x402 transfer. Recorded because the two have very different economics. */
  rail?: "nanopayments" | "x402";
  satisfaction: number | null;
  rated: number | null;
  ratedTx: string | null;
  /** How the rating was arrived at. Present when the seller actually performed the work
   *  and the buyer checked it; null when the sector has no implementation yet and the
   *  score came from the seller's hidden quality instead. */
  delivery?: { verified: boolean; jobs: number; note: string } | null;
};

export type Settlement = {
  startup: string;
  dealId: number | null;
  revenueUsdc: number;
  cutUsdc: number;
  judge: string | null;
  note?: string;
};

export type MarketRun = {
  id: number;
  at: string;
  dryRun: boolean;
  /** One customer explains its shopping in its own words. Null when the model is down,
   *  which must never stop the market: the trading is the product, the sentence is not. */
  note: { customer: string; text: string } | null;
  orders: Order[];
  settlements: Settlement[];
};

type MarketFile = { memory: Memory; runs: MarketRun[] };

const EMPTY: MarketFile = { memory: {}, runs: [] };

export function readMarket(): MarketFile {
  if (!existsSync(MARKET_PATH)) return { memory: {}, runs: [] };
  try {
    const parsed = JSON.parse(readFileSync(MARKET_PATH, "utf8")) as Partial<MarketFile>;
    return {
      memory: parsed.memory ?? {},
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export function nextRunId(): number {
  const { runs } = readMarket();
  return runs.length === 0 ? 1 : Math.max(...runs.map((r) => r.id)) + 1;
}

export function writeMarket(memory: Memory, run: MarketRun): void {
  const { runs } = readMarket();
  const next: MarketFile = { memory, runs: [...runs, run].slice(-KEEP) };
  writeFileSync(MARKET_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

const SMOOTHING = 0.4;

/** Fold one purchase into a customer's view of a seller. */
export function remember(
  memory: Memory,
  customer: string,
  provider: string,
  units: number,
  spentUsdc: number,
  satisfaction: number,
  runId: number,
): void {
  const book = (memory[customer] ??= {});
  const prev = book[provider];
  book[provider] = {
    orders: (prev?.orders ?? 0) + 1,
    units: (prev?.units ?? 0) + units,
    spentUsdc: Number(((prev?.spentUsdc ?? 0) + spentUsdc).toFixed(6)),
    satisfaction: prev
      ? Number((prev.satisfaction * (1 - SMOOTHING) + satisfaction * SMOOTHING).toFixed(4))
      : Number(satisfaction.toFixed(4)),
    lastRunId: runId,
  };
}
