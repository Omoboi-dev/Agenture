import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateJson } from "./llm.js";
import { startups } from "./startups.js";

// Draft new startup agents for the arena. Writes to shared/startup-drafts.json for a
// human to read BEFORE anything is provisioned, because once a startup has a wallet and
// an ERC-8004 identity, rewriting its pitch means a different company wearing the same
// address. Cheap to review first, dishonest to fix afterwards.

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../shared/startup-drafts.json");

export type Draft = {
  name: string;
  idea: string;
  monthlyRevenueUsdc: number;
  estimatedWorthUsdc: number;
  askUsdc: number;
  // Whether this agent should arrive having already traded: real x402 earnings and real
  // ratings from a non-judge client, seeded before it ever pitches. Deal flow is not all
  // cold starts, and judges need something to tell newcomers apart by.
  arrivesWithTraction: boolean;
  profile: string; // which shape of business this is, for review
  // What the agent sells, so a customer can find it, and how well it actually delivers.
  // Both are set here rather than asked of the model: the sector has to match the fixed
  // vocabulary in catalog.ts, and quality is the ground truth of this world, which the
  // thing being described obviously does not get to pick.
  sectors: string[];
  quality: number;
};

// The model reliably invents good names and ideas, and just as reliably collapses every
// financial figure to the same number. So the shape of each business is chosen here and
// the model writes only the story that fits it. A cohort has to actually vary or the
// judges have nothing to tell one pitch from another.
type Profile = {
  key: string;
  brief: string;
  revenue: [number, number];
  worthMultiple: [number, number];
  ask: [number, number];
  // How well it will actually serve a customer, 0..1. The judges never see it and neither
  // does the pitch: it only shows up in what a buyer thinks after paying. Ranges overlap
  // on purpose, so a profile is a tendency rather than a label a judge could decode.
  quality: [number, number];
};

const PROFILES: Record<string, Profile> = {
  proven: {
    key: "proven",
    brief: "an established agent with real paying customers and steady revenue",
    revenue: [400, 2500],
    worthMultiple: [15, 30],
    ask: [2, 5],
    quality: [0.68, 0.9],
  },
  earlyTraction: {
    key: "earlyTraction",
    brief: "an agent with a handful of early paying users and a credible path to more",
    revenue: [40, 350],
    worthMultiple: [30, 60],
    ask: [1, 4],
    quality: [0.52, 0.76],
  },
  preRevenue: {
    key: "preRevenue",
    brief: "a pre-revenue agent with a genuinely strong idea and a large addressable market",
    revenue: [0, 0],
    worthMultiple: [0, 0],
    ask: [3, 6],
    quality: [0.28, 0.72],
  },
  overvalued: {
    key: "overvalued",
    brief: "an agent with a vague, hype-heavy pitch and a valuation it cannot justify",
    revenue: [0, 40],
    worthMultiple: [0, 0],
    ask: [5, 6],
    quality: [0.1, 0.38],
  },
  modest: {
    key: "modest",
    brief: "a small, unglamorous agent doing one narrow job reliably for a little money",
    revenue: [15, 120],
    worthMultiple: [10, 25],
    ask: [1, 3],
    quality: [0.44, 0.66],
  },
};

// Deliberate spread: a few clear yeses, a few clear noes, and several genuine judgement
// calls. Six of these are unproven, so a judge that only reads reputation funds nothing.
const MIX = [
  "proven", "earlyTraction", "preRevenue", "overvalued", "modest",
  "preRevenue", "proven", "overvalued", "earlyTraction", "preRevenue",
];

const rand = (lo: number, hi: number) => lo + Math.round(Math.random() * (hi - lo));

function financials(p: Profile): Pick<Draft, "monthlyRevenueUsdc" | "estimatedWorthUsdc" | "askUsdc" | "arrivesWithTraction"> {
  const revenue = rand(p.revenue[0], p.revenue[1]);
  let worth: number;
  if (p.key === "preRevenue") worth = rand(60, 400) * 1000;
  else if (p.key === "overvalued") worth = rand(500, 3000) * 1000;
  else worth = Math.max(5000, revenue * rand(p.worthMultiple[0], p.worthMultiple[1]));
  return {
    monthlyRevenueUsdc: revenue,
    estimatedWorthUsdc: worth,
    askUsdc: rand(p.ask[0], p.ask[1]),
    arrivesWithTraction: revenue > 0,
  };
}

// Each brief is paired with the catalog sectors it sells into, because a buyer matches on
// those keys and nothing else. Guessing them from the finished pitch text works most of
// the time and fails silently the rest, which would leave a funded agent invisible to
// every customer for no reason anyone chose.
//
// Note that "security" has no buyer on the current customer roster. That is left in
// deliberately: an agent nobody needs is a real outcome, and a judge that funds one should
// find out the same way a real investor does.
const SECTORS: { brief: string; sectors: string[] }[] = [
  { brief: "onchain data and indexing", sectors: ["onchain-data"] },
  { brief: "agent-to-agent payments infrastructure", sectors: ["payments"] },
  { brief: "content or media generation sold to other agents", sectors: ["media"] },
  { brief: "security, auditing or monitoring for agents", sectors: ["security", "compliance"] },
  { brief: "logistics, scheduling or coordination between agents", sectors: ["logistics"] },
  { brief: "identity, attestation or compliance tooling", sectors: ["identity", "compliance"] },
  { brief: "market making or liquidity routing", sectors: ["market-data"] },
  { brief: "translation, summarisation or research services", sectors: ["media"] },
  { brief: "storage, caching or retrieval", sectors: ["storage"] },
  { brief: "simulation, testing or benchmarking", sectors: ["security"] },
];

