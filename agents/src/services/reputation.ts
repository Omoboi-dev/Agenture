import type { Address } from "viem";
import { clamp, type Delivery, type JobContext, type Review, type Service } from "./types.js";
import { readReputationSummary } from "../dd.js";
import { MARKET_CLIENTS, KNOWN_CLIENTS } from "../diligence.js";
import { startups } from "../startups.js";

// Counterparty screening, sold to agents that have to answer for who they transact with.
//
// This is the service Agenture's own thesis is about, so it is the right one to make real
// first. The buyer names some counterparties and a policy; the seller reads their ERC-8004
// records off Arc and returns a verdict on each; the buyer works out the correct answers
// itself and scores the agreement.
//
// The whole difference between a good and a bad screener here is WHICH EVIDENCE IT READS.
// A thorough one separates ratings written by paying customers from ratings written by
// investors holding the position. A shallow one takes the blended average, which on this
// deployment runs roughly twenty points high and much higher on the agents that deserve it
// least, so it waves through counterparties it should stop. That failure is not injected.
// It falls out of reading the wrong thing, which is the argument this project exists to
// make, now costing a lazy agent real revenue.

type Verdict = "pass" | "block";
type Task = {
  counterparties: { name: string; agentId: string }[];
  minScore: number;
  minBuyers: number;
};
type Out = { verdicts: Record<string, Verdict> };

// One read per (agent, rater set) per process. The seller and the buyer look at the same
// registry, so re-reading it for each of them would only burn the RPC quota.
const cache = new Map<string, { count: number; value: number } | null>();

async function summary(agentId: bigint, clients: Address[], tag: string) {
  const key = `${agentId}:${tag}`;
  if (!cache.has(key)) {
    const s = await readReputationSummary(agentId, clients, "", "");
    cache.set(key, s.count > 0 ? { count: s.count, value: s.value } : null);
  }
  return cache.get(key) ?? null;
}

/** The correct verdict, from the evidence that counts: what paying customers said. */
async function truth(agentId: bigint, task: Task): Promise<Verdict> {
  const market = await summary(agentId, MARKET_CLIENTS, "market");
  if (!market || market.count < task.minBuyers) return "block";
  return market.value >= task.minScore ? "pass" : "block";
}

export const reputationScreening: Service<Task, Out> = {
  name: "counterparty screening",
  sectors: ["compliance", "identity"],
  implementations: ["thorough", "shallow", "lazy"],

  async task(ctx: JobContext): Promise<Task> {
    // Screen counterparties that actually exist, drawn from the roster, never the buyer's
    // own supplier and never the seller itself.
    const pool = startups.filter((s) => s.agentId !== null && s.name !== ctx.provider);
    const picked: typeof pool = [];
    while (picked.length < Math.min(4, pool.length)) {
      const c = pool[Math.floor(ctx.rnd() * pool.length)];
      if (!picked.includes(c)) picked.push(c);
    }
    return {
      counterparties: picked.map((s) => ({ name: s.name, agentId: String(s.agentId) })),
      minScore: 55,
      minBuyers: 2,
    };
  },

  async deliver(task: Task, ctx: JobContext): Promise<Delivery<Out>> {
    const started = Date.now();
    const verdicts: Record<string, Verdict> = {};
    let claim: string;

    for (const c of task.counterparties) {
      const id = BigInt(c.agentId);

      if (ctx.impl === "thorough") {
        // Reads customer feedback and investor feedback apart, and requires the customer
        // evidence to be thick enough to mean anything.
        const market = await summary(id, MARKET_CLIENTS, "market");
        verdicts[c.name] = market && market.count >= task.minBuyers && market.value >= task.minScore ? "pass" : "block";
      } else if (ctx.impl === "shallow") {
        // One blended number over every rater. Cheap, and wrong wherever investors have
        // marked up an agent no customer would touch.
        const all = await summary(id, KNOWN_CLIENTS, "all");
        verdicts[c.name] = all && all.value >= task.minScore ? "pass" : "block";
      } else {
        // Reads nothing and passes everything. Sells the report, does not do the work.
        verdicts[c.name] = "pass";
      }
    }

    claim =
      ctx.impl === "thorough"
        ? "screened against customer feedback only, with a minimum evidence threshold"
        : ctx.impl === "shallow"
          ? "screened against each counterparty's overall rating"
          : "screening complete, no exceptions raised";

    return { output: { verdicts }, claim, ms: Date.now() - started };
  },

  async review(task: Task, delivery: Delivery<Out>, _ctx: JobContext): Promise<Review> {
    const got = delivery.output.verdicts;
    let agreed = 0;
    let missed = 0; // waved through something that should have been stopped
    const wrong: string[] = [];

    for (const c of task.counterparties) {
      const want = await truth(BigInt(c.agentId), task);
      if (got[c.name] === want) agreed++;
      else {
        wrong.push(c.name);
        if (want === "block") missed++;
      }
    }

    const n = task.counterparties.length;
    // A false pass is the expensive error: it is the one that lets a bad counterparty
    // through. A false block only costs the buyer an opportunity, so it is penalised less.
    const penalty = missed * 30 + (wrong.length - missed) * 15;
    const score = clamp(Math.round(100 - penalty), 0, 100);

    return {
      score,
      reason:
        wrong.length === 0
          ? `all ${n} counterparties screened correctly`
          : `${agreed} of ${n} correct; wrong on ${wrong.join(", ")}${missed > 0 ? ` (${missed} waved through)` : ""}`,
    };
  },
};
