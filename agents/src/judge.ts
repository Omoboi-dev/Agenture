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
  if (value >= 85) return "excellent, among the best they deal with";
  if (value >= 70) return "solid, they are satisfied";
  if (value >= 55) return "mediocre and lukewarm, which is a yellow flag";
  if (value >= 40) return "POOR, rated badly, which is a serious red flag";
  return "VERY POOR, close to unusable";
}

// Reputation is presented split by who wrote it, and the gap between the two is called
// out rather than averaged away. Blending them hides the one thing a judge most needs to
// know: whether anyone outside this fund has ever been willing to pay for the service.
function describeDiligence(dd: DueDiligence): string {
  const lines: string[] = [];

  if (dd.market) {
    lines.push(
      `PAYING CUSTOMERS: ${dd.market.count} rating(s) averaging ${dd.market.value} out of 100 ` +
        `from agents that bought this service with their own money. A score of ${dd.market.value} is ` +
        `${readScore(dd.market.value)}. This is the strongest evidence you have, because these raters ` +
        `have no stake in the agent succeeding.`,
    );
  } else {
    lines.push(
      "PAYING CUSTOMERS: none. No agent has ever paid for this service and rated it. That is not " +
        "proof the business is bad, but it does mean nothing about it has been tested by a buyer.",
    );
  }

  if (dd.investor) {
    lines.push(
      `OTHER INVESTORS: ${dd.investor.count} rating(s) averaging ${dd.investor.value} out of 100 ` +
        `from judges on this fund. Weigh this far less than the customer score: a judge that already ` +
        `backed this agent has a position to defend, so these ratings run generous.`,
    );
  } else {
    lines.push("OTHER INVESTORS: no judge on this fund has rated this agent.");
  }

  // The disagreement is the signal, so state it outright rather than leaving a small model
  // to notice two numbers twenty points apart on its own.
  if (dd.market && dd.investor && dd.investor.value - dd.market.value >= 12) {
    lines.push(
      `NOTE THE GAP: investors rate this agent ${dd.investor.value - dd.market.value} points higher ` +
        `than the customers paying for it. Believe the customers.`,
    );
  }
  if (!dd.market && dd.investor && dd.investor.value >= 70) {
    lines.push(
      "NOTE: this agent carries a good investor score while never having sold anything to anyone. " +
        "That score is other investors' opinion, not traction. Treat it as unproven.",
    );
  }

  return `${lines.join(" ")} Live wallet USDC balance: ${dd.usdcBalance}.`;
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
    `${judge.rule}\n\n` +
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
    `Reputation comes to you split by who wrote it. Ratings from paying customers are evidence: ` +
    `those agents spent their own money and owe this fund nothing. Ratings from other judges are ` +
    `opinion from people holding the same position you are being offered, and on this fund they ` +
    `run consistently higher than what the customers say. Where the two disagree, believe the ` +
    `customers, and score "evidence" on what the customers said rather than on the blend.\n\n` +
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

  const raw = await generateJson<Partial<Decision>>(system, user, 0.7);
  if (!raw) {
    return { invest: false, amountUsdc: 0, revenueShareBps: 0, score: 0, rationale: "no parseable decision; passed" };
  }

  const invest = Boolean(raw.invest);
  let amountUsdc = invest ? clamp(Number(raw.amountUsdc), 0, budget) : 0;
  const revenueShareBps = Math.round(clamp(Number(raw.revenueShareBps), 0, 10000));
  const rationale = cleanRationale(raw.rationale);

  // Conviction is built from four components rather than a number the model picks, which
  // is what stops every pitch coming back at 85. The components are then weighted by the
  // judge's own priorities, which is what stops all three judges returning the same
  // verdict: a prescriptive rubric otherwise swamps the persona entirely.
  const part = (v: unknown, max: number) => Math.round(clamp(Number(v), 0, max));
  const breakdown = {
    idea: part((raw as Record<string, unknown>).idea, 30),
    evidence: part((raw as Record<string, unknown>).evidence, 30),
    price: part((raw as Record<string, unknown>).price, 20),
    risk: part((raw as Record<string, unknown>).risk, 20),
  };
  const w = judge.weights;
  const earned =
    breakdown.idea * w.idea + breakdown.evidence * w.evidence + breakdown.price * w.price + breakdown.risk * w.risk;
  const possible = 30 * w.idea + 30 * w.evidence + 20 * w.price + 20 * w.risk;
  const score = Math.round((earned / possible) * 100);

  // Sizing discipline, applied after the fact. Asked nicely, a judge will happily put its
  // whole wallet into one deal, or exceed its own stated cap on an unproven agent.
  const concentrationCap = remainingMandateUsdc * judge.maxTicketPct;
  const weakEvidence = breakdown.evidence < 15;
  const ceiling = weakEvidence ? Math.min(concentrationCap, judge.unprovenCapUsdc) : concentrationCap;
  if (amountUsdc > ceiling) amountUsdc = Math.round(ceiling * 1e6) / 1e6;

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
