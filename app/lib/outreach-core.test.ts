// Unit tests for the pure outreach logic: send guards (valve, cap, dedupe),
// reply matching by In-Reply-To/References, the classification prompt shape,
// and the one-word answer parser. The effectful halves (SMTP send, IMAP poll)
// are deliberately not exercised here; their contracts are non-throwing by
// construction and they run against production services.
import { describe, it, expect } from 'vitest'

import {
  buildClassifyPrompt,
  buildFooter,
  checkSendGuards,
  CLASSIFY_SYSTEM_PROMPT,
  DEDUPE_WINDOW_DAYS,
  extractMessageIds,
  inboundDedupeKey,
  matchOutreachReply,
  parseClassification,
  statusForClassification,
  utcDayStart,
  type SendGuardInput,
} from './outreach-core'

const NOW = new Date('2026-08-05T18:00:00Z')

function guardInput(overrides: Partial<SendGuardInput> = {}): SendGuardInput {
  return {
    valveOn: true,
    sentToday: 0,
    dailyCap: 5,
    prospect: { status: 'queued', contactEmail: 'media@example.com' },
    lastOutboundAt: null,
    now: NOW,
    ...overrides,
  }
}

describe('checkSendGuards', () => {
  it('passes when every guard is satisfied', () => {
    expect(checkSendGuards(guardInput())).toEqual({ ok: true })
  })

  it('blocks when the valve is off, before anything else', () => {
    const r = checkSendGuards(guardInput({ valveOn: false, prospect: null }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('outreach_send_enabled')
  })

  it('blocks at the daily cap', () => {
    const r = checkSendGuards(guardInput({ sentToday: 5, dailyCap: 5 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('cap')
  })

  it('blocks a cap of zero even for the first send of the day', () => {
    expect(checkSendGuards(guardInput({ sentToday: 0, dailyCap: 0 })).ok).toBe(false)
  })

  it('blocks a missing prospect', () => {
    const r = checkSendGuards(guardInput({ prospect: null }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('not found')
  })

  it('blocks every non-queued status', () => {
    for (const status of ['new', 'sent', 'replied_positive', 'on_hold', 'rejected']) {
      const r = checkSendGuards(guardInput({ prospect: { status, contactEmail: 'a@b.co' } }))
      expect(r.ok).toBe(false)
    }
  })

  it('blocks a queued prospect with no contact email', () => {
    const r = checkSendGuards(guardInput({ prospect: { status: 'queued', contactEmail: null } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('contact_email')
  })

  it('blocks a second send inside the dedupe window', () => {
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000)
    const r = checkSendGuards(guardInput({ lastOutboundAt: sixDaysAgo }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(`${DEDUPE_WINDOW_DAYS} days`)
  })

  it('allows a send once the dedupe window has fully elapsed', () => {
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000)
    expect(checkSendGuards(guardInput({ lastOutboundAt: eightDaysAgo }))).toEqual({ ok: true })
  })
})

describe('utcDayStart', () => {
  it('returns UTC midnight of the given instant', () => {
    expect(utcDayStart(new Date('2026-08-05T23:59:59Z')).toISOString())
      .toBe('2026-08-05T00:00:00.000Z')
    expect(utcDayStart(new Date('2026-08-05T00:00:00Z')).toISOString())
      .toBe('2026-08-05T00:00:00.000Z')
  })
})

describe('buildFooter', () => {
  it('identifies the sender and carries the postal address when set', () => {
    const f = buildFooter('123 Example St, Somewhere, CA 90000')
    expect(f).toContain('xdipx.com')
    expect(f).toContain('123 Example St')
  })

  it('omits the postal line when the env placeholder is unset', () => {
    expect(buildFooter(undefined)).toContain('xdipx.com')
    expect(buildFooter(undefined)).not.toContain('undefined')
  })

  it('contains no em-dashes', () => {
    expect(buildFooter('addr')).not.toContain('\u2014')
  })
})

describe('extractMessageIds', () => {
  it('pulls every angle-bracketed id from a References header', () => {
    const ids = extractMessageIds('<a@x.com> <b@y.com>\t<c@z.com>')
    expect(ids).toEqual(['<a@x.com>', '<b@y.com>', '<c@z.com>'])
  })

  it('returns empty for null, undefined, and id-free strings', () => {
    expect(extractMessageIds(null)).toEqual([])
    expect(extractMessageIds(undefined)).toEqual([])
    expect(extractMessageIds('no ids here')).toEqual([])
  })
})

describe('matchOutreachReply', () => {
  const known = new Set(['<out-1@xdipx.com>', '<out-2@xdipx.com>'])

  it('matches by In-Reply-To', () => {
    expect(matchOutreachReply({ inReplyTo: '<out-1@xdipx.com>' }, known))
      .toBe('<out-1@xdipx.com>')
  })

  it('falls back to References when In-Reply-To is absent', () => {
    expect(matchOutreachReply(
      { references: '<other@a.com> <out-2@xdipx.com>' },
      known,
    )).toBe('<out-2@xdipx.com>')
  })

  it('prefers In-Reply-To over References', () => {
    expect(matchOutreachReply(
      { inReplyTo: '<out-1@xdipx.com>', references: '<out-2@xdipx.com>' },
      known,
    )).toBe('<out-1@xdipx.com>')
  })

  it('returns null for unrelated mail, so support email is never touched', () => {
    expect(matchOutreachReply(
      { inReplyTo: '<customer@gmail.com>', references: '<thread@gmail.com>' },
      known,
    )).toBeNull()
    expect(matchOutreachReply({}, known)).toBeNull()
    expect(matchOutreachReply({ inReplyTo: '<out-1@xdipx.com>' }, new Set())).toBeNull()
  })
})

describe('inboundDedupeKey', () => {
  it('prefers the Message-ID when the sender provided one', () => {
    expect(inboundDedupeKey({ messageId: '<reply@partner.com>', uidValidity: 42n, uid: 7 }))
      .toBe('<reply@partner.com>')
  })

  // The bug this guards against: a matched reply with no Message-ID was
  // re-inserted, re-classified, and re-alerted on every poll. The fallback
  // key must be stable across polls (same uidvalidity + uid = same key).
  it('falls back to stable IMAP coordinates when the Message-ID is absent', () => {
    const key = inboundDedupeKey({ messageId: null, uidValidity: 1234n, uid: 567 })
    expect(key).toBe('imap:1234:567')
    // Same message on the next poll produces the identical key.
    expect(inboundDedupeKey({ messageId: null, uidValidity: 1234n, uid: 567 })).toBe(key)
    // A different message never collides.
    expect(inboundDedupeKey({ messageId: null, uidValidity: 1234n, uid: 568 })).not.toBe(key)
  })

  it('still yields a usable key when uidvalidity is unavailable', () => {
    expect(inboundDedupeKey({ messageId: null, uidValidity: undefined, uid: 9 }))
      .toBe('imap:unknown:9')
  })
})

describe('classification prompt', () => {
  it('asks for exactly one word and names all four labels', () => {
    for (const label of ['positive', 'negative', 'neutral', 'auto_reply']) {
      expect(CLASSIFY_SYSTEM_PROMPT).toContain(label)
    }
    expect(CLASSIFY_SYSTEM_PROMPT).toContain('one word')
  })

  it('includes subject and body and truncates very long bodies', () => {
    const p = buildClassifyPrompt({ subject: 'Re: Guest post', bodyText: 'Sounds great, send the draft.' })
    expect(p).toContain('Re: Guest post')
    expect(p).toContain('send the draft')
    const long = buildClassifyPrompt({ subject: null, bodyText: 'x'.repeat(10000) })
    expect(long.length).toBeLessThan(5000)
  })
})

describe('parseClassification', () => {
  it('accepts each label, case-insensitively, with punctuation noise', () => {
    expect(parseClassification('positive')).toBe('positive')
    expect(parseClassification('  Negative.\n')).toBe('negative')
    expect(parseClassification('AUTO_REPLY')).toBe('auto_reply')
    expect(parseClassification('neutral')).toBe('neutral')
  })

  it('degrades anything unrecognized to neutral', () => {
    expect(parseClassification('maybe interested?')).toBe('neutral')
    expect(parseClassification('')).toBe('neutral')
  })
})

describe('statusForClassification', () => {
  it('maps replies onto prospect statuses, leaving neutral and auto_reply alone', () => {
    expect(statusForClassification('positive')).toBe('replied_positive')
    expect(statusForClassification('negative')).toBe('replied_negative')
    expect(statusForClassification('neutral')).toBeNull()
    expect(statusForClassification('auto_reply')).toBeNull()
  })
})
