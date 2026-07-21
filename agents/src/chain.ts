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
