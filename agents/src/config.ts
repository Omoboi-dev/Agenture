import { defineChain } from "viem";
import addresses from "../../shared/addresses.json" with { type: "json" };

export { addresses };

// Arc testnet as a viem chain. USDC is the native gas token (18-decimal native view);
// the same USDC also has a 6-decimal ERC-20 view at addresses.usdc. Never mix the two.
export const arcTestnet = defineChain({
  id: addresses.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? addresses.rpcUrl] } },
  blockExplorers: { default: { name: "Arcscan", url: addresses.explorer } },
});
