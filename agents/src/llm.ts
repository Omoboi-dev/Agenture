import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

// The single model seam for every agent. Today it points at Qwen 2.5 7B on 0G compute
// via an OpenAI-compatible endpoint. Swapping to a stronger model later is a one-line
// change here — nothing else in the codebase knows which model it is.
const provider = createOpenAICompatible({
  name: "qwen-0g",
  baseURL: process.env.LLM_BASE_URL ?? "",
  apiKey: process.env.LLM_API_KEY ?? "",
});

const MODEL = process.env.LLM_MODEL ?? "qwen/qwen-2.5-7b-instruct";

export async function generate(system: string, user: string, temperature = 0.4): Promise<string> {
  const { text } = await generateText({
    model: provider(MODEL),
    system,
    prompt: user,
    temperature,
  });
  return text;
}

// Ask the model for a JSON object and parse it robustly. A 7B model sometimes wraps
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
