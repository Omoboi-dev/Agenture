import { useOverview } from '@/components/Shell'
import { Card, CardHeader, Pill, Meter, AddressChip, Dot } from '@/components/ui'
import { PageTitle, LoadingState } from '@/routes/Dashboard'
import { usdc, bpsToPct } from '@/lib/format'
import { judgeColor } from '@/lib/roster'
import { addresses } from '@/lib/addresses'
import type { Overview, JudgeRow } from '@/lib/data'

// The LP edge: the one place a human touches the fund, and the page that answers "where
// does the money come from and who decides where it goes". It deliberately shows the
// capital structure rather than offering a deposit box, because supplying the fund today
// means calling the contract, and a disabled button would say less than the truth does.

export default function Invest() {
  const { data, error } = useOverview()
  if (!data) return <LoadingState note={error ? 'Arc public RPC is busy. Retrying…' : undefined} />

  return (
    <div className="mx-auto max-w-[1340px]">
      <PageTitle
        title="Capital"
        sub="How money enters the fund and how it reaches a deal. A human supplies the pool; every allocation after that is decided, drawn and signed by an agent."
      />

      <PositionCard data={data} />
      <FlowCard data={data} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <CommitmentsCard data={data} />
        <TermsCard />
      </div>
    </div>
  )
}

function PositionCard({ data }: { data: Overview }) {
  const { fund } = data
  const inJudgeWallets = data.judges.reduce((a, j) => a + j.budget, 0n)
  // Realized return, not NAV growth. NAV counts every judge's wallet balance, including
  // USDC they held before this Fund was deployed, so measuring NAV against supplied
  // capital reads as a large gain that the fund never earned. What it has actually made
  // is the revenue share that came back.
  const realizedBps = fund.totalDeployed > 0n ? Number((fund.totalReturned * 10000n) / fund.totalDeployed) : 0

  return (
    <Card className="mb-6">
      <CardHeader
        title="Fund position"
        right={
          <span className="flex items-center gap-1.5">
            <Dot tone="gain" pulse />
            <span className="eyebrow text-faint">Live on Arc</span>
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-5">
        <Cell label="Net asset value" value={usdc(fund.nav)} unit="USDC" accent />
        <Cell label="Supplied by LPs" value={usdc(fund.totalCapital)} unit="USDC" />
        <Cell label="Undeployed in fund" value={usdc(fund.cash)} unit="USDC" />
        <Cell label="Held by judges" value={usdc(inJudgeWallets)} unit="USDC" />
        <Cell label="Realized return" value={bpsToPct(realizedBps)} tone={realizedBps > 0 ? 'gain' : undefined} />
      </div>
      <p className="border-t border-line px-5 py-3.5 text-[12px] leading-relaxed text-faint">
        NAV counts cash in the fund, capital sitting in judges' wallets, and the cost basis of live positions, so a
        capital call never changes what the fund is worth. Realized return is revenue share actually paid back, not a
        change in NAV: the judges' wallets also hold USDC predating this deployment, which would otherwise read as a
        gain the fund never made.
      </p>
    </Card>
  )
}

function Cell({
  label,
  value,
  unit,
  accent = false,
  tone,
}: {
  label: string
  value: string
  unit?: string
  accent?: boolean
  tone?: 'gain' | 'loss'
}) {
  const color = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : accent ? 'text-primary' : 'text-ink'
  return (
    <div className="bg-surface-2 px-5 py-4">
      <div className="eyebrow mb-2 leading-4">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`tnum text-[19px] font-semibold leading-none ${color}`}>{value}</span>
        {unit && <span className="eyebrow">{unit}</span>}
      </div>
    </div>
  )
}

const STAGES = [
  {
    key: 'supplied',
    title: 'Supplied',
    who: 'a human',
    body: 'An LP deposits USDC into the Fund contract. This is the only step a person performs.',
    call: 'depositCapital()',
  },
  {
    key: 'committed',
    title: 'Committed',
    who: 'the fund',
    body: 'The fund promises an amount to each judge. Nothing moves: this is a commitment, not a transfer.',
    call: 'commitCapital()',
  },
  {
    key: 'called',
    title: 'Called',
    who: 'the judge',
    body: 'A judge decides it is short and draws against its own commitment. Nobody hands it the money.',
    call: 'callCapital()',
  },
  {
    key: 'deployed',
    title: 'Deployed',
    who: 'the judge',
    body: 'The judge invests from its own wallet, on its own terms, and signs the transaction itself.',
    call: 'invest()',
  },
  {
    key: 'returned',
    title: 'Returned',
    who: 'the startup',
    body: 'The startup settles its revenue share back. That raises the judge’s commitment, so winners earn the right to more.',
    call: 'settle()',
  },
] as const

