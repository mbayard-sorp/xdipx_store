// ─────────────────────────────────────────────────────────────────────────────
// Sustained out-of-stock monitor for carried products (suggestion #3884).
//
// The discontinued-sweep (`app/lib/feed-processor.server.ts`) only archives a
// carried SKU when Nalpac itself marks the sub-category/description
// discontinued. It does NOT look at supplier qty=0 — a temporary out-of-stock —
// so a carried product can sit orderable on the storefront while its supplier
// has zero units, and a customer can reach a sold-out checkout. The 2026-08-17
// inventory sweep found 311 carried SKUs (6.6%) at supplier qty=0 with nothing
// surfacing them.
//
// This module FLAGS (never auto-archives) carried SKUs that have shown supplier
// qty=0 for N consecutive days, so a human can hide or backorder-badge them.
// It runs as a step inside the existing daily import-monitor cron
// (`runImportMonitor`), reusing the carried set and feed snapshots already built
// there — no new cron schedule (which would be a protected `vercel.json` change)
// and no new table (a protected `db/schema.ts`/migration change).
//
// Streak state is a single Vercel-KV map keyed by SKU → the ISO date it was
// first observed at qty=0. `nalpac_price_history` keeps only the latest snapshot
// per SKU (its primary key is the SKU), so it cannot answer "how many days
// consecutively" on its own; the KV map is the minimal streak memory that
// avoids new schema. A SKU that recovers (qty > 0) simply drops out of the map,
// resetting its streak.
// ─────────────────────────────────────────────────────────────────────────────

import { kvGet, kvSet } from '~/lib/kv.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import {
  fileDetectionTicket,
  makeDedupeKey,
  priorityFromSeverity,
} from '~/lib/detection-tickets.server'

const KV_OOS_ZERO_SINCE = 'monitor:oos-zero-since'

/** Default consecutive-day threshold before a qty=0 carried SKU is flagged. */
export const DEFAULT_OOS_MIN_DAYS = 3
/** Default per-run ceiling on new flag tickets, so a first crossing can't flood. */
export const DEFAULT_OOS_MAX_PER_RUN = 20

/** SKU → ISO date (YYYY-MM-DD) it was first observed at supplier qty=0. */
export type OosStreakState = Record<string, string>

export interface OosFlag {
  sku: string
  /** ISO date the SKU was first observed at qty=0. */
  sinceStr: string
  /** Whole UTC days elapsed since `sinceStr`. */
  streakDays: number
}

export interface OosStreakResult {
  /** The streak map to persist for the next run (recovered SKUs dropped). */
  nextState: OosStreakState
  /** SKUs whose zero-streak has reached the threshold this run, longest first. */
  flagged: OosFlag[]
}

/** Whole UTC days between two YYYY-MM-DD date strings (never negative). */
export function utcDaysBetween(sinceStr: string, todayStr: string): number {
  const since = Date.parse(`${sinceStr}T00:00:00Z`)
  const today = Date.parse(`${todayStr}T00:00:00Z`)
  if (Number.isNaN(since) || Number.isNaN(today)) return 0
  return Math.max(0, Math.round((today - since) / 86_400_000))
}

/**
 * Pure streak core. Given the carried SKUs currently at supplier qty=0, the
 * prior streak map, today's date, and the day threshold, return the next map to
 * persist plus the SKUs that have been continuously zero for >= thresholdDays.
 *
 * A SKU absent from `zeroSkus` this run is dropped from the map (streak reset).
 * A newly-zero SKU is recorded at today's date (streak 0, not yet flagged).
 */
export function computeOosStreaks(
  zeroSkus: string[],
  priorState: OosStreakState,
  todayStr: string,
  thresholdDays: number,
): OosStreakResult {
  const nextState: OosStreakState = {}
  const flagged: OosFlag[] = []
  for (const sku of zeroSkus) {
    const sinceStr = priorState[sku] ?? todayStr
    nextState[sku] = sinceStr
    const streakDays = utcDaysBetween(sinceStr, todayStr)
    if (streakDays >= thresholdDays) flagged.push({ sku, sinceStr, streakDays })
  }
  // Longest-out-of-stock first so a per-run cap keeps the worst offenders.
  flagged.sort((a, b) => b.streakDays - a.streakDays || a.sku.localeCompare(b.sku))
  return { nextState, flagged }
}

