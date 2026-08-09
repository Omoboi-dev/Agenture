import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient, withRpcRetry } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { catalog, SECTOR_LABEL, type Listing } from "./catalog.js";
import { serviceFor, verifiedSectors, validateImplementations } from "./services/index.js";
import { liveCustomers, budgetOf, type LiveCustomer } from "./customers.js";
import { readReputationSummary } from "./dd.js";
import { KNOWN_CLIENTS } from "./diligence.js";
import { payViaX402 } from "./x402.js";
import { payViaNanopayments, gatewayBalance } from "./nanopay.js";
import { rateAfterPurchase } from "./feedback.js";
import { settle } from "./revenue.js";
import { getDeal, dealCount } from "./close-loop.js";
import { findJudgeByWallet } from "./judges.js";
import { generate } from "./llm.js";
import {
  readMarket,
  writeMarket,
  nextRunId,
  remember,
  type Experience,
  type Memory,
  type Order,
  type Reason,
  type Settlement,
  type MarketRun,
} from "./marketlog.js";

// The market. Four customer agents, each with its own wallet, browse the whole roster and
// decide what to buy. Nobody assigns them a budget line and
// nothing tells a seller it has been chosen: revenue is what is left over after four
// independent shopping trips.
//
//   read reputation -> each customer decides -> x402 payment -> the buyer forms an
//   opinion -> it rates the seller on ERC-8004 -> sellers settle the fund's cut
//
// The judges are not in that sentence anywhere, which is the point. Their returns are
// downstream of whether real buyers came back.

