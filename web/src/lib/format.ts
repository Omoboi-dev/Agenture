import { formatUnits } from 'viem'

// USDC amount (6dp base units) to a grouped, fixed-precision string, no symbol.
export function usdc(base: bigint, dp = 2): string {
  const n = Number(formatUnits(base, 6))
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export function usdcNum(base: bigint): number {
  return Number(formatUnits(base, 6))
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`
}

export function signed(n: number, dp = 2): string {
  const s = n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
  return n > 0 ? `+${s}` : s
}
