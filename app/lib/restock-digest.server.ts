/**
 * Ticket #5430: batch a day's restock crossings into ONE suggestion row
 * instead of filing one per crossing.
 *
 * `server/webhooks.ts` used to call `createSuggestion` on every genuine
 * sold-out -> in-stock crossing (dedupeKey `restock:<handle>`, kind
 * `process`). 46 of those rows were filed 2026-08-21..08-25, all still
 * `status=approved`, zero applied: `process` has no automated executor and
 * routine-social-daily.md Step 7b can close at most 6/day against a fill
 * rate of ~9.2/day. That gap is structural (a fill-rate problem), so raising
 * the drain rate would still leave every run paying to read a queue that
 * grows regardless. Filing one digest row per UTC day, listing every
 * crossing, fixes the fill rate directly and costs one row instead of nine.
 *
 * dedupeKey is `restock-digest:<UTC day>` with `dedupeScope: 'daily'`, so the
 * date is identity, not noise (mirrors `new-products:enrich:<day>` in
 * import-enrich.server.ts) — without `daily` scope the key would canonicalize
 * to `restock-digest` and every day after the first would be swallowed by
 * the first day's row.
 *
 * `createSuggestionDetailed`'s dedupeKey collision path returns the EXISTING
 * live row without touching its content (see its own doc comment in
 * team.server.ts) — a repeat create is not an "append". So a second-and-later
 * crossing the same day appends its own line with a direct, atomic SQL
 * concatenation (`suggestion || line`) rather than a read-modify-write,
 * because two webhook deliveries landing close together must not race and
 * clobber one another's line.
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { homepageTeamSuggestions } from '../../db/schema'
import { createSuggestionDetailed } from '~/lib/team.server'

export interface RestockCrossingProduct {
  handle: string
  title: string
  /** `xdipx.deal_score` metafield, when available. */
  dealScore?: number | null
}

/** UTC calendar day (`YYYY-MM-DD`) a crossing belongs to. Pure so the day
 *  rollover boundary is unit-testable without touching the DB. */
export function restockDigestDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** `dedupeScope: 'daily'` keeps this date stamp instead of stripping it
 *  (dedupe-key.ts), which is what makes one row per day the point. */
export function restockDigestDedupeKey(day: string): string {
  return `restock-digest:${day}`
}

/** One bullet line for the digest body. Carries handle, title, and deal score
 *  (ticket #5430 DONE WHEN) so the social routine can still pick a product
 *  from the digest without opening Shopify. */
export function formatRestockDigestLine(
  product: RestockCrossingProduct,
  now: Date = new Date(),
): string {
  const score =
    product.dealScore == null || Number.isNaN(product.dealScore)
      ? 'n/a'
      : product.dealScore.toFixed(1)
  const time = now.toISOString().slice(11, 16)
  return `- ${product.title} (handle: ${product.handle}, deal score: ${score}) at ${time} UTC`
}

export function buildRestockDigestHeader(day: string): string {
  return (
    `Back in stock digest for ${day} (UTC). One row per day, batched from ` +
    `every genuine sold-out -> in-stock crossing (ticket #5430) instead of one ` +
    `row per crossing, because \`process\` has no automated executor and the ` +
    `old per-crossing filing flooded a lane the routine cannot drain. Each line ` +
    `is still the rarest, highest-intent restock signal we have: draft a post ` +
    `per routine-social-daily.md Step 7b for any line that clears the usual ` +
    `gates (Instagram category eligibility + stock). CAPTION CONSTRAINT: frame ` +
    `every restock as mechanism or quality ("why this one keeps selling out"), ` +
    `never as scarcity or urgency; "back in stock" as urgency bait is a ` +
    `sale-signal register the charter and social-publish-gate refuse.\n\n` +
    `Crossings today:\n`
  )
}

/**
 * File (or extend) today's restock digest row for one crossing.
 *
 * Returns `created: true` the first time a given UTC day is seen, `false`
 * when the crossing was appended onto an already-live digest row for today.
 */
export async function fileRestockDigestEntry(
  product: RestockCrossingProduct,
  opts: { now?: Date } = {},
): Promise<{ id: number; created: boolean }> {
  const now = opts.now ?? new Date()
  const day = restockDigestDay(now)
  const dedupeKey = restockDigestDedupeKey(day)
  const line = formatRestockDigestLine(product, now)

  const result = await createSuggestionDetailed({
    team:        'social',
    kind:        'process',
    category:    'social-automation',
    dedupeKey,
    dedupeScope: 'daily',
    suggestion:  buildRestockDigestHeader(day) + line,
  })

  if (!result.deduped) return { id: result.id, created: true }
  if (result.id === 0) {
    // The dedupe collision fired but the live row it pointed at could not be
    // resolved (e.g. it was closed between the insert attempt and the lookup
    // inside createSuggestionDetailed). Rare and not worth retrying here: the
    // NEXT crossing will mint a fresh digest row for today.
    console.warn(
      `[restock-digest] dedupe collision on '${dedupeKey}' but no live row found; ` +
      `crossing for ${product.handle} was not recorded in a digest row`,
    )
    return { id: 0, created: false }
  }

  // Append atomically at the DB layer, never read-modify-write, so two
  // webhook deliveries landing close together cannot clobber one another.
  await db
    .update(homepageTeamSuggestions)
    .set({
      suggestion: sql`${homepageTeamSuggestions.suggestion} || ${'\n' + line}`,
      updatedAt:  now,
    })
    .where(eq(homepageTeamSuggestions.id, result.id))

  return { id: result.id, created: false }
}
