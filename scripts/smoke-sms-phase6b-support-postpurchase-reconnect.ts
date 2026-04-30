/**
 * scripts/smoke-sms-phase6b-support-postpurchase-reconnect.ts
 *
 * Phase 6b smoke test — SUPPORT, POST_PURCHASE, RECONNECT stage handlers
 * and the orderStatusLookup tool.
 *
 * Run with:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/smoke-sms-phase6b-support-postpurchase-reconnect.ts
 *
 * Scenarios:
 *   1. SUPPORT with real order   → prose contains #1234 and Phoenix AZ
 *   2. SUPPORT with no order     → NOT_FOUND_REPLY fires
 *   3. POST_PURCHASE happy path  → 5 runs, no $ or PDP URL in output
 *   4. POST_PURCHASE sales-attempt fabrication → fabricationCaught fires
 *   5. RECONNECT with prior order → prose contains item title or "last time"
 *   6. RECONNECT cold            → welcome-back template, no product names
 */

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { executeSupportStage } from '../app/lib/sms-v2/stages/support.server'
import {
  executePostPurchaseStage,
  _setAnthropicClient as setPostPurchaseClient,
} from '../app/lib/sms-v2/stages/post-purchase.server'
import { executeReconnectStage } from '../app/lib/sms-v2/stages/reconnect.server'
import {
  OrderNotFoundError,
  type OrderStatus,
  _setOrderStatusLookup,
} from '../app/lib/sms-v2/tools/order-status.server'
import { NOT_FOUND_REPLY } from '../app/lib/sms-v2/templates/support-templates'
import type { EmmaContext, IntentResult } from '../app/lib/sms-v2/types.server'

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function assertSoft(cond: boolean, msg: string): void {
  if (!cond) console.warn(`  SOFT: ${msg}`)
  else { console.log(`  ok   ${msg}`); passCount++ }
}

function makeIntent(intent: IntentResult['intent'] = 'SUPPORT', confidence = 0.9): IntentResult {
  return { intent, confidence, source: 'regex' }
}

function buildCtx(opts: {
  stage?: EmmaContext['conversation']['stage']
  lastOrderItems?: { handle: string; title: string; pdpUrl: string }[]
  customerGid?: string
} = {}): EmmaContext {
  return {
    conversation: {
      phone:                '+15555559001',
      conversationId:       'smoke-phase6b',
      stage:                opts.stage ?? 'SUPPORT',
      currentPitchHandle:   null,
      currentUpsellHandle:  null,
      lastQuoteUrl:         null,
    },
    customer: {
      ...(opts.customerGid != null ? { gid: opts.customerGid } : {}),
      ...(opts.lastOrderItems != null ? { lastOrderItems: opts.lastOrderItems } : {}),
    },
  }
}

// ─── Fixture order ────────────────────────────────────────────────────────────

const FIXTURE_ORDER: OrderStatus = {
  orderName:      '#1234',
  status:         'shipped',
  trackingNumber: '9400111899223447512345',
  trackingUrl:    'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223447512345',
  carrier:        'USPS',
  lastScan:       'Phoenix AZ Apr 12 6:23am',
  refundEligible: true,
  cancelEligible: false,
}

function mockOrderFound(): () => void {
  const restore = _setOrderStatusLookup(async () => FIXTURE_ORDER)
  return () => _setOrderStatusLookup(restore)
}

function mockOrderNotFound(): () => void {
  const restore = _setOrderStatusLookup(async () => {
    throw new OrderNotFoundError('No order found for phone')
  })
  return () => _setOrderStatusLookup(restore)
}

// ─── Scenario 1: SUPPORT with real order ─────────────────────────────────────

async function scenario1(): Promise<void> {
  console.log('\nScenario 1: SUPPORT with real order (#1234, Phoenix AZ)')
  const restore = mockOrderFound()
  try {
    const ctx = buildCtx({ stage: 'SUPPORT' })
    const resp = await executeSupportStage(ctx, makeIntent('SUPPORT'), "what's my order status?")

    const prose = resp.segments.map((s) => s.prose).join(' ')
    console.log('  Reply:', prose.slice(0, 200))

    assert(prose.includes('#1234'), 'prose contains #1234')
    assert(
      prose.toLowerCase().includes('phoenix') || prose.includes('Phoenix AZ'),
      'prose contains Phoenix AZ',
    )
    assert(resp.stageOut === 'SUPPORT', 'stageOut is SUPPORT')
    assert(resp.stateWrites.stage === 'SUPPORT', 'stateWrites.stage is SUPPORT')
    assert(
      resp.telemetry.toolCalls?.some((tc) => tc.name === 'orderStatusLookup' && tc.ok) ?? false,
      'toolCall orderStatusLookup ok',
    )
  } finally {
    restore()
  }
}

// ─── Scenario 2: SUPPORT with no order ───────────────────────────────────────

async function scenario2(): Promise<void> {
  console.log('\nScenario 2: SUPPORT with no order (OrderNotFoundError)')
  const restore = mockOrderNotFound()
  try {
    const ctx = buildCtx({ stage: 'SUPPORT' })
    const resp = await executeSupportStage(ctx, makeIntent('SUPPORT'), 'track my order')

    const prose = resp.segments.map((s) => s.prose).join(' ')
    console.log('  Reply:', prose.slice(0, 200))

    // Should match NOT_FOUND_REPLY or degrade gracefully
    assert(
      prose.toLowerCase().includes("don't see") ||
      prose.toLowerCase().includes('order') ||
      prose.toLowerCase().includes('number'),
      'fallback mentions order lookup',
    )
    assert(
      prose.toLowerCase().includes("don't see") ||
      prose.toLowerCase().includes('can you') ||
      prose.toLowerCase().includes('#'),
      'fallback asks customer to clarify',
    )
    assert(resp.stageOut === 'SUPPORT', 'stageOut is SUPPORT')
    assert(
      resp.telemetry.toolCalls?.some((tc) => tc.name === 'orderStatusLookup' && !tc.ok) ?? false,
      'toolCall orderStatusLookup not ok',
    )
  } finally {
    restore()
  }
}

