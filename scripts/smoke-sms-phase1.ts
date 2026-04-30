/**
 * scripts/smoke-sms-phase1.ts
 *
 * Phase 1 SMS smoke test. Run with:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx scripts/smoke-sms-phase1.ts
 *
 * Covers:
 *   1. Intent classifier: 10 messages, >=8 hit regex, others fall to Haiku,
 *      all return a valid IntentResult.
 *   2. Conversation 24h rotation: insert row with last_active_at 25h ago,
 *      send message, assert new conversation_id and stage='RECONNECT'.
 *   3. v2 path: call processSmsMessageV2 with SMS_V2_PHONES set to test phone;
 *      assert sms_turns.intent and intent_confidence are populated.
 *   4. Consent v2: AGE_CONFIRM sets smsAgeConsent.method='sms_yes_v2'.
 *   5. Stage TTL: row with stage='PRESENTATION' and stage_set_at 7h ago +
 *      OFF_TOPIC intent → stage drops to DISCOVERY.
 *
 * Note: Klaviyo subscribe is attempted but non-fatal — we assert the attempt
 * was made by checking no unhandled error propagated (we don't mock HTTP here;
 * the env var KLAVIYO_SMS_LIST_ID being unset causes a graceful skip/log).
 */
import 'dotenv/config'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsAgeConsent, smsConversations, smsMessages, smsOptouts, smsTurns } from '../db/schema'
import { classifyIntent } from '../app/lib/sms-v2/intent-classifier.server'
import { getOrCreateConversation } from '../app/lib/sms-v2/conversation.server'
import { processSmsMessageV2 } from '../app/lib/sms-v2/processor.server'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TEST_PHONE_A = '+15555551001'   // intent classifier + v2 path
const TEST_PHONE_B = '+15555551002'   // 24h rotation
const TEST_PHONE_C = '+15555551003'   // stage TTL
const TEST_PHONE_D = '+15555551004'   // consent v2

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function cleanupPhone(phone: string): Promise<void> {
  await db.delete(smsTurns).where(eq(smsTurns.phone, phone))
  await db.delete(smsConversations).where(eq(smsConversations.phone, phone))
  await db.delete(smsMessages).where(eq(smsMessages.phone, phone))
  await db.delete(smsAgeConsent).where(eq(smsAgeConsent.phone, phone))
  await db.delete(smsOptouts).where(eq(smsOptouts.phone, phone))
}

async function cleanup(): Promise<void> {
  await Promise.all([
    cleanupPhone(TEST_PHONE_A),
    cleanupPhone(TEST_PHONE_B),
    cleanupPhone(TEST_PHONE_C),
    cleanupPhone(TEST_PHONE_D),
  ])
}

async function settle(ms = 600): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Test 1: Intent classifier
// ---------------------------------------------------------------------------

const CLASSIFIER_MESSAGES = [
  // Should hit regex (>=8 of these must hit regex or haiku — all must return valid IntentResult)
  { text: 'stop',                       expect: 'STOP_HELP_START' as const },
  { text: 'yes',                        expect: 'AGE_CONFIRM' as const },
  { text: "I'll take it",               expect: 'COMMIT_PICK' as const },
  { text: 'no thanks',                  expect: 'UPSELL_DECLINE' as const },
  { text: 'yes add the lube',           expect: 'UPSELL_ACCEPT' as const },
  { text: 'show me vibrators',          expect: 'NAME_ITEM' as const },
  { text: 'Is it waterproof?',          expect: 'RESEARCH' as const },
  { text: 'does it work with couples?', expect: 'RESEARCH' as const },
  // Haiku escalation cases (no regex match)
  { text: 'When will my order arrive?', expect: 'SUPPORT' as const },
  { text: 'This seems expensive',       expect: 'OBJECTION' as const },
]

async function testIntentClassifier(): Promise<void> {
  console.log('\n── Test 1: Intent Classifier ──')
  let regexHits = 0
  const results: Array<{ text: string; intent: string; source: string; confidence: number }> = []

  for (const { text, expect: expectedIntent } of CLASSIFIER_MESSAGES) {
    const result = await classifyIntent({ stage: 'DISCOVERY' }, text)

    assert(typeof result.intent === 'string', `intent is a string for: "${text}"`)
    assert(typeof result.confidence === 'number', `confidence is a number for: "${text}"`)
    assert(result.confidence >= 0 && result.confidence <= 1, `confidence in [0,1] for: "${text}"`)
    assert(['regex', 'haiku', 'fallback'].includes(result.source), `source valid for: "${text}"`)

    if (result.source === 'regex') regexHits++
    results.push({ text, intent: result.intent, source: result.source, confidence: result.confidence })

    // Soft assertion — log if intent doesn't match expected
    if (result.intent !== expectedIntent) {
      console.log(`  ⚠  "${text}" → ${result.intent} (expected ${expectedIntent}) [source=${result.source}]`)
    }
  }

  assert(regexHits >= 8, `at least 8/10 messages hit regex (got ${regexHits})`)

  console.log('\n  Classification results:')
  for (const r of results) {
    console.log(`    "${r.text}" → ${r.intent} [${r.source}, conf=${r.confidence.toFixed(2)}]`)
  }
}

// ---------------------------------------------------------------------------
// Test 2: 24h conversation rotation
// ---------------------------------------------------------------------------

