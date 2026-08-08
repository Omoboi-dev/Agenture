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
