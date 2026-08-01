import { describe, expect, it } from 'vitest'
import { isComplianceKeyword, complianceKeyword, STOP_WORDS, START_WORDS, HELP_WORDS } from '~/lib/sms-processor.server'

// processSmsMessageV2 short-circuits carrier-compliance traffic to v1 BEFORE
// stage dispatch (Step 0 in processor.server.ts). These tests pin the keyword
// classification that gate depends on: if a STOP variant stops matching here,
// an opted-out customer would be routed into a sales-stage handler.
describe('compliance keyword classification', () => {
  it('matches every STOP word, case-insensitive, with punctuation and whitespace', () => {
    for (const w of STOP_WORDS) {
      expect(isComplianceKeyword(w)).toBe(true)
      expect(isComplianceKeyword(w.toUpperCase())).toBe(true)
      expect(isComplianceKeyword(`  ${w}! `)).toBe(true)
    }
  })

  it('matches START and HELP words', () => {
    for (const w of START_WORDS) expect(isComplianceKeyword(w)).toBe(true)
    for (const w of HELP_WORDS) expect(isComplianceKeyword(w)).toBe(true)
  })

  it('normalizes to bare a-z keyword shape', () => {
    expect(complianceKeyword(' STOP. ')).toBe('stop')
    expect(complianceKeyword('Un-Subscribe')).toBe('unsubscribe')
  })

  it('does not match ordinary messages that contain a keyword as a substring of a sentence', () => {
    // Multi-word bodies collapse to one long letter string, which is not in
    // any keyword set — "stop sending me lube ads" must NOT be a bare STOP
    // (v1 has always worked this way; carrier keywords are single-word).
    expect(isComplianceKeyword('stop sending me lube ads')).toBe(false)
    expect(isComplianceKeyword('can you help me pick a vibrator')).toBe(false)
    expect(isComplianceKeyword('what is your cancellation policy')).toBe(false)
  })

  it('does not match normal shopping messages', () => {
    expect(isComplianceKeyword('show me wands under $50')).toBe(false)
    expect(isComplianceKeyword('yes')).toBe(false)
    expect(isComplianceKeyword('')).toBe(false)
  })
})