function FlowCard({ data }: { data: Overview }) {
  const { fund } = data
  const called = data.judges.reduce((a, j) => a + j.called, 0n)
  const committed = data.judges.reduce((a, j) => a + j.committed, 0n)
  const amounts: Record<string, bigint> = {
    supplied: fund.totalCapital,
    committed,
    called,
    deployed: fund.totalDeployed,
    returned: fund.totalReturned,
  }
  const max = Object.values(amounts).reduce((a, v) => (v > a ? v : a), 1n)

  return (
    <Card>
      <CardHeader title="How capital reaches a deal" right={<span className="eyebrow text-faint">five steps, one human</span>} />
      <div className="divide-y divide-line">
        {STAGES.map((s, i) => (
          <div key={s.key} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
            <div className="flex w-full items-start gap-3 md:w-[46%]">
              <span className="tnum mt-0.5 text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-ink">{s.title}</span>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide ${
                      s.who === 'a human' ? 'text-caution' : 'text-primary'
                    }`}
                  >
                    {s.who}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{s.body}</p>
                <div className="tnum mt-1 text-[10px] text-faint">{s.call}</div>
              </div>
            </div>
            <div className="flex-1">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="eyebrow">cumulative</span>
                <span className="tnum text-[13px] text-ink">
                  {usdc(amounts[s.key])} <span className="text-[10px] text-faint">USDC</span>
                </span>
              </div>
              <Meter pct={Number((amounts[s.key] * 100n) / max)} tone={s.key === 'returned' ? 'gain' : 'primary'} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function CommitmentsCard({ data }: { data: Overview }) {
  return (
    <Card>
      <CardHeader title="Commitments" right={<span className="eyebrow text-faint">{data.judges.length} judges</span>} />
      <div className="divide-y divide-line">
        {data.judges.map((j) => (
          <CommitmentRow key={j.wallet} j={j} />
        ))}
      </div>
      <p className="border-t border-line px-5 py-3.5 text-[12px] leading-relaxed text-faint">
        A judge can only draw what has been committed to it, and can only invest what it has drawn. Both limits are
        enforced onchain, the second by the USDC contract itself. Its returns raise the commitment, so a judge that
        backs winners can call for more without anyone deciding to give it more.
      </p>
    </Card>
  )
}

function CommitmentRow({ j }: { j: JudgeRow }) {
  const drawnPct = j.committed > 0n ? Number((j.called * 100n) / j.committed) : 0
  const callable = j.committed > j.called ? j.committed - j.called : 0n
  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: judgeColor(j.name) }} />
          <span className="text-[14px] font-semibold capitalize text-ink">{j.name}</span>
          <span className="eyebrow">{j.label}</span>
        </span>
        {j.roiBps > 0 ? <Pill tone="gain">{bpsToPct(j.roiBps)} returned</Pill> : <Pill tone="neutral">No return yet</Pill>}
      </div>
      <Meter pct={drawnPct} tone="primary" />
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
        <Fig label="Committed" value={usdc(j.committed)} />
        <Fig label="Drawn" value={usdc(j.called)} />
        <Fig label="Still callable" value={usdc(callable)} accent={callable > 0n} />
        <Fig label="In its wallet" value={usdc(j.budget)} />
      </div>
    </div>
  )
}

function Fig({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-faint">{label}</div>
      <div className={`tnum ${accent ? 'text-primary' : 'text-subtle'}`}>{value}</div>
    </div>
  )
}

function TermsCard() {
  return (
    <Card>
      <CardHeader title="What supplying capital means" />
      <div className="space-y-4 px-5 py-5">
        <Term title="No human picks the deals">
          Three agents with different theses allocate the capital, each drawing from the fund and signing from its own
          wallet. There is no override and no approval step.
        </Term>
        <Term title="Returns come from revenue share, not exits">
          Each deal carries a share in basis points. When a startup earns, its cut streams back to the fund and is
          credited to the judge that backed it.
        </Term>
        <Term title="Depositing is open, withdrawing is not built">
          <span className="tnum text-subtle">depositCapital</span> is permissionless, so anyone can supply the fund by
          calling it directly. The contract issues no share token and has no withdraw path, so anything deposited today
          stays in. That is the honest state of it, and it is on the roadmap.
        </Term>
        <Term title="Testnet only">
          Arc testnet, unaudited, testnet USDC. Nothing here is an offer or investment advice.
        </Term>
      </div>
      <div className="border-t border-line px-5 py-3.5">
        <div className="eyebrow mb-2">Fund contract</div>
        <div className="flex items-center justify-between">
          <AddressChip addr={addresses.agenture.fund} />
          <a
            href={`${addresses.explorer}/address/${addresses.agenture.fund}`}
            target="_blank"
            rel="noreferrer"
            className="tnum text-[11px] text-primary hover:underline"
          >
            Arcscan ↗
          </a>
        </div>
      </div>
    </Card>
  )
}

function Term({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="h-1 w-1 rounded-full bg-primary" />
        <span className="text-[13px] font-semibold text-ink">{title}</span>
      </div>
      <p className="pl-3 text-[12px] leading-relaxed text-faint">{children}</p>
    </div>
  )
}
