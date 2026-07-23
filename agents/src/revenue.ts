import type { Address, Hex } from "viem";
import { walletFromKey, withRpcRetry, waitReceipt } from "./chain.js";
import { addresses } from "./config.js";
import { erc20Abi } from "./abis.js";
import { circleExecute } from "./circle.js";

const USDC = addresses.usdc as Address;
const RS = addresses.agenture.revenueShare as Address;

// Simulate an x402 earning: a customer pays the startup in USDC. The customer here is the
// operator (a plain EOA), so this stays a viem transfer. This is the seam where real x402
// (EIP-3009 transferWithAuthorization) plugs in later.
export async function payRevenue(customerKey: Hex, startup: Address, amount: bigint): Promise<Hex> {
  const wallet = walletFromKey(customerKey);
  const hash = await withRpcRetry(() =>
    wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [startup, amount] }),
  );
  await waitReceipt(hash);
  return hash;
}

// The startup reports revenue and pays the fund's cut, signing from its own Circle wallet.
// It approves RevenueShare to pull the cut, then calls settle; RevenueShare moves the bps
// share to the Fund and records the return against the deal's judge.
export async function settle(startupWalletId: string, dealId: bigint, revenueAmount: bigint): Promise<Hex> {
  await circleExecute(startupWalletId, USDC, "approve(address,uint256)", [RS, revenueAmount.toString()]);
  return circleExecute(startupWalletId, RS, "settle(uint256,uint256)", [dealId.toString(), revenueAmount.toString()]);
}