const USDC = addresses.usdc as Address;
const fmt = (b: bigint) => formatUnits(b, 6);
const num = (b: bigint) => Number(formatUnits(b, 6));
const U = (n: string) => parseUnits(n, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_ORDERS = Number(process.env.MARKET_ORDERS_PER_CUSTOMER ?? "2");
const GAS_RESERVE = U(process.env.MARKET_GAS_RESERVE_USDC ?? "0.35");
const NEUTRAL = 0.5; // what an unknown seller is worth before any evidence
const STALE_AFTER = Number(process.env.MARKET_STALE_AFTER ?? "4"); // runs before a seller is worth another look

// Deterministic where it can be. Satisfaction noise and the exploration coin are the only
// randomness in the system, and a seeded generator means a dry run can be re-read and
// argued with instead of being a one-off.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type Quote = Listing & { reputation: { count: number; value: number } | null };

export type Intent = {
  provider: Quote;
  units: number;
  amount: bigint;
  reason: Reason;
  score: number;
};

/**
 * One customer's shopping decision. Pure: same inputs, same basket. Everything the
 * customer is allowed to know is an argument, and its own memory is the only private
 * part. It never sees a seller's quality, and it never sees another customer's book.
 */
export function decide(
  c: LiveCustomer,
  quotes: Quote[],
  book: Record<string, Experience>,
  budget: bigint,
  rnd: () => number,
  runId = 1,
  maxOrders = MAX_ORDERS,
): Intent[] {
  // Every seller on the roster, not a slice of it. A buyer browses the whole marketplace
  // and decides for itself; the only thing that rules a seller out is not being able to
  // afford one unit of it.
  //
  // An earlier version restricted each buyer to sectors it "needed", so that an agent
  // nobody wanted would earn nothing. That is a real effect, but it was a rule imposed on
  // the market rather than something the market produced, and it left two thirds of the
  // roster invisible to any given buyer. The buyers still differ from each other without
  // it: they weigh price, reputation and their own experience differently, and each one
  // has a private history nobody else can read.
  const affordable = quotes.filter((q) => q.unitPrice <= budget);
  if (affordable.length === 0) return [];

  const cheapest = affordable.reduce((lo, q) => (q.unitPrice < lo ? q.unitPrice : lo), affordable[0].unitPrice);
  const { experience, reputation, price } = c.weights;
  const total = experience + reputation + price || 1;

  const scored = affordable.map((q) => {
    const own = book[q.name]?.satisfaction ?? null;
    const pub = q.reputation ? clamp(q.reputation.value / 100, 0, 1) : null;
    // A seller with no history is neither good nor bad. Scoring it as zero would make
    // "never tried" indistinguishable from "tried and terrible", and the market would
    // freeze around whoever happened to sell first.
    const term = (experience * (own ?? NEUTRAL) + reputation * (pub ?? NEUTRAL) + price * (Number(cheapest) / Number(q.unitPrice))) / total;
    const reason: Reason = own !== null ? "repeat" : pub !== null ? "reputation" : "trial";
    const lastSeen = book[q.name]?.lastRunId ?? -Infinity;
    return { provider: q, score: term, reason, stale: runId - lastSeen > STALE_AFTER };
  });

  scored.sort((a, b) => b.score - a.score);
  const picks = scored.slice(0, maxOrders);

  // Exploration. Spend the last slot on a seller this customer has not dealt with lately
  // rather than on the next best familiar name.
  //
  // "Not lately" rather than "never" on purpose. A seller judged on a single delivery can
  // have been unlucky, and if one weak first impression locked it out permanently, the
  // fund would be holding positions in agents that are unsellable for reasons no longer
  // true. Never tried counts as maximally stale, so a newcomer still gets its first
  // customer this way.
  const stale = scored.filter((s) => s.stale && !picks.includes(s));
  if (stale.length > 0 && picks.length > 0 && rnd() < c.explore) {
    picks[picks.length - 1] = { ...stale[Math.floor(rnd() * stale.length)], reason: "trial" };
  }

  // Split the budget by score, then buy whole units. A seller the customer rates highly
  // gets a bigger share of the wallet, which is how satisfaction turns into revenue
  // without anything computing revenue from quality.
  const weightSum = picks.reduce((a, p) => a + p.score, 0) || 1;
  let left = budget;
  const intents: Intent[] = [];

  for (const p of picks) {
    if (left < p.provider.unitPrice) continue;
    const share = (budget * BigInt(Math.round((p.score / weightSum) * 10000))) / 10000n;
    const spend = share > left ? left : share;
    const units = Number(spend / p.provider.unitPrice);
    if (units < 1) continue;
    const amount = p.provider.unitPrice * BigInt(units);
    left -= amount;
    intents.push({ provider: p.provider, units, amount, reason: p.reason, score: p.score });
  }

  return intents;
}

/**
 * What the customer got, when there is nothing real to receive. The fallback: a seller in
 * a sector no service has been written for cannot deliver anything, so satisfaction comes
 * from its hidden quality with noise. This is the one authored seam left in the system and
 * it shrinks every time a sector gets a real implementation under services/.
 *
 * Exported because seed-traction produces the same thing: a rating from a client that
 * paid. If it used a different rule, an agent could arrive rated 84 and then be
 * contradicted by every buyer that touched it, which would read as a noisy customer
 * signal rather than as two bits of code disagreeing.
 */
export function experienceOf(quality: number, rnd: () => number = Math.random): number {
  return clamp(quality + (rnd() * 2 - 1) * 0.15, 0.02, 0.99);
}

const JOBS_PER_ORDER = Number(process.env.MARKET_JOBS_PER_ORDER ?? "3");

/**
 * Pay for one order, preferring Circle Gateway nanopayments.
 *
 * Nanopayments is the right rail for this market: orders are fractions of a USDC, and
 * settling each one onchain costs gas to move less than a dollar. Gateway takes the
 * buyer's signed authorization, batches it with everyone else's, and pays gas once for
 * the batch. The buyer needs a Gateway balance for that, so a buyer that has not
 * deposited yet falls through to the direct x402 rail rather than failing to trade.
 *
 * Set MARKET_RAIL=x402 to force the onchain path.
 */
async function payForOrder(
  walletId: string,
  buyer: Address,
  seller: Address,
  amount: bigint,
  operatorKey: Hex,
): Promise<{ tx: string | null; rail: "nanopayments" | "x402" }> {
  if (process.env.MARKET_RAIL !== "x402") {
    try {
      const res = await payViaNanopayments(walletId, buyer, seller, amount);
      if (res.settled) return { tx: res.tx, rail: "nanopayments" };
      console.log(`    nanopayments unavailable (${res.reason}), settling onchain instead`);
    } catch (e) {
      console.log(`    nanopayments failed (${String((e as Error).message).split("\n")[0]}), settling onchain instead`);
    }
  }
  return { tx: await payViaX402(walletId, buyer, operatorKey, seller, amount), rail: "x402" };
}

/**
 * Buy the service for real: the buyer sets a task, the seller performs it, the buyer
 * checks the result. Runs several jobs per order and averages, because one route or one
 * screening is a small sample to judge a supplier on.
 *
 * Returns null when this sector has no implementation yet, so the caller falls back.
 */
async function useService(
  listing: Listing,
  buyer: string,
  units: number,
  rnd: () => number,
): Promise<{ satisfaction: number; jobs: number; note: string } | null> {
  const svc = serviceFor(listing.sectors);
  const impl = listing.startup.service?.impl;
  if (!svc || !impl) return null;

  const ctx = { buyer, provider: listing.name, impl, rnd };
  const jobs = Math.max(1, Math.min(units, svc.maxJobs ?? JOBS_PER_ORDER));
  const scores: number[] = [];
  let last = "";

  for (let i = 0; i < jobs; i++) {
    const task = await svc.task(ctx);
    const delivery = await svc.deliver(task, ctx);
    const review = await svc.review(task, delivery, ctx);
    scores.push(review.score);
    last = review.reason;
  }

  const mean = scores.reduce((a, s) => a + s, 0) / scores.length;
  return { satisfaction: clamp(mean / 100, 0.01, 1), jobs, note: last };
}

async function balanceOf(addr: Address): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
  )) as bigint;
}

