/**
 * One-off recovery listing for ticket #5416. READ-ONLY.
 *
 * Rejection was terminal with no escape hatch that carried content forward,
 * so some rows the owner rejected with real revision direction ("show a cast
 * member cleaning a toy with one of our toy cleaning products", row #74) are
 * stuck dead with no way back except a blank Composer draft. This lists
 * those rows so the owner can pick which ones to clone with the new
 * "Clone to new draft" action in /admin/socials (History tab, rejected rows).
 *
 * A row counts here when it is rejected AND its feedback is human-authored
 * revision direction, not a bare gate stamp: `feedback IS NOT NULL AND
 * feedback NOT LIKE '%publish-gate%'`. The count is NOT hardcoded; it is
 * whatever this query finds today.
 *
 * This script never writes. It only reports. Cloning is a click in the UI,
 * on the owner's own judgment about which of these are worth reworking.
 *
 * Usage:
 *   npx tsx scripts/list-rejected-with-human-feedback.ts            # table
 *   npx tsx scripts/list-rejected-with-human-feedback.ts --json     # JSON
 */
import 'dotenv/config'
import { db } from '../app/lib/db.server.ts'
import { socialPosts } from '../db/schema.ts'
import { and, eq, isNotNull, notLike } from 'drizzle-orm'

const asJson = process.argv.includes('--json')

async function main() {
  const rows = await db
    .select({
      id: socialPosts.id,
      platform: socialPosts.platform,
      tweetText: socialPosts.tweetText,
      feedback: socialPosts.feedback,
      gateStatus: socialPosts.gateStatus,
      reviewedAt: socialPosts.reviewedAt,
      reviewedBy: socialPosts.reviewedBy,
    })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.reviewStatus, 'rejected'),
      isNotNull(socialPosts.feedback),
      notLike(socialPosts.feedback, '%publish-gate%'),
    ))

  const candidates = rows.filter(r => (r.feedback ?? '').trim().length > 0)

  if (asJson) {
    console.log(JSON.stringify({ count: candidates.length, rows: candidates }, null, 2))
    return
  }

  console.log(`${candidates.length} rejected row(s) carry non-gate human-authored feedback.`)
  console.log('Clone the ones worth reworking from /admin/socials (History tab); nothing here is written automatically.')
  console.log('')
  for (const r of candidates) {
    const caption = r.tweetText.length > 90 ? `${r.tweetText.slice(0, 90)}...` : r.tweetText
    const feedback = (r.feedback ?? '').length > 160 ? `${(r.feedback ?? '').slice(0, 160)}...` : r.feedback
    console.log(`#${r.id} [${r.platform}]${r.gateStatus === 'block' ? ' (gate BLOCK)' : ''}`)
    console.log(`  caption: ${caption}`)
    console.log(`  feedback: ${feedback}`)
    console.log(`  reviewed: ${r.reviewedAt ?? 'unknown'} by ${r.reviewedBy ?? 'unknown'}`)
    console.log('')
  }
}

main().catch(err => {
  console.error('list-rejected-with-human-feedback failed:', err)
  process.exit(1)
})
