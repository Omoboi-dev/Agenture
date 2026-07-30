import { Routes, Route } from 'react-router-dom'
import Shell from '@/components/Shell'
import Dashboard from '@/routes/Dashboard'
import Arena from '@/routes/Arena'
import Judges from '@/routes/Judges'
import Startups from '@/routes/Startups'
import Rounds from '@/routes/Rounds'
import Invest from '@/routes/Invest'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="arena" element={<Arena />} />
        <Route path="judges" element={<Judges />} />
        <Route path="startups" element={<Startups />} />
        <Route path="rounds" element={<Rounds />} />
        <Route path="invest" element={<Invest />} />
      </Route>
    </Routes>
  )
}
