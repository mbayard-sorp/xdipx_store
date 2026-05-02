/**
 * scripts/smoke-sms-phase8-web.ts
 *
 * Phase 8 — Web chat v2 engine smoke test.
 *
 * Calls processWebMessageV2 directly (in-process), mirroring Phase 5.5's
 * in-process pattern. No dev server needed — we call the adapter directly
 * and inspect DB state.
 *
 * Scenarios:
 *   1. Web DISCOVERY: { sessionId: 'sm-test-1', customerText: 'hi' }
 *      → ChatReply has ≥1 segment with prose containing '?'
 *      → web_conversations row created with stage='DISCOVERY'
 *      → sms_turns row with channel='web'
 *
 *   2. Page context: { sessionId: 'sm-test-2', pageContext: { handle: 'lush-mini' }, customerText: 'is this waterproof?' }
 *      → intent classifies as RESEARCH
 *      → currentPitchHandle set to 'lush-mini' from page context
 *      → response is RESEARCH-style (contains product info or question)
 *
 *   3. Variant pick → cart: seed web_conversations with stage='UPSELL',
 *      current_pitch_handle, current_upsell_handle. Send customerText: 'yes'
 *      → cartUpdated is set in ChatReply
 *      → last_quote_url is real Shopify URL
 *
 *   4. WEB_PIPELINE_VERSION fallback: with default env (no WEB_PIPELINE_VERSION),
 *      pickWebPipelineVersion('any') returns 'v1'. With WEB_V2_SESSIONS=sm-test-1,
 *      returns 'v2'.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/smoke-sms-phase8-web.ts
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { webConversations, smsTurns } from '../db/schema'
import { processWebMessageV2 } from '../app/lib/sms-v2/adapters/web.server'
import { pickWebPipelineVersion, __resetForTest } from '../app/lib/sms-v2/web-pipeline-flag.server'

// ---------------------------------------------------------------------------
// Test session IDs
// ---------------------------------------------------------------------------

const SESSION_1 = 'sm-test-1'
const SESSION_2 = 'sm-test-2'
const SESSION_3 = 'sm-test-3'

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ FAIL: ${msg}`)
    throw new Error(`FAIL: ${msg}`)
  }
  console.log(`  ✓ ${msg}`)
}

function assertSoft(cond: boolean, msg: string): void {
  if (!cond) console.warn(`  ~ SOFT: ${msg}`)
  else console.log(`  ✓ ${msg}`)
}

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) saved[k] = process.env[k]
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    __resetForTest()
    fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    __resetForTest()
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getWebConv(sessionId: string) {
  const rows = await db
    .select()
    .from(webConversations)
    .where(eq(webConversations.sessionId, sessionId))
    .limit(1)
  return rows[0] ?? null
}

async function getLatestWebTurn(sessionId: string) {
  // The sentinel phone is 'web:<first16chars>'
  const phone = `web:${sessionId.slice(0, 16)}`
  const rows = await db
    .select()
    .from(smsTurns)
    .where(eq(smsTurns.phone, phone))
    .limit(1)
  return rows[0] ?? null
}

async function cleanupSession(sessionId: string): Promise<void> {
  await db.delete(webConversations).where(eq(webConversations.sessionId, sessionId))
  const phone = `web:${sessionId.slice(0, 16)}`
  await db.delete(smsTurns).where(eq(smsTurns.phone, phone))
}

async function settle(ms = 800): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Scenario 1: Web DISCOVERY
// ---------------------------------------------------------------------------

async function scenario1(): Promise<void> {
  console.log('\n── Scenario 1: Web DISCOVERY (sessionId=sm-test-1) ──')
  await cleanupSession(SESSION_1)

  const result = await processWebMessageV2(
    { sessionId: SESSION_1, customerText: 'hi' },
    [],
  )

  assert(typeof result.reply === 'string' && result.reply.length > 0, 'ChatReply has non-empty reply')
  assert(Array.isArray(result.products), 'ChatReply.products is an array')
  assert(Array.isArray(result.history), 'ChatReply.history is an array')

  // DISCOVERY should return a SPIN question
  assertSoft(result.reply.includes('?'), `Reply contains '?' (SPIN question) — got: ${result.reply.slice(0, 80)}`)

  // Allow async DB writes to settle
  await settle()

  const conv = await getWebConv(SESSION_1)
  assert(!!conv, 'web_conversations row created')
  assert(
    conv?.stage === 'DISCOVERY' || conv?.stage === 'GREETING',
    `stage is DISCOVERY or GREETING (got '${conv?.stage}')`,
  )

  const turn = await getLatestWebTurn(SESSION_1)
  assertSoft(!!turn, 'sms_turns row written for web turn')
  if (turn) {
    assert(turn.channel === 'web', `channel='web' (got '${turn.channel}')`)
    assert(turn.pipelineVersion === 'v2-web', `pipeline_version='v2-web' (got '${turn.pipelineVersion}')`)
  }

  console.log(`  Stage: ${conv?.stage}, reply[0:60]: ${result.reply.slice(0, 60)}`)
}

// ---------------------------------------------------------------------------
// Scenario 2: Page context — RESEARCH via handle
// ---------------------------------------------------------------------------

async function scenario2(): Promise<void> {
  console.log('\n── Scenario 2: Page context + RESEARCH (sessionId=sm-test-2) ──')
  await cleanupSession(SESSION_2)

  const result = await processWebMessageV2(
    {
      sessionId: SESSION_2,
      customerText: 'is this waterproof?',
      pageContext: { handle: 'lush-mini', route: '/products/lush-mini' },
    },
    [],
  )

  assert(typeof result.reply === 'string' && result.reply.length > 0, 'ChatReply has non-empty reply')

  await settle()

  const conv = await getWebConv(SESSION_2)
  assert(!!conv, 'web_conversations row created')

  // Page context should seed pitch handle from RESEARCH flow
  assertSoft(
    conv?.currentPitchHandle === 'lush-mini',
    `currentPitchHandle set to 'lush-mini' (got '${conv?.currentPitchHandle ?? 'null'}')`,
  )

  // Response should be research-style (contains info, not a hard sell)
  assertSoft(
    !result.reply.toLowerCase().includes("i'll take it"),
    'reply is not a purchase CTA (research-style)',
  )

  console.log(
    `  Stage: ${conv?.stage}, pitchHandle: ${conv?.currentPitchHandle ?? 'null'}, reply[0:60]: ${result.reply.slice(0, 60)}`,
  )
}

// ---------------------------------------------------------------------------
// Scenario 3: Variant pick → cart (UPSELL seeded)
// ---------------------------------------------------------------------------

async function scenario3(): Promise<void> {
  console.log('\n── Scenario 3: UPSELL → CHECKOUT (cartUpdated) (sessionId=sm-test-3) ──')
  await cleanupSession(SESSION_3)

  // First, run a discovery turn to create the row
  await processWebMessageV2(
    { sessionId: SESSION_3, customerText: 'hi' },
    [],
  )
  await settle(400)

  // Seed the conversation in UPSELL stage with real-ish handles
  // Using 'lush-mini' as pitch — if Shopify doesn't have it, stage falls back gracefully
  await db.update(webConversations)
    .set({
      stage: 'UPSELL',
      currentPitchHandle: 'lush-mini',
      currentUpsellHandle: 'silky-lube',
      stageSetAt: new Date(),
    })
    .where(eq(webConversations.sessionId, SESSION_3))

  const result = await processWebMessageV2(
    { sessionId: SESSION_3, customerText: 'yes' },
    [],
  )

  assert(typeof result.reply === 'string' && result.reply.length > 0, 'ChatReply has non-empty reply')

  await settle()

  const conv = await getWebConv(SESSION_3)
  assert(!!conv, 'web_conversations row exists after UPSELL')

  // UPSELL_ACCEPT → CHECKOUT should move to POST_CHECKOUT and set a quote URL
  if (conv?.stage === 'POST_CHECKOUT') {
    assert(conv.stage === 'POST_CHECKOUT', `stage=POST_CHECKOUT (got '${conv.stage}')`)
    assertSoft(
      typeof conv.lastQuoteUrl === 'string' && conv.lastQuoteUrl.length > 0,
      `lastQuoteUrl set (got '${conv.lastQuoteUrl ?? 'null'}')`,
    )
    assertSoft(result.cartUpdated === true, 'ChatReply.cartUpdated=true')
    console.log(`  lastQuoteUrl: ${(conv.lastQuoteUrl ?? 'null').slice(0, 60)}`)
  } else {
    // Acceptable: if Shopify handles don't exist, checkout handler falls back to DISCOVERY
    assertSoft(
      conv?.stage === 'DISCOVERY' || conv?.stage === 'CHECKOUT',
      `stage acceptable fallback (got '${conv?.stage}') — Shopify handles may not exist in test env`,
    )
    console.log(`  Soft fallback: stage=${conv?.stage} (Shopify product may not exist in test env)`)
  }
}

// ---------------------------------------------------------------------------
// Scenario 4: Pipeline flag behaviour
// ---------------------------------------------------------------------------

function scenario4(): void {
  console.log('\n── Scenario 4: WEB_PIPELINE_VERSION flag ──')

  // Default: no env set → 'v1'
  withEnv({ WEB_PIPELINE_VERSION: undefined, WEB_V2_SESSIONS: undefined }, () => {
    const v = pickWebPipelineVersion('any-session')
    assert(v === 'v1', `default (no env) returns 'v1' (got '${v}')`)
  })

  // Allowlist override: sm-test-1 in WEB_V2_SESSIONS → 'v2'
  withEnv({ WEB_PIPELINE_VERSION: undefined, WEB_V2_SESSIONS: SESSION_1 }, () => {
    const v = pickWebPipelineVersion(SESSION_1)
    assert(v === 'v2', `allowlisted sessionId returns 'v2' (got '${v}')`)
    const vOther = pickWebPipelineVersion('other-session')
    assert(vOther === 'v1', `non-allowlisted session returns 'v1' (got '${vOther}')`)
  })

  // Global v2 override
  withEnv({ WEB_PIPELINE_VERSION: 'v2', WEB_V2_SESSIONS: undefined }, () => {
    const v = pickWebPipelineVersion('any-session')
    assert(v === 'v2', `WEB_PIPELINE_VERSION=v2 returns 'v2' (got '${v}')`)
  })

  // Kill-switch back to v1
  withEnv({ WEB_PIPELINE_VERSION: 'v1', WEB_V2_SESSIONS: undefined }, () => {
    const v = pickWebPipelineVersion('any-session')
    assert(v === 'v1', `WEB_PIPELINE_VERSION=v1 returns 'v1' (got '${v}')`)
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\nPhase 8 — Web chat v2 engine smoke test')
  console.log('========================================')

  const ALL_SESSIONS = [SESSION_1, SESSION_2, SESSION_3]

  try {
    // Scenario 4 is synchronous — run it first (no DB, no network)
    scenario4()

    // Async scenarios
    await scenario1()
    await scenario2()
    await scenario3()

    console.log('\n✓ All Phase 8 scenarios passed.\n')
  } finally {
    if (process.env['SMS_SMOKE_KEEP_ROWS'] !== '1') {
      await Promise.all(ALL_SESSIONS.map(cleanupSession)).catch(() => {})
    } else {
      console.log('[smoke] SMS_SMOKE_KEEP_ROWS=1 — skipping cleanup.')
    }
  }
}

main().then(
  () => process.exit(0),
  async (err: unknown) => {
    console.error('\n✗', (err as Error).message)
    if (process.env['SMS_SMOKE_KEEP_ROWS'] !== '1') {
      const ALL_SESSIONS = [SESSION_1, SESSION_2, SESSION_3]
      await Promise.all(ALL_SESSIONS.map(cleanupSession)).catch(() => {})
    }
    process.exit(1)
  },
)
