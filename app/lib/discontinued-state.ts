/**
 * Discontinued as a STATE derived from the Nalpac feeds (owner direction
 * 2026-09-25). Nalpac never flags a discontinued product in the feed; the
 * 2026-09-25 sweep found the regex matched exactly one row in 18,316, a false
 * positive on "AC/DC". Products simply disappear from the feed. So the signal
 * is absence: a carried SKU missing from every feed for `graceDays`
 * consecutive daily checks is discontinued as of the first day it went
 * missing. A SKU that reappears is un-discontinued.
 *
 * Pure: the sweep owns the KV ledger and the Shopify writes.
 */

/** sku -> ISO date (YYYY-MM-DD) of the first daily check that missed it. */
export type AbsenceLedger = Record<string, string>

export interface FeedAbsenceInput {
  /** Carried SKUs (imported, not yet archived). */
  carried: readonly string[]
  /** SKUs present in any Nalpac feed today. */
  present: ReadonlySet<string>
  /** SKUs the feed itself marks discontinued today (regex signal; rare). */
  flagged: ReadonlySet<string>
  ledger: AbsenceLedger
  today: string
  graceDays: number
}

export interface FeedAbsenceResult {
  ledger: AbsenceLedger
  /** SKUs now in the discontinued state, with the date it began. */
  discontinued: Array<{ sku: string; since: string }>
  /** SKUs that were in the ledger and are back in the feed. */
  returned: string[]
  /** Absent SKUs still inside the grace window. */
  pending: number
}

export const DISCONTINUED_GRACE_DAYS_DEFAULT = 3

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso); const b = Date.parse(toIso)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.floor((b - a) / 86_400_000)
}

export function classifyFeedAbsence(input: FeedAbsenceInput): FeedAbsenceResult {
  const ledger: AbsenceLedger = { ...input.ledger }
  const discontinued: FeedAbsenceResult['discontinued'] = []
  const returned: string[] = []
  let pending = 0

  for (const sku of input.carried) {
    const flagged = input.flagged.has(sku)
    const present = input.present.has(sku)

    if (present && !flagged) {
      if (ledger[sku] !== undefined) {
        delete ledger[sku]
        returned.push(sku)
      }
      continue
    }

    const since = ledger[sku] ?? input.today
    ledger[sku] = since

    if (flagged || daysBetween(since, input.today) >= input.graceDays) {
      discontinued.push({ sku, since })
    } else {
      pending++
    }
  }

  // Ledger entries for SKUs no longer carried (archived since) are dropped so
  // the blob cannot grow forever.
  const carriedSet = new Set(input.carried)
  for (const sku of Object.keys(ledger)) {
    if (!carriedSet.has(sku)) delete ledger[sku]
  }

  return { ledger, discontinued, returned, pending }
}