async function quoteBoard(): Promise<Quote[]> {
  const quotes: Quote[] = [];
  for (const l of catalog) {
    let reputation: Quote["reputation"] = null;
    if (l.startup.agentId !== null) {
      const sum = await readReputationSummary(l.startup.agentId, KNOWN_CLIENTS, "", "");
      if (sum.count > 0) reputation = { count: sum.count, value: sum.value };
    }
    quotes.push({ ...l, reputation });
  }
  return quotes;
}

// Sellers pay the fund its share of what they sold this run. Revenue is metered per deal,
// so an agent two judges backed splits its takings between them in proportion to what
// each put in. An agent nobody funded keeps everything, which is exactly right: it has
// traction and no investor, and that is the case a judge should want to see.
async function settleSales(
  sales: Map<string, bigint>,
  dryRun: boolean,
): Promise<Settlement[]> {
  const out: Settlement[] = [];
  const count = await dealCount();
  const active: Array<{ id: number; startup: string; amount: bigint; bps: number; judge: string }> = [];
  for (let i = 0n; i < count; i++) {
    const d = await getDeal(i);
    if (d.status === 0) {
      active.push({ id: Number(i), startup: d.startup.toLowerCase(), amount: d.amount, bps: d.revenueShareBps, judge: d.judge });
    }
  }

  for (const [name, revenue] of sales) {
    const listing = catalog.find((l) => l.name === name);
    if (!listing) continue;
    const deals = active.filter((d) => d.startup === listing.startup.wallet.toLowerCase());

    if (deals.length === 0) {
      out.push({ startup: name, dealId: null, revenueUsdc: num(revenue), cutUsdc: 0, judge: null, note: "unfunded traction" });
      console.log(`  ${name} sold ${fmt(revenue)} USDC with no investor behind it; it keeps all of it.`);
      continue;
    }

    const backing = deals.reduce((a, d) => a + d.amount, 0n);
    let assigned = 0n;
    for (const [i, d] of deals.entries()) {
      const slice = i === deals.length - 1 ? revenue - assigned : (revenue * d.amount) / backing;
      assigned += slice;
      if (slice <= 0n) continue;

      const cut = (slice * BigInt(d.bps)) / 10000n;
      const judge = findJudgeByWallet(d.judge as Address)?.name ?? null;
      if (!dryRun) {
        try {
          await settle(listing.startup.walletId, BigInt(d.id), slice);
        } catch (e) {
          console.log(`  ${name} could not settle deal #${d.id}: ${String((e as Error).message).split("\n")[0]}`);
          continue;
        }
        await sleep(1200);
      }
      out.push({ startup: name, dealId: d.id, revenueUsdc: num(slice), cutUsdc: num(cut), judge });
      console.log(`  ${name} settled ${fmt(slice)} USDC on deal #${d.id}: ${fmt(cut)} to ${judge ?? "the fund"}.`);
    }
  }

  return out;
}

