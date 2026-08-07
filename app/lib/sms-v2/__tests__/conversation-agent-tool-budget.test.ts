/**
 * app/lib/sms-v2/__tests__/conversation-agent-tool-budget.test.ts
 *
 * conv-audit C5: the Sonnet tool-hop budget must not discard completed
 * searches. When the model spends every tool hop, the agent must still run one
 * final no-tools text turn over the collected results instead of returning
 * safeFallback ("I lost the thread for a sec.").
 *
 * Heavy server-only imports are mocked so the tool loop can be exercised with a
 * scripted Anthropic client injected via `_setConversationAgentClient`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/shopify.server', () => ({}))
vi.mock('~/lib/ai-agent/prompt', () => ({ BRAND_VOICE: 'BRAND_VOICE_STUB' }))
vi.mock('../token-log.server', () => ({ logApiTokens: vi.fn() }))
vi.mock('../conversation-history.server', () => ({ loadConversationHistory: vi.fn(async () => []) }))
vi.mock('../slot-extractor.server', () => ({ extractSlots: vi.fn(async () => null) }))
vi.mock('../discovery-gate.server', () => ({ mergeSlots: (a: unknown) => a }))
vi.mock('../transitions.server', () => ({ resolveTransition: (_from: string, to: string) => to }))
vi.mock('../discovery-agent-tools.server', () => ({
  DISCOVERY_AGENT_TOOLS: [{ name: 'searchProducts' }],
  // Populate the card sink so realHandles / detectPitchedCard have truth to
  // work from, mirroring a successful search.
  runDiscoveryTool: vi.fn(async (_name: string, _input: unknown, ctx: { toolUseId: string; cardSink: Map<string, unknown[]> }) => {
    ctx.cardSink.set(ctx.toolUseId, [
      { handle: 'aurora-wand', title: 'Aurora Wand', price: 89, tagline: 'quiet and strong' },
    ])
    return { ok: true, data: { results: 1 } }
  }),
}))

let executeConversationAgent: typeof import('../conversation-agent.server').executeConversationAgent
let _setConversationAgentClient: typeof import('../conversation-agent.server')._setConversationAgentClient

beforeEach(async () => {
  const mod = await import('../conversation-agent.server')
  executeConversationAgent = mod.executeConversationAgent
  _setConversationAgentClient = mod._setConversationAgentClient
})

function toolUseResponse(id: string) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name: 'searchProducts', input: { query: 'wand' } }],
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

function makeCtx() {
  return {
    channel: 'sms',
    conversation: {
      conversationId: 'conv-1',
      phone: '+16025550100',
      stage: 'DISCOVERY',
      discoveredSlots: {},
      currentPitchHandle: null,
      conversationSummary: null,
      pitchedHandlesLog: null,
      pageHandle: null,
    },
  } as unknown as Parameters<typeof executeConversationAgent>[0]['ctx']
}

const intent = { intent: 'RESEARCH', confidence: 0.8 } as unknown as Parameters<typeof executeConversationAgent>[0]['intent']

const SAFE_FALLBACK_PROSE = 'I lost the thread'

describe('conversation-agent tool-hop budget (conv-audit C5)', () => {
  it('runs a final text turn over collected results when every tool hop is spent', async () => {
    // Model calls a tool on all three tool hops, then (forced, tools=none) speaks.
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse('t0'))
      .mockResolvedValueOnce(toolUseResponse('t1'))
      .mockResolvedValueOnce(toolUseResponse('t2'))
      .mockResolvedValueOnce(textResponse('The Aurora Wand is the one I would start with.'))
    _setConversationAgentClient({ messages: { create } } as unknown as Anthropic)

    const res = await executeConversationAgent({ ctx: makeCtx(), intent, customerText: 'quiet wand?', stage: 'DISCOVERY' })

    // Four calls: three tool hops + one final no-tools text turn.
    expect(create).toHaveBeenCalledTimes(4)
    // The final turn forbids tool use so the model must answer in text.
    const finalArgs = create.mock.calls[3]?.[0] as { tool_choice?: { type: string } }
    expect(finalArgs.tool_choice).toEqual({ type: 'none' })

    // The customer gets the real reply, not the discard-everything fallback.
    expect(res.segments[0]?.prose).toContain('Aurora Wand')
    expect(res.segments[0]?.prose).not.toContain(SAFE_FALLBACK_PROSE)
    // Exhaustion is still recorded in telemetry for the dashboard.
    expect(res.telemetry.toolBudgetExhausted).toBe(true)
  })

  it('leaves the normal path unchanged: a text turn after one tool hop wins', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse('t0'))
      .mockResolvedValueOnce(textResponse('Here is a great pick: the Aurora Wand.'))
    _setConversationAgentClient({ messages: { create } } as unknown as Anthropic)

    const res = await executeConversationAgent({ ctx: makeCtx(), intent, customerText: 'quiet wand?', stage: 'DISCOVERY' })

    expect(create).toHaveBeenCalledTimes(2)
    expect(res.segments[0]?.prose).toContain('Aurora Wand')
    expect(res.telemetry.toolBudgetExhausted).toBeUndefined()
  })
})
