/**
 * Client-safe analytics helpers for the Social Studio (Phase 6a, #4914).
 *
 * `social_posts.metrics_json` holds whatever the capture code last merged for
 * that row's platform. The persisted vocabulary is the one in
 * `social-engagement.server.ts`: Instagram rows carry `reach`, `likes`,
 * `comments`, `saved`; X rows carry `impressions`, `likes`, `replies`,
 * `reposts`, `quotes`, `bookmarks`. The raw Graph / X API names (`saved`,
 * `like_count`, `impression_count`, `total_interactions`, ...) are accepted
 * too so a row written by an older or hand-run capture still normalises.
 *
 * Nothing here is estimated: a field the platform never reported is `null`,
 * not 0, and the table shows a dash for it.
 */

export type AnalyticsPlatform = 'instagram' | 'x'
export type AnalyticsRange = 7 | 30 | 90
export type AnalyticsSort = 'best' | 'recent' | 'likes' | 'comments' | 'saves' | 'views'

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = [7, 30, 90]
export const ANALYTICS_SORTS: readonly AnalyticsSort[] = ['best', 'recent', 'likes', 'comments', 'saves', 'views']

export interface NormalisedMetrics {
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
  views: number | null
  reach: number | null
  impressions: number | null
  replies: number | null
  reposts: number | null
}

const EMPTY: NormalisedMetrics = {
  likes: null, comments: null, saves: null, shares: null, views: null,
  reach: null, impressions: null, replies: null, reposts: null,
}

/** Persisted key first, raw API key second; the first number wins. */
const ALIASES: Record<keyof NormalisedMetrics, string[]> = {
  likes:       ['likes', 'like_count'],
  comments:    ['comments', 'comment_count', 'comments_count'],
  saves:       ['saved', 'saves', 'bookmarks', 'bookmark_count'],
  shares:      ['shares', 'share_count'],
  views:       ['views', 'plays', 'video_views'],
  reach:       ['reach'],
  impressions: ['impressions', 'impression_count'],
  replies:     ['replies', 'reply_count'],
  reposts:     ['reposts', 'retweet_count', 'retweets'],
}

function pick(json: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = json[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

export function parseRange(raw: string | null | undefined): AnalyticsRange {
  const n = Number(raw)
  return (ANALYTICS_RANGES as readonly number[]).includes(n) ? (n as AnalyticsRange) : 30
}

export function parsePlatform(raw: string | null | undefined): AnalyticsPlatform | 'all' {
  return raw === 'instagram' || raw === 'x' ? raw : 'all'
}

export function parseSort(raw: string | null | undefined): AnalyticsSort {
  return (ANALYTICS_SORTS as readonly string[]).includes(raw ?? '') ? (raw as AnalyticsSort) : 'best'
}

/**
 * One row's `metrics_json` into the nine-field shape the table reads. The
 * platform decides nothing about the keys (they are already per-platform in
 * the column) but it does decide which raw names are plausible: an X
 * `bookmarks` is a save, an Instagram `saved` is a save, and neither platform
 * ever writes the other's word.
 */
export function normaliseMetrics(
  platform: AnalyticsPlatform | string,
  json: Record<string, unknown> | null | undefined,
): NormalisedMetrics {
  if (!json || typeof json !== 'object') return { ...EMPTY }
  const out: NormalisedMetrics = { ...EMPTY }
  for (const field of Object.keys(ALIASES) as (keyof NormalisedMetrics)[]) {
    out[field] = pick(json, ALIASES[field])
  }
  // An X row never has "comments"; its replies are the comment column, and
  // the reverse holds for Instagram. Fill the missing twin so a sort by
  // comments ranks both platforms, but keep the source field as-is.
  if (platform === 'x' && out.comments == null) out.comments = out.replies
  if (platform === 'instagram' && out.replies == null) out.replies = out.comments
  return out
}

/**
 * Total interactions: everything a person did to the post, summed, with a
 * `total_interactions` key from the platform taking precedence when it was
 * reported. Comments and replies are the same number on both platforms after
 * normalisation (see above) so only one of them is counted.
 */
export function interactionsOf(m: NormalisedMetrics, raw?: Record<string, unknown> | null): number {
  if (raw) {
    const reported = pick(raw, ['total_interactions'])
    if (reported != null) return reported
  }
  return (m.likes ?? 0) + (m.comments ?? m.replies ?? 0) + (m.saves ?? 0) + (m.shares ?? 0) + (m.reposts ?? 0)
}

/** True when at least one metric was ever captured for this row. */
export function hasAnyMetric(m: NormalisedMetrics): boolean {
  return Object.values(m).some(v => v != null)
}

/** The column the table labels "Views": views where the platform has them, impressions otherwise. */
export function viewsOrImpressions(m: NormalisedMetrics): number | null {
  return m.views ?? m.impressions
}

// ─── CSV ────────────────────────────────────────────────────────────────────

export interface AnalyticsCsvRow {
  id: number
  platform: string
  postedAt: string | null
  permalink: string | null
  caption: string
  metrics: NormalisedMetrics
  interactions: number
}

export const CSV_HEADER = [
  'id', 'platform', 'posted_at', 'permalink', 'caption',
  'likes', 'comments', 'saves', 'shares', 'views', 'reach', 'impressions', 'replies', 'reposts', 'interactions',
] as const

/**
 * RFC 4180 cell: quoted when it holds a comma, a quote, or a line break;
 * embedded quotes doubled. Null is an empty cell, never the word "null".
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** UTF-8 BOM so Excel reads the captions as UTF-8; CRLF line ends per RFC 4180. */
export function buildAnalyticsCsv(rows: AnalyticsCsvRow[]): string {
  const lines: string[] = [CSV_HEADER.join(',')]
  for (const r of rows) {
    const m = r.metrics
    lines.push([
      r.id, r.platform, r.postedAt, r.permalink, r.caption,
      m.likes, m.comments, m.saves, m.shares, m.views, m.reach, m.impressions, m.replies, m.reposts, r.interactions,
    ].map(csvCell).join(','))
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

export function csvFilename(range: AnalyticsRange, now: Date): string {
  return `xdipx-social-${range}d-${now.toISOString().slice(0, 10)}.csv`
}

/** A one-line caption excerpt for table cells and the CSV. */
export function captionSnippet(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}
