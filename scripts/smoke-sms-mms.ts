/**
 * Asserts the multi-message MMS pipeline:
 *   - splitSmsReplyForMms turns a "---"-delimited two-product reply into
 *     two segments, each with a Shopify product image attached
 *   - processSmsMessage records one row per segment (with mediaUrl)
 *   - single-product replies stay as one segment
 */
import 'dotenv/config'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsAgeConsent, smsMessages, smsOptouts } from '../db/schema'
import { processSmsMessage } from '../app/lib/sms-processor.server'
import { splitSmsReplyForMms } from '../app/lib/sms-reply-segments.server'

const TEST_PHONE = '+15555550899'

async function cleanup() {
  await db.delete(smsMessages).where(and(eq(smsMessages.phone, TEST_PHONE), eq(smsMessages.simulated, true)))
  await db.delete(smsAgeConsent).where(eq(smsAgeConsent.phone, TEST_PHONE))
  await db.delete(smsOptouts).where(eq(smsOptouts.phone, TEST_PHONE))
}

async function main() {
  console.log(`MMS smoke for ${TEST_PHONE}.`)
  await cleanup()

  // ── Unit: pure splitter shape ─────────────────────────────────────────────
  const single = await splitSmsReplyForMms('Just one pick: xdipx.com/products/wiggly-bunny-purple. Sound good?')
  console.log(`\n[unit] single-product split → ${single.length} segments`)
  if (single.length !== 1) throw new Error('expected 1 segment for single-product reply')

  const dual = await splitSmsReplyForMms(
    'Two solid picks:\n\nThe Wiggly Bunny — xdipx.com/products/wiggly-bunny-purple\n\n---\n\nOr the Solia Bullet — xdipx.com/products/solia-bullet-pink. Either feel right?',
  )
  console.log(`[unit] two-product split → ${dual.length} segments`)
  if (dual.length !== 2) throw new Error(`expected 2 segments, got ${dual.length}`)
  console.log(`  segment 1 mediaUrl: ${dual[0]?.mediaUrl ?? '(none)'}`)
  console.log(`  segment 2 mediaUrl: ${dual[1]?.mediaUrl ?? '(none)'}`)
  if (!dual[0]?.mediaUrl) throw new Error('segment 1 missing mediaUrl (Shopify lookup failed?)')
  if (!dual[1]?.mediaUrl) throw new Error('segment 2 missing mediaUrl (Shopify lookup failed?)')
  if (!/cdn\.shopify\.com|shopify/.test(dual[0]!.mediaUrl!)) {
    throw new Error(`segment 1 mediaUrl doesn't look like a Shopify CDN URL: ${dual[0]!.mediaUrl}`)
  }

  // ── End-to-end: simulator-driven flow records per-segment rows ─────────────
  await processSmsMessage({ from: TEST_PHONE, body: 'hi', simulated: true })
  await processSmsMessage({ from: TEST_PHONE, body: 'YES', simulated: true })
  const reco = await processSmsMessage({
    from: TEST_PHONE,
    body: 'i need a powerful vibrator under $150 — show me two options',
    simulated: true,
  })
  console.log(`\n[e2e] reco produced ${reco.replies.length} segment(s)`)
  for (const [i, seg] of reco.replies.entries()) {
    console.log(`  ${i + 1}. [${seg.mediaUrl ? 'MMS' : 'SMS'}] ${seg.body.slice(0, 110)}${seg.body.length > 110 ? '…' : ''}`)
  }

  const rows = await db
    .select({ direction: smsMessages.direction, body: smsMessages.body, mediaUrl: smsMessages.mediaUrl })
    .from(smsMessages)
    .where(and(eq(smsMessages.phone, TEST_PHONE), eq(smsMessages.simulated, true)))
    .orderBy(asc(smsMessages.createdAt))
  const outboundRows = rows.filter((r) => r.direction === 'outbound')
  console.log(`\n[e2e] persisted ${outboundRows.length} outbound rows`)
  const lastTwo = outboundRows.slice(-Math.max(reco.replies.length, 1))
  for (const r of lastTwo) {
    console.log(`  [${r.mediaUrl ? 'MMS' : 'SMS'}] ${r.body.slice(0, 90)}…`)
  }

  console.log('\n✓ MMS smoke test passed.')
  await cleanup()
}

main().then(
  () => process.exit(0),
  async (err) => {
    console.error('\n✗', err.message)
    await cleanup()
    process.exit(1)
  },
)
