import { Routes, Route } from 'react-router-dom'
import Shell from '@/components/Shell'
import Landing from '@/routes/Landing'
import Dashboard from '@/routes/Dashboard'
import Arena from '@/routes/Arena'
import Judges from '@/routes/Judges'
import JudgeDetail from '@/routes/JudgeDetail'
import Startups from '@/routes/Startups'
import StartupDetail from '@/routes/StartupDetail'
import Rounds from '@/routes/Rounds'
import Market from '@/routes/Market'
import Invest from '@/routes/Invest'

export default function App() {
  return (
    <Routes>
      {/* The landing page stands alone: no sidebar, it is the front door. */}
      <Route path="/" element={<Landing />} />
      <Route element={<Shell />}>
        <Route path="fund" element={<Dashboard />} />
        <Route path="arena" element={<Arena />} />
        <Route path="judges" element={<Judges />} />
        <Route path="judges/:name" element={<JudgeDetail />} />
        <Route path="startups" element={<Startups />} />
        <Route path="startups/:name" element={<StartupDetail />} />
        <Route path="market" element={<Market />} />
        <Route path="rounds" element={<Rounds />} />
        <Route path="invest" element={<Invest />} />
      </Route>
    </Routes>
  )
}