// One customer says why it shopped the way it did. This is the only model call in the
// market and nothing depends on it: if it fails, the run is unchanged and the note is
// null. Pick the customer whose behaviour moved, because a buyer that did the same thing
// as last time has nothing to explain.
async function narrate(
  orders: Order[],
  memory: Memory,
  previous: MarketRun | undefined,
): Promise<MarketRun["note"]> {
  if (process.env.MARKET_NARRATE === "off" || orders.length === 0) return null;

  const byCustomer = new Map<string, Order[]>();
  for (const o of orders) byCustomer.set(o.customer, [...(byCustomer.get(o.customer) ?? []), o]);

  const changed = [...byCustomer.entries()].find(([name, os]) => {
    const before = new Set((previous?.orders ?? []).filter((o) => o.customer === name).map((o) => o.provider));
    return before.size > 0 && os.some((o) => !before.has(o.provider));
  });
  const [name, basket] =
    changed ?? [...byCustomer.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))[0];

  const book = memory[name] ?? {};
  const history = Object.entries(book)
    .map(([p, e]) => `${p}: ${e.orders} orders, satisfaction ${(e.satisfaction * 100).toFixed(0)}/100`)
    .join("; ");
  // Two things kept apart on purpose. Handed the reason and the outcome in one clause,
  // the model reports the score as the reason it bought, which is backwards: the score
  // is what it thought afterwards. That sentence goes on the marketplace page.
  const why: Record<Reason, string> = {
    repeat: "because you have bought from them before and were satisfied",
    reputation: "because other clients rate them well",
    trial: "as a first look, having never used them",
  };
  const bought = basket
    .map(
      (o) =>
        `${o.units} units from ${o.provider} for ${o.amountUsdc.toFixed(2)} USDC in total ` +
        `(${o.unitPriceUsdc.toFixed(2)} each), chosen ${why[o.reason]}`,
    )
    .join("; ");
  const results = basket
    .map((o) => `${o.provider} delivered ${((o.satisfaction ?? 0) * 100).toFixed(0)} out of 100`)
    .join("; ");

  try {
    const text = await generate(
      "You are a procurement agent reporting to your operator. One sentence, under 30 words, plain and factual. No preamble, no quotes, no markdown.",
      `You are ${name}.\nWhat you bought this period, and why you picked each: ${bought}.\n` +
        `How it then turned out: ${results}.\n` +
        `Your record with sellers before this: ${history || "none, this is your first period"}.\n` +
        `Say in one sentence what you did and why you picked them. Do not use the delivery scores as the reason you bought: you only learned those afterwards.`,
      0.6,
    );
    const clean = text.trim().replace(/^["']|["']$/g, "").split("\n")[0];
    return clean ? { customer: name, text: clean.slice(0, 240) } : null;
  } catch (e) {
    console.log(`  narration skipped (${String((e as Error).message).split("\n")[0]}).`);
    return null;
  }
}

const sum = (os: Order[]) => os.reduce((a, o) => a + o.amountUsdc, 0);

export type MarketResult = { orders: Order[]; settlements: Settlement[]; volume: bigint; cut: bigint };

export async function runMarket(opts: { dryRun?: boolean; operatorKey?: Hex } = {}): Promise<MarketResult> {
  const dryRun = opts.dryRun ?? false;
  const buyers = liveCustomers();
  if (buyers.length === 0) {
    console.log("No customer agents have wallets yet. Run: bun run provision-customers");
    return { orders: [], settlements: [], volume: 0n, cut: 0n };
  }
  if (!dryRun && !opts.operatorKey) throw new Error("a live market run needs the operator key to settle x402 payments");

  const runId = nextRunId();
  const seedEnv = process.env.MARKET_SEED;
  const rnd = rng(seedEnv ? Number(seedEnv) : runId * 7919 + Date.now() % 100000);
  const { memory, runs } = readMarket();
  const previous = runs[runs.length - 1];

  // A bad impl name would fall through to a service's default branch and make an agent
  // quietly terrible for a reason nobody chose. Refuse to trade rather than mislabel one.
  const problems = validateImplementations(
    catalog.map((l) => ({ name: l.name, sectors: l.sectors, impl: l.startup.service?.impl })),
  );
  if (problems.length > 0) throw new Error(`roster problems:\n  ${problems.join("\n  ")}`);

  console.log(`--- Market · run ${runId}${dryRun ? " (dry)" : ""} ---`);
  console.log(`Real delivery in: ${verifiedSectors.map((s) => SECTOR_LABEL[s] ?? s).join(", ")}. Elsewhere the rating still comes from the seller's quality.\n`);

  const quotes = await quoteBoard();
  const orders: Order[] = [];
  const sales = new Map<string, bigint>();

  for (const c of buyers) {
    // A buyer's spending power is its wallet plus its Gateway balance, because payments
    // draw on either rail. Counting only the wallet made buyers look broke moments after
    // they had deposited into Gateway, which is where their money had gone.
    //
    // The gas reserve comes off the wallet alone. Gateway funds pay for goods; the small
    // amount of gas an agent needs to write its ERC-8004 rating has to be in the wallet.
    const held = await balanceOf(c.wallet);
    const inGateway = await gatewayBalance(c.wallet).catch(() => 0n);
    const walletSpendable = held > GAS_RESERVE ? held - GAS_RESERVE : 0n;
    const spendable = walletSpendable + inGateway;
    const budget = spendable < budgetOf(c) ? spendable : budgetOf(c);

    if (budget < U("0.3")) {
      console.log(`${c.name} holds ${fmt(held)} USDC and ${fmt(inGateway)} in Gateway; cannot buy this run.\n`);
      continue;
    }

    const intents = decide(c, quotes, memory[c.name] ?? {}, budget, rnd, runId);
    if (intents.length === 0) {
      console.log(`${c.name} found nothing on the marketplace it could afford.\n`);
      continue;
    }

    console.log(`${c.name} · budget ${fmt(budget)} USDC (wallet ${fmt(held)}, Gateway ${fmt(inGateway)})`);
    for (const it of intents) {
      const p = it.provider;
      const label = SECTOR_LABEL[p.sectors[0]] ?? p.sectors[0];
      const why =
        it.reason === "repeat"
          ? `bought before, satisfaction ${((memory[c.name]?.[p.name]?.satisfaction ?? 0) * 100).toFixed(0)}`
          : it.reason === "reputation"
            ? `rated ${p.reputation?.value} by ${p.reputation?.count} clients`
            : "never tried it";

      const order: Order = {
        customer: c.name,
        provider: p.name,
        sector: p.sectors[0],
        units: it.units,
        unitPriceUsdc: num(p.unitPrice),
        amountUsdc: num(it.amount),
        reason: it.reason,
        paidTx: null,
        rail: undefined,
        satisfaction: null,
        rated: null,
        ratedTx: null,
        delivery: null,
      };

      console.log(`  buys ${it.units} x ${label} from ${p.name} · ${fmt(it.amount)} USDC · ${why}`);

      if (!dryRun) {
        try {
          const paid = await payForOrder(c.walletId, c.wallet, p.startup.wallet, it.amount, opts.operatorKey as Hex);
          order.paidTx = paid.tx;
          order.rail = paid.rail;
          console.log(`    paid via ${paid.rail === "nanopayments" ? "Gateway nanopayments, gasless" : "x402 onchain"}`);
        } catch (e) {
          console.log(`    payment failed: ${String((e as Error).message).split("\n")[0]}`);
          orders.push(order);
          continue;
        }
        await sleep(1200);
      }

      // The buyer uses what it paid for and forms an opinion. Where the sector has a real
      // implementation the seller actually does the work and the buyer checks it; where it
      // does not, satisfaction falls back to the seller's hidden quality.
      const real = await useService(p, c.name, it.units, rnd);
      const satisfaction = real ? real.satisfaction : experienceOf(p.startup.quality, rnd);
      order.satisfaction = Number(satisfaction.toFixed(3));
      order.rated = Math.round(satisfaction * 100);
      order.delivery = real ? { verified: true, jobs: real.jobs, note: real.note } : null;
      remember(memory, c.name, p.name, it.units, num(it.amount), satisfaction, runId);
      sales.set(p.name, (sales.get(p.name) ?? 0n) + it.amount);

      console.log(`    delivered: ${order.rated}/100${real ? ` · verified over ${real.jobs} job${real.jobs === 1 ? "" : "s"} · ${real.note}` : " · unverified (no service implementation)"}`);

      if (!dryRun && p.startup.agentId !== null) {
        try {
          order.ratedTx = await rateAfterPurchase(c.walletId, p.startup.agentId, order.rated);
          console.log(`    ${c.name} rated ${p.name} ${order.rated} on ERC-8004`);
        } catch (e) {
          console.log(`    rating skipped (${String((e as Error).message).split("\n")[0]})`);
        }
        await sleep(1200);
      }

      orders.push(order);
    }
    console.log("");
  }

  console.log("--- Settlement ---");
  const settlements = orders.length > 0 ? await settleSales(sales, dryRun) : [];
  if (settlements.length === 0) console.log("  nothing sold, nothing to settle.");

  const note = await narrate(orders, memory, previous);
  if (note) console.log(`\n${note.customer}: "${note.text}"`);

  const volume = orders.reduce((a, o) => a + (o.satisfaction === null ? 0n : U(o.amountUsdc.toFixed(6))), 0n);
  const cut = settlements.reduce((a, s) => a + U(s.cutUsdc.toFixed(6)), 0n);

  const run: MarketRun = { id: runId, at: new Date().toISOString(), dryRun, note, orders, settlements };
  // A dry run must not teach anyone anything. It never happened.
  if (!dryRun) writeMarket(memory, run);

  console.log(`\nVolume ${fmt(volume)} USDC across ${orders.length} orders; ${fmt(cut)} USDC to the fund.`);
  if (dryRun) console.log("Dry run: nothing paid, nothing rated, nothing remembered.");

  return { orders, settlements, volume, cut };
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  const operatorKey = raw ? ((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex) : undefined;
  if (!dryRun && !operatorKey) throw new Error("missing DEPLOYER_PRIVATE_KEY in environment");

  console.log(`=== Agenture market · ${new Date().toISOString()} ===\n`);
  await runMarket({ dryRun, operatorKey });
}

if (process.argv[1]?.endsWith("market.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
