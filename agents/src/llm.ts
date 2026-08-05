import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

// The single model seam for every agent. Any OpenAI-compatible endpoint works, so
// changing model or provider is environment variables rather than code.
//
// Two endpoints can be configured. The primary is whatever you want the judges to think
// with; the fallback is the one that has to be there when the primary is not. That
// matters more than it sounds: a failed call makes `generateJson` return null, which
// `decide` turns into a safe pass, so an outage does not crash the cycle. It quietly
// produces a round where every judge rejects everything, which looks like a considered
// verdict and is not one. A fallback keeps that from reaching the record.

type Endpoint = { name: string; baseURL: string; apiKey: string; model: string };

const primary: Endpoint = {
  name: "primary",
  baseURL: process.env.LLM_BASE_URL ?? "",
  apiKey: process.env.LLM_API_KEY ?? "",
  model: process.env.LLM_MODEL ?? "qwen/qwen-2.5-7b-instruct",
};

// Optional. Point this at a provider that is independent of the primary, or it is not a
// fallback, it is a second chance at the same outage.
const fallback: Endpoint | null = process.env.LLM_FALLBACK_BASE_URL
  ? {
      name: "fallback",
      baseURL: process.env.LLM_FALLBACK_BASE_URL,
      apiKey: process.env.LLM_FALLBACK_API_KEY ?? "",
      model: process.env.LLM_FALLBACK_MODEL ?? "qwen/qwen-2.5-7b-instruct",
    }
  : null;

function client(e: Endpoint) {
  return createOpenAICompatible({ name: e.name, baseURL: e.baseURL, apiKey: e.apiKey })(e.model);
}

async function callOnce(e: Endpoint, system: string, user: string, temperature: number): Promise<string> {
  const { text } = await generateText({ model: client(e), system, prompt: user, temperature });
  return text;
}

// Whether the fallback has already been announced, so a long round logs the switch once
// rather than on every one of its calls.
let warned = false;

export async function generate(system: string, user: string, temperature = 0.4): Promise<string> {
  try {
    return await callOnce(primary, system, user, temperature);
  } catch (err) {
    if (!fallback) throw err;
    if (!warned) {
      warned = true;
      const why = String((err as Error)?.message ?? err).split("\n")[0];
      console.log(`LLM primary (${primary.model}) failed, falling back to ${fallback.model}: ${why}`);
    }
    return await callOnce(fallback, system, user, temperature);
  }
}

// Ask the model for a JSON object and parse it robustly. A small model sometimes wraps
// JSON in prose or code fences, so we extract the first {...} block. Returns null on
// failure so callers can apply a safe fallback (the Mettle pattern).
export async function generateJson<T = unknown>(
  system: string,
  user: string,
  temperature = 0.4,
): Promise<T | null> {
  const text = await generate(system, user, temperature);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

/** Which endpoints are configured, for scripts that want to report it. */
export function describeProviders(): string {
  return fallback
    ? `${primary.model} (fallback: ${fallback.model})`
    : `${primary.model} (no fallback configured)`;
}
