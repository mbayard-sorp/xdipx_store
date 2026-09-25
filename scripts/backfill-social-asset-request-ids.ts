/**
 * One-off backfill for `social_media_assets.provider_request_id` (migration
 * 103, ticket #11548).
 *
 * Historic cast frames logged their provider request id only on
 * `api_token_log.request_id`, keyed by `ref_id` = the asset filename. This
 * joins that ref_id to the filename at the tail of the asset `url` (query
 * string stripped) and fills `provider_request_id` for rows that are still
 * null and have exactly one distinct matching request id. Ambiguous and
 * unmatched rows are counted and left alone.
 *
 * Usage:
 *   npx tsx scripts/backfill-social-asset-request-ids.ts          # dry-run, reports counts
 *   npx tsx scripts/backfill-social-asset-request-ids.ts --apply  # write the unambiguous matches
 */
// MUST be the first import, it populates process.env before db.server reads it.
import './_load-env'
import { sql } from 'drizzle-orm'
import { db } from '../app/lib/db.server'

const APPLY = process.argv.includes('--apply')

/** Filename at the tail of a url, query string stripped. */
function filenameFromUrl(url: string): string {
  const bare = url.split('?')[0] ?? ''
  return decodeURIComponent(bare.slice(bare.lastIndexOf('/') + 1))
}

async function main() {
  const assets = (await db.execute(sql`
    select id, url from social_media_assets
    where provider_request_id is null and source = 'generated'
  `)).rows as { id: number; url: string }[]

  const logs = (await db.execute(sql`
    select ref_id, request_id from api_token_log
    where ref_id is not null and request_id is not null
  `)).rows as { ref_id: string; request_id: string }[]

  const byRef = new Map<string, Set<string>>()
  for (const l of logs) {
    const set = byRef.get(l.ref_id) ?? new Set<string>()
    set.add(l.request_id)
    byRef.set(l.ref_id, set)
  }

  let ambiguous = 0
  let unmatched = 0
  const updates: { id: number; requestId: string }[] = []
  for (const a of assets) {
    const ids = byRef.get(filenameFromUrl(a.url))
    if (!ids || ids.size === 0) { unmatched++; continue }
    if (ids.size > 1) { ambiguous++; continue }
    updates.push({ id: a.id, requestId: [...ids][0]!.slice(0, 64) })
  }

  console.log(`assets scanned: ${assets.length}`)
  console.log(`unambiguous matches: ${updates.length}, ambiguous: ${ambiguous}, unmatched: ${unmatched}`)

  if (!APPLY) {
    console.log('dry-run, nothing written. Re-run with --apply to write.')
    return
  }
  let written = 0
  for (const u of updates) {
    await db.execute(sql`
      update social_media_assets set provider_request_id = ${u.requestId}, updated_at = now()
      where id = ${u.id} and provider_request_id is null
    `)
    written++
  }
  console.log(`written: ${written}`)
}

main().then(() => process.exit(0), err => {
  console.error(err)
  process.exit(1)
})