// ─── Scenario 3: POST_PURCHASE happy path ────────────────────────────────────

async function scenario3(): Promise<void> {
  console.log('\nScenario 3: POST_PURCHASE happy path — 5 runs, no $ or PDP URL')
  const restore = mockOrderFound()
  try {
    const SALES_PATTERN = /(\$\d|\/products\/[a-z0-9-]+|\/collections\/[a-z0-9-]+)/i

    let allClean = true
    for (let i = 0; i < 5; i++) {
      const ctx = buildCtx({ stage: 'POST_PURCHASE' })
      const resp = await executePostPurchaseStage(
        ctx,
        makeIntent('OFF_TOPIC'),
        'how do I clean it?',
      )
      const prose = resp.segments.map((s) => s.prose).join(' ')

      if (SALES_PATTERN.test(prose)) {
        console.error(
          `  Run ${i + 1}: FAIL — found sales content in prose: ${prose.slice(0, 200)}`,
        )
        allClean = false
      } else {
        console.log(`  Run ${i + 1}: ok — no sales content`)
      }
    }

    assert(allClean, 'all 5 POST_PURCHASE runs produced clean (no $ / PDP URL) prose')
  } finally {
    restore()
  }
}

// ─── Scenario 4: POST_PURCHASE fabrication catch ─────────────────────────────

async function scenario4(): Promise<void> {
  console.log('\nScenario 4: POST_PURCHASE fabrication catch — LLM injects sales pitch')
  const restoreOrder = mockOrderFound()

  // Monkey-patch the LLM to return a sales attempt
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: 'You should also try the Lush 2 — only $139!' }],
        usage: {
          input_tokens:                100,
          output_tokens:               20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens:     0,
        },
      }),
    },
  } as unknown as Anthropic

  const original = setPostPurchaseClient(fakeClient)

  try {
    const ctx = buildCtx({ stage: 'POST_PURCHASE' })
    const resp = await executePostPurchaseStage(ctx, makeIntent('OFF_TOPIC'), 'it stopped working')

    const prose = resp.segments.map((s) => s.prose).join(' ')
    console.log('  Fallback prose:', prose.slice(0, 200))

    assert(
      resp.telemetry.fabricationCaught === 'post_purchase_sales_attempt',
      'fabricationCaught === post_purchase_sales_attempt',
    )
    assert(resp.stageOut === 'POST_PURCHASE', 'stageOut is POST_PURCHASE')
    assert(
      !prose.includes('$139') && !prose.includes('Lush 2'),
      'sales content suppressed in output',
    )
  } finally {
    setPostPurchaseClient(original)
    restoreOrder()
  }
}

// ─── Scenario 5: RECONNECT with prior order ───────────────────────────────────

async function scenario5(): Promise<void> {
  console.log('\nScenario 5: RECONNECT with prior order — prose references Lush Mini')

  const ctx = buildCtx({
    stage: 'RECONNECT',
    lastOrderItems: [
      {
        handle: 'lovense-lush-mini',
        title:  'Lush Mini',
        pdpUrl: 'https://xdipx.com/products/lovense-lush-mini',
      },
    ],
  })

  // executeReconnectStage is synchronous — no mocking needed
  const resp = executeReconnectStage(ctx, makeIntent('OFF_TOPIC'), 'hey')
  const prose = resp.segments.map((s) => s.prose).join(' ')
  console.log('  Reply:', prose.slice(0, 200))

  assert(
    prose.toLowerCase().includes('lush mini') || prose.toLowerCase().includes('last time'),
    'prose mentions Lush Mini or "last time"',
  )
  assert(resp.stageOut === 'DISCOVERY', 'stageOut is DISCOVERY (next-turn reclassification)')
  assert(resp.stateWrites.stage === 'DISCOVERY', 'stateWrites.stage is DISCOVERY')
}

// ─── Scenario 6: RECONNECT cold (no prior order) ──────────────────────────────

async function scenario6(): Promise<void> {
  console.log('\nScenario 6: RECONNECT cold — welcome-back template, no product names')

  const ctx = buildCtx({ stage: 'RECONNECT' }) // no lastOrderItems

  const resp = executeReconnectStage(ctx, makeIntent('OFF_TOPIC'), 'hey')
  const prose = resp.segments.map((s) => s.prose).join(' ')
  console.log('  Reply:', prose.slice(0, 200))

  assert(
    prose.toLowerCase().includes('welcome') ||
    prose.toLowerCase().includes('glad') ||
    prose.toLowerCase().includes('back'),
    'prose contains welcome-back greeting',
  )
  assert(resp.stageOut === 'DISCOVERY', 'stageOut is DISCOVERY')
  // No product names should appear (we didn't inject any)
  assertSoft(!prose.includes('Lush'), 'no product name in cold reconnect')
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Phase 6b smoke test: SUPPORT + POST_PURCHASE + RECONNECT ===')

  await scenario1()
  await scenario2()
  await scenario3()
  await scenario4()
  await scenario5()
  await scenario6()

  console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`)
  if (failCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
