import { useEffect, useState, useCallback } from 'react'

const TAGLINES = [
  "Today only. No reruns. No excuses.",
  "This deal disappears at midnight. Just saying.",
  "New deal drops at midnight. This one's going, going...",
  "The clock doesn't negotiate. Neither do we.",
  "You've been warned. In the best way. ♥",
]

interface TimeLeft {
  hours:   number
  minutes: number
  seconds: number
}

function getMidnightMs(): number {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  return midnight.getTime() - now.getTime()
}

function msToTimeLeft(ms: number): TimeLeft {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  return {
    hours:   Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function useCountdown() {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({ hours: 0, minutes: 0, seconds: 0 })
  const [mounted, setMounted]   = useState(false)

  const tick = useCallback(() => {
    setTimeLeft(msToTimeLeft(getMidnightMs()))
  }, [])

  useEffect(() => {
    tick()
    setMounted(true)
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tick])

  const isUrgent = timeLeft.hours === 0 && timeLeft.minutes < 60
  return { ...timeLeft, mounted, isUrgent }
}

/** Thin charcoal divider line at the top of the homepage */
export function CountdownTimer() {
  return <div className="w-full h-px bg-brand-charcoal" />
}

/** Inline countdown placed beneath the buy button */
export function InlineCountdown() {
  const { hours, minutes, seconds, mounted, isUrgent } = useCountdown()
  const [taglineIdx, setTaglineIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTaglineIdx(i => (i + 1) % TAGLINES.length), 4000)
    return () => clearInterval(id)
  }, [])

  if (!mounted) {
    return (
      <div className="text-center text-sm text-brand-charcoal/60 py-2">
        Deal ends tonight at midnight
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-1.5 pt-3">
      <div className="flex items-center gap-1">
        <InlineTimeUnit value={hours}   label="hr"  urgent={isUrgent} />
        <InlineColon urgent={isUrgent} />
        <InlineTimeUnit value={minutes} label="min" urgent={isUrgent} />
        <InlineColon urgent={isUrgent} />
        <InlineTimeUnit value={seconds} label="sec" urgent={isUrgent} />
      </div>
      <p
        key={taglineIdx}
        className="text-brand-charcoal/50 text-xs text-center fade-in"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {TAGLINES[taglineIdx]}
      </p>
    </div>
  )
}

function InlineTimeUnit({ value, label, urgent }: { value: number; label: string; urgent: boolean }) {
  return (
    <div className="flex flex-col items-center w-9">
      <span
        className={[
          'text-xl font-black tabular-nums leading-none',
          urgent ? 'text-brand-coral countdown-pulse' : 'text-brand-charcoal',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {pad(value)}
      </span>
      <span className="text-brand-charcoal/40 text-[9px] uppercase tracking-widest">{label}</span>
    </div>
  )
}

function InlineColon({ urgent }: { urgent: boolean }) {
  return (
    <span
      className={[
        'text-lg font-bold pb-2.5 mx-0.5 select-none',
        urgent ? 'text-brand-coral/40' : 'text-brand-charcoal/30',
      ].join(' ')}
      aria-hidden="true"
    >
      :
    </span>
  )
}
