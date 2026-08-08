import type { Address } from "viem";
import { formatUnits } from "viem";
import { startups, type Startup } from "./startups.js";
import { getDeal, dealCount } from "./close-loop.js";

// A startup does not queue up at the same committee every week. It pitches, and if it is
// funded it leaves the arena to go and run the business. It only comes back once it has
// something to show, and then it is judged on what it did with the last cheque.
//
// Status is derived from the chain rather than stored, so it can never drift out of sync
// with what actually happened.

export type Stage = "seeking" | "portfolio" | "followOn";

export type Position = {
  startup: Startup;
  stage: Stage;
  raised: bigint;
  returned: bigint;
  dealIds: number[];
};

// How much of its raise a portfolio company must have paid back before it may ask for
// more. Low enough that traction shows up within a couple of settlement cycles.
const FOLLOW_ON_BAR_BPS = Number(process.env.FOLLOW_ON_BAR_BPS ?? "1000"); // 10%

export async function readPositions(): Promise<Position[]> {
  const count = await dealCount();

  const byStartup = new Map<string, { raised: bigint; returned: bigint; dealIds: number[] }>();
  for (let i = 0n; i < count; i++) {
    const deal = await getDeal(i);
    const key = deal.startup.toLowerCase();
    const entry = byStartup.get(key) ?? { raised: 0n, returned: 0n, dealIds: [] };
    entry.raised += deal.amount;
    entry.returned += deal.returned;
    entry.dealIds.push(Number(i));
    byStartup.set(key, entry);
  }

  return startups.map((startup) => {
    const found = byStartup.get(startup.wallet.toLowerCase());
    if (!found || found.raised === 0n) {
      return { startup, stage: "seeking" as Stage, raised: 0n, returned: 0n, dealIds: [] };
    }
    const paidBackBps = Number((found.returned * 10000n) / found.raised);
    return {
      startup,
      stage: paidBackBps >= FOLLOW_ON_BAR_BPS ? ("followOn" as Stage) : ("portfolio" as Stage),
      raised: found.raised,
      returned: found.returned,
      dealIds: found.dealIds,
    };
  });
}

/// Who gets heard this round. The queue is first come, first served: agents are heard in
/// the order they registered, so an agent that provisioned earlier is seen sooner and
/// nobody jumps ahead. `startups` preserves registration order because
/// `provision-startups` appends to the roster, so position in that list is the queue.
///
/// A funded company is not in the queue at all. It only reappears once it has earned a
/// follow-on, and then it takes one slot so the round is still mostly fresh deal flow.
export function pickCohort(positions: Position[], size: number): Position[] {
  const queue = positions.filter((p) => p.stage === "seeking");
  const followOn = positions.filter((p) => p.stage === "followOn");

  const cohort: Position[] = [];
  // Reserve a slot for a returning company when one has qualified.
  const newSlots = followOn.length > 0 ? Math.max(1, size - 1) : size;
  cohort.push(...queue.slice(0, newSlots));
  if (followOn.length > 0) cohort.push(followOn[0]);

  return cohort.slice(0, size);
}

/// Where an agent sits in the queue to be heard, 1-based. null once it has been funded.
export function queuePosition(positions: Position[], name: string): number | null {
  const queue = positions.filter((p) => p.stage === "seeking");
  const i = queue.findIndex((p) => p.startup.name === name);
  return i === -1 ? null : i + 1;
}

export function describeStage(p: Position): string {
  const u = (b: bigint) => formatUnits(b, 6);
  switch (p.stage) {
    case "seeking":
      return "first raise";
    case "followOn":
      return `follow-on, returned ${u(p.returned)} of ${u(p.raised)} USDC`;
    default:
      return `portfolio, returned ${u(p.returned)} of ${u(p.raised)} USDC`;
  }
}

export function findPosition(positions: Position[], wallet: Address): Position | undefined {
  const w = wallet.toLowerCase();
  return positions.find((p) => p.startup.wallet.toLowerCase() === w);
}
