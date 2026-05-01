/**
 * scripts/smoke-sms-phase10-cross-channel.ts
 *
 * Phase 10 — Cross-channel conversation state smoke test.
 *
 * All scenarios are in-process (no dev server needed).
 *
 * Scenarios:
 *   1. No customer_gid → null
 *   2. Same channel → null (SMS activity excluded when currentChannel='sms')
 *   3. Cross-channel hit: web conv with pitch handle → CrossChannelHint returned
 *   4. TTL expiry: activity > 24h ago → null
 *   5. Multiple matches → most-recent wins
 *   6. RECONNECT surfaces hint: prose references product, stageOut=DISCOVERY
 *
 * Run with:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/smoke-sms-phase10-cross-channel.ts
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { smsConversations, webConversations } from '../db/schema'
import {
  findRecentCrossChannelActivity,
  getCrossChannelHint,
} from '../app/lib/sms-v2/cross-channel.server'
import { executeReconnectStage } from '../app/lib/sms-v2/stages/reconnect.server'
import type { EmmaContext, IntentResult } from '../app/lib/sms-v2/types.server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passCount = 0
let failCount = 0

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  FAIL: ${msg}`)
    failCount++
  } else {
    console.log(`  ok   ${msg}`)
    passCount++
  }
}

const SMOKE_GID = `gid://shopify/Customer/smoke-phase10-xchan`
const SMOKE_GID_2 = `gid://shopify/Customer/smoke-phase10-xchan-2`
const SMOKE_PHONE = '+15550001010'
const SMOKE_SESSION_A = `smoke-p10-session-a`
const SMOKE_SESSION_B = `smoke-p10-session-b`
const SMOKE_SESSION_C = `smoke-p10-session-c`

/** Upsert a web_conversations row with specific fields. */
async function upsertWebConv(opts: {
  sessionId: string
  customerGid: string
  pitchHandle: string | null
  lastActiveAt: Date
}): Promise<void> {
  await db
    .insert(webConversations)
    .values({
      sessionId:          opts.sessionId,
      stage:              'DISCOVERY',
      stageSetAt:         opts.lastActiveAt,
      lastActiveAt:       opts.lastActiveAt,
      customerGid:        opts.customerGid,
      currentPitchHandle: opts.pitchHandle,
    })
    .onConflictDoUpdate({
      target: webConversations.sessionId,
      set: {
        customerGid:        opts.customerGid,
        currentPitchHandle: opts.pitchHandle,
        lastActiveAt:       opts.lastActiveAt,
        stageSetAt:         opts.lastActiveAt,
      },
    })
}

/** Upsert an sms_conversations row with specific fields. */
async function upsertSmsConv(opts: {
  phone: string
  customerGid: string
  pitchHandle: string | null
  lastActiveAt: Date
}): Promise<void> {
  await db
    .insert(smsConversations)
    .values({
      phone:               opts.phone,
      stage:               'DISCOVERY',
      stageSetAt:          opts.lastActiveAt,
      lastActiveAt:        opts.lastActiveAt,
      customerGid:         opts.customerGid,
      currentPitchHandle:  opts.pitchHandle,
    })
    .onConflictDoUpdate({
      target: smsConversations.phone,
      set: {
        customerGid:        opts.customerGid,
        currentPitchHandle: opts.pitchHandle,
        lastActiveAt:       opts.lastActiveAt,
        stageSetAt:         opts.lastActiveAt,
      },
    })
}

/** Clean up smoke test rows. */
async function cleanup(): Promise<void> {
  await db.delete(webConversations).where(eq(webConversations.sessionId, SMOKE_SESSION_A))
  await db.delete(webConversations).where(eq(webConversations.sessionId, SMOKE_SESSION_B))
  await db.delete(webConversations).where(eq(webConversations.sessionId, SMOKE_SESSION_C))
  await db.delete(smsConversations).where(eq(smsConversations.phone, SMOKE_PHONE))
}

