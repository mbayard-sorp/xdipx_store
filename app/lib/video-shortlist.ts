/**
 * The merchandising team's weekly video product shortlist, carried on the
 * strategy brief as `metricsJson.videoShortlist` (video program v2 plan,
 * "Product selection"). The showrunner pitches only from it, so a malformed
 * entry is dropped (and logged) rather than failing the whole brief publish:
 * the brief directs every team, and one bad shortlist row must not keep it
 * from landing.
 *
 * Pure: no .server imports, so the brief route and its tests share it.
 */

export interface VideoShortlistEntry {
  handle: string
  title: string
  format: string
  reason: string
  /** ISO timestamp of the Shopify + Nalpac stock check behind this entry. */
  stockCheckedAt: string
}

export interface ShortlistDrop {
  index: number
  reason: string
}

function validEntry(raw: unknown): { entry: VideoShortlistEntry } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not an object' }
  const o = raw as Record<string, unknown>
  for (const k of ['handle', 'title', 'format', 'reason', 'stockCheckedAt'] as const) {
    if (typeof o[k] !== 'string' || !(o[k] as string).trim()) return { error: `${k} must be a non-empty string` }
  }
  const stock = (o['stockCheckedAt'] as string).trim()
  if (Number.isNaN(Date.parse(stock))) return { error: 'stockCheckedAt is not a parseable date' }
  // A well-formed entry passes through exactly as sent (extra keys such as a
  // margin or an alternate handle included), so GET returns what was published.
  return { entry: o as unknown as VideoShortlistEntry }
}

/**
 * Returns metricsJson with `videoShortlist` reduced to its well-formed
 * entries. Anything that is not a plain object, or has no `videoShortlist`
 * key, passes through untouched. A `videoShortlist` that is not an array is
 * removed. Every drop is reported so the caller can log it.
 */
export function sanitizeBriefMetrics(metricsJson: unknown): { metricsJson: unknown; dropped: ShortlistDrop[] } {
  if (!metricsJson || typeof metricsJson !== 'object' || Array.isArray(metricsJson)) return { metricsJson, dropped: [] }
  const rec = metricsJson as Record<string, unknown>
  if (!('videoShortlist' in rec)) return { metricsJson, dropped: [] }
  const list = rec['videoShortlist']
  if (!Array.isArray(list)) {
    const { videoShortlist: _gone, ...rest } = rec
    return { metricsJson: rest, dropped: [{ index: -1, reason: 'videoShortlist is not an array' }] }
  }
  const kept: VideoShortlistEntry[] = []
  const dropped: ShortlistDrop[] = []
  list.forEach((raw, index) => {
    const r = validEntry(raw)
    if ('entry' in r) kept.push(r.entry)
    else dropped.push({ index, reason: r.error })
  })
  return { metricsJson: { ...rec, videoShortlist: kept }, dropped }
}
