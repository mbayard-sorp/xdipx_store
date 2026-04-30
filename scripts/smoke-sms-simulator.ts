/**
 * Smoke test for the SMS simulator pipeline. Hits processSmsMessage() directly
 * with simulated:true so it doesn't pollute real customer threads.
 *
 *   tsx scripts/smoke-sms-simulator.ts
 *
 * Cleans up after itself (deletes simulated rows for the test phone).
 */
import 'dotenv/config'
import { and, eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsAgeConsent, smsMessages, smsOptouts } from '../db/schema'
import { processSmsMessage } from '../app/lib/sms-processor.server'

const TEST_PHONE = '+15555550199'

async function cleanup() {
  await db.delete(smsMessages).where(and(eq(smsMessages.phone, TEST_PHONE), eq(smsMessages.simulated, true)))
  await db.delete(smsAgeConsent).where(eq(smsAgeConsent.phone, TEST_PHONE))
  await db.delete(smsOptouts).where(eq(smsOptouts.phone, TEST_PHONE))
}

async function step(label: string, body: string) {
  const r = await processSmsMessage({ from: TEST_PHONE, body, simulated: true })
  const reply = r.reply ? r.reply.replace(/\s+/g, ' ').slice(0, 180) : '(silent)'
  console.log(`\n[${label}] sent: ${JSON.stringify(body)}`)
  console.log(`  outcome: ${r.outcome}`)
  console.log(`  reply  : ${reply}${r.reply && r.reply.length > 180 ? '…' : ''}`)
  return r
}

async function main() {
  console.log(`Smoke test for ${TEST_PHONE} (simulated rows only).`)
  await cleanup()

  // 1. Fresh phone → age gate
  const ageGate = await step('1. fresh', "hey what's your best vibrator?")
  if (ageGate.outcome !== 'age_gate_prompt') throw new Error('expected age_gate_prompt')

  // 2. Confirm age
  const ageOk = await step('2. consent', 'YES')
  if (ageOk.outcome !== 'age_gate_confirmed') throw new Error('expected age_gate_confirmed')

  // 3. Real product question — Emma should reply with a real recommendation
  const reco = await step('3. discover', 'something quiet for beginners under 80')
  if (reco.outcome !== 'reply' && reco.outcome !== 'reply_fallback') {
    throw new Error('expected reply')
  }

  // 4. STOP keyword
  const stop = await step('4. stop', 'STOP')
  if (stop.outcome !== 'stop') throw new Error('expected stop')

  // 5. Opted-out follow-up should be silent
  const silent = await step('5. opted-out', 'hello?')
  if (silent.outcome !== 'opted_out_silent') throw new Error('expected opted_out_silent')

  // 6. START resubscribes
  const start = await step('6. start', 'START')
  if (start.outcome !== 'start') throw new Error('expected start')

  // 7. HELP
  const help = await step('7. help', 'HELP')
  if (help.outcome !== 'help') throw new Error('expected help')

  // Confirm row tagging — every row from this run should have simulated=true
  const rows = await db
    .select({ direction: smsMessages.direction, simulated: smsMessages.simulated, body: smsMessages.body })
    .from(smsMessages)
    .where(eq(smsMessages.phone, TEST_PHONE))
  const allSimulated = rows.every((r) => r.simulated === true)
  console.log(`\nPersistence: ${rows.length} rows for ${TEST_PHONE}, all simulated=${allSimulated}`)
  if (!allSimulated) throw new Error('non-simulated row written from simulator!')

  await cleanup()
  console.log('\n✓ smoke test passed — cleaned up.')
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\n✗ smoke test failed', err)
    process.exit(1)
  },
)
