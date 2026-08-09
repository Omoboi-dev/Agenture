import { clamp, type Delivery, type JobContext, type Review, type Service } from "./types.js";

// Route optimisation, sold to agents that move things.
//
// The cleanest verifiable service in the system: the buyer hands over a set of stops, the
// seller returns the order to visit them in, and the buyer measures the route itself. A
// shorter route is better, and by exactly how much is arithmetic. There is no hidden
// quality, no model, and no judgement call anywhere in the scoring.
//
// Eight stops is chosen so the buyer can brute force the true optimum (7! = 5040 tours)
// in a millisecond and score against it rather than against a guess.

type Stop = { x: number; y: number };
type Task = { stops: Stop[] };
type Out = { order: number[] };

const STOPS = 8;

function distance(a: Stop, b: Stop): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Length of the tour depot -> stops in `order` -> depot. Stop 0 is the depot. */
function tourLength(stops: Stop[], order: number[]): number {
  let total = 0;
  let at = 0;
  for (const next of order) {
    total += distance(stops[at], stops[next]);
    at = next;
  }
  return total + distance(stops[at], stops[0]);
}

function nearestNeighbour(stops: Stop[]): number[] {
  const left = new Set(stops.map((_, i) => i).slice(1));
  const order: number[] = [];
  let at = 0;
  while (left.size > 0) {
    let best = -1;
    let bestD = Infinity;
    for (const i of left) {
      const d = distance(stops[at], stops[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    order.push(best);
    left.delete(best);
    at = best;
  }
  return order;
}

/** Repeatedly reverse a segment when doing so shortens the tour. */
function twoOpt(stops: Stop[], start: number[]): number[] {
  let order = [...start];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (tourLength(stops, candidate) < tourLength(stops, order) - 1e-9) {
          order = candidate;
          improved = true;
        }
      }
    }
  }
  return order;
}

/** The true optimum, by exhaustive search. Only tractable because STOPS is small. */
function exact(stops: Stop[]): number[] {
  const ids = stops.map((_, i) => i).slice(1);
  let best: number[] = ids;
  let bestLen = Infinity;

  const permute = (fixed: number[], rest: number[]) => {
    if (rest.length === 0) {
      const len = tourLength(stops, fixed);
      if (len < bestLen) {
        bestLen = len;
        best = [...fixed];
      }
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      permute([...fixed, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)]);
    }
  };
  permute([], ids);
  return best;
}

export const logistics: Service<Task, Out> = {
  name: "route optimisation",
  sectors: ["logistics"],
  implementations: ["exact", "twoOpt", "nearest", "naive"],

  async task(ctx: JobContext): Promise<Task> {
    const stops: Stop[] = [];
    for (let i = 0; i < STOPS; i++) {
      stops.push({ x: Math.round(ctx.rnd() * 1000) / 10, y: Math.round(ctx.rnd() * 1000) / 10 });
    }
    return { stops };
  },

  async deliver(task: Task, ctx: JobContext): Promise<Delivery<Out>> {
    const started = Date.now();
    const ids = task.stops.map((_, i) => i).slice(1);
    let order: number[];
    let claim: string;

    switch (ctx.impl) {
      case "exact":
        order = exact(task.stops);
        claim = "exhaustive search over every tour";
        break;
      case "twoOpt":
        order = twoOpt(task.stops, nearestNeighbour(task.stops));
        claim = "nearest neighbour refined with 2-opt";
        break;
      case "nearest":
        order = nearestNeighbour(task.stops);
        claim = "greedy nearest neighbour";
        break;
      default:
        // Returns the stops in the order they arrived. A real service, badly built.
        order = ids;
        claim = "stops dispatched in the order received";
    }

    return { output: { order }, claim, ms: Date.now() - started };
  },

  async review(task: Task, delivery: Delivery<Out>, _ctx: JobContext): Promise<Review> {
    const { order } = delivery.output;
    const ids = task.stops.map((_, i) => i).slice(1);

    // Before scoring quality, check the seller answered the question at all. A route that
    // skips a stop or visits one twice is not a bad route, it is not a route.
    const valid = order.length === ids.length && new Set(order).size === ids.length && order.every((i) => ids.includes(i));
    if (!valid) return { score: 0, reason: "returned route did not visit every stop exactly once" };

    const got = tourLength(task.stops, order);
    const best = tourLength(task.stops, exact(task.stops));
    const worst = tourLength(task.stops, ids);

    // Scored against what was achievable, not against an absolute. Full marks for the
    // optimum, zero for no better than not bothering.
    const span = worst - best;
    const score = span < 1e-9 ? 100 : clamp(Math.round(((worst - got) / span) * 100), 0, 100);
    const excess = best > 0 ? ((got - best) / best) * 100 : 0;

    return {
      score,
      reason: `route ${got.toFixed(1)} against a best possible ${best.toFixed(1)}, ${excess.toFixed(1)}% longer than optimal`,
    };
  },
};
