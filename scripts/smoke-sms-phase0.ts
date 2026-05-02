/**
 * Phase 0 SMS observability smoke test.
 *
 * Asserts:
 *   1. POST a fake signed request to /api/twilio/sms with a unique MessageSid.
 *   2. sms_turns row is written: pipeline_version='v1', both inbound AND
 *      outbound rows present.
 *   3. POST the same MessageSid a second time — assert only ONE inbound row
 *      exists (idempotency dedup).
 *   4. sms_conversations row is created for the test phone.
 *
 * Signing follows the same HMAC-SHA1 algorithm as twilio.server.ts so the
 * webhook's verifyTwilioRequest() accepts the request.
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import { and, eq, count } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsAgeConsent, smsMessages, smsOptouts, smsConversations, smsTurns } from '../db/schema'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env['SMOKE_BASE_URL'] ?? 'http://localhost:5173'
const AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN'] ?? ''
const TEST_PHONE = '+15555550100'
const TEST_MSG_SID = `SMsmoke${Date.now()}`

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

async function postSmsWebhook(params: Record<string, string>): Promise<{ status: number; body: string }> {
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

async function cleanup() {
  await db.delete(smsTurns).where(eq(smsTurns.phone, TEST_PHONE))
  await db.delete(smsConversations).where(eq(smsConversations.phone, TEST_PHONE))
  await db.delete(smsMessages).where(eq(smsMessages.phone, TEST_PHONE))
  await db.delete(smsAgeConsent).where(eq(smsAgeConsent.phone, TEST_PHONE))
  await db.delete(smsOptouts).where(eq(smsOptouts.phone, TEST_PHONE))
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nPhase 0 SMS observability smoke (${BASE_URL})`)
  console.log(`Test phone : ${TEST_PHONE}`)
  console.log(`Test SID   : ${TEST_MSG_SID}\n`)

  await cleanup()

  // ── First request ─────────────────────────────────────────────────────────
  console.log('1. Sending first request (age-gate path expected)…')
  const params: Record<string, string> = {
    From: TEST_PHONE,
    Body: 'hi',
    MessageSid: TEST_MSG_SID,
    SmsMessageSid: TEST_MSG_SID,
  }
  const r1 = await postSmsWebhook(params)
  console.log(`   HTTP ${r1.status}`)
  assert(r1.status === 200, 'webhook returned 200')
  assert(r1.body.includes('<Response>'), 'response is TwiML')

  // ── DB assertions ─────────────────────────────────────────────────────────
  console.log('\n2. Checking sms_turns rows…')

  // Small delay to let async DB writes settle (Neon HTTP is near-instant but
  // we're calling async fire-and-forget helpers inside the route).
  await new Promise((r) => setTimeout(r, 800))

  const turnRows = await db
    .select()
    .from(smsTurns)
    .where(eq(smsTurns.phone, TEST_PHONE))

  assert(turnRows.length >= 1, 'at least one sms_turns row exists')

  const inboundRows = turnRows.filter((r) => r.direction === 'inbound')
  const outboundRows = turnRows.filter((r) => r.direction === 'outbound')

  assert(inboundRows.length === 1, 'exactly one inbound row')
  assert(outboundRows.length >= 1, 'at least one outbound row')

  const inbound = inboundRows[0]!
  assert(inbound.pipelineVersion === 'v1', `pipeline_version = 'v1' (got '${inbound.pipelineVersion}')`)
  assert(inbound.twilioMessageSid === TEST_MSG_SID, 'twilio_message_sid matches TEST_MSG_SID')

  console.log('\n3. Checking sms_conversations row…')
  const convRows = await db
    .select()
    .from(smsConversations)
    .where(eq(smsConversations.phone, TEST_PHONE))

  assert(convRows.length === 1, 'sms_conversations row created')
  assert(typeof convRows[0]!.conversationId === 'string' && convRows[0]!.conversationId.length > 0,
    'conversation_id is a non-empty UUID')

  // ── Idempotency: send exact same SID again ────────────────────────────────
  console.log('\n4. Sending duplicate SID — expecting empty TwiML (no LLM call)…')
  const r2 = await postSmsWebhook(params)
  console.log(`   HTTP ${r2.status}`)
  assert(r2.status === 200, 'duplicate returns 200')
  // Empty TwiML = <Response></Response> with no <Message> children.
  assert(!r2.body.includes('<Message>'), 'duplicate returns empty TwiML (no <Message>)')

  await new Promise((r) => setTimeout(r, 400))

  // Still only one inbound row — dedup worked.
  const turnRowsAfter = await db
    .select()
    .from(smsTurns)
    .where(and(eq(smsTurns.phone, TEST_PHONE), eq(smsTurns.direction, 'inbound')))

  assert(turnRowsAfter.length === 1, 'still exactly one inbound row after duplicate SID')

  console.log('\n✓ Phase 0 smoke passed.\n')
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
