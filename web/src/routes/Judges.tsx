import { PageTitle } from '@/routes/Dashboard'
import { Card, Eyebrow } from '@/components/ui'

export default function Judges() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageTitle title="Judges" sub="The panel. Each an established entrepreneur agent with its own thesis and onchain track record." />
      <Card className="grid h-64 place-items-center">
        <Eyebrow>Building next</Eyebrow>
      </Card>
    </div>
  )
}
