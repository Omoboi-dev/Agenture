import { useEffect, useRef, useState, type ReactNode } from 'react'

// Motion for a page about money moving between agents. The rule here is restraint: one
// orchestrated moment (the committee reaching a verdict) and everything else a quiet
// rise into place. Anything more reads as decoration, and this subject does not want to
// look decorated.

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** True once the element has been scrolled into view. Fires once and stops observing. */
export function useInView<T extends HTMLElement>(rootMargin = '-12% 0px') {
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(() => reduced())

  useEffect(() => {
    if (seen || !ref.current) return
    // Content must never depend on an observer existing. If it does not, show everything.
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const el = ref.current
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin, threshold: 0.05 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, rootMargin])

  return { ref, seen }
}

/**
 * Rises 14px into place on first view. `delay` staggers siblings; keep the steps small,
 * because a long cascade draws attention to the animation rather than the content.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const { ref, seen } = useInView<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={`reveal ${seen ? 'is-in' : ''} ${className}`}
      style={{ transitionDelay: seen ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  )
}

/**
 * How far down the document we are, 0 to 1. Continuous, unlike Reveal, which fires once
 * and then never moves again. That one-shot behaviour is exactly what makes a page feel
 * inert on the second scroll.
 */
export function useScrollProgress(): number {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (reduced()) return
    let frame = 0
    const read = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      setP(max > 0 ? Math.min(1, window.scrollY / max) : 0)
    }
    const onScroll = () => {
      // rAF-coalesced: scroll fires far faster than the screen refreshes.
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])
  return p
}

/**
 * How far through one element the viewport has travelled, 0 to 1. Used to drive a section
 * that tells its story as you scroll it rather than all at once on arrival.
 */
export function useSectionProgress<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [p, setP] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // With motion reduced, sit at the end state so nothing is hidden behind a scroll.
    if (reduced()) {
      setP(1)
      return
    }
    let frame = 0
    const read = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const travel = r.height - window.innerHeight
      setP(travel <= 0 ? 0 : Math.min(1, Math.max(0, -r.top / travel)))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return { ref, progress: p }
}

/** A hairline of cobalt across the top, tracking how far through the page you are. */
export function ScrollProgress() {
  const p = useScrollProgress()
  return (
    <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-0.5 bg-transparent">
      <div
        className="h-full origin-left bg-primary/70"
        style={{ transform: `scaleX(${p})`, transition: 'transform 90ms linear' }}
      />
    </div>
  )
}
