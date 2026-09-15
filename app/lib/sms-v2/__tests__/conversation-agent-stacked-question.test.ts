/**
 * app/lib/sms-v2/__tests__/conversation-agent-stacked-question.test.ts
 *
 * Ticket #9528: HARD RULES line 130 ("Ask exactly ONE question per turn. Never
 * stack questions.") already lives in the conversation-agent system prompt and
 * still gets violated. Verified failure: sms_turns 1623 (web channel, first
 * turn of a brand-new DISCOVERY conversation, stage_in=DISCOVERY,
 * intent=OFF_TOPIC) logged emma_msg = "Something good on your mind? What are
 * you looking for today?" — two question marks in one reply.
 *
 * stripStackedQuestions is the deterministic backstop: it counts "?" in the
 * finished reply and, when it finds more than one, keeps only the LAST
 * question sentence and drops the earlier one(s). Heavy server-only imports
 * are mocked so the pure guard can be imported and exercised directly.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/shopify.server', () => ({}))
vi.mock('~/lib/ai-agent/prompt', () => ({ BRAND_VOICE: 'BRAND_VOICE_STUB' }))
vi.mock('../token-log.server', () => ({ logApiTokens: vi.fn() }))
vi.mock('../conversation-history.server', () => ({ loadConversationHistory: vi.fn(async () => []) }))
vi.mock('../slot-extractor.server', () => ({ extractSlots: vi.fn(async () => null) }))

import { stripStackedQuestions } from '../conversation-agent.server'

describe('stripStackedQuestions (#9528)', () => {
  it('catches the verified failure (sms_turns 1623) and keeps only the last question', () => {
    const turn1623 = 'Something good on your mind? What are you looking for today?'
    const result = stripStackedQuestions(turn1623)
    expect(result.caught).toBe(true)
    expect((result.text.match(/\?/g) ?? []).length).toBe(1)
    expect(result.text).toBe('What are you looking for today?')
  })

  it('preserves a leading acknowledgement sentence and keeps only the last question', () => {
    const prose =
      'That combo is tough to find in one box. Which one matters most, quiet or discreet? Or would you rather go bigger?'
    const result = stripStackedQuestions(prose)
    expect(result.caught).toBe(true)
    expect((result.text.match(/\?/g) ?? []).length).toBe(1)
    expect(result.text.startsWith('That combo is tough to find in one box.')).toBe(true)
    expect(result.text.endsWith('Or would you rather go bigger?')).toBe(true)
  })

  it('does NOT fire on a normal single-question reply', () => {
    const prose = 'What matters most to you, power, quiet, or something beginner-friendly?'
    const result = stripStackedQuestions(prose)
    expect(result.caught).toBe(false)
    expect(result.text).toBe(prose)
  })

  it('does NOT fire on a reply with no question at all', () => {
    const prose = 'Got it, queuing it up.'
    const result = stripStackedQuestions(prose)
    expect(result.caught).toBe(false)
    expect(result.text).toBe(prose)
  })

  it('never yields more than one "?" for any stacked input', () => {
    const inputs = [
      'Really?? Are you serious?',
      'One? Two? Three?',
      'Is it discreet? How is it billed? What matters most?',
    ]
    for (const prose of inputs) {
      const result = stripStackedQuestions(prose)
      expect((result.text.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1)
    }
  })

  it('tolerates empty/nullish prose', () => {
    expect(stripStackedQuestions('').caught).toBe(false)
    // @ts-expect-error exercising the nullish guard
    expect(stripStackedQuestions(undefined).caught).toBe(false)
  })
})
