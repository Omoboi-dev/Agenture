import { useCallback, useEffect, useRef, useState } from 'react'

// Loads async data on mount and re-polls on an interval. Keeps the last good value while
// refreshing so the UI never flashes empty.
export function useLive<T>(loader: () => Promise<T>, intervalMs = 30_000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const inFlight = useRef(false)

  const run = useCallback(async () => {
    if (inFlight.current) return // don't stack overlapping loads
    inFlight.current = true
    try {
      const d = await loaderRef.current()
      setData(d)
      setError(null)
    } catch (e) {
      setError(String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e))
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    run()
    const t = setInterval(run, intervalMs)
    return () => clearInterval(t)
  }, [run, intervalMs])

  return { data, error, loading, refresh: run }
}
