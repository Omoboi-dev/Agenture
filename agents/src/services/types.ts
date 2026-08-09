// Real service delivery.
//
// Until now a buyer's satisfaction was drawn from a hidden `quality` on the seller: the
// one authored number in the system. This replaces it for the sectors implemented here.
// The buyer states a task, the seller actually performs it, and the buyer scores what came
// back by checking it itself. Nobody consults `quality` and nobody asks a model how good
// the work was.
//
// The part that is still authored is which IMPLEMENTATION each seller runs, and that is a
// much smaller and more honest claim than a quality score. A route solver that returns a
// longer route really is worse, demonstrably, and a compliance checker that reads the
// wrong evidence really does return wrong verdicts. The market measures the result; we
// only decide what code each agent is running, exactly as reality decides it.
//
// Rules a service must obey:
//   1. `review` may not look at the seller, its quality, or its implementation. It gets
//      the task and the output, and works out the score on its own.
//   2. Everything is deterministic given the supplied rng, so a run can be re-read.
//   3. No model calls in this file or anything under it. These sectors are arithmetic.

export type JobContext = {
  buyer: string;
  provider: string;
  /** Which implementation this seller runs. Unknown to the buyer. */
  impl: string;
  rnd: () => number;
};

export type Delivery<Out = unknown> = {
  output: Out;
  /** What the seller says it did. Goes in the log; the buyer does not score it. */
  claim: string;
  ms: number;
};

export type Review = {
  /** 0..100, computed by the buyer from the output alone. */
  score: number;
  /** Why. Shown in the marketplace so a rating can be read rather than trusted. */
  reason: string;
};

export type Service<Task = unknown, Out = unknown> = {
  name: string;
  sectors: string[];
  /** Implementations a seller can be assigned, best-known first. Used to validate the roster. */
  implementations: string[];
  /** Cap on jobs sampled per order. Services that hit the chain ask for fewer, because
   *  Arc's public RPC is quota limited and a purely local service is free to sample more. */
  maxJobs?: number;
  /** The buyer says what it needs. */
  task(ctx: JobContext): Promise<Task>;
  /** The seller does the work. This is where implementations differ. */
  deliver(task: Task, ctx: JobContext): Promise<Delivery<Out>>;
  /** The buyer checks the result against its own reckoning. */
  review(task: Task, delivery: Delivery<Out>, ctx: JobContext): Promise<Review>;
};

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
