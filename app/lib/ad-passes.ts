/**
 * The ads routine's two daily passes (plan section 5): 14:30 UTC files ideas and
 * renders hearted ones, 20:30 UTC renders anything hearted during the day.
 * Pure and client-safe; the loader computes the label so SSR and hydration agree.
 */
export const AD_PASSES_UTC: ReadonlyArray<{ hour: number; minute: number }> = [
  { hour: 14, minute: 30 },
  { hour: 20, minute: 30 },
]

/** Label for the next pass after `now`, for example "20:30 UTC" or "tomorrow 14:30 UTC". */
export function nextRenderPassLabel(now: Date): string {
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
  for (const p of AD_PASSES_UTC) {
    if (p.hour * 60 + p.minute > nowMin) return `${pad(p.hour)}:${pad(p.minute)} UTC`
  }
  const first = AD_PASSES_UTC[0]!
  return `tomorrow ${pad(first.hour)}:${pad(first.minute)} UTC`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
