/**
 * app/lib/sms-v2/__tests__/web-upsell-closer-persist.test.ts
 *
 * Ticket #5658 — P2 web upsell closer repeats verbatim (daily support review,
 * web turns 1611 & 1619, 2026-08-25). A direct recurrence of #3218.
 *
 * Root cause: the UPSELL handler keys its closer rotation to
 * pitchedHandlesLog.length (upsell.server.ts) and appends the just-pitched
 * accessory to stateWrites.pitchedHandlesLog, exactly as voice does. Voice
 * persists that write (voice.server.ts ~L895); the web adapter's Step 5 never
 * threaded writes.pitchedHandlesLog into applyWebStateWrites, and Step 5b only
 * appends when the handler did NOT set it. So on web the log never grew:
 * pitchIndex stayed at the same value every upsell, and pickUpsellTemplate kept
 * returning WEB_TEMPLATES[0] verbatim (turns 1611 & 1619 identical).
 *
 * Two layers pinned here:
 *   (a) processWebMessageV2 persists the handler's pitchedHandlesLog write via
 *       applyWebStateWrites — the actual regression. Without the Step 5 line the
 *       log never accumulates and the closer never rotates. (DONE WHEN a)
 *   (b) with the log growing, two upsells in one web session return different
 *       closers, and the closer derives from the pitched-products count, not
 *       from the current stage. (DONE WHEN b + c)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── (a) Adapter persistence — the #5658 regression ─────────────────────────────

const h = vi.hoisted(() => ({
  getOrCreateWebConversation: vi.fn(),
  applyWebStateWrites: vi.fn(async (_sessionId: string, _writes: Record<string, unknown>) => {}),
  classifyIntent: vi.fn(),
  buildWebEmmaContext: vi.fn(),
  findRecentCrossChannelActivity: vi.fn(async () => null),
  pickEffectiveStage: vi.fn(() => 'UPSELL'),
  guardStagePreconditions: vi.fn(() => 'UPSELL'),
  dispatchStage: vi.fn(),
  logWebStageResponse: vi.fn(async () => {}),
  loadConversationHistory: vi.fn(async () => []),
  generateConversationSummary: vi.fn(async () => null),
  getPreviewImagesByHandles: vi.fn(async () => new Map()),
}))

vi.mock('../web-conversation.server', () => ({
  getOrCreateWebConversation: h.getOrCreateWebConversation,
  applyWebStateWrites: h.applyWebStateWrites,
}))
vi.mock('../intent-classifier.server', () => ({ classifyIntent: h.classifyIntent }))
vi.mock('../web-context-builder.server', () => ({ buildWebEmmaContext: h.buildWebEmmaContext }))
vi.mock('../cross-channel.server', () => ({ findRecentCrossChannelActivity: h.findRecentCrossChannelActivity }))
vi.mock('../stage-dispatch.server', () => ({
  pickEffectiveStage: h.pickEffectiveStage,
  guardStagePreconditions: h.guardStagePreconditions,
  dispatchStage: h.dispatchStage,
}))
vi.mock('../web-turn-logger.server', () => ({ logWebStageResponse: h.logWebStageResponse }))
vi.mock('../conversation-history.server', () => ({ loadConversationHistory: h.loadConversationHistory }))
vi.mock('../summary.server', () => ({ generateConversationSummary: h.generateConversationSummary }))
vi.mock('~/lib/sanity.server', () => ({ getPreviewImagesByHandles: h.getPreviewImagesByHandles }))

import { processWebMessageV2 } from '../adapters/web.server'

const MAIN = 'b-vibe-p-spot-curl'
const JELLE = 'wicked-jelle-plus-anal-lubricant-with-relaxants'

function webRow(pitchedHandlesLog: string[] | null) {
  return {
    sessionId: 'sess-1',
    conversationId: 'conv-web-1',
    // UPSELL (not GREETING/RECONNECT) so no pre-dispatch bump or fresh-start reset.
    stage: 'UPSELL',
    currentPitchHandle: MAIN,
    currentUpsellHandle: null,
    lastQuoteUrl: null,
    lastQuoteItems: null,
    lastQuoteCreatedAt: null,
    customerGid: null,
    pageHandle: null,
    pageRoute: null,
    discoveryState: null,
    discoveredSlots: {},
    pendingPdpUrl: null,
    conversationSummary: null,
    pitchedHandlesLog,
    stageSetAt: new Date(),
    lastActiveAt: new Date(),
  }
}

describe('processWebMessageV2 persists the upsell pitched-handles log (#5658)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getOrCreateWebConversation.mockResolvedValue(webRow([MAIN]))
    // COMMIT_PICK (not STOP_HELP_START), stage UPSELL (not RECONNECT) → no reset.
    h.classifyIntent.mockResolvedValue({ intent: 'COMMIT_PICK', confidence: 0.95, source: 'haiku' })
    h.buildWebEmmaContext.mockResolvedValue({ channel: 'web', conversation: webRow([MAIN]) })
    h.pickEffectiveStage.mockReturnValue('UPSELL')
    h.guardStagePreconditions.mockReturnValue('UPSELL')
    h.logWebStageResponse.mockResolvedValue(undefined)
    h.generateConversationSummary.mockResolvedValue(null)
    h.getPreviewImagesByHandles.mockResolvedValue(new Map())
  })

  it('threads the handler stateWrites.pitchedHandlesLog into applyWebStateWrites', async () => {
    // The UPSELL handler appended the just-pitched accessory to the log.
    h.dispatchStage.mockReturnValue(
      Promise.resolve({
        stageOut: 'UPSELL',
        goalAchieved: false,
        segments: [{ prose: 'Toss it in?' }],
        stateWrites: {
          currentUpsellHandle: JELLE,
          pitchedHandlesLog: [MAIN, JELLE],
        },
        telemetry: { intent: 'COMMIT_PICK', intentConfidence: 0.95 },
      }),
    )

    await processWebMessageV2({ sessionId: 'sess-1', customerText: 'yes add it' })

    // Step 5 must persist the grown log; without the fix it was silently dropped.
    const persistedLog = h.applyWebStateWrites.mock.calls.find(
      ([, writes]) => writes && Array.isArray((writes as { pitchedHandlesLog?: string[] }).pitchedHandlesLog),
    )
    expect(persistedLog).toBeDefined()
    expect((persistedLog![1] as { pitchedHandlesLog: string[] }).pitchedHandlesLog).toEqual([MAIN, JELLE])
  })

  it('does not double-append: Step 5b never fires when the handler set the log', async () => {
    h.dispatchStage.mockReturnValue(
      Promise.resolve({
        stageOut: 'UPSELL',
        goalAchieved: false,
        // currentUpsellHandle, NOT currentPitchHandle — so Step 5b's newPitchHandle
        // guard is undefined and it cannot append on top of the handler's write.
        segments: [{ prose: 'Toss it in?' }],
        stateWrites: {
          currentUpsellHandle: JELLE,
          pitchedHandlesLog: [MAIN, JELLE],
        },
        telemetry: { intent: 'COMMIT_PICK', intentConfidence: 0.95 },
      }),
    )

    await processWebMessageV2({ sessionId: 'sess-1', customerText: 'yes add it' })

    const logWrites = h.applyWebStateWrites.mock.calls.filter(
      ([, writes]) => writes && Array.isArray((writes as { pitchedHandlesLog?: string[] }).pitchedHandlesLog),
    )
    // Exactly one write carries the log — the Step 5 persist — never a second append.
    expect(logWrites).toHaveLength(1)
  })
})

// ─── (b) Closer rotates by pitch ordinal, independent of stage (DONE WHEN b + c) ─

// Handler-level layer: the real pickUpsellTemplate, driven off the pitched-log
// length. Shopify is mocked; the no-curated search path is what reaches the
// rotating template. Isolated from the adapter mocks above via its own module.
vi.mock('~/lib/shopify.server', () => ({
  getProductByHandle: vi.fn(async () => null),
  getCuratedUpsellCandidates: vi.fn(async () => ({ pitchedTags: ['prostate', 'anal'], candidates: [] })),
}))
vi.mock('../transitions.server', () => ({ resolveTransition: (_from: string, to: string) => to }))

import { executeUpsellStage, type SearchForIvrFn, type AttachSourceFn } from '../stages/upsell.server'
import type { EmmaContext, IntentResult } from '../types.server'
import type { IvrProductCard } from '~/lib/ivr-search.server'

const analAttach: AttachSourceFn = async () => ({ pitchedTags: ['prostate', 'anal'], candidates: [] })
const jelleSearch: SearchForIvrFn = async () =>
  [{ handle: JELLE, title: 'Jelle Plus Anal Lubricant', price: 13.99, tagline: '', category: '' } as unknown as IvrProductCard]
const commit: IntentResult = { intent: 'COMMIT_PICK', confidence: 0.95, source: 'haiku' }

function upsellCtx(pitchedHandlesLog: string[]): EmmaContext {
  return {
    channel: 'web',
    conversation: {
      conversationId: 'conv-1',
      stage: 'UPSELL',
      currentPitchHandle: MAIN,
      currentUpsellHandle: null,
      lastQuoteUrl: null,
      pitchedHandlesLog,
    },
  } as unknown as EmmaContext
}

describe('web upsell closer rotates with the pitched-products count (#5658 DONE WHEN b + c)', () => {
  it('the SAME accessory pitched at two ordinals returns two different closers', async () => {
    // First upsell of the session: one product already pitched (the main pick).
    const first = await executeUpsellStage(upsellCtx([MAIN]), commit, '', { searchFn: jelleSearch, attachFn: analAttach })
    // Second upsell: two products pitched so far. JELLE is not yet in this log,
    // so it is pitched again — same name/price, so any prose difference is the
    // closer alone, not the product.
    const second = await executeUpsellStage(upsellCtx([MAIN, 'prior-pick']), commit, '', { searchFn: jelleSearch, attachFn: analAttach })

    expect(first.segments[0]?.productCard?.handle).toBe(JELLE)
    expect(second.segments[0]?.productCard?.handle).toBe(JELLE)
    // Different closers for consecutive upsells — the #3218/#5658 guarantee.
    expect(first.segments[0]?.prose).not.toBe(second.segments[0]?.prose)
  })

  it('derives the closer from the log length, not the stage: a longer log wraps the 5-variant bank', async () => {
    // pitchedLog.length 0 and 5 land on the same WEB_TEMPLATES index (bank wraps),
    // proving the ordinal — not the stage, which is UPSELL in both — is the key.
    const atZero = await executeUpsellStage(upsellCtx([]), commit, '', { searchFn: jelleSearch, attachFn: analAttach })
    const atFive = await executeUpsellStage(
      upsellCtx(['h0', 'h1', 'h2', 'h3', 'h4']),
      commit, '', { searchFn: jelleSearch, attachFn: analAttach },
    )
    expect(atZero.segments[0]?.prose).toBe(atFive.segments[0]?.prose)

    // ...while an adjacent ordinal does NOT collide.
    const atOne = await executeUpsellStage(upsellCtx(['h0']), commit, '', { searchFn: jelleSearch, attachFn: analAttach })
    expect(atZero.segments[0]?.prose).not.toBe(atOne.segments[0]?.prose)
  })
})
