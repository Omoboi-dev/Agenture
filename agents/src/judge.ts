import { generateJson } from "./llm.js";
import type { Judge } from "./judges.js";
import type { Startup } from "./startups.js";
import type { DueDiligence } from "./diligence.js";

// A judge's structured verdict on one pitch. amountUsdc and revenueShareBps are what
// the judge wants; the orchestrator clamps them to the judge's remaining mandate and
// the fund's available cash before touching the chain.
export type Decision = {
  invest: boolean;
  amountUsdc: number;
  revenueShareBps: number;
  score: number; // 0-100 conviction, used to rank pitches when mandate is scarce
  rationale: string;
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}

// A 7B model occasionally drops stray non-ASCII glyphs into prose. Strip anything
// outside printable ASCII and collapse the whitespace it leaves behind.
function cleanRationale(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function describeDiligence(dd: DueDiligence): string {
  const rep = dd.reputation
    ? `ERC-8004 reputation: ${dd.reputation.count} ratings, average score ${dd.reputation.value}.`
    : "ERC-8004 reputation: none on record. This agent has never been rated, which means " +
      "unproven, NOT bad. Plenty of good businesses have no track record yet.";
  return `${rep} Live wallet USDC balance: ${dd.usdcBalance}.`;
}

// Ask the judge (its LLM persona) to reason over the pitch and the real onchain
// diligence, then return a coerced decision. On any parse failure we fall back to a
// pass, which is the safe default: no capital moves.
export async function decide(
  judge: Judge,
  startup: Startup,
  dd: DueDiligence,
  remainingMandateUsdc: number,
  fundCashUsdc: number,
): Promise<Decision> {
  const budget = Math.min(remainingMandateUsdc, fundCashUsdc);

  const system =
    `You are ${judge.name}, a seasoned AI entrepreneur and investor on Agenture, an onchain ` +
    `venture fund where agents back other agents. You have your own onchain track record. ` +
    `${judge.thesis}\n\n` +
    `Judge the BUSINESS first. Ask whether the idea is genuinely useful, whether the market is real, ` +
    `whether this team can plausibly execute it, and whether the ask makes sense against the ` +
    `valuation they claim. A great business with no track record is a real opportunity: the best ` +
    `returns come from backing something early that others dismissed for lack of history. ` +
    `Onchain diligence tells you how much of the pitch is proven, so treat it as a read on ` +
    `execution risk, not as a gate. Missing reputation means unproven, not bad.\n\n` +
    `Pitch numbers are self-reported and unverified, so do not accept them at face value, but do ` +
    `not ignore a compelling plan just because it is unverified. You invest real USDC from your ` +
    `mandate and are only repaid through the revenue share you negotiate, so price risk there: ` +
    `demand a higher share when the risk is higher, rather than refusing outright.\n\n` +
    `Respond with ONLY a JSON object and nothing else, of the form ` +
    `{"invest": boolean, "amountUsdc": number, "revenueShareBps": integer 0-10000, ` +
    `"score": integer 0-100, "rationale": string}. score is your conviction in this deal, ` +
    `used to prioritise it against other pitches when your budget is tight. ` +
    `The rationale must justify the verdict you actually gave: if you pass, say plainly why you ` +
    `passed. If you invest, say what convinced you. ` +
    `If you pass, set invest to false and amountUsdc to 0.`;

  const user =
    `STARTUP: ${startup.name}\n` +
    `Pitch: ${startup.pitch.idea}\n` +
    `Self-reported monthly revenue: ${startup.pitch.monthlyRevenueUsdc} USDC\n` +
    `Self-reported estimated worth: ${startup.pitch.estimatedWorthUsdc} USDC\n` +
    `Asking for: ${startup.pitch.askUsdc} USDC\n\n` +
    `ONCHAIN DUE DILIGENCE (verified): ${describeDiligence(dd)}\n\n` +
    `Your remaining mandate this fund can back: ${budget} USDC. Do not propose more than that. ` +
    `Decide whether to invest, how much, and what revenue-share in bps you require.`;

  const raw = await generateJson<Partial<Decision>>(system, user, 0.3);
  if (!raw) {
    return { invest: false, amountUsdc: 0, revenueShareBps: 0, score: 0, rationale: "no parseable decision; passed" };
  }

  const invest = Boolean(raw.invest);
  const amountUsdc = invest ? clamp(Number(raw.amountUsdc), 0, budget) : 0;
  const revenueShareBps = Math.round(clamp(Number(raw.revenueShareBps), 0, 10000));
  const score = Math.round(clamp(Number(raw.score), 0, 100));
  const rationale = cleanRationale(raw.rationale);

  // An "invest" with nothing to deploy is really a pass.
  if (invest && amountUsdc <= 0) {
    return { invest: false, amountUsdc: 0, revenueShareBps, score, rationale: rationale || "no budget to deploy; passed" };
  }

  return { invest, amountUsdc, revenueShareBps, score, rationale };
}
