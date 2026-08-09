import { Link } from 'react-router-dom'
import { useState, type ReactNode } from 'react'
import { shortAddr } from '@/lib/format'

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>
}

export function Card({
  children,
  className = '',
  elevated = false,
}: {
  children: ReactNode
  className?: string
  elevated?: boolean
}) {
  return (
    <div
      className={`rounded-lg border border-line ${elevated ? 'bg-surface-3' : 'bg-surface-2'} ${className}`}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, icon, right }: { title: ReactNode; icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-5 py-4">
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-primary">{icon}</span>}
        <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
      </div>
      {right}
    </div>
  )
}

export type Tone = 'primary' | 'gain' | 'loss' | 'caution' | 'neutral'

export const toneText: Record<Tone, string> = {
  primary: 'text-primary',
  gain: 'text-gain',
  loss: 'text-loss',
  caution: 'text-caution',
  neutral: 'text-muted',
}
const toneBgSoft: Record<Tone, string> = {
  primary: 'bg-primary/12 text-primary border-primary/25',
  gain: 'bg-gain/12 text-gain border-gain/25',
  loss: 'bg-loss/12 text-loss border-loss/25',
  caution: 'bg-caution/12 text-caution border-caution/25',
  neutral: 'bg-surface-4 text-subtle border-line-bright',
}
const dotBg: Record<Tone, string> = {
  primary: 'bg-primary',
  gain: 'bg-gain',
  loss: 'bg-loss',
  caution: 'bg-caution',
  neutral: 'bg-muted',
}

// Status pill: fully rounded, optional pulsing dot. For live/active states.
export function Pill({ tone = 'neutral', dot = false, pulse = false, children }: { tone?: Tone; dot?: boolean; pulse?: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${toneBgSoft[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotBg[tone]} ${pulse ? 'pulse' : ''}`} />}
      {children}
    </span>
  )
}

// Metadata chip: lightly rounded rectangle for labels like a lead judge.
export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${toneBgSoft[tone]}`}>
      {children}
    </span>
  )
}

export function Dot({ tone = 'gain', pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotBg[tone]} ${pulse ? 'pulse' : ''}`} />
}

export function StatTile({
  label,
  value,
  unit,
  delta,
  deltaTone = 'primary',
  accent = false,
}: {
  label: string
  value: ReactNode
  unit?: string
  delta?: string
  deltaTone?: Tone
  accent?: boolean
}) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow mb-2 leading-4">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className={`tnum text-[26px] font-semibold leading-none ${accent ? 'text-primary' : 'text-ink'}`}>{value}</span>
        {unit && <span className="eyebrow">{unit}</span>}
        {delta && <span className={`tnum text-[12px] ${toneText[deltaTone]}`}>{delta}</span>}
      </div>
    </div>
  )
}

export function Meter({ pct, tone = 'primary' }: { pct: number; tone?: Tone }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-4">
      <div className={`h-full rounded-full ${dotBg[tone]}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`tnum ${className}`}>{children}</span>
}

// Concentric reputation ring with the score in the centre.
export function ReputationRing({ score, size = 64, label }: { score: number | null; size?: number; label?: string }) {
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-4)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
        />
      </svg>
      <div className="absolute text-center">
        <div className="tnum text-[15px] font-semibold text-ink">{score == null ? '—' : score}</div>
        {label && <div className="text-[8px] uppercase tracking-wide text-faint">{label}</div>}
      </div>
    </div>
  )
}

// AI judge rationale, quoted with a cobalt edge.
export function Rationale({ children }: { children: ReactNode }) {
  return <p className="rationale rounded-r-md px-3 py-2.5 text-[13px] italic leading-relaxed text-subtle">{children}</p>
}

// Monospace address that copies on click.
export function AddressChip({ addr }: { addr: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={addr}
      onClick={() => {
        navigator.clipboard?.writeText(addr)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className="tnum inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-line-bright hover:text-subtle"
    >
      <span className="h-1 w-1 rounded-full bg-primary/70" />
      {copied ? 'Copied' : shortAddr(addr)}
    </button>
  )
}

/**
 * An unmissable way into a detail page. Making the name a link is not enough: nothing on
 * a card says a page exists behind it, so people never find them.
 */
export function DetailLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[12.5px] font-medium text-primary transition-colors hover:bg-primary/8"
    >
      <span>{label}</span>
      <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
    </Link>
  )
}
