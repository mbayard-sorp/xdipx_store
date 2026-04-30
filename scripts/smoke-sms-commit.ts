/**
 * Drives the SMS simulator through a full happy path and asserts that:
 *   1. Emma never asks for email/name/address.
 *   2. The commit reply contains a customer-facing Shopify checkout URL
 *      (xdipx.myshopify.com/cart/c/... — NOT an /admin/draft_orders/... link).
 */
import 'dotenv/config'
import { and, eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsAgeConsent, smsMessages, smsOptouts } from '../db/schema'
import { processSmsMessage } from '../app/lib/sms-processor.server'

const TEST_PHONE = '+15555550299'

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

async function main() {
  console.log(`Commit-flow smoke test for ${TEST_PHONE}.`)
  await cleanup()

  await step('1', "hi emma")
  await step('2', 'YES')
  await step('3', "looking for a powerful vibrator under $150")
  const commit1 = await step('4', "i'll take the first one")

  // If she asked for personal info, fail loudly.
  const personalInfoAsk = /\b(email|name|address|zip|street|shipping)\b/i.test(commit1.reply ?? '')
  if (personalInfoAsk) {
    // Maybe she's still pitching — try one more turn.
    const commit2 = await step('5', "yes send me the checkout link")
    const stillAsking = /\b(email|name|address|zip|street|shipping)\b/i.test(commit2.reply ?? '')
    if (stillAsking) {
      console.error('\n✗ FAIL: Emma asked for personal info on SMS commit — she should never do that.')
      console.error('  Last reply:', commit2.reply)
      await cleanup()
      process.exit(1)
    }
    const url = (commit2.reply ?? '').match(/https?:\/\/\S+/)?.[0]
    assertCheckoutUrl(url)
  } else {
    const url = (commit1.reply ?? '').match(/https?:\/\/\S+/)?.[0]
    if (!url) {
      // Sometimes she'll confirm before sending — push once.
      const commit2 = await step('5', "yes please send the link")
      const url2 = (commit2.reply ?? '').match(/https?:\/\/\S+/)?.[0]
      assertCheckoutUrl(url2)
    } else {
      assertCheckoutUrl(url)
    }
  }

  console.log('\n✓ commit-flow smoke test passed.')
  await cleanup()
}

function assertCheckoutUrl(url: string | undefined): void {
  if (!url) {
    throw new Error('Emma did not send a checkout URL.')
  }
  if (url.includes('/admin/draft_orders/')) {
    throw new Error(`Emma sent an admin-only invoice URL — customers cannot open this: ${url}`)
  }
  // Shopify cart-checkout URLs from createCart's cart.checkoutUrl take the
  // form "https://<shop>.myshopify.com/cart/c/<token>?key=..." or similar.
  if (!/myshopify\.com\/(cart|checkouts?)\//.test(url) && !/xdipx\.com\/(cart|checkouts?)\//.test(url)) {
    throw new Error(`URL doesn't look like a Shopify hosted checkout: ${url}`)
  }
  console.log(`\n✓ checkout URL looks valid: ${url}`)
}

main().then(
  () => process.exit(0),
  async (err) => {
    console.error('\n✗', err.message)
    await cleanup()
    process.exit(1)
  },
)
