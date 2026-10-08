/** Number formatting for the P&L. One place, so every tile and table agrees. */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const int = new Intl.NumberFormat('en-US')

/** $1,234.56, with a true minus sign for negatives. */
export function money(n: number | null | undefined): string {
  if (n == null) return '—'
  const s = usd.format(Math.abs(n))
  return n < 0 && Math.abs(n) >= 0.005 ? `−${s}` : s
}

/** Headline money: cents under $1,000, whole dollars to $100k, compact beyond. */
export function moneyHeadline(n: number | null | undefined): string {
  if (n == null) return '—'
  const a = Math.abs(n)
  const s = a < 1000 ? usd.format(a) : a < 100_000 ? usd0.format(a) : usdCompact.format(a)
  return n < 0 && a >= 0.005 ? `−${s}` : s
}

/** Axis ticks: $0, $50, $1.2K. */
export function moneyTick(n: number): string {
  const a = Math.abs(n)
  const s = a >= 1000 ? usdCompact.format(a) : usd0.format(a)
  return n < 0 ? `−${s}` : s
}

/** A cost shown on the statement: (−$12.34). Null renders as a dash. */
export function cost(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) < 0.005) return usd.format(0)
  return `−${usd.format(Math.abs(n))}`
}

export function count(n: number | null | undefined): string {
  return n == null ? '—' : int.format(n)
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null) return '—'
  return `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`
}

export function signedPct(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) < 0.05) return '0%'
  return `${n > 0 ? '+' : '−'}${Math.abs(n) >= 100 ? Math.round(Math.abs(n)) : Math.abs(n).toFixed(1)}%`
}

export function multiple(n: number | null | undefined): string {
  return n == null ? '—' : `${n.toFixed(2)}×`
}

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const longDayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export function monthLabel(ym: string): string {
  return monthFmt.format(new Date(`${ym.slice(0, 7)}-01T00:00:00Z`))
}

export function dayLabel(day: string): string {
  return dayFmt.format(new Date(`${day}T00:00:00Z`))
}

export function longDay(day: string): string {
  return longDayFmt.format(new Date(`${day}T00:00:00Z`))
}

export function windowLabel(from: string, to: string): string {
  if (from === to) return longDay(from)
  return `${dayLabel(from)} to ${longDay(to)}`
}