async function testConversationRotation(): Promise<void> {
  console.log('\n── Test 2: 24h Conversation Rotation ──')
  await cleanupPhone(TEST_PHONE_B)

  // Insert a row with last_active_at 25 hours ago
  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await db.insert(smsConversations).values({
    phone: TEST_PHONE_B,
    stage: 'DISCOVERY',
    stageSetAt: twentyFiveHoursAgo,
    lastActiveAt: twentyFiveHoursAgo,
  })

  const before = await db
    .select({ conversationId: smsConversations.conversationId, stage: smsConversations.stage })
    .from(smsConversations)
    .where(eq(smsConversations.phone, TEST_PHONE_B))
    .limit(1)

  const originalId = before[0]?.conversationId
  assert(typeof originalId === 'string', 'original conversation_id is a string')

  // Call getOrCreateConversation — should trigger rotation
  const row = await getOrCreateConversation(TEST_PHONE_B)

  assert(row.conversationId !== originalId, `conversation_id rotated (${originalId} → ${row.conversationId})`)
  assert(row.stage === 'RECONNECT', `stage reset to RECONNECT (got '${row.stage}')`)
}

// ---------------------------------------------------------------------------
// Test 3: v2 path — sms_turns gets intent + intent_confidence populated
// ---------------------------------------------------------------------------

async function testV2TurnsObservability(): Promise<void> {
  console.log('\n── Test 3: v2 Path — sms_turns observability ──')
  await cleanupPhone(TEST_PHONE_A)

  // Pre-consent so the processor reaches the LLM/reply path
  await db.insert(smsAgeConsent).values({ phone: TEST_PHONE_A, method: 'sim_yes' })

  const twilioSid = `SMphase1smoke${Date.now()}`
  await processSmsMessageV2({
    from: TEST_PHONE_A,
    body: 'show me vibrators',
    twilioSid,
    simulated: true,
  })

  await settle()

  const turns = await db
    .select()
    .from(smsTurns)
    .where(and(eq(smsTurns.phone, TEST_PHONE_A), eq(smsTurns.direction, 'inbound')))
    .orderBy(desc(smsTurns.createdAt))
    .limit(1)

  const turn = turns[0]
  assert(!!turn, 'sms_turns inbound row exists')
  assert(turn!.pipelineVersion === 'v2', `pipeline_version = 'v2' (got '${turn!.pipelineVersion}')`)
  assert(typeof turn!.intent === 'string' && turn!.intent.length > 0,
    `sms_turns.intent populated (got '${turn!.intent}')`)
  assert(typeof turn!.intentConfidence === 'number' && turn!.intentConfidence! > 0,
    `sms_turns.intent_confidence populated (got ${turn!.intentConfidence})`)
}

// ---------------------------------------------------------------------------
// Test 4: Consent v2 — AGE_CONFIRM writes sms_yes_v2
// ---------------------------------------------------------------------------

async function testConsentV2(): Promise<void> {
  console.log('\n── Test 4: Consent v2 — sms_yes_v2 method ──')
  await cleanupPhone(TEST_PHONE_D)

  // No existing consent — first message is "YES"
  await processSmsMessageV2({
    from: TEST_PHONE_D,
    body: 'yes',
    twilioSid: `SMconsent${Date.now()}`,
    simulated: true,
  })

  await settle()

  const consent = await db
    .select({ method: smsAgeConsent.method })
    .from(smsAgeConsent)
    .where(eq(smsAgeConsent.phone, TEST_PHONE_D))
    .limit(1)

  assert(consent.length > 0, 'smsAgeConsent row exists')
  assert(consent[0]!.method === 'sms_yes_v2', `consent method = 'sms_yes_v2' (got '${consent[0]!.method}')`)
}

// ---------------------------------------------------------------------------
// Test 5: Stage TTL — PRESENTATION + 7h old + OFF_TOPIC → DISCOVERY
// ---------------------------------------------------------------------------

async function testStageTtl(): Promise<void> {
  console.log('\n── Test 5: Stage TTL — PRESENTATION → DISCOVERY ──')
  await cleanupPhone(TEST_PHONE_C)

  const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000)
  await db.insert(smsConversations).values({
    phone: TEST_PHONE_C,
    stage: 'PRESENTATION',
    stageSetAt: sevenHoursAgo,
    lastActiveAt: new Date(),  // active recently — avoids 24h rotation
  })

  // getOrCreateConversation with an OFF_TOPIC intent should trigger TTL reset
  const row = await getOrCreateConversation(TEST_PHONE_C, 'OFF_TOPIC')
  assert(row.stage === 'DISCOVERY', `stage reset to DISCOVERY (got '${row.stage}')`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\nPhase 1 SMS smoke test')
  console.log('======================')

  try {
    await testIntentClassifier()
    await testConversationRotation()
    await testV2TurnsObservability()
    await testConsentV2()
    await testStageTtl()

    console.log('\n✓ All Phase 1 smoke tests passed.\n')
  } finally {
    await cleanup()
  }
}

main().then(
  () => process.exit(0),
  async (err) => {
    console.error('\n✗', (err as Error).message)
    console.error((err as Error).stack)
    await cleanup().catch(() => {})
    process.exit(1)
  },
)
