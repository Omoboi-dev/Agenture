import { createPublicClient, defineChain, fallback, http } from 'viem'
import { addresses } from './addresses'

export const arc = defineChain({
  id: addresses.chainId,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [addresses.rpcUrl] } },
  blockExplorers: { default: { name: 'Arcscan', url: addresses.explorer } },
})

// Arc publishes four public RPC providers. Any one gets rate-limited under load, so we
// spread across all of them with viem's fallback transport, which fails over on error.
// Set VITE_ARC_RPC to prepend your own (e.g. an API-key node) for maximum reliability.
const endpoints = [
  import.meta.env.VITE_ARC_RPC as string | undefined,
  'https://rpc.blockdaemon.testnet.arc.network',
  'https://rpc.drpc.testnet.arc.network',
  'https://rpc.quicknode.testnet.arc.network',
  addresses.rpcUrl,
].filter(Boolean) as string[]

// batch: true coalesces a full dashboard refresh into a single JSON-RPC request per node.
export const publicClient = createPublicClient({
  chain: arc,
  transport: fallback(
    endpoints.map((url) => http(url, { batch: true, retryCount: 2, retryDelay: 800 })),
    { rank: false, retryCount: 2 },
  ),
})

export const explorerTx = (hash: string) => `${addresses.explorer}/tx/${hash}`
export const explorerAddress = (addr: string) => `${addresses.explorer}/address/${addr}`
