// The mark: an "A" drawn as a network of agents, with a single solid arrow rising
// through it. The lattice is the panel and the roster, the arrow is the capital going
// up through them. Redrawn from the reference in cobalt rather than its original green,
// which would fight every other surface in the app.
//
// Node count is deliberately low. The reference has fourteen, which turns to mud at the
// 18px the sidebar renders it at; six reads as a network and still resolves small.

export function Logo({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Agenture"
    >
      {/* outer frame of the A */}
      <path
        d="M16 3.5 4.5 27.5M16 3.5 27.5 27.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* crossbar and the struts that make it read as a lattice rather than a letter */}
      <path
        d="M9.4 22.2h13.2M11.2 17.4 16 22.2l4.8-4.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
      />
      {/* the nodes: apex, shoulders, crossbar ends, feet */}
      <g fill="currentColor">
        <circle cx="16" cy="3.5" r="1.9" />
        <circle cx="11.2" cy="17.4" r="1.35" opacity="0.7" />
        <circle cx="20.8" cy="17.4" r="1.35" opacity="0.7" />
        <circle cx="9.4" cy="22.2" r="1.35" opacity="0.55" />
        <circle cx="22.6" cy="22.2" r="1.35" opacity="0.55" />
        <circle cx="4.5" cy="27.5" r="1.7" opacity="0.8" />
        <circle cx="27.5" cy="27.5" r="1.7" opacity="0.8" />
      </g>
      {/* the arrow: the one solid shape, so the eye lands on the capital, not the mesh */}
      <path d="M16 8.6 23.2 25 16 20.1 8.8 25Z" fill="currentColor" />
    </svg>
  )
}

/** Mark plus name, for the sidebar and the landing nav. */
export function Wordmark({ sub }: { sub?: string }) {
  return (
    <span className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-primary/40 bg-primary/15 text-primary">
        <Logo size={20} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-tight tracking-tight text-ink">Agenture</span>
        {sub && (
          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{sub}</span>
        )}
      </span>
    </span>
  )
}
