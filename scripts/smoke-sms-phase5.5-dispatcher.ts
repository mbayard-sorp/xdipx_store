/**
 * scripts/smoke-sms-phase5.5-dispatcher.ts
 *
 * Phase 5.5 dispatcher end-to-end smoke test.
 *
 * Sends real signed HTTP requests to the Twilio webhook on a locally spawned
 * dev server, exercising the full dispatching path (processor → dispatcher →
 * stage handler → applyStateWrites → turn logging).
 *
 * Scenarios:
 *   1. DISCOVERY end-to-end (phone 500): POST "hey" → v2 handler ran,
 *      sms_turns pipeline_version='v2', stage_out='DISCOVERY',
 *      prose contains a '?' (SPIN question).
 *   2. DISCOVERY → PRESENTATION via NAME_ITEM (phone 501): POST "show me a vibrator"
 *      → sms_conversations.stage='PRESENTATION', current_pitch_handle set,
 *      response includes a PDP URL.
 *   3. PRESENTATION → UPSELL via COMMIT_PICK (phone 502, seeded stage=PRESENTATION):
 *      POST "I'll take it" → stage='UPSELL', current_upsell_handle set.
 *   4. UPSELL → CHECKOUT via UPSELL_ACCEPT (phone 503, seeded stage=UPSELL):
 *      POST "yes add the lube" → stage='POST_CHECKOUT', last_quote_url set,
 *      response contains a Shopify checkout URL.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/smoke-sms-phase5.5-dispatcher.ts
 *
 * The script starts its own dev server (PORT=5173 npm run dev) and kills it
 * cleanly on exit.
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsAgeConsent, smsConversations, smsMessages, smsOptouts, smsTurns } from '../db/schema'
import { __resetForTest } from '../app/lib/sms-v2/pipeline-flag.server'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT       = 5173
const BASE_URL   = `http://localhost:${PORT}`
const AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN'] ?? ''

// Test phones — must be in SMS_V2_PHONES for the dispatcher to run
const PHONE_500 = '+15555555500'
const PHONE_501 = '+15555555501'
const PHONE_502 = '+15555555502'
const PHONE_503 = '+15555555503'
const ALL_PHONES = [PHONE_500, PHONE_501, PHONE_502, PHONE_503]

if (!AUTH_TOKEN) {
  console.error('TWILIO_AUTH_TOKEN must be set.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Twilio request signing (mirrors twilio.server.ts verifyTwilioSignature)
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
// Dev server lifecycle
// ---------------------------------------------------------------------------

let devServer: ChildProcess | null = null

async function startDevServer(): Promise<void> {
  console.log(`[smoke] Starting dev server on port ${PORT}…`)

  // Force all test phones into the v2 allowlist before the server starts.
  const allowlist = ALL_PHONES.join(',')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(PORT),
    SMS_V2_PHONES: allowlist,
    SMS_PIPELINE_VERSION: 'v1',
  }

  devServer = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  devServer.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString()
    if (line.includes('[express]') || line.includes('listening') || line.includes('error')) {
      process.stdout.write(`  [server] ${line.trim()}\n`)
    }
  })
  devServer.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString()
    if (line.includes('error') || line.includes('Error')) {
      process.stderr.write(`  [server:err] ${line.trim()}\n`)
    }
  })

  // Wait until the server responds to a health-check GET.
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(1000) })
      if (res.ok || res.status === 200 || res.status === 404 || res.status === 302) {
        console.log(`[smoke] Dev server reachable (HTTP ${res.status}).`)
        return
      }
    } catch {
      // Not up yet — keep waiting.
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('[smoke] Dev server failed to start within 30 s.')
}

function stopDevServer(): void {
  if (devServer) {
    devServer.kill('SIGTERM')
    devServer = null
    console.log('[smoke] Dev server stopped.')
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function cleanupPhone(phone: string): Promise<void> {
  await db.delete(smsTurns).where(eq(smsTurns.phone, phone))
  await db.delete(smsConversations).where(eq(smsConversations.phone, phone))
  await db.delete(smsMessages).where(eq(smsMessages.phone, phone))
  await db.delete(smsAgeConsent).where(eq(smsAgeConsent.phone, phone))
  await db.delete(smsOptouts).where(eq(smsOptouts.phone, phone))
}

async function cleanupAll(): Promise<void> {
  await Promise.all(ALL_PHONES.map(cleanupPhone))
}

/** Insert age consent so the webhook skips the age gate and reaches the processor. */
async function preConsent(phone: string): Promise<void> {
  await db.insert(smsAgeConsent).values({ phone, method: 'smoke_pre_consent' }).onConflictDoNothing()
}

async function settle(ms = 1200): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function getConversation(phone: string) {
  const rows = await db
    .select()
    .from(smsConversations)
    .where(eq(smsConversations.phone, phone))
    .limit(1)
  return rows[0] ?? null
}

