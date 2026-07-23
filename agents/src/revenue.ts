import type { Address, Hex } from "viem";
import { addresses } from "./config.js";
import { circleExecute } from "./circle.js";

const USDC = addresses.usdc as Address;
const RS = addresses.agenture.revenueShare as Address;

// The startup reports revenue and pays the fund's cut, signing from its own Circle wallet.
// It approves RevenueShare to pull the cut, then calls settle; RevenueShare moves the bps
// share to the Fund and records the return against the deal's judge. The revenue itself
// arrives via x402 (see x402.ts).
export async function settle(startupWalletId: string, dealId: bigint, revenueAmount: bigint): Promise<Hex> {
  await circleExecute(startupWalletId, USDC, "approve(address,uint256)", [RS, revenueAmount.toString()]);
  return circleExecute(startupWalletId, RS, "settle(uint256,uint256)", [dealId.toString(), revenueAmount.toString()]);
}
