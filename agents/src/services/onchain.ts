import type { Address } from "viem";
import { formatUnits } from "viem";
import { clamp, type Delivery, type JobContext, type Review, type Service } from "./types.js";
import { publicClient, withRpcRetry } from "../chain.js";
import { addresses } from "../config.js";
import { erc20Abi } from "../abis.js";
import { startups } from "../startups.js";

// Onchain data and market data, sold to agents that need to know the state of the chain.
//
// The buyer asks something with one correct answer, the seller answers it, and the buyer
// looks it up itself. No quality, no model, no scoring by opinion.
//
// Providers differ on the two axes real ones differ on, and nothing here is fabricated.
//
//   freshness  `cached` serves from a real block about three hours old. Its answer was
//              correct then and is wrong now by exactly however much the chain moved.
//   coverage   `partial` only indexes some of the address space. For anything outside it
//              there is no answer to give, and a buyer that needed one got nothing.
//
// Freshness alone turned out to be a weak differentiator here, because balances only move
// while a market run is happening and are otherwise still for hours. A provider serving
// from an hour back scored 99. That is an honest result rather than a broken one: stale
// data is only wrong when something has happened. Coverage is what separates them the
// rest of the time.
//
// An earlier version had a provider quantise the current value instead. That was a bad
// idea: a fixed rounding step is brutal on a 0.60 USDC balance and invisible on a 31 USDC
// one, so it measured the size of the subject rather than the quality of the seller.

const USDC = addresses.usdc as Address;

// Arc runs at roughly 0.52s per block, so 20,000 is about three hours.
const STALE_BLOCKS = BigInt(process.env.SERVICE_STALE_BLOCKS ?? "20000");

/** Whether a partial-coverage provider has indexed an address. Deterministic, so the same
 *  provider is consistently blind to the same corners of the roster rather than randomly
 *  unlucky. Works out at ten of every sixteen addresses. */
function indexes(wallet: Address): boolean {
  return parseInt(wallet.slice(-1), 16) < 10;
}

type Task =
  | { kind: "balance"; subject: { name: string; wallet: Address } }
  | { kind: "ranking"; subjects: { name: string; wallet: Address }[] };

// usdc is null when the provider simply does not cover that address.
type Out = { kind: "balance"; usdc: number | null } | { kind: "ranking"; order: string[] };

async function balanceAt(wallet: Address, blockNumber?: bigint): Promise<number> {
  const raw = (await withRpcRetry(() =>
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
      ...(blockNumber === undefined ? {} : { blockNumber }),
    }),
  )) as bigint;
  return Number(formatUnits(raw, 6));
}

/** What the seller can actually answer, given how it is built. */
async function read(wallet: Address, impl: string, head: bigint): Promise<number | null> {
  if (impl === "partial") return indexes(wallet) ? balanceAt(wallet) : null;
  if (impl === "cached") return balanceAt(wallet, head - STALE_BLOCKS);
  return balanceAt(wallet);
}

function pick<T>(pool: T[], n: number, rnd: () => number): T[] {
  const out: T[] = [];
  while (out.length < Math.min(n, pool.length)) {
    const c = pool[Math.floor(rnd() * pool.length)];
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

export const onchainData: Service<Task, Out> = {
  name: "onchain data",
  sectors: ["onchain-data", "market-data"],
  implementations: ["live", "cached", "partial"],
  // Each job is two independent chain reads per subject, and Arc's public RPC is quota
  // limited, so this one asks for fewer samples than a purely local service would.
  maxJobs: 2,

  async task(ctx: JobContext): Promise<Task> {
    const pool = startups
      .filter((s) => s.name !== ctx.provider)
      .map((s) => ({ name: s.name, wallet: s.wallet as Address }));

    // Sometimes a buyer wants a figure, sometimes a comparison. Both are things a data
    // service is asked for, and a ranking exposes staleness that a single quote can hide.
    if (ctx.rnd() < 0.4) return { kind: "ranking", subjects: pick(pool, 3, ctx.rnd) };
    return { kind: "balance", subject: pick(pool, 1, ctx.rnd)[0] };
  },

  async deliver(task: Task, ctx: JobContext): Promise<Delivery<Out>> {
    const started = Date.now();
    const head = await withRpcRetry(() => publicClient.getBlockNumber());

    const claim =
      ctx.impl === "cached"
        ? `served from block ${head - STALE_BLOCKS}, roughly ${Math.round((Number(STALE_BLOCKS) * 0.52) / 60)} minutes behind`
        : ctx.impl === "partial"
          ? "read from the head of the chain, for the addresses this provider indexes"
          : "read from the head of the chain";

    if (task.kind === "balance") {
      const usdc = await read(task.subject.wallet, ctx.impl, head);
      return { output: { kind: "balance", usdc }, claim, ms: Date.now() - started };
    }

    // Anything the provider cannot see is simply absent from the ranking it returns.
    const seen: { name: string; usdc: number }[] = [];
    for (const s of task.subjects) {
      const usdc = await read(s.wallet, ctx.impl, head);
      if (usdc !== null) seen.push({ name: s.name, usdc });
    }
    seen.sort((a, b) => b.usdc - a.usdc);
    return { output: { kind: "ranking", order: seen.map((s) => s.name) }, claim, ms: Date.now() - started };
  },

  async review(task: Task, delivery: Delivery<Out>, _ctx: JobContext): Promise<Review> {
    if (task.kind === "balance" && delivery.output.kind === "balance") {
      const got = delivery.output.usdc;
      if (got === null) return { score: 0, reason: `no figure returned for ${task.subject.name}: not covered by this provider` };
      const truth = await balanceAt(task.subject.wallet);
      const err = Math.abs(got - truth) / Math.max(truth, 1);
      // Full marks inside a tenth of a percent, nothing beyond a quarter off. A treasury
      // agent acting on a balance that is 25% wrong is not getting a partial service.
      const score = clamp(Math.round(100 * (1 - err / 0.25)), 0, 100);
      return {
        score,
        reason: `quoted ${got.toFixed(2)} USDC for ${task.subject.name}, actual ${truth.toFixed(2)}, off by ${(err * 100).toFixed(1)}%`,
      };
    }

    if (task.kind === "ranking" && delivery.output.kind === "ranking") {
      const live: Record<string, number> = {};
      for (const s of task.subjects) live[s.name] = await balanceAt(s.wallet);
      const truth = [...task.subjects].map((s) => s.name).sort((a, b) => live[b] - live[a]);

      // Scored on pairwise agreement rather than exact order, so getting one pair wrong
      // costs less than getting the whole thing backwards.
      const got = delivery.output.order;
      let concordant = 0;
      let pairs = 0;
      for (let i = 0; i < truth.length; i++) {
        for (let j = i + 1; j < truth.length; j++) {
          pairs++;
          const a = got.indexOf(truth[i]);
          const b = got.indexOf(truth[j]);
          // A pair the provider could not rank, because one side is missing from its
          // coverage, counts against it. The buyer asked and did not get an answer.
          if (a !== -1 && b !== -1 && a < b) concordant++;
        }
      }
      const missing = task.subjects.filter((s) => !got.includes(s.name)).map((s) => s.name);
      const score = pairs === 0 ? 100 : Math.round((concordant / pairs) * 100);
      return {
        score,
        reason:
          `ranked ${got.join(" > ") || "nothing"}, actual ${truth.join(" > ")}, ${concordant} of ${pairs} pairs right` +
          (missing.length > 0 ? `; did not cover ${missing.join(", ")}` : ""),
      };
    }

    return { score: 0, reason: "answered a different question from the one asked" };
  },
};
