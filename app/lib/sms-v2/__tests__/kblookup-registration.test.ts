/**
 * app/lib/sms-v2/__tests__/kblookup-registration.test.ts
 *
 * Ticket #621. kbLookup (app/lib/sms-v2/tools/kb-lookup.server.ts) shipped
 * fully implemented but was never registered as a callable tool in the
 * RESEARCH, OBJECTION, or POST_PURCHASE stage handlers — each carried a
 * "TODO (Phase 6c)" instead. Asserts the model can actually reach kbLookup
 * in all three and that its result lands in the final prose.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/shopify.server', () => ({ getProductByHandle: vi.fn(async () => null) }))
vi.mock('~/lib/mfg-specs/sync.server', () => ({ getMfgSpecs: vi.fn(async () => null) }))
vi.mock('~/lib/claude.server', () => ({
  buildEmmaSystemBlocks: vi.fn(async () => [{ text: 'BRAND_VOICE_STUB', cache: false }]),
}))
vi.mock('../../token-log.server', () => ({ logApiTokens: vi.fn() }))
vi.mock('~/lib/ivr-search.server', () => ({ searchForIvr: vi.fn(async () => []) }))
// The worktree env pins DISCOVERY_AGENT_VERSION=v2-agent, which would route
// executeObjectionStage to the unified conversation agent instead of the
// legacy gate handler under test here. Force the gate path explicitly.
vi.mock('../discovery-agent-flag.server', () => ({ pickDiscoveryAgentVersion: () => 'v2-gate' }))

const { kbLookup } = vi.hoisted(() => ({ kbLookup: vi.fn() }))
vi.mock('../tools/kb-lookup.server', () => ({ kbLookup }))

function kbToolUseResponse(id: string, input: Record<string, unknown>) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name: 'kbLookup', input }],
    usage: { input_tokens: 10, output_tokens: 5 },
  }
}

function textResponse(text: string) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 20 },
  }
}

const KB_RESULT = {
  topic: 'returns' as const,
  quickAnswer: 'Unopened items can be returned within 30 days.',
  sourceId: 'kb-1',
  sourceTitle: 'Returns Policy',
}

beforeEach(() => {
  kbLookup.mockReset()
  kbLookup.mockResolvedValue(KB_RESULT)
})

describe('OBJECTION stage — kbLookup registered in the existing tool loop', () => {
  it('offers kbLookup as an available tool once product context resolves', async () => {
    vi.doMock('~/lib/shopify.server', () => ({
      getProductByHandle: vi.fn(async () => ({
        seoTitle: '', title: 'Aurora Wand', variants: [{ price: '89.00' }], images: [],
      })),
    }))
    vi.resetModules()
    const mod = await import('../stages/objection.server')
    const create = vi
      .fn()
      .mockResolvedValueOnce(kbToolUseResponse('t0', { topic: 'returns', query: 'can I return it' }))
      .mockResolvedValueOnce(textResponse('Unopened items can go back within 30 days.'))
    mod._setAnthropicClient({ messages: { create } } as unknown as Anthropic)

    const ctx = {
      conversation: {
        phone: '+16025550100',
        conversationId: 'conv-1',
        stage: 'OBJECTION',
        currentPitchHandle: 'aurora-wand',
        currentUpsellHandle: null,
        lastQuoteUrl: null,
      },
    } as unknown as Parameters<typeof mod.executeObjectionStage>[0]

    const res = await mod.executeObjectionStage(
      ctx,
      { intent: 'OBJECTION', confidence: 0.9 } as never,
      'can I return it if it breaks',
    )

    const firstCallArgs = create.mock.calls[0]?.[0] as { tools?: Array<{ name: string }> }
    const toolNames = (firstCallArgs.tools ?? []).map((t) => t.name)
    expect(toolNames).toContain('kbLookup')
    expect(kbLookup).toHaveBeenCalledWith({ topic: 'returns', query: 'can I return it' })
    expect(res.segments[0]?.prose).toContain('30 days')
  })
})

describe('RESEARCH stage — kbLookup registered as the one optional tool', () => {
  it('offers kbLookup, dispatches it, and folds the result into the reply', async () => {
    vi.resetModules()
    vi.doMock('../slot-extractor.server', () => ({
      extractSlots: vi.fn(async () => ({ slots: {} })),
    }))
    vi.doMock('../discovery-gate.server', () => ({
      suspendForExplain: vi.fn(),
      initDiscoveryState: vi.fn(),
      mergeSlots: vi.fn((a: unknown) => a),
      resumeFromExplain: vi.fn(),
    }))
    vi.doMock('../templates/category-explainers', () => ({ getExplainer: vi.fn(() => null) }))
    vi.doMock('../templates/research-templates', () => ({
      pickResearchFallbackTemplate: vi.fn(() => 'fallback'),
    }))
    vi.doMock('./_product-context.server', () => ({ fetchProductContext: vi.fn(async () => null) }))

    const mod = await import('../stages/research.server')
    const create = vi
      .fn()
      .mockResolvedValueOnce(kbToolUseResponse('t0', { topic: 'compatibility', query: 'does this work with my other toy' }))
      .mockResolvedValueOnce(textResponse('Compatible with most silicone-safe lubes.'))
    mod._setAnthropicClient({ messages: { create } } as unknown as Anthropic)

    const ctx = {
      conversation: {
        phone: '+16025550100',
        conversationId: 'conv-1',
        stage: 'RESEARCH',
        currentPitchHandle: null,
        discoveredSlots: {},
        discoveryState: null,
      },
      customer: null,
    } as unknown as Parameters<typeof mod.executeResearchStage>[0]

    const res = await mod.executeResearchStage(
      ctx,
      { intent: 'RESEARCH', confidence: 0.8 } as never,
      'does this work with my other toy',
    )

    const firstCallArgs = create.mock.calls[0]?.[0] as { tools?: Array<{ name: string }>; tool_choice?: { type: string } }
    const toolNames = (firstCallArgs.tools ?? []).map((t) => t.name)
    expect(toolNames).toEqual(['kbLookup'])
    expect(firstCallArgs.tool_choice).toEqual({ type: 'auto' })
    expect(kbLookup).toHaveBeenCalledWith({ topic: 'compatibility', query: 'does this work with my other toy' })
    expect(res.segments[0]?.prose).toContain('Compatible')
  })
})

describe('POST_PURCHASE stage — kbLookup registered as a bounded one-hop tool', () => {
  it('offers kbLookup, dispatches it, and the reply never trips the sales-attempt guard', async () => {
    vi.resetModules()
    class MockOrderNotFoundError extends Error {}
    vi.doMock('../tools/order-status.server', () => ({
      orderStatusLookup: vi.fn(async () => {
        throw new MockOrderNotFoundError('no order')
      }),
      OrderNotFoundError: MockOrderNotFoundError,
    }))
    vi.doMock('../templates/post-purchase-templates', () => ({
      GENERIC_POST_PURCHASE_FALLBACK: 'FALLBACK_PROSE',
    }))

    const mod = await import('../stages/post-purchase.server')
    const create = vi
      .fn()
      .mockResolvedValueOnce(kbToolUseResponse('t0', { topic: 'troubleshooting', query: 'it stopped charging' }))
      .mockResolvedValueOnce(textResponse('Try a full charge for 3 hours on the included cable first.'))
    mod._setAnthropicClient({ messages: { create } } as unknown as Anthropic)

    const ctx = {
      conversation: { phone: '+16025550100' },
      customer: null,
    } as unknown as Parameters<typeof mod.executePostPurchaseStage>[0]

    const res = await mod.executePostPurchaseStage(
      ctx,
      { intent: 'POST_PURCHASE', confidence: 0.8 } as never,
      'it stopped charging, what do I do',
    )

    const firstCallArgs = create.mock.calls[0]?.[0] as { tools?: Array<{ name: string }> }
    const toolNames = (firstCallArgs.tools ?? []).map((t) => t.name)
    expect(toolNames).toEqual(['kbLookup'])
    expect(kbLookup).toHaveBeenCalledWith({ topic: 'troubleshooting', query: 'it stopped charging' })
    expect(res.segments[0]?.prose).toContain('full charge')
    expect(res.telemetry.fabricationCaught).toBeUndefined()
  })
})
