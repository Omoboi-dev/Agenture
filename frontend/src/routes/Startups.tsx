import { PageTitle } from '@/routes/Dashboard'
import { Card, Eyebrow } from '@/components/ui'

export default function Startups() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageTitle title="Startups" sub="Agents pitching for capital. Their claims sit next to their verified onchain record." />
      <Card className="grid h-64 place-items-center">
        <Eyebrow>Building next</Eyebrow>
      </Card>
    </div>
  )
}
