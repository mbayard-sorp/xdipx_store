/**
 * app/lib/sms-v2/__tests__/discovery-first-contact-collection.test.ts
 *
 * Ticket #17174: web chat conversation a28ef201-5e2e-4182-b51e-70eda2d51efc
 * (2026-10-22T06:13:03Z), DISCOVERY stage, brand-new conversation (no prior
 * turns). Customer's opening message: "Not quite it. Can you look again?
 * (I'm in the Air Pulse & Suction Vibrators collection)". Emma made zero
 * tool calls and replied with a generic clarifying question that ignored
 * the collection name the customer had just supplied.
 *
 * Root cause: the WELCOME TURN hard rule and DISCOVERY's first-time-contact
 * rule in conversation-agent.server.ts told the model to ask ONE narrowing
 * question on a customer's first message, with no carve-out for a first
 * message that already names a concrete category/collection/brand — exactly
 * the signal those rules exist to collect. (The ticket's own remedy pointed
 * at a `findCollection` tool from app/lib/ai-agent/prompt.ts's CHAT_MODE;
 * that tool is not part of this surface's DISCOVERY_AGENT_TOOLS at all —
 * `searchProducts` is the tool this architecture actually exposes, and the
 * ticket's own DONE WHEN accepts either.)
 *
 * This cannot replay the live transcript against the real model (no
 * ANTHROPIC_API_KEY in this sandbox, per routine-dev-daily.md 3h), so this
 * pins what IS deterministically verifiable: (1) the fixed system prompt
 * text actually sent to the model carries the new exception, and (2) the
 * existing tool-loop plumbing correctly surfaces a searchProducts-sourced
 * reply end to end when the model does call the tool on a first turn.
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
  runDiscoveryTool: vi.fn(async (_name: string, _input: unknown, ctx: { toolUseId: string; cardSink: Map<string, unknown[]> }) => {
    ctx.cardSink.set(ctx.toolUseId, [
      { handle: 'air-pulse-rose-bud', title: 'Rose Bud Air Pulse', price: 69, tagline: 'quiet suction, strong finish' },
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

function toolUseResponse(id: string, query: string) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name: 'searchProducts', input: { query } }],
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
    channel: 'web',
    conversation: {
      conversationId: 'a28ef201-5e2e-4182-b51e-70eda2d51efc',
      phone: null,
      stage: 'DISCOVERY',
      discoveredSlots: {},
      currentPitchHandle: null,
      conversationSummary: null,
      pitchedHandlesLog: null,
      pageHandle: null,
    },
  } as unknown as Parameters<typeof executeConversationAgent>[0]['ctx']
}

const intent = { intent: 'COMMIT_PICK', confidence: 0.95 } as unknown as Parameters<typeof executeConversationAgent>[0]['intent']

const CUSTOMER_TEXT =
  "Not quite it. Can you look again? (I'm in the Air Pulse & Suction Vibrators collection)"

describe('DISCOVERY first-contact rule names the category exception (#17174)', () => {
  it('the stable system prompt sent to the model carries the first-contact collection/brand exception', async () => {
    const create = vi.fn().mockResolvedValueOnce(textResponse('placeholder'))
    _setConversationAgentClient({ messages: { create } } as unknown as Anthropic)

    await executeConversationAgent({ ctx: makeCtx(), intent, customerText: CUSTOMER_TEXT, stage: 'DISCOVERY' })

    const args = create.mock.calls[0]?.[0] as { system: { text: string }[] }
    const stableBlockText = args.system[0]?.text ?? ''
    expect(stableBlockText).toContain('already names a concrete product category, collection, or brand')
    expect(stableBlockText).toContain('that already IS the narrowing answer')
  })

  it('surfaces a searchProducts-sourced reply end to end on a first-contact message naming a collection', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse('t0', 'air pulse suction vibrators'))
      .mockResolvedValueOnce(textResponse('This Rose Bud Air Pulse is a strong fit for that collection.'))
    _setConversationAgentClient({ messages: { create } } as unknown as Anthropic)

    const res = await executeConversationAgent({ ctx: makeCtx(), intent, customerText: CUSTOMER_TEXT, stage: 'DISCOVERY' })

    expect(create).toHaveBeenCalledTimes(2)
    const toolCallArgs = create.mock.calls[0]?.[0] as { tools: { name: string }[] }
    expect(toolCallArgs.tools.map((t) => t.name)).toContain('searchProducts')
    expect(res.segments[0]?.prose).toContain('Rose Bud Air Pulse')
  })
})
