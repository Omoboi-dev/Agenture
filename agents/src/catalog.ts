import { parseUnits } from "viem";
import { startups, type Startup } from "./startups.js";

// The selling side of the market: what each funded agent actually offers, and what it
// charges for one unit of it.
//
// Sectors are how a buyer finds a seller at all. A customer agent has standing needs and
// only ever looks at services that meet them, which is what makes demand structural: an
// excellent agent in a sector nobody buys earns nothing, and that is a real answer rather
// than a bug.
//
// A sector is read from the roster when the agent declares one, and inferred from its
// pitch otherwise, so an agent provisioned later is tradeable the moment it exists.

export const SECTORS = [
  "market-data",
  "onchain-data",
  "payments",
  "compliance",
  "identity",
  "media",
  "storage",
  "logistics",
  "security",
] as const;

export type Sector = (typeof SECTORS)[number];

/** Human labels for anything the UI or the logs print. */
export const SECTOR_LABEL: Record<string, string> = {
  "market-data": "Market data",
  "onchain-data": "Onchain data",
  payments: "Payments",
  compliance: "Compliance",
  identity: "Identity",
  media: "Media",
  storage: "Storage",
  logistics: "Logistics",
  security: "Security",
};

// Deliberately narrow. Broad words like "market" or "index" match half the roster and
// hand every seller to every buyer, which flattens the market back into one pool.
const KEYWORDS: Record<Sector, string[]> = {
  "market-data": ["price feed", "data feed", "oracle", "liquidity", "arbitrage", "quote", "market data", "order book"],
  "onchain-data": ["indexes", "indexer", "transaction logs", "event log", "subgraph", "analytics", "websocket"],
  payments: ["payment", "remittance", "billing", "relayer", "cross-chain", "invoice", "payout"],
  compliance: ["compliance", "regulat", "aml", "sanction", "monitors all transactions", "reporting obligation"],
  identity: ["identity", "identities", "credential", "attestation", "authenticity", "kyc"],
  media: ["image", "render", "generative", "content", "summar", "video", "illustration"],
  storage: ["storage", "stores and retriev", "archive", "gigabyte", "blob", "file"],
  logistics: ["logistics", "delivery", "deliveries", "shipment", "route", "supply chain", "schedules deliveries"],
  security: ["vulnerab", "audit", "benchmark", "exploit", "secureguard", "penetration"],
};

function classify(s: Startup): Sector[] {
  const text = s.pitch.idea.toLowerCase();
  const hits = SECTORS.filter((sector) => KEYWORDS[sector].some((k) => text.includes(k)));
  // Everything has to be buyable by someone, or a newly provisioned agent is dead on
  // arrival for a reason nobody chose.
  return hits.length > 0 ? hits : ["onchain-data"];
}

// What one unit of the service costs. An agent raising more is running a bigger business
// with a bigger ticket, so the ask sets the price unless the roster overrides it. Held
// inside a narrow band: too cheap and a customer's whole budget buys one seller, too dear
// and a 3 USDC buyer cannot transact at all.
function priceOf(s: Startup): bigint {
  const override = s.service?.unitPriceUsdc;
  const raw = typeof override === "number" ? override : s.pitch.askUsdc / 6;
  const clamped = Math.min(1.2, Math.max(0.3, raw));
  return parseUnits((Math.round(clamped * 20) / 20).toFixed(2), 6);
}

export type Listing = {
  startup: Startup;
  name: string;
  sectors: Sector[];
  unitPrice: bigint;
};

export const catalog: Listing[] = startups.map((s) => {
  const declared = s.service?.sectors?.filter((x): x is Sector => (SECTORS as readonly string[]).includes(x));
  return {
    startup: s,
    name: s.name,
    sectors: declared && declared.length > 0 ? declared : classify(s),
    unitPrice: priceOf(s),
  };
});

export function listingFor(name: string): Listing | undefined {
  const n = name.toLowerCase();
  return catalog.find((l) => l.name.toLowerCase() === n);
}

/** Sectors nobody on the roster sells, and sectors with no buyer, are both worth naming. */
export function sectorsOnOffer(): Sector[] {
  return SECTORS.filter((s) => catalog.some((l) => l.sectors.includes(s)));
}
