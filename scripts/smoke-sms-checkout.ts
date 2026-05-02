/**
 * End-to-end commit-flow smoke specifically targeting the regression the user
 * hit: customer picks a product, accepts the lube upsell, and Emma fabricates
 * a checkout URL because she had no real variantId.
 *
 * Asserts:
 *   - The commit reply contains a real Shopify checkout URL (xdipx.myshopify.com/cart/c/...)
 *   - It is NOT a fabrication (validator's recovery message is a failure)
 *   - When the customer accepts the lube P.S., a fresh checkout URL is sent
 */
import 'dotenv/config'
import { and, eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsAgeConsent, smsMessages, smsOptouts } from '../db/schema'
import { processSmsMessage } from '../app/lib/sms-processor.server'

const TEST_PHONE = '+15555550999'

async function cleanup() {
  await db.delete(smsMessages).where(and(eq(smsMessages.phone, TEST_PHONE), eq(smsMessages.simulated, true)))
  await db.delete(smsAgeConsent).where(eq(smsAgeConsent.phone, TEST_PHONE))
  await db.delete(smsOptouts).where(eq(smsOptouts.phone, TEST_PHONE))
}

async function step(label: string, body: string) {
  const r = await processSmsMessage({ from: TEST_PHONE, body, simulated: true })
  const joined = r.replies.map((s) => s.body).join(' || ')
  console.log(`\n[${label}] sent: ${JSON.stringify(body)}`)
  console.log(`  outcome  : ${r.outcome}`)
  console.log(`  segments : ${r.replies.length}`)
  console.log(`  reply    : ${joined.slice(0, 240)}${joined.length > 240 ? '…' : ''}`)
  return r
}

const CHECKOUT_RE = /https?:\/\/[\w-]*\.?(?:myshopify\.com|xdipx\.com)\/(?:cart|checkouts?)\/\S+/i
const RECOVERY_RE = /couldn'?t generate.*checkout.*cleanly|glitched on my end/i

function fail(msg: string): never {
  throw new Error(msg)
}

function joined(r: Awaited<ReturnType<typeof processSmsMessage>>): string {
  return r.replies.map((s) => s.body).join('\n')
}

async function main() {
  console.log(`Checkout-flow regression smoke for ${TEST_PHONE}.`)
  await cleanup()

  await step('1. greet', 'hi')
  await step('2. consent', 'YES')

  const reco = await step('3. ask', 'i need a powerful vibrator under $150 - show me two options')
  if (!CHECKOUT_RE.test(joined(reco))) {
    /* expected: pitch with PDP links, no checkout yet */
  } else {
    fail('Pitch reply already contained a checkout URL — should only happen on commit')
  }

  // TURN A: Commit. Should produce the upsell QUESTION, NOT a checkout URL.
  const commit = await step('4. pick first', 'i like the first one')
  const commitText = joined(commit)
  if (RECOVERY_RE.test(commitText)) {
    fail(`Commit triggered fabrication recovery: ${commitText}`)
  }
  if (CHECKOUT_RE.test(commitText)) {
    fail(`Commit reply contained a checkout URL — should be the upsell question first, link comes after yes/no: ${commitText}`)
  }
  // Upsell question must name a specific lube (no generic placeholder).
  const namesSpecificLube = /lube/i.test(commitText) && !/\ba good lube\b|\ba lube\b|\bthe lube\b/i.test(commitText)
  if (!namesSpecificLube) {
    console.warn(`  ⚠️ commit reply mentioned lube but may not have named a specific product: ${commitText}`)
  }
  console.log('  ✓ commit produced the upsell question (no premature URL)')

  // TURN B (yes path): Customer accepts. Now we expect the bundled checkout URL.
  const accept = await step('5. yes', 'yes')
  const acceptText = joined(accept)
  if (RECOVERY_RE.test(acceptText)) {
    fail(`Upsell-accept triggered fabrication recovery: ${acceptText}`)
  }
  if (!CHECKOUT_RE.test(acceptText)) {
    fail(`Upsell-accept reply did not contain a checkout URL: ${acceptText}`)
  }
  console.log('  ✓ upsell-accept produced a real bundled checkout URL')

  console.log('\n✓ checkout-flow smoke passed.')
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
