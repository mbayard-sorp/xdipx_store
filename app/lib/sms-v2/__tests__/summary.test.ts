/**
 * app/lib/sms-v2/__tests__/summary.test.ts
 *
 * Vitest unit tests for generateConversationSummary().
 *
 * Uses _setSummaryAnthropicClient to inject a mock client so no real API
 * calls are made. Tests cover: happy path, error fallback, empty input,
 * prior summary anchoring, and the 300-char hard cap.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateConversationSummary, _setSummaryAnthropicClient } from '../summary.server'
import type { HistoryTurn } from '../conversation-history.server'

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMock(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  }
}

function makeMockThatThrows(error: Error) {
  return {
    messages: {
      create: vi.fn().mockRejectedValue(error),
    },
  }
}

const turns: HistoryTurn[] = [
  { role: 'user', text: 'looking for a quiet wand for my partner' },
  { role: 'assistant', text: 'Got it. Budget in mind?' },
  { role: 'user', text: 'under $100 please' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateConversationSummary', () => {
  it('returns Haiku output on success', async () => {
    const mock = makeMock('Customer is shopping for a quiet wand for their partner, budget under $100.')
    _setSummaryAnthropicClient(mock as never)

    const result = await generateConversationSummary(turns, null)
    expect(result).toBe('Customer is shopping for a quiet wand for their partner, budget under $100.')
    expect(mock.messages.create).toHaveBeenCalledOnce()
  })

  it('falls back to priorSummary when the API throws', async () => {
    const mock = makeMockThatThrows(new Error('network error'))
    _setSummaryAnthropicClient(mock as never)

    const result = await generateConversationSummary(turns, 'Previous: customer wanted a wand.')
    expect(result).toBe('Previous: customer wanted a wand.')
  })

  it('falls back to empty string when priorSummary is null and the API throws', async () => {
    const mock = makeMockThatThrows(new Error('timeout'))
    _setSummaryAnthropicClient(mock as never)

    const result = await generateConversationSummary(turns, null)
    expect(result).toBe('')
  })

  it('returns priorSummary when Haiku returns an empty string', async () => {
    const mock = makeMock('')
    _setSummaryAnthropicClient(mock as never)

    const result = await generateConversationSummary(turns, 'Prior context here.')
    expect(result).toBe('Prior context here.')
  })

  it('returns empty string when turns are empty and no prior summary', async () => {
    // No API call needed — short-circuits before calling Haiku.
    const mock = makeMock('should not be called')
    _setSummaryAnthropicClient(mock as never)

    const result = await generateConversationSummary([], null)
    expect(result).toBe('')
    expect(mock.messages.create).not.toHaveBeenCalled()
  })

  it('truncates output longer than 300 chars', async () => {
    const longOutput = 'x'.repeat(400)
    const mock = makeMock(longOutput)
    _setSummaryAnthropicClient(mock as never)

    const result = await generateConversationSummary(turns, null)
    expect(result.length).toBeLessThanOrEqual(300)
    expect(result).toMatch(/\.\.\.$/)
  })

  it('includes priorSummary as anchor in the user message', async () => {
    const mock = makeMock('Customer is shopping for a wand, budget $100.')
    _setSummaryAnthropicClient(mock as never)

    await generateConversationSummary(turns, 'Prior: customer mentioned partner.')
    const callArg = mock.messages.create.mock.calls[0]?.[0]
    const userMsg = (callArg as { messages: Array<{ content: string }> }).messages[0]?.content
    expect(userMsg).toContain('Prior: customer mentioned partner.')
  })

  it('does not emit em-dashes in the system prompt (architect condition #4)', async () => {
    // Import the module and check the system prompt source.
    // We verify this by inspecting the call argument passed to Haiku.
    const mock = makeMock('ok')
    _setSummaryAnthropicClient(mock as never)

    await generateConversationSummary(turns, null)
    const callArg = mock.messages.create.mock.calls[0]?.[0] as { system?: string }
    const systemPrompt = callArg?.system ?? ''
    expect(systemPrompt).not.toContain('—') // em-dash character
    expect(systemPrompt).not.toContain(' -- ') // double hyphen used as em-dash substitute
  })
})
