import { useEffect, useState, useCallback } from 'react'

interface TimeLeft { hours: number; minutes: number; seconds: number }

function getMidnightMs(): number {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  return midnight.getTime() - now.getTime()
}

function msToTimeLeft(ms: number): TimeLeft {
  const total = Math.max(0, Math.floor(ms / 1000))
  return {
    hours:   Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

export function useCountdown() {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({ hours: 0, minutes: 0, seconds: 0 })
  const [mounted,  setMounted]  = useState(false)

  const tick = useCallback(() => setTimeLeft(msToTimeLeft(getMidnightMs())), [])

  useEffect(() => {
    tick()
    setMounted(true)
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tick])

  return { timeLeft, mounted, isUrgent: timeLeft.hours === 0 && timeLeft.minutes < 60 }
}
