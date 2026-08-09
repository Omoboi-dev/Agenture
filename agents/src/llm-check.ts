import "dotenv/config";

// Smoke test for the endpoints agents/.env points at. Reports what each one is, how it
// meters you, and whether the key actually works.
//
// The two providers in play bill in completely different ways, and confusing them has
// cost this project a day of quota already:
//
//   0G Compute Router      static API key, 50 requests per DAY per ACCOUNT (not per key,
//                          so a second key buys nothing), 10 per minute. Exposes /models
//                          and returns x-ratelimit headers.
//   0G Compute Direct      an `app-sk-` token signed by your wallet, billed per token
//                          against a sub-account you prefunded for that provider. No
//                          request cap at all: you run out of money, not out of calls.
//                          Does not expose /models, so absence of it is not an error.
//
//   bun run llm-check              reachability and metering, costs nothing
//   bun run llm-check -- --live    also sends one tiny completion to prove the key works

type Endpoint = { label: string; baseURL: string; apiKey: string; model: string };

const LIVE = process.argv.includes("--live");

function styleOf(e: Endpoint): string {
  if (e.apiKey.startsWith("app-sk-")) return "0G Compute Direct (wallet-signed, prefunded per token)";
  if (e.apiKey.startsWith("sk-")) return "0G Compute Router (static key, daily request cap)";
  return "unknown";
}

async function live(e: Endpoint): Promise<void> {
  const res = await fetch(`${e.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${e.apiKey}` },
    body: JSON.stringify({ model: e.model, messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 10 }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.log(`live     FAILED ${res.status}: ${body.slice(0, 220)}`);
    return;
  }
  let text = "";
  try {
    text = (JSON.parse(body) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
  } catch {
    /* leave blank */
  }
  console.log(`live     OK, model replied: ${text.trim().slice(0, 60) || "(empty)"}`);
  reportQuota(res.headers, e.apiKey.startsWith("app-sk-"));
}

function reportQuota(h: Headers, direct = false): void {
  const day = h.get("x-ratelimit-remaining-day");
  if (day === null) {
    if (direct) {
      console.log(
        "quota    no request cap. Runway is your sub-account balance:\n" +
          "         0g-compute-cli get-sub-account --provider <address> --service inference",
      );
      return;
    }
    // The Router only sends these on /chat/completions, never on /models, so silence here
    // is not proof there is no cap. Use --live to get the real numbers.
    console.log("quota    not reported on this response (run with -- --live for the real figures)");
    return;
  }
  const limit = h.get("x-ratelimit-limit-day");
  const reset = h.get("x-ratelimit-reset-day");
  const min = h.get("x-ratelimit-remaining-requests");
  console.log(
    `quota    ${day} of ${limit ?? "?"} requests left today${reset ? `, resets ${reset}` : ""}` +
      `${min ? `; ${min} left this minute` : ""}`,
  );
}

async function check(e: Endpoint) {
  console.log(`\n=== ${e.label} ===`);
  console.log(`endpoint ${e.baseURL}`);
  console.log(`key      ${e.apiKey ? `${e.apiKey.slice(0, 8)}… (${e.apiKey.length} chars)` : "MISSING"}`);
  console.log(`model    ${e.model || "(not set)"}`);
  if (!e.baseURL || !e.apiKey) {
    console.log("not configured, skipping.");
    return;
  }
  console.log(`style    ${styleOf(e)}`);

  const res = await fetch(`${e.baseURL.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${e.apiKey}` },
  });
  const body = await res.text();

  if (res.ok) {
    let ids: string[] = [];
    try {
      ids = ((JSON.parse(body) as { data?: { id?: string }[] }).data ?? []).map((m) => m.id ?? "").filter(Boolean);
    } catch {
      /* non-JSON body */
    }
    console.log(`models   ${ids.join(", ") || "(none listed)"}`);
    if (ids.length > 0 && e.model && !ids.includes(e.model)) {
      console.log(`         WARNING: ${e.model} is not in that list`);
    }
    reportQuota(res.headers, e.apiKey.startsWith("app-sk-"));
  } else if (body.includes("unsupported endpoint")) {
    // A direct provider proxy serves chat/completions and nothing else. Not a failure.
    console.log("models   not exposed by this endpoint (normal for a direct provider proxy)");
  } else {
    console.log(`models   FAILED ${res.status}: ${body.slice(0, 200)}`);
  }

  if (LIVE) await live(e);
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

  if (!LIVE) console.log("\nRun with -- --live to send one real completion per endpoint and prove the keys work.");
  console.log(
    "\nA fallback is only worth having if it fails independently of the primary. Two Router keys " +
      "share one daily account cap and die together; a Direct provider proxy does not.",
  );
}

main().catch((err) => {
  console.error(`\nFAILED: ${String(err?.message ?? err).slice(0, 400)}`);
  process.exit(1);
});
