import "dotenv/config";

// Smoke test for whichever LLM endpoint agents/.env points at: lists the models the key
// can actually reach, then sends one tiny completion. Run this after changing provider,
// before spending a round finding out it does not work.

const baseURL = (process.env.LLM_BASE_URL ?? "").replace(/\/$/, "");
const apiKey = process.env.LLM_API_KEY ?? "";
const model = process.env.LLM_MODEL ?? "";

async function main() {
  console.log(`endpoint ${baseURL}`);
  console.log(`key      ${apiKey ? `${apiKey.slice(0, 6)}… (${apiKey.length} chars)` : "MISSING"}`);
  console.log(`model    ${model || "(not set yet)"}\n`);
  if (!baseURL || !apiKey) throw new Error("set LLM_BASE_URL and LLM_API_KEY in agents/.env");

  const res = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = await res.text();
  if (!res.ok) throw new Error(`GET /models -> ${res.status}: ${body.slice(0, 300)}`);

  let ids: string[] = [];
  try {
    const parsed = JSON.parse(body) as { data?: { id?: string }[] };
    ids = (parsed.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  } catch {
    console.log(body.slice(0, 500));
  }
  console.log(`${ids.length} models available:`);
  for (const id of ids) console.log(`  ${id}`);

  if (!model) {
    console.log("\nPick one, set LLM_MODEL, and run this again to send a test completion.");
    return;
  }

  const chat = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with just: OK" }], max_tokens: 20 }),
  });
  const chatBody = await chat.text();
  if (!chat.ok) throw new Error(`POST /chat/completions -> ${chat.status}: ${chatBody.slice(0, 400)}`);
  console.log(`\nreply from ${model}: ${chatBody.slice(0, 200)}`);
  console.log("\nEndpoint works.");
}

main().catch((err) => {
  console.error(`\nFAILED: ${String(err?.message ?? err).slice(0, 500)}`);
  process.exit(1);
});