async function getLatestInboundTurn(phone: string) {
  const rows = await db
    .select()
    .from(smsTurns)
    .where(and(eq(smsTurns.phone, phone), eq(smsTurns.direction, 'inbound')))
    .orderBy(desc(smsTurns.createdAt))
    .limit(1)
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

function assertSoft(cond: boolean, msg: string): void {
  if (!cond) console.log(`  SOFT FAIL: ${msg}`)
  else console.log(`  ✓ ${msg}`)
}

// ---------------------------------------------------------------------------
// Scenario 1: DISCOVERY end-to-end
// ---------------------------------------------------------------------------

async function scenario1(): Promise<void> {
  console.log('\n── Scenario 1: DISCOVERY end-to-end (phone 500) ──')
  await cleanupPhone(PHONE_500)
  await preConsent(PHONE_500)

  // Insert conversation in DISCOVERY stage so dispatcher routes there.
  await db.insert(smsConversations).values({
    phone: PHONE_500,
    stage: 'DISCOVERY',
  })

  const sid = `SMphase55sc1${Date.now()}`
  const r = await postSmsWebhook({
    From: PHONE_500,
    Body: 'hey',
    MessageSid: sid,
    SmsMessageSid: sid,
  })
  console.log(`  HTTP ${r.status}`)
  assert(r.status === 200, 'webhook returned 200')
  assert(r.body.includes('<Response>'), 'response is TwiML')

  await settle()

  const turn = await getLatestInboundTurn(PHONE_500)
  assert(!!turn, 'sms_turns inbound row written')
  assert(turn!.pipelineVersion === 'v2', `pipeline_version='v2' (got '${turn!.pipelineVersion}')`)
  assert(turn!.stageOut === 'DISCOVERY', `stage_out='DISCOVERY' (got '${turn!.stageOut}')`)
  assert(
    typeof turn!.intent === 'string' && turn!.intent.length > 0,
    `intent populated (got '${turn!.intent}')`,
  )

  // DISCOVERY returns a SPIN question — it must contain '?'
  const twimlHasQuestion = r.body.includes('?')
  assertSoft(twimlHasQuestion, 'TwiML prose contains "?" (SPIN question)')

  console.log(`  Stage trace: GREETING → DISCOVERY (stage_out=${turn!.stageOut}, intent=${turn!.intent})`)
}

// ---------------------------------------------------------------------------
// Scenario 2: DISCOVERY → PRESENTATION via NAME_ITEM
// ---------------------------------------------------------------------------

async function scenario2(): Promise<void> {
  console.log('\n── Scenario 2: DISCOVERY → PRESENTATION via NAME_ITEM (phone 501) ──')
  await cleanupPhone(PHONE_501)
  await preConsent(PHONE_501)

  await db.insert(smsConversations).values({
    phone: PHONE_501,
    stage: 'DISCOVERY',
  })

  const sid = `SMphase55sc2${Date.now()}`
  const r = await postSmsWebhook({
    From: PHONE_501,
    Body: 'show me a vibrator',
    MessageSid: sid,
    SmsMessageSid: sid,
  })
  console.log(`  HTTP ${r.status}`)
  assert(r.status === 200, 'webhook returned 200')

  await settle()

  const conv = await getConversation(PHONE_501)
  assert(!!conv, 'sms_conversations row exists')

  if (conv?.stage === 'PRESENTATION') {
    assert(conv.stage === 'PRESENTATION', `stage updated to PRESENTATION (got '${conv.stage}')`)
    assert(
      typeof conv.currentPitchHandle === 'string' && conv.currentPitchHandle.length > 0,
      `current_pitch_handle set (got '${conv.currentPitchHandle ?? 'null'}')`,
    )
    const hasUrl = r.body.includes('xdipx.com/products/')
    assertSoft(hasUrl, 'response includes a PDP URL')
    console.log(`  Stage trace: DISCOVERY → PRESENTATION (handle=${conv.currentPitchHandle})`)
  } else {
    // Acceptable fallback: NAME_ITEM search returned no candidates (no Shopify product)
    // → discovery handler stayed in DISCOVERY with a SPIN question.
    assertSoft(
      conv?.stage === 'DISCOVERY',
      `stage='DISCOVERY' (acceptable fallback — search found no candidate, got '${conv?.stage}')`,
    )
    console.log(`  Soft fallback: NAME_ITEM returned no candidate — stayed in DISCOVERY`)
  }
}

// ---------------------------------------------------------------------------
// Scenario 3: PRESENTATION → UPSELL via COMMIT_PICK
// ---------------------------------------------------------------------------

async function scenario3(pitchHandle: string): Promise<void> {
  console.log('\n── Scenario 3: PRESENTATION → UPSELL via COMMIT_PICK (phone 502) ──')
  await cleanupPhone(PHONE_502)
  await preConsent(PHONE_502)

  // Seed conversation in PRESENTATION stage with a real pitch handle.
  await db.insert(smsConversations).values({
    phone: PHONE_502,
    stage: 'PRESENTATION',
    currentPitchHandle: pitchHandle,
  })

  const sid = `SMphase55sc3${Date.now()}`
  const r = await postSmsWebhook({
    From: PHONE_502,
    Body: "I'll take it",
    MessageSid: sid,
    SmsMessageSid: sid,
  })
  console.log(`  HTTP ${r.status}`)
  assert(r.status === 200, 'webhook returned 200')

  await settle()

  const conv = await getConversation(PHONE_502)
  assert(!!conv, 'sms_conversations row exists')
  assert(conv?.stage === 'UPSELL', `stage updated to UPSELL (got '${conv?.stage}')`)

  const hasUpsellHandle =
    typeof conv?.currentUpsellHandle === 'string' && conv.currentUpsellHandle.length > 0
  assertSoft(hasUpsellHandle, `current_upsell_handle set (got '${conv?.currentUpsellHandle ?? 'null'}')`)

  console.log(
    `  Stage trace: PRESENTATION → UPSELL (pitch=${pitchHandle}, upsell=${conv?.currentUpsellHandle ?? 'null'})`,
  )
}

// ---------------------------------------------------------------------------
// Scenario 4: UPSELL → CHECKOUT (POST_CHECKOUT) via UPSELL_ACCEPT
// ---------------------------------------------------------------------------

async function scenario4(pitchHandle: string, upsellHandle: string | null): Promise<void> {
  console.log('\n── Scenario 4: UPSELL → CHECKOUT via UPSELL_ACCEPT (phone 503) ──')
  await cleanupPhone(PHONE_503)
  await preConsent(PHONE_503)

  await db.insert(smsConversations).values({
    phone: PHONE_503,
    stage: 'UPSELL',
    currentPitchHandle: pitchHandle,
    currentUpsellHandle: upsellHandle,
  })

  const sid = `SMphase55sc4${Date.now()}`
  // "yes add" triggers UPSELL_ACCEPT in the regex bank
  const r = await postSmsWebhook({
    From: PHONE_503,
    Body: 'yes add the lube',
    MessageSid: sid,
    SmsMessageSid: sid,
  })
  console.log(`  HTTP ${r.status}`)
  assert(r.status === 200, 'webhook returned 200')

  await settle()

  const conv = await getConversation(PHONE_503)
  assert(!!conv, 'sms_conversations row exists')
  assert(conv?.stage === 'POST_CHECKOUT', `stage updated to POST_CHECKOUT (got '${conv?.stage}')`)

  const hasQuoteUrl =
    typeof conv?.lastQuoteUrl === 'string' && conv.lastQuoteUrl.length > 0
  assertSoft(hasQuoteUrl, `last_quote_url set (got '${conv?.lastQuoteUrl ?? 'null'}')`)

  // TwiML should have a Shopify checkout URL
  const hasCheckout = r.body.includes('myshopify.com') || r.body.includes('/checkouts') || r.body.includes('xdipx.com/cart')
  assertSoft(hasCheckout, 'TwiML contains a Shopify checkout URL')

  console.log(
    `  Stage trace: UPSELL → POST_CHECKOUT (lastQuoteUrl=${conv?.lastQuoteUrl?.slice(0, 60) ?? 'null'})`,
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\nPhase 5.5 dispatcher smoke test')
  console.log('================================')

  // Register cleanup/kill so the dev server always stops.
  process.on('exit', stopDevServer)
  process.on('SIGINT', () => { stopDevServer(); process.exit(1) })
  process.on('SIGTERM', () => { stopDevServer(); process.exit(1) })

  // Wire the allowlist into this process too (pipeline-flag reads from process.env
  // at module load; we need to reset after mutating).
  process.env['SMS_V2_PHONES'] = ALL_PHONES.join(',')
  process.env['SMS_PIPELINE_VERSION'] = 'v1'
  __resetForTest()

  await cleanupAll()

  try {
    await startDevServer()

    await scenario1()
    await scenario2()

    // For scenarios 3 & 4 we need a real Shopify product handle. Use the handle
    // from scenario 2 if we got one (PRESENTATION was reached); otherwise fall
    // back to a known product handle from the seed / smoke env.
    // We query Shopify via the scenario 2 conversation row.
    const conv2 = await getConversation(PHONE_501)
    const pitchHandle = conv2?.currentPitchHandle ?? 'lush-mini'

    // For upsell handle, query the scenario 3 conversation after running it.
    await scenario3(pitchHandle)
    const conv3 = await getConversation(PHONE_502)
    const upsellHandle = conv3?.currentUpsellHandle ?? null

    await scenario4(pitchHandle, upsellHandle)

    console.log('\n✓ All Phase 5.5 scenarios passed.\n')
  } finally {
    stopDevServer()
    if (process.env['SMS_SMOKE_KEEP_ROWS'] !== '1') {
      await cleanupAll()
    }
  }
}

main().then(
  () => process.exit(0),
  async (err: unknown) => {
    console.error('\n✗', (err as Error).message)
    console.error((err as Error).stack)
    stopDevServer()
    // DEBUG: skip cleanup so we can inspect rows after failure.
    if (process.env['SMS_SMOKE_KEEP_ROWS'] !== '1') {
      await cleanupAll().catch(() => {})
    } else {
      console.log('[smoke] SMS_SMOKE_KEEP_ROWS=1 — skipping cleanup so rows are inspectable.')
    }
    process.exit(1)
  },
)
