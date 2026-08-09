import { Link, NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { useLive } from '@/lib/useLive'
import { loadOverview, type Overview } from '@/lib/data'
import { addresses } from '@/lib/addresses'
import { usdc, shortAddr } from '@/lib/format'
import { Wordmark } from '@/components/logo'

export type LiveCtx = ReturnType<typeof useLive<Overview>>
export const useOverview = () => useOutletContext<LiveCtx>()

const nav = [
  { to: '/fund', label: 'Fund', end: true, icon: IconVault },
  { to: '/arena', label: 'Arena', icon: IconArena },
  { to: '/judges', label: 'Judges', icon: IconJudges },
  { to: '/startups', label: 'Startups', icon: IconStartups },
  { to: '/market', label: 'Marketplace', icon: IconMarket },
  { to: '/rounds', label: 'Rounds', icon: IconRounds },
  { to: '/invest', label: 'Capital', icon: IconInvest },
]

export default function Shell() {
  const live = useLive(loadOverview, 60_000)
  const nav_val = live.data ? usdc(live.data.fund.nav) : '—'

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr] bg-bg">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen flex-col border-r border-line bg-surface">
        <Link to="/" className="block px-5 py-5 transition-opacity hover:opacity-80">
          <Wordmark sub="Autonomous venture fund" />
        </Link>

        <nav className="mt-3 flex flex-col gap-1 px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition-colors ${
                  isActive ? 'bg-surface-3 font-medium text-ink' : 'text-muted hover:bg-surface-2 hover:text-subtle'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={isActive ? 'text-primary' : 'text-faint group-hover:text-muted'}>
                    <n.icon />
                  </span>
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* This sits where an app usually puts "you are signed in as", which is what made
            it read as an account chip for a session nobody has. It is not that. It is the
            operator: the account that funds the buyers and submits x402 settlements, and
            the only human-held key in the system. Worth showing, because the honest claim
            is "a human does these two things and nothing else", but it has to say so and
            it has to be checkable. "Admin custodian" was neither: Circle holds the keys,
            so nothing here is a custodian. */}
        <div className="mt-auto px-3 pb-4">
          <a
            href={`${addresses.explorer}/address/${addresses.agenture.operator}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5 transition-colors hover:border-line-bright"
          >
            <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-4 text-muted">
              <IconShield />
            </span>
            <div className="min-w-0">
              <div className="tnum truncate text-[12px] text-subtle">{shortAddr(addresses.agenture.operator)}</div>
              <div className="text-[10px] uppercase tracking-wide text-faint">Operator · funds buyers, settles x402</div>
            </div>
          </a>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-col">
        <header className="glass sticky top-0 z-10 flex h-16 items-center justify-between border-b border-line px-8">
          <div className="flex items-center gap-6 text-[13px]">
            <span className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${live.error ? 'bg-loss' : 'bg-gain pulse'}`} />
              <span className="text-subtle">Arc Testnet</span>
            </span>
            <span className="text-faint">
              TVL <span className="tnum text-subtle">{nav_val} USDC</span>
            </span>
            <span className="text-faint">
              Status{' '}
              <span className="tnum text-subtle">{live.error ? 'RPC busy' : live.loading ? 'Syncing' : 'Live'}</span>
            </span>
          </div>
          {/* Was a Connect Wallet button that connected nothing. A control that does not
              work is worse than no control: the first thing anyone does is click it. The
              slot is better spent on the one thing a visitor actually wants, which is a
              way to check that any of this is real. */}
          <a
            href={`${addresses.explorer}/address/${addresses.agenture.fund}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-line-bright bg-surface-2 px-4 py-2 text-[13px] font-semibold text-subtle transition-colors hover:border-primary/40 hover:text-ink"
          >
            Fund contract ↗
          </a>
        </header>

        <main className="min-w-0 flex-1 px-8 py-8">
          <Outlet context={live} />
        </main>
      </div>
    </div>
  )
}

/* icons — 1.5pt refined strokes */
function I({ children }: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}
function IconVault() {
  return (<I><rect x="2.5" y="3.5" width="13" height="11" rx="1.5" /><circle cx="9" cy="9" r="2.2" /><path d="M9 3.5v1.4M9 13.1v1.4" /></I>)
}
function IconArena() {
  return (<I><rect x="2.5" y="3" width="13" height="12" rx="1.5" /><path d="M5.5 11.5 8 8l2 2 2.5-3.5" /></I>)
}
function IconJudges() {
  return (<I><path d="M9 2.5 3.5 5 9 7.5 14.5 5 9 2.5Z" /><path d="M4.5 7v3.5c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5V7" /></I>)
}
function IconStartups() {
  return (<I><path d="M9 2c2.4 1.3 3.6 3.4 3.6 5.8L9 10.6 5.4 7.8C5.4 5.4 6.6 3.3 9 2Z" /><circle cx="9" cy="6.4" r="1.1" /><path d="M6.4 11 5 14.5 8 13M11.6 11 13 14.5 10 13" /></I>)
}
function IconMarket() {
  return (<I><path d="M2.5 6.5h13l-1 3.5H4.2L3 4.5H1.5" /><circle cx="6" cy="14" r="1.1" /><circle cx="13" cy="14" r="1.1" /></I>)
}
function IconRounds() {
  return (<I><circle cx="9" cy="9" r="6" /><path d="M9 5.5V9l2.3 1.4" /></I>)
}
function IconInvest() {
  return (<I><rect x="2.5" y="4.5" width="13" height="9" rx="1.5" /><path d="M2.5 7.5h13" /><circle cx="12" cy="10.5" r="0.8" /></I>)
}
function IconShield() {
  return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"><path d="M7 1.5 2.5 3.2v3.3c0 3 1.9 4.7 4.5 5.6 2.6-.9 4.5-2.6 4.5-5.6V3.2L7 1.5Z" /></svg>)
}
