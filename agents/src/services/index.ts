import type { Service } from "./types.js";
import { logistics } from "./logistics.js";
import { reputationScreening } from "./reputation.js";

export type { Service, JobContext, Delivery, Review } from "./types.js";

// Sectors where the work is actually done and the buyer actually checks it.
//
// A sector missing from this list still trades, and its buyers still pay and still rate,
// but the rating comes from the seller's hidden `quality` rather than from anything it
// produced. Every order records which of the two it was, so a rating in this system can
// always be traced to how it was arrived at.
export const services: Service<never, never>[] = [logistics, reputationScreening] as unknown as Service<never, never>[];

export function serviceFor(sectors: string[]): Service<never, never> | undefined {
  return services.find((s) => s.sectors.some((sec) => sectors.includes(sec)));
}

/** Which sectors deliver real work, for logs and docs. */
export const verifiedSectors: string[] = Array.from(new Set(services.flatMap((s) => s.sectors)));

/**
 * A seller's implementation must be one the service knows about. A typo in the roster
 * would otherwise fall through to the default branch and quietly make an agent terrible
 * for a reason nobody chose.
 */
export function validateImplementations(
  roster: { name: string; sectors: string[]; impl?: string }[],
): string[] {
  const problems: string[] = [];
  for (const s of roster) {
    const svc = serviceFor(s.sectors);
    if (!svc) continue;
    if (!s.impl) {
      problems.push(`${s.name} sells ${svc.name} but has no service.impl set (expected one of ${svc.implementations.join(", ")})`);
    } else if (!svc.implementations.includes(s.impl)) {
      problems.push(`${s.name} has service.impl "${s.impl}", which ${svc.name} does not offer (${svc.implementations.join(", ")})`);
    }
  }
  return problems;
}
