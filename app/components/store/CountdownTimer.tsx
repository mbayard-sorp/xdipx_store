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

export function CountdownTimer() {
  const [timeLeft, setTimeLeft]     = useState<TimeLeft>({ hours: 0, minutes: 0, seconds: 0 })
  const [taglineIdx, setTaglineIdx] = useState(0)
  const [mounted, setMounted]       = useState(false)

  const tick = useCallback(() => {
    setTimeLeft(msToTimeLeft(getMidnightMs()))
  }, [])

  useEffect(() => {
    // Set initial values immediately after mount (client only)
    tick()
    setMounted(true)

    const tickId    = setInterval(tick, 1000)
    const taglineId = setInterval(
      () => setTaglineIdx(i => (i + 1) % TAGLINES.length),
      4000,
    )

    return () => {
      clearInterval(tickId)
      clearInterval(taglineId)
    }
  }, [tick])

  const { hours, minutes, seconds } = timeLeft

  // Render placeholder during SSR / before hydration to avoid mismatch
  if (!mounted) {
    return (
      <div className="w-full bg-brand-charcoal py-3 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-3">
          <span className="text-white/60 text-sm" style={{ fontFamily: 'var(--font-display)' }}>
            Deal ends tonight at midnight
          </span>
        </div>
      </div>
    )
  }

  const isUrgent = hours === 0 && minutes < 60

  return (
    <div className={['w-full py-3 px-4', isUrgent ? 'bg-brand-gradient' : 'bg-brand-charcoal'].join(' ')}>
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-6">

        {/* Time display */}
        <div className="flex items-center gap-1">
          <TimeUnit value={hours}   label="hr"  urgent={isUrgent} />
          <Colon />
          <TimeUnit value={minutes} label="min" urgent={isUrgent} />
          <Colon />
          <TimeUnit value={seconds} label="sec" urgent={isUrgent} />
        </div>

        {/* Separator — hidden on small */}
        <span className="hidden sm:block text-white/30 text-xl">·</span>

        {/* Rotating tagline */}
        <p
          key={taglineIdx}
          className="text-white/90 text-sm text-center fade-in"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {TAGLINES[taglineIdx]}
        </p>
      </div>
    </div>
  )
}

function TimeUnit({ value, label, urgent }: { value: number; label: string; urgent: boolean }) {
  return (
    <div className="flex flex-col items-center w-10">
      <span
        className={[
          'text-2xl font-black tabular-nums leading-none',
          urgent ? 'text-white countdown-pulse' : 'text-brand-gradient',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {pad(value)}
      </span>
      <span className="text-white/50 text-[10px] uppercase tracking-widest">{label}</span>
    </div>
  )
}

function Colon() {
  return (
    <span
      className="text-white/40 text-xl font-bold pb-3 mx-0.5 select-none"
      aria-hidden="true"
    >
      :
    </span>
  )
}
