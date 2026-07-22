import type { Address, Hex } from "viem";
import { publicClient, walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { identityAbi } from "./abis.js";

const IDENTITY = addresses.erc8004.identityRegistry as Address;

// Mint a fresh ERC-8004 identity owned by the signer of ownerKey. We simulate first to
// read the agentId the registry will assign, then send the same call.
export async function registerIdentity(ownerKey: Hex, uri: string): Promise<bigint> {
  const wallet = walletFromKey(ownerKey);
  const { request, result } = await withRpcRetry(() =>
    publicClient.simulateContract({
      address: IDENTITY,
      abi: identityAbi,
      functionName: "register",
      args: [uri],
      account: wallet.account,
    }),
  );
  const hash = await withRpcRetry(() => wallet.writeContract(request));
  await waitReceipt(hash);
  return result as bigint;
}
