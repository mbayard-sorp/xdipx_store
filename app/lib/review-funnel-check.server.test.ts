import { describe, expect, it, vi } from 'vitest'
import { checkReviewFunnelSilentDrop, REVIEW_FUNNEL_CHECK_WINDOW_DAYS, type ReviewFunnelCheckDeps } from './review-funnel-check.server'

/**
 * Ticket #16267: handleOrderFulfilled silently died on the Basic plan's PII
 * redaction for every one of the last 38 fulfilled orders, and nothing
 * noticed. These pin the breach decision; the Neon wiring is thin.
 */

const mockFile = () => vi.fn(async (_t: { dedupeKey: string; priority: number; suggestion: string }) => ({ id: 42, deduped: false }))

function deps(over: Partial<ReviewFunnelCheckDeps> = {}): ReviewFunnelCheckDeps & { fileTicket: ReturnType<typeof mockFile> } {
  const fileTicket = mockFile()
  return {
    fulfillmentLogCountSince: async () => 0,
    inviteCountSince: async () => 0,
    outcomeBreakdownSince: async () => [],
    fileTicket,
    ...over,
  } as ReviewFunnelCheckDeps & { fileTicket: ReturnType<typeof mockFile> }
}

describe('checkReviewFunnelSilentDrop', () => {
  it('files a ticket when orders fulfilled but zero invites were created', async () => {
    const d = deps({
      fulfillmentLogCountSince: async () => 22,
      inviteCountSince: async () => 0,
      outcomeBreakdownSince: async () => [{ outcome: 'no_email_pii_redacted', count: 22 }],
    })
    const report = await checkReviewFunnelSilentDrop(d)

    expect(report).toMatchObject({ fulfilled: 22, invited: 0, breached: true, ticketId: 42 })
    expect(d.fileTicket).toHaveBeenCalledTimes(1)
    const ticket = d.fileTicket.mock.calls[0]![0]
    expect(ticket.dedupeKey).toBe('review-funnel-silent-drop')
    expect(ticket.suggestion).toContain(`${REVIEW_FUNNEL_CHECK_WINDOW_DAYS} days`)
    expect(ticket.suggestion).toContain('handleOrderFulfilled')
    expect(ticket.suggestion).toContain('no_email_pii_redacted=22')
  })

  it('names the Klaviyo-retry fallback instead of the PII branch when that outcome dominates', async () => {
    const d = deps({
      fulfillmentLogCountSince: async () => 23,
      inviteCountSince: async () => 0,
      outcomeBreakdownSince: async () => [{ outcome: 'no_invite_created', count: 23 }],
    })
    const report = await checkReviewFunnelSilentDrop(d)

    expect(report.breached).toBe(true)
    const ticket = d.fileTicket.mock.calls[0]![0]
    expect(ticket.suggestion).toContain('no_invite_created=23')
    expect(ticket.suggestion).toContain('review-klaviyo-fallback.server.ts')
  })

  it('does nothing when nothing fulfilled in the window', async () => {
    const d = deps({ fulfillmentLogCountSince: async () => 0, inviteCountSince: async () => 0 })
    const report = await checkReviewFunnelSilentDrop(d)

    expect(report).toEqual({ fulfilled: 0, invited: 0, breached: false, ticketId: null, deduped: false })
    expect(d.fileTicket).not.toHaveBeenCalled()
  })

  it('does nothing when invites are flowing normally', async () => {
    const d = deps({ fulfillmentLogCountSince: async () => 10, inviteCountSince: async () => 6 })
    const report = await checkReviewFunnelSilentDrop(d)

    expect(report.breached).toBe(false)
    expect(d.fileTicket).not.toHaveBeenCalled()
  })
})
