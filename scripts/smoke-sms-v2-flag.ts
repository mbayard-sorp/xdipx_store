/**
 * Phase 0.5 pipeline-flag smoke test.
 *
 * Asserts two branches of pickPipelineVersion():
 *
 *   Branch A — default v1 path (unit + DB):
 *     With SMS_PIPELINE_VERSION=v1 and SMS_V2_PHONES=(empty), calling the
 *     processSmsMessage pipeline directly writes pipeline_version='v1' to
 *     sms_turns. Also POSTs a signed webhook to confirm TwiML is valid.
 *
 *   Branch B — per-phone allowlist forces v2 (unit + DB):
 *     With SMS_PIPELINE_VERSION=v1 and SMS_V2_PHONES=<PHONE_B>,
 *     pickPipelineVersion(PHONE_B) returns 'v2'. We call withTurnLogging
 *     directly (in-process) with processSmsMessageV2 + version='v2', then
 *     assert the sms_turns row has pipeline_version='v2'.
 *
 * Strategy for env permutations:
 *   We mutate process.env between branches then call __resetForTest() from
 *   pipeline-flag.server.ts to re-parse the allowlist in this process.
 *   The Drizzle / Neon HTTP client reads DATABASE_URL once at module scope
 *   (db.server.ts) but that URL doesn't change between branches, so no reset
 *   is needed for the DB connection.
 *
 *   The dev server is a separate process and cannot have its env mutated from
 *   here. Branch B therefore invokes processSmsMessageV2 + withTurnLogging
 *   directly rather than via HTTP POST — this correctly tests that:
 *     (a) pickPipelineVersion() returns 'v2' for an allowlisted phone, and
 *     (b) withTurnLogging writes pipeline_version='v2' to sms_turns when
 *         called with version='v2'.
 *   Branch A uses HTTP POST to additionally confirm the webhook route wires
 *   everything together end-to-end for the default v1 path.
 *
 * Signing follows the same HMAC-SHA1 algorithm as twilio.server.ts.
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsAgeConsent, smsConversations, smsMessages, smsOptouts, smsTurns } from '../db/schema'
import { pickPipelineVersion, __resetForTest } from '../app/lib/sms-v2/pipeline-flag.server'
import { processSmsMessage } from '../app/lib/sms-processor.server'
import { processSmsMessageV2 } from '../app/lib/sms-v2/processor.server'
import { withTurnLogging } from '../app/lib/sms-v2/turn-logger.server'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env['SMOKE_BASE_URL'] ?? 'http://localhost:5173'
const AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN'] ?? ''

const PHONE_A = '+15555550201' // default v1 branch
const PHONE_B = '+15555550202' // allowlisted to v2

if (!AUTH_TOKEN) {
  console.error('TWILIO_AUTH_TOKEN must be set (needed for request signing).')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Twilio signing (mirrors twilio.server.ts verifyTwilioSignature)
// ---------------------------------------------------------------------------

function signTwilioRequest(fullUrl: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort()
  const data = fullUrl + sorted.map((k) => k + params[k]).join('')
  return crypto.createHmac('sha1', AUTH_TOKEN).update(Buffer.from(data, 'utf-8')).digest('base64')
}

async function postSmsWebhook(
  params: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const url = `${BASE_URL}/api/twilio/sms`
  const sig = signTwilioRequest(url, params)
  const form = new URLSearchParams(params)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': sig,
    },
    body: form.toString(),
  })
  return { status: res.status, body: await res.text() }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanupPhone(phone: string) {
  await db.delete(smsTurns).where(eq(smsTurns.phone, phone))
  await db.delete(smsConversations).where(eq(smsConversations.phone, phone))
  await db.delete(smsMessages).where(eq(smsMessages.phone, phone))
  await db.delete(smsAgeConsent).where(eq(smsAgeConsent.phone, phone))
  await db.delete(smsOptouts).where(eq(smsOptouts.phone, phone))
}

async function cleanup() {
  await cleanupPhone(PHONE_A)
  await cleanupPhone(PHONE_B)
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function getLatestInboundPipelineVersion(phone: string): Promise<string | null> {
  // Small settle delay — Neon HTTP is near-instant but DB writes are async.
  await new Promise((r) => setTimeout(r, 500))
  const rows = await db
    .select({ pipelineVersion: smsTurns.pipelineVersion })
    .from(smsTurns)
    .where(and(eq(smsTurns.phone, phone), eq(smsTurns.direction, 'inbound')))
    .orderBy(desc(smsTurns.createdAt))
    .limit(1)
  return rows[0]?.pipelineVersion ?? null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nPhase 0.5 pipeline-flag smoke (${BASE_URL})`)
  console.log(`Phone A (v1 default) : ${PHONE_A}`)
  console.log(`Phone B (v2 allowlist): ${PHONE_B}\n`)

  await cleanup()

  // ── Branch A: SMS_PIPELINE_VERSION=v1, no allowlist ──────────────────────
  // Use HTTP POST so we also confirm the webhook route wires v1 end-to-end.
  console.log('Branch A: default v1 path (HTTP POST to webhook)…')
  process.env['SMS_PIPELINE_VERSION'] = 'v1'
  process.env['SMS_V2_PHONES'] = ''
  __resetForTest()

  assert(pickPipelineVersion(PHONE_A) === 'v1', `pickPipelineVersion(${PHONE_A}) === 'v1'`)

  const sidA = `SMsmokeA${Date.now()}`
  const rA = await postSmsWebhook({
    From: PHONE_A,
    Body: 'hi',
    MessageSid: sidA,
    SmsMessageSid: sidA,
  })
  console.log(`  HTTP ${rA.status}`)
  assert(rA.status === 200, 'Branch A webhook returned 200')
  assert(rA.body.includes('<Response>'), 'Branch A response is TwiML')

  const pvA = await getLatestInboundPipelineVersion(PHONE_A)
  assert(pvA === 'v1', `Branch A sms_turns pipeline_version='v1' (got '${pvA}')`)

  // ── Branch B: SMS_PIPELINE_VERSION=v1, PHONE_B in allowlist → forces v2 ──
  // Test in-process: mutate env + __resetForTest(), call withTurnLogging with
  // the v2 processFn. This correctly tests the dispatch logic without needing
  // the HTTP dev-server to reload its env (separate process).
  console.log('\nBranch B: allowlist overrides to v2 (in-process withTurnLogging call)…')
  process.env['SMS_PIPELINE_VERSION'] = 'v1'
  process.env['SMS_V2_PHONES'] = PHONE_B
  __resetForTest()

  assert(pickPipelineVersion(PHONE_B) === 'v2', `pickPipelineVersion(${PHONE_B}) === 'v2'`)
  assert(pickPipelineVersion(PHONE_A) === 'v1', `pickPipelineVersion(${PHONE_A}) still 'v1' (not in allowlist)`)

  const version = pickPipelineVersion(PHONE_B) // 'v2'
  const processFn = version === 'v2' ? processSmsMessageV2 : processSmsMessage

  await withTurnLogging(
    { from: PHONE_B, body: 'hi', twilioSid: `SMsmokeB${Date.now()}`, simulated: false },
    processFn,
    version,
  )

  const pvB = await getLatestInboundPipelineVersion(PHONE_B)
  assert(pvB === 'v2', `Branch B sms_turns pipeline_version='v2' (got '${pvB}')`)

  console.log('\n✓ Phase 0.5 pipeline-flag smoke passed.\n')
  await cleanup()
}

main().then(
  () => process.exit(0),
  async (err) => {
    console.error('\n✗', (err as Error).message)
    await cleanup()
    process.exit(1)
  },
)
