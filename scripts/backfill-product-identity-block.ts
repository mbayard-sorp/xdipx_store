/**
 * One-time backfill for `social_media_assets.product_identity_failed_at`
 * (migration 109, ticket #11954).
 *
 * Run 1108 (2026-09-27) found `social_media_assets` 720/728/730 (B-Swish
 * Bthrilled wand) carrying `visionVerdict.pass=true` while the publish gate
 * BLOCKs them on product-identity every time reuse-first offers them (the
 * frame shows a foam/fabric massager head, not the real smooth silicone
 * wand) — a mismatch the frame-only vision check can't see, since it never
 * compares against the actual SKU. Going forward, `applyPublishGateVerdict`
 * (app/lib/social-publish-approve.server.ts) stamps a fresh product-identity
 * BLOCK onto the reused row automatically; this script is only for the three
 * rows that were already BLOCKed before that write-back existed.
 *
 * Usage:
 *   DATABASE_URL=<prod> npx tsx scripts/backfill-product-identity-block.ts
 *   DATABASE_URL=<prod> npx tsx scripts/backfill-product-identity-block.ts --ids=720,728,730 --note="..."
 *
 * Defaults to exactly the three ids and the reason above; both are
 * overridable for any future asset that needs the same one-time fix.
 * Idempotent: re-running only updates `updated_at`/`last_gate_block`, never
 * clears the flag it and the live code path both only ever set.
 */
import './_load-env'
import { markAssetsProductIdentityBlocked } from '../app/lib/social-publish-approve.server'
import { db } from '../app/lib/db.server'
import { socialMediaAssets } from '../db/schema'
import { inArray } from 'drizzle-orm'

const DEFAULT_IDS = [720, 728, 730]
const DEFAULT_NOTE =
  'product-identity: reused frame shows a foam/fabric massager head, not the real smooth silicone ' +
  'B-Swish Bthrilled wand (backfilled from run 1108, 2026-09-27, ticket #11954)'

function parseArgs(argv: string[]): { ids: number[]; note: string } {
  const args = argv.slice(2)
  const idsArg = args.find(a => a.startsWith('--ids='))
  const noteArg = args.find(a => a.startsWith('--note='))
  const ids = idsArg
    ? idsArg.slice('--ids='.length).split(',').map(s => Number(s.trim())).filter(Number.isInteger)
    : DEFAULT_IDS
  return { ids, note: noteArg ? noteArg.slice('--note='.length) : DEFAULT_NOTE }
}

async function main(): Promise<number> {
  const { ids, note } = parseArgs(process.argv)
  if (ids.length === 0) {
    console.error('no valid --ids given')
    return 2
  }

  const rows = await db
    .select({ id: socialMediaAssets.id, url: socialMediaAssets.url })
    .from(socialMediaAssets)
    .where(inArray(socialMediaAssets.id, ids))

  if (rows.length === 0) {
    console.error(`none of ids ${ids.join(',')} exist in social_media_assets`)
    return 1
  }
  if (rows.length < ids.length) {
    const found = new Set(rows.map(r => r.id))
    console.warn(`missing ids (skipped): ${ids.filter(i => !found.has(i)).join(',')}`)
  }

  await markAssetsProductIdentityBlocked(rows.map(r => r.url), note)
  console.log(`marked ${rows.length} row(s) product-identity-blocked: ${rows.map(r => `#${r.id}`).join(', ')}`)
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('ERROR:', err instanceof Error ? err.message : err)
    process.exit(2)
  },
)
