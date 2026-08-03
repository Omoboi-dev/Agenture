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
  score: number; // 0-100 conviction, used to rank pitches when capital is scarce
  rationale: string;
  // The four components the score is built from, kept for the record so a conviction can
  // be read rather than just trusted.
  breakdown?: { idea: number; evidence: number; price: number; risk: number };
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

// A raw "average score 48" tells the model nothing, and it will happily read it as good
// news. Spell out what the number is worth.
function readScore(value: number): string {
  if (value >= 85) return "excellent: its clients rate it among the best they deal with";
  if (value >= 70) return "solid: its clients are satisfied";
  if (value >= 55) return "mediocre: its clients are lukewarm, which is a yellow flag";
  if (value >= 40) return "POOR: its own paying clients rate it badly, which is a serious red flag";
  return "VERY POOR: its clients consider it close to unusable";
}

function describeDiligence(dd: DueDiligence): string {
  const rep = dd.reputation
    ? `ERC-8004 reputation: ${dd.reputation.count} rating(s) averaging ${dd.reputation.value} out of 100. ` +
      `A score of ${dd.reputation.value} is ${readScore(dd.reputation.value)}. ` +
      `This comes from clients that actually paid this agent, so it is evidence about the ` +
      `service as delivered, not a claim.`
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
    `A bad reputation is worse than no reputation. An agent whose paying clients rate it poorly ` +
    `has been tested and found wanting, which is stronger evidence against it than silence. ` +
    `Be especially wary of a large claimed valuation sitting on top of tiny revenue and a weak ` +
    `score: that is the classic overvalued pitch.\n\n` +
    `Respond with ONLY a JSON object and nothing else, of the form ` +
    `{"invest": boolean, "amountUsdc": number, "revenueShareBps": integer 0-10000, ` +
    `"idea": integer, "evidence": integer, "price": integer, "risk": integer, ` +
    `"rationale": string}.\n\n` +
    `Do not hand back a single overall score. Rate these four things separately and honestly, ` +
    `and give each its own number, because a pitch that is strong on one is often weak on another:\n` +
    `  "idea": 0-30. How useful and defensible is the business itself?\n` +
    `  "evidence": 0-30. How much of the story is actually proven onchain? A poor reputation ` +
    `scores lower here than no reputation at all.\n` +
    `  "price": 0-20. Is the ask sensible against the claimed valuation and revenue?\n` +
    `  "risk": 0-20. How likely is it to survive and keep paying the revenue share?\n` +
    `Use the full width of each range. Award a maximum only for something genuinely exceptional.\n\n` +
    `The rationale must justify the verdict you actually gave: if you pass, say plainly why you ` +
    `passed, naming the specific weakness. If you invest, say what convinced you. ` +
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
  const rationale = cleanRationale(raw.rationale);

  // Conviction is the sum of the four components rather than a number the model picks,
  // which is what stops every pitch coming back at 85.
  const part = (v: unknown, max: number) => Math.round(clamp(Number(v), 0, max));
  const breakdown = {
    idea: part((raw as Record<string, unknown>).idea, 30),
    evidence: part((raw as Record<string, unknown>).evidence, 30),
    price: part((raw as Record<string, unknown>).price, 20),
    risk: part((raw as Record<string, unknown>).risk, 20),
  };
  const score = breakdown.idea + breakdown.evidence + breakdown.price + breakdown.risk;

  // An "invest" with nothing to deploy is really a pass.
  if (invest && amountUsdc <= 0) {
    return {
      invest: false,
      amountUsdc: 0,
      revenueShareBps,
      score,
      rationale: rationale || "no budget to deploy; passed",
      breakdown,
    };
  }

  return { invest, amountUsdc, revenueShareBps, score, rationale, breakdown };
}
