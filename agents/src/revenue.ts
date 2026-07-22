import type { Address, Hex } from "viem";
import { walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi, revenueShareAbi } from "./abis.js";

const USDC = addresses.usdc as Address;
const RS = addresses.agenture.revenueShare as Address;

// Simulate an x402 earning: a customer pays the startup in USDC. On Arc this is a plain
// USDC transfer; a real deployment would settle it via EIP-3009 transferWithAuthorization.
// This is the seam where genuine x402 revenue plugs in later.
export async function payRevenue(customerKey: Hex, startup: Address, amount: bigint): Promise<Hex> {
  const wallet = walletFromKey(customerKey);
  const hash = await withRpcRetry(() =>
    wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [startup, amount] }),
  );
  await waitReceipt(hash);
  return hash;
}

// The startup reports revenue and pays the fund's cut. It approves RevenueShare to pull
// the cut, then calls settle; RevenueShare moves the bps share to the Fund and records
// the return against the deal's judge.
export async function settle(startupKey: Hex, dealId: bigint, revenueAmount: bigint): Promise<Hex> {
  const wallet = walletFromKey(startupKey);

  const approveHash = await withRpcRetry(() =>
    wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [RS, revenueAmount] }),
  );
  await waitReceipt(approveHash);

  const hash = await withRpcRetry(() =>
    wallet.writeContract({ address: RS, abi: revenueShareAbi, functionName: "settle", args: [dealId, revenueAmount] }),
  );
  await waitReceipt(hash);
  return hash;
}
