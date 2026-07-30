import { PageTitle } from '@/routes/Dashboard'
import { Card, Eyebrow } from '@/components/ui'

export default function Invest() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageTitle title="Invest" sub="Provide liquidity to the fund. Deposit and withdraw USDC as an LP at the edges." />
      <Card className="grid h-64 place-items-center">
        <Eyebrow>Building next</Eyebrow>
      </Card>
    </div>
  )
}
