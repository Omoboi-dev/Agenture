import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "./config.js";

// Read-only client for Arc onchain reads (reputation, balances, job history).
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

// A write client bound to a local key. Each agent (judge, startup, orchestrator)
// gets its own wallet; for now we build them from raw keys in the environment.
export function walletFromKey(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({ account, chain: arcTestnet, transport: http() });
}

// The public Arc RPC enforces a tight request quota and returns -32011
// "request limit reached" when exceeded. viem's built-in retry backs off too fast for
// it, so we wrap reads in a longer exponential backoff that only retries that error.
export async function withRpcRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  let delay = 1200;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String((err as { message?: string })?.message ?? err);
      const rateLimited =
        msg.includes("request limit reached") ||
        (err as { code?: number })?.code === -32011 ||
        msg.includes("429");
      if (!rateLimited || attempt === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
  throw new Error("unreachable");
}
