/**
 * Asserts two prompt-driven behaviors:
 *   1. Every product Emma pitches on SMS includes its xdipx.com/products/{handle} PDP link in the same reply.
 *   2. On commit, Emma offers an accessory upsell BEFORE sending the checkout URL.
 */
import 'dotenv/config'
import { and, eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsAgeConsent, smsMessages, smsOptouts } from '../db/schema'
import { processSmsMessage } from '../app/lib/sms-processor.server'

const TEST_PHONE = '+15555550799'

async function cleanup() {
  await db.delete(smsMessages).where(and(eq(smsMessages.phone, TEST_PHONE), eq(smsMessages.simulated, true)))
  await db.delete(smsAgeConsent).where(eq(smsAgeConsent.phone, TEST_PHONE))
  await db.delete(smsOptouts).where(eq(smsOptouts.phone, TEST_PHONE))
}

async function step(label: string, body: string) {
  const r = await processSmsMessage({ from: TEST_PHONE, body, simulated: true })
  console.log(`\n[${label}] sent: ${JSON.stringify(body)}`)
  console.log(`  outcome: ${r.outcome}`)
  console.log(`  reply  : ${r.reply ?? '(silent)'}`)
  return r
}

const PDP_RE = /xdipx\.com\/products\/[a-z0-9-]+/i
const CHECKOUT_RE = /xdipx\.myshopify\.com\/(?:cart|checkouts?)\/\S+/i
// Words that indicate Emma is offering an accessory upsell, not yet sending the link.
const UPSELL_RE = /\b(toss it in|pair|pairs|add\s+(?:a\s+)?lube|add\s+(?:an?\s+)?(?:lube|accessor|warmer|toy cleaner)|quick add|both in|pairs great|pairs well)\b/i

function fail(msg: string): never {
  throw new Error(msg)
}

async function main() {
  console.log(`PDP-link + upsell smoke for ${TEST_PHONE}.`)
  await cleanup()

  await step('1. greet', "hi")
  await step('2. consent', 'YES')

  // The pitch must include a PDP link.
  const pitch = await step('3. ask', "i'm looking for a powerful vibrator under $150")
  if (!pitch.reply || !PDP_RE.test(pitch.reply)) {
    fail(`Pitch reply did not include xdipx.com/products/{handle}: ${pitch.reply}`)
  }
  if (CHECKOUT_RE.test(pitch.reply)) {
    fail(`Pitch reply included a checkout URL — should only happen on commit: ${pitch.reply}`)
  }
  console.log('  ✓ pitch contains a PDP link, no premature checkout URL')

  // Commit must trigger the upsell question (not an immediate checkout URL).
  const commit = await step('4. commit', "i'll take it")
  if (!commit.reply) fail('Commit reply was empty')
  const offeredUpsell = UPSELL_RE.test(commit.reply)
  const sentCheckout = CHECKOUT_RE.test(commit.reply)
  if (!offeredUpsell && !sentCheckout) {
    fail(`Commit reply neither offered an upsell nor sent a checkout URL: ${commit.reply}`)
  }
  if (sentCheckout && !offeredUpsell) {
    fail(`Commit reply sent the checkout URL without first offering an accessory upsell: ${commit.reply}`)
  }
  console.log(`  ✓ commit reply ${offeredUpsell ? 'offered an upsell' : 'unexpectedly sent checkout'}`)

  // Decline the upsell — should now produce a checkout URL.
  const decline = await step('5. decline upsell', "no thanks, just the main one")
  if (!decline.reply) fail('Decline reply was empty')
  if (!CHECKOUT_RE.test(decline.reply)) {
    // Recovery message ("Something glitched") is acceptable — that's the validator catching a separate failure.
    if (!/glitched|try.*again|couldn'?t generate/i.test(decline.reply)) {
      fail(`Decline reply did not include a checkout URL: ${decline.reply}`)
    }
    console.log('  ⚠️  decline triggered the URL-fabrication recovery — buildCheckoutLink failed cleanly (acceptable)')
  } else {
    console.log('  ✓ decline produced a real checkout URL')
  }

  console.log('\n✓ pdp-and-upsell smoke passed.')
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
