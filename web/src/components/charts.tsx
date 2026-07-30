// Lightweight inline-SVG charts tuned to the Institutional Intelligence palette.
// Single-series area (cobalt) for growth over time; a categorical donut for allocation.

export function AreaChart({
  values,
  labels,
  height = 240,
}: {
  values: number[]
  labels: string[]
  height?: number
}) {
  const W = 1000
  const padT = 16
  const padB = 4
  const n = Math.max(values.length, 2)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => padT + (1 - (v - min) / span) * (height - padT - padB)

  const pts = values.map((v, i) => `${x(i)},${y(v)}`)
  const line = `M${pts.join(' L')}`
  const area = `${line} L${W},${height} L0,${height} Z`

  // gridlines at 0 / 50 / 100 %
  const grid = [0, 0.5, 1].map((g) => padT + g * (height - padT - padB))

  return (
    <div className="w-full">
      <div className="relative w-full" style={{ height }}>
        <svg
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {grid.map((gy, i) => (
            <line key={i} x1="0" y1={gy} x2={W} y2={gy} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill="url(#areaFill)" />
          <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="mt-2 flex justify-between px-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  )
}

export type DonutSeg = { label: string; value: number; color: string }

export function Donut({
  segments,
  size = 168,
  thickness = 18,
  centerTop,
  centerBottom,
}: {
  segments: DonutSeg[]
  size?: number
  thickness?: number
  centerTop?: string
  centerBottom?: string
}) {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  let acc = 0

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-4)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${Math.max(len - 2, 0)} ${c - Math.max(len - 2, 0)}`}
              strokeDashoffset={-acc}
            />
          )
          acc += len
          return el
        })}
      </svg>
      {(centerTop || centerBottom) && (
        <div className="absolute text-center">
          {centerTop && <div className="tnum text-[18px] font-semibold text-ink">{centerTop}</div>}
          {centerBottom && <div className="text-[10px] uppercase tracking-wide text-faint">{centerBottom}</div>}
        </div>
      )}
    </div>
  )
}