export interface OosMonitorResult {
  zeroCount:    number
  flaggedCount: number
  ticketsFiled: number
  capped:       number
}

/**
 * Detect carried SKUs sitting at supplier qty=0 for N consecutive days and file
 * one deduped detection ticket per SKU (kind `process`, target team `product`),
 * up to a per-run cap. Reads config from `pipeline_settings` (never writes it):
 *   - `oos_flag_min_days`   (default 3): consecutive-day threshold.
 *   - `oos_flag_max_per_run`(default 20): max new tickets per run. Set to 0 to
 *     keep tracking streaks but file nothing — an off-switch with no new valve.
 *
 * Best-effort: reads the feed snapshots and carried set already built by the
 * import-monitor. Never throws (the import-monitor cron must return 200); the
 * caller still wraps it defensively.
 */
export async function flagSustainedOutOfStock(opts: {
  snapshots:   ReadonlyMap<string, { qty: number | null }>
  carriedSkus: ReadonlySet<string>
  todayStr?:   string
}): Promise<OosMonitorResult> {
  const todayStr = opts.todayStr ?? new Date().toISOString().slice(0, 10)

  const [minDaysStr, maxPerRunStr] = await Promise.all([
    getPipelineSetting('oos_flag_min_days'),
    getPipelineSetting('oos_flag_max_per_run'),
  ])
  const thresholdDays = Math.max(1, parseInt(minDaysStr ?? '', 10) || DEFAULT_OOS_MIN_DAYS)
  const maxPerRun = Math.max(0, parseInt(maxPerRunStr ?? '', 10) || DEFAULT_OOS_MAX_PER_RUN)

  // Carried SKUs present in this feed at supplier qty=0.
  const zeroSkus: string[] = []
  for (const sku of opts.carriedSkus) {
    const snap = opts.snapshots.get(sku)
    if (snap && snap.qty === 0) zeroSkus.push(sku)
  }

  const priorState = (await kvGet<OosStreakState>(KV_OOS_ZERO_SINCE)) ?? {}
  const { nextState, flagged } = computeOosStreaks(zeroSkus, priorState, todayStr, thresholdDays)
  // 35-day TTL: comfortably longer than any real streak; if it lapses, streaks
  // just restart from today, which only delays a flag, never files a false one.
  await kvSet(KV_OOS_ZERO_SINCE, nextState, 35 * 24 * 60 * 60)

  const toFile = flagged.slice(0, maxPerRun)
  let ticketsFiled = 0
  for (const f of toFile) {
    const id = await fileDetectionTicket({
      detector:   'oos-monitor',
      dedupeKey:  makeDedupeKey('inv-oos-sustained', f.sku),
      priority:   priorityFromSeverity('P3'),
      category:   'other',
      kind:       'process',
      targetTeam: 'product',
      suggestion:
        `Carried SKU ${f.sku} has shown Nalpac supplier qty=0 for ${f.streakDays} consecutive day(s) ` +
        `(first observed 0 on ${f.sinceStr}). The discontinued-sweep only archives on an explicit Nalpac ` +
        `discontinued flag, not a temporary out-of-stock, so this product may still be live and orderable ` +
        `on the storefront with zero supplier stock. Confirm the storefront state and hide or backorder-badge ` +
        `it so a customer does not reach a sold-out checkout. This is a FLAG for human action, not an ` +
        `auto-archive: if stock returns, no action is needed; if Nalpac later marks it discontinued, ` +
        `/cron/discontinued-sweep archives it. DONE WHEN: ${f.sku} is hidden, backorder-badged, or confirmed ` +
        `still sellable.`,
    })
    if (id) ticketsFiled++
  }

  const capped = flagged.length - toFile.length
  if (flagged.length > 0) {
    console.info(
      `[oos-monitor] carried qty=0: ${zeroSkus.length}; sustained >=${thresholdDays}d: ${flagged.length}; ` +
      `tickets filed: ${ticketsFiled}${capped > 0 ? `; capped ${capped} for a later run` : ''}`,
    )
  }

  return { zeroCount: zeroSkus.length, flaggedCount: flagged.length, ticketsFiled, capped }
}