async function draftOne(sector: (typeof SECTORS)[number], profile: Profile, taken: string[]): Promise<Draft | null> {
  const system =
    "You invent autonomous software agents that sell services to OTHER AUTONOMOUS AGENTS on a " +
    "blockchain. There are no humans anywhere in this world. The customers are always other " +
    "agents: trading agents, indexing agents, relayer agents, wallet agents and so on. They pay " +
    "per call in USDC over x402, automatically, with no invoices, no subscriptions and no sales.\n\n" +
    "NEVER mention businesses, companies, enterprises, teams, startups, users, customers, clients, " +
    "developers, institutions, marketers or people as the buyer. The buyer is always other agents.\n\n" +
    'Respond with ONLY a JSON object of the form {"name": string, "idea": string}. ' +
    "name is one or two words joined in CamelCase with no spaces, and should be distinctive. " +
    "idea is ONE sentence: what it does, which kind of agent buys it, and what it charges per unit.";

  const user =
    `Invent one autonomous agent working in: ${sector.brief}.\n` +
    `It should read as ${profile.brief}. Let that show in the writing: a specific, concrete pitch ` +
    "for a solid one, and a vague, buzzword-heavy pitch for a weak one.\n" +
    "Example of the right register: \"Indexes ERC-8004 feedback events and serves them to " +
    "diligence agents over a query API, charging 0.001 USDC per lookup.\"";

  // Force a distinct initial. Asked the same question twice this model returns the same
  // name twice, however high the temperature, so a rejected draft retried verbatim just
  // burns quota on the same collision. Naming the taken names instead would be worse: the
  // model treats a forbidden list as a suggestion and hands them straight back.
  const used = new Set(taken.map((t) => t[0]?.toUpperCase()).filter(Boolean));
  const free = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((c) => !used.has(c));
  const initial = free.length > 0 ? free[Math.floor(Math.random() * free.length)] : "";
  const withInitial = initial ? `${user}\nThe name must begin with the letter ${initial}.` : user;

  const raw = await generateJson<{ name?: string; idea?: string }>(system, withInitial, 0.9);
  if (!raw || typeof raw.name !== "string" || typeof raw.idea !== "string") return null;

  const name = raw.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
  if (!name) return null;
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) {
    console.log(`  (${name} is already taken, retrying)`);
    return null;
  }

  const idea = raw.idea.replace(/[^\x20-\x7E]/g, "").trim();
  const HUMAN_WORDS =
    /\b(business(es)?|compan(y|ies)|enterprise|team|startup|user|customer|client|developer|institution|marketer|people|organi[sz]ation|brand|SEO|subscription|invoice)s?\b/i;
  if (HUMAN_WORDS.test(idea)) {
    console.log(`  (${name} pitched to humans, rejecting)`);
    return null;
  }

  const [qLo, qHi] = profile.quality;
  return {
    name,
    idea,
    profile: profile.key,
    sectors: sector.sectors,
    quality: Math.round((qLo + Math.random() * (qHi - qLo)) * 100) / 100,
    ...financials(profile),
  };
}

async function main() {
  const count = Number(process.env.COUNT ?? "10");
  const taken = startups.map((s) => s.name);
  const drafts: Draft[] = [];

  console.log(`Drafting ${count} startup agents...\n`);

  // Sector advances on every attempt, profile only on every accepted draft. A rejection
  // has to change the question or the next call is the same call: the sector is what the
  // model actually keys its answer off, and the profile is what gives the cohort the
  // spread of good and bad bets it needs, so only one of them may depend on failures.
  for (let i = 0; drafts.length < count && i < count * 4; i++) {
    const sector = SECTORS[i % SECTORS.length];
    const profile = PROFILES[MIX[drafts.length % MIX.length]];
    const d = await draftOne(sector, profile, [...taken, ...drafts.map((x) => x.name)]);
    if (!d) continue;
    drafts.push(d);
    console.log(
      `${String(drafts.length).padStart(2)}. ${d.name.padEnd(16)} [${d.profile.padEnd(13)}] ${d.sectors.join("/").padEnd(20)} ` +
        `ask ${String(d.askUsdc).padStart(2)} · claims ${String(d.monthlyRevenueUsdc).padStart(4)}/mo · ` +
        `worth ${d.estimatedWorthUsdc.toLocaleString("en-US")} · truth ${d.quality.toFixed(2)}` +
        `${d.arrivesWithTraction ? " · arrives traded" : ""}`,
    );
    console.log(`    ${d.idea}`);
  }

  writeFileSync(OUT, `${JSON.stringify({ drafts }, null, 2)}\n`);
  console.log(`\nWrote ${drafts.length} drafts to shared/startup-drafts.json.`);
  console.log("Review and edit that file, then run: bun run provision-startups");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
