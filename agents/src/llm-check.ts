import "dotenv/config";

// Smoke test for the endpoints agents/.env points at: for each, list the models the key
// can reach and report the quota headers. The quota matters as much as the key does,
// because a daily cap that is shared between the primary and the fallback is not a
// fallback at all: both die at the same moment, mid-round.

type Endpoint = { label: string; baseURL: string; apiKey: string; model: string };

async function check(e: Endpoint) {
  console.log(`\n=== ${e.label} ===`);
  console.log(`endpoint ${e.baseURL}`);
  console.log(`key      ${e.apiKey ? `${e.apiKey.slice(0, 6)}… (${e.apiKey.length} chars)` : "MISSING"}`);
  console.log(`model    ${e.model || "(not set)"}`);
  if (!e.baseURL || !e.apiKey) {
    console.log("not configured, skipping.");
    return;
  }

  const res = await fetch(`${e.baseURL.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${e.apiKey}` },
  });
  const body = await res.text();
  if (!res.ok) {
    console.log(`FAILED ${res.status}: ${body.slice(0, 200)}`);
    return;
  }

  let ids: string[] = [];
  try {
    ids = ((JSON.parse(body) as { data?: { id?: string }[] }).data ?? []).map((m) => m.id ?? "").filter(Boolean);
  } catch {
    /* non-JSON body, fall through */
  }
  console.log(`models   ${ids.join(", ") || "(none listed)"}`);

  const day = res.headers.get("x-ratelimit-remaining-day");
  const limit = res.headers.get("x-ratelimit-limit-day");
  const reset = res.headers.get("x-ratelimit-reset-day");
  if (day !== null) console.log(`quota    ${day} of ${limit ?? "?"} requests left today${reset ? `, resets ${reset}` : ""}`);
  else console.log("quota    (no rate-limit headers returned)");
}

async function main() {
  await check({
    label: "primary",
    baseURL: process.env.LLM_BASE_URL ?? "",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "",
  });
  await check({
    label: "fallback",
    baseURL: process.env.LLM_FALLBACK_BASE_URL ?? "",
    apiKey: process.env.LLM_FALLBACK_API_KEY ?? "",
    model: process.env.LLM_FALLBACK_MODEL ?? "",
  });
  console.log(
    "\nIf both show the same remaining count, the cap is per account and the fallback " +
      "buys you nothing. If they differ, it is per key and you have real headroom.",
  );
}

main().catch((err) => {
  console.error(`\nFAILED: ${String(err?.message ?? err).slice(0, 400)}`);
  process.exit(1);
});
