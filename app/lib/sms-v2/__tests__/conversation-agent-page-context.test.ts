/**
 * app/lib/sms-v2/__tests__/conversation-agent-page-context.test.ts
 *
 * Vitest unit tests for buildKnownAboutCustomer — specifically the
 * cold-PDP-visit case (C-01h fix).
 *
 * The conversation-agent module has heavy top-level imports (Anthropic SDK,
 * Shopify, Drizzle). We mock those away so the pure buildKnownAboutCustomer
 * function can be tested in isolation without network or DB access.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

// ---------------------------------------------------------------------------
// Mock heavy server-only imports before the module under test loads.
// Order matters: vi.mock calls are hoisted by Vitest to before imports.
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() }
  },
}))

vi.mock('~/lib/db.server', () => ({
  db: {},
}))

vi.mock('~/lib/shopify.server', () => ({
  findCustomerByPhone: vi.fn(),
  getTodaysDeal: vi.fn(),
  getProductByHandle: vi.fn(),
}))

vi.mock('~/lib/ai-agent/prompt', () => ({
  BRAND_VOICE: 'BRAND_VOICE_STUB',
}))

vi.mock('../conversation-history.server', () => ({
  loadConversationHistory: vi.fn(),
}))

vi.mock('../discovery-agent-tools.server', () => ({
  DISCOVERY_AGENT_TOOLS: [],
  runDiscoveryTool: vi.fn(),
}))

vi.mock('../slot-extractor.server', () => ({
  extractSlots: vi.fn(),
}))

vi.mock('../transitions.server', () => ({
  resolveTransition: vi.fn(),
}))

vi.mock('~/lib/ivr-search.server', () => ({}))

vi.mock('../context-builder.server', () => ({
  buildEmmaContext: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import the function under test AFTER mocks are declared.
// ---------------------------------------------------------------------------

let buildKnownAboutCustomer: (
  slots: Record<string, unknown>,
  summary: string | null,
  pitchedHandlesLog: string[] | null,
  pageContext?: { handle?: string; route?: string } | null,
) => string

beforeAll(async () => {
  const mod = await import('../conversation-agent.server')
  buildKnownAboutCustomer = mod.buildKnownAboutCustomer
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildKnownAboutCustomer — cold PDP visit (C-01h)', () => {
  it('emits the page-context line when pageContext.handle is set and no prior pitch exists', () => {
    const result = buildKnownAboutCustomer(
      {},      // no discovered slots
      null,    // no summary
      null,    // no pitchedHandlesLog
      { handle: 'we-vibe-tango-x' },
    )

    expect(result).toContain('<known_about_customer>')
    expect(result).toContain('We Vibe Tango X')
    expect(result).toContain('No intent signal yet, just page presence.')
  })

  it('emits page-context line even when currentPitchHandle would be null on a cold visit', () => {
    // This is the exact cold-PDP-visit scenario from C-01h:
    // pageContext.handle comes from the URL; currentPitchHandle is null (no prior pitch).
    // Before the fix, pageContextForPrompt was null because it gated on currentPitchHandle.
    // After the fix, pageHandle feeds in independently.
    const result = buildKnownAboutCustomer(
      {},
      null,
      null,
      { handle: 'satisfyer-pro-2' },
    )

    expect(result).toContain('Satisfyer Pro 2')
    expect(result).toContain('No intent signal yet, just page presence.')
  })

  it('falls through to empty string when pageContext is absent and no other context', () => {
    const result = buildKnownAboutCustomer({}, null, null, null)
    expect(result).toBe('')
  })

  it('still includes page-context line alongside slots and summary', () => {
    const result = buildKnownAboutCustomer(
      { who: 'solo' } as Record<string, unknown>,
      'Customer is exploring solo options.',
      null,
      { handle: 'lelo-sona-2' },
    )

    expect(result).toContain('Lelo Sona 2')
    expect(result).toContain('No intent signal yet, just page presence.')
    expect(result).toContain('Customer is exploring solo options.')
  })

  it('does not emit page-context line when pageContext is null', () => {
    const result = buildKnownAboutCustomer(
      { who: 'couples' } as Record<string, unknown>,
      null,
      null,
      null,
    )

    expect(result).not.toContain('page')
  })

  it('does not imply purchase intent in the page-context line', () => {
    const result = buildKnownAboutCustomer(
      {},
      null,
      null,
      { handle: 'some-product' },
    )

    // Empathy gate: the line must say "page presence" not "wants to buy" etc.
    expect(result).toContain('No intent signal yet, just page presence.')
    expect(result).not.toMatch(/want(s)? to buy/i)
    expect(result).not.toMatch(/intent to purchase/i)
    expect(result).not.toMatch(/ready to buy/i)
  })
})