// ---------------------------------------------------------------------------
// Scenario 1: No customer_gid → null
// ---------------------------------------------------------------------------

async function scenario1(): Promise<void> {
  console.log('\nScenario 1: No customer_gid → null')

  const result = await findRecentCrossChannelActivity(null, 'sms')
  assert(result === null, 'null gid → null returned')

  const resultUndefined = await findRecentCrossChannelActivity(undefined, 'sms')
  assert(resultUndefined === null, 'undefined gid → null returned')

  const resultEmpty = await findRecentCrossChannelActivity('', 'sms')
  assert(resultEmpty === null, 'empty string gid → null returned')
}

// ---------------------------------------------------------------------------
// Scenario 2: Same channel → null
// ---------------------------------------------------------------------------

async function scenario2(): Promise<void> {
  console.log('\nScenario 2: Same channel → null (sms activity excluded when currentChannel=sms)')

  // Seed an SMS conversation with this customer_gid active right now.
  await upsertSmsConv({
    phone: SMOKE_PHONE,
    customerGid: SMOKE_GID,
    pitchHandle: 'lush-mini',
    lastActiveAt: new Date(),
  })

  // Calling with the same channel='sms' should return null (no *other* channel to check).
  const result = await findRecentCrossChannelActivity(SMOKE_GID, 'sms')
  assert(result === null, 'same-channel (sms→sms) returns null')

  // Web requesting sms should also return the sms row correctly:
  // this verifies the GID is actually in the DB.
  const webResult = await findRecentCrossChannelActivity(SMOKE_GID, 'web')
  assert(webResult !== null, 'cross-channel (web asks for sms) returns a result')
  if (webResult) {
    assert(webResult.otherChannel === 'sms', 'otherChannel is sms')
    assert(webResult.topic.kind === 'product', 'topic.kind is product')
    if (webResult.topic.kind === 'product') {
      assert(webResult.topic.handle === 'lush-mini', 'handle is lush-mini')
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario 3: Cross-channel hit (web conv with pitch handle)
// ---------------------------------------------------------------------------

async function scenario3(): Promise<void> {
  console.log('\nScenario 3: Cross-channel hit — web conv with lush-mini, 10 min ago')

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
  await upsertWebConv({
    sessionId: SMOKE_SESSION_A,
    customerGid: SMOKE_GID,
    pitchHandle: 'lush-mini',
    lastActiveAt: tenMinAgo,
  })

  const result = await findRecentCrossChannelActivity(SMOKE_GID, 'sms')
  assert(result !== null, 'cross-channel hit found')
  if (result) {
    assert(result.otherChannel === 'web', 'otherChannel is web')
    assert(result.topic.kind === 'product', 'topic.kind is product')
    if (result.topic.kind === 'product') {
      assert(result.topic.handle === 'lush-mini', 'handle is lush-mini')
      console.log(`  title resolved: ${result.topic.title ?? '(none — product may not exist in Shopify)'}`)
    }
    assert(result.lastActiveAt instanceof Date, 'lastActiveAt is a Date')
    assert(typeof result.conversationId === 'string', 'conversationId is a string')
  }
}

// ---------------------------------------------------------------------------
// Scenario 4: TTL expiry
// ---------------------------------------------------------------------------

async function scenario4(): Promise<void> {
  console.log('\nScenario 4: TTL expiry — web conv 25h ago → null')

  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await upsertWebConv({
    sessionId: SMOKE_SESSION_B,
    customerGid: SMOKE_GID_2,
    pitchHandle: 'some-old-product',
    lastActiveAt: twentyFiveHoursAgo,
  })

  const result = await findRecentCrossChannelActivity(SMOKE_GID_2, 'sms')
  assert(result === null, '25h-old activity outside 24h TTL returns null')
}

// ---------------------------------------------------------------------------
// Scenario 5: Multiple matches → most-recent wins
// ---------------------------------------------------------------------------

async function scenario5(): Promise<void> {
  console.log('\nScenario 5: Multiple matches → most-recent wins')

  const twoHoursAgo  = new Date(Date.now() - 2 * 60 * 60 * 1000)
  const oneHourAgo   = new Date(Date.now() - 1 * 60 * 60 * 1000)

  // Session A (seeded in Scenario 3) = 10 min ago, handle='lush-mini'.
  // Seed Session C at 2h ago with a different handle.
  await upsertWebConv({
    sessionId: SMOKE_SESSION_C,
    customerGid: SMOKE_GID,
    pitchHandle: 'older-product',
    lastActiveAt: twoHoursAgo,
  })
  // Re-seed Session A to a 1-hour-ago timestamp with 'lush-mini'.
  await upsertWebConv({
    sessionId: SMOKE_SESSION_A,
    customerGid: SMOKE_GID,
    pitchHandle: 'lush-mini',
    lastActiveAt: oneHourAgo,
  })

  const result = await findRecentCrossChannelActivity(SMOKE_GID, 'sms')
  assert(result !== null, 'multiple matches → result found')
  if (result && result.topic.kind === 'product') {
    assert(result.topic.handle === 'lush-mini', 'most-recent session wins (lush-mini)')
  }
}

// ---------------------------------------------------------------------------
// Scenario 6: RECONNECT surfaces the hint
// ---------------------------------------------------------------------------

async function scenario6(): Promise<void> {
  console.log('\nScenario 6: RECONNECT surfaces cross-channel hint → DISCOVERY + prose with product')

  // Build a minimal EmmaContext and attach a cross-channel hint directly,
  // simulating what buildEmmaContextWithCrossChannel does.
  const ctx: EmmaContext = {
    conversation: {
      phone:               '+15555551234',
      conversationId:      'smoke-p10-reconnect',
      stage:               'RECONNECT',
      currentPitchHandle:  null,
      currentUpsellHandle: null,
      lastQuoteUrl:        null,
    },
  }

  // Attach the cross-channel hint manually (mirrors the processor-layer attach).
  const hint = {
    otherChannel: 'web' as const,
    topic: { kind: 'product' as const, handle: 'lush-mini', title: 'Lush Mini' },
    lastActiveAt: new Date(Date.now() - 10 * 60 * 1000),
    conversationId: 'smoke-web-conv-123',
  }
  ;(ctx as EmmaContext & { crossChannelHint?: typeof hint }).crossChannelHint = hint

  // Verify getCrossChannelHint reads it back.
  const readBack = getCrossChannelHint(ctx)
  assert(readBack !== undefined, 'getCrossChannelHint reads the hint back')

  const intent: IntentResult = { intent: 'OFF_TOPIC', confidence: 0.9, source: 'regex' }
  const resp = await executeReconnectStage(ctx, intent, 'hey')

  const prose = resp.segments.map((s) => s.prose).join(' ')
  console.log(`  Reply: ${prose.slice(0, 200)}`)

  assert(
    prose.toLowerCase().includes('lush mini') || prose.includes('lush-mini'),
    'prose references the product title or handle',
  )
  assert(resp.stageOut === 'DISCOVERY', 'stageOut is DISCOVERY')
  assert(
    resp.stateWrites.currentPitchHandle === 'lush-mini',
    'stateWrites.currentPitchHandle set to lush-mini',
  )
  assert(resp.stateWrites.stage === 'DISCOVERY', 'stateWrites.stage is DISCOVERY')
  assert(
    resp.telemetry.intent === 'OFF_TOPIC',
    'telemetry.intent preserved from input intent',
  )
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Phase 10 smoke test: Cross-channel conversation state ===')

  await cleanup()

  try {
    await scenario1()
    await scenario2()
    await scenario3()
    await scenario4()
    await scenario5()
    await scenario6()
  } finally {
    await cleanup()
  }

  console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`)
  if (failCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
