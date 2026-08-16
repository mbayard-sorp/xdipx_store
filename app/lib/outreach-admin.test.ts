// Unit tests for the pure half of /admin/outreach: seeding the composer from
// an offsite-scout pitch suggestion, the lifecycle buttons the page may show,
// and the owner-facing phrasing of a blocked send. The seeding tests carry the
// weight here: the whole point of the page is that the owner sends what he
// read, so a seeder that silently drops a paragraph or invents a subject is
// the one bug that matters.
import { describe, it, expect } from 'vitest'

import {
  agePhrase,
  canOwnerSet,
  canQueue,
  describeSendBlock,
  extractPitchTarget,
  OWNER_SETTABLE_STATUSES,
  seedDraftFromSuggestion,
} from './outreach-admin'
import { checkSendGuards, PROSPECT_STATUSES } from './outreach-core'

describe('canQueue', () => {
  it('accepts the pre-send states and rejects everything downstream', () => {
    expect(canQueue('new')).toBe(true)
    expect(canQueue('researching')).toBe(true)
    expect(canQueue('on_hold')).toBe(true)
    expect(canQueue('queued')).toBe(true)
    expect(canQueue('sent')).toBe(false)
    expect(canQueue('replied_positive')).toBe(false)
    expect(canQueue('replied_negative')).toBe(false)
    expect(canQueue('landed')).toBe(false)
    expect(canQueue('rejected')).toBe(false)
    expect(canQueue('bounced')).toBe(false)
  })
})

describe('canOwnerSet', () => {
  it('offers only the hand-set states', () => {
    for (const s of OWNER_SETTABLE_STATUSES) expect(canOwnerSet(s)).toBe(true)
  })

  it('never offers a status the pipeline owns', () => {
    // 'sent' is a consequence of sending and the replied_* pair is the
    // classifier's verdict; a button for either would let the page lie about
    // what happened on the wire.
    for (const s of ['sent', 'replied_positive', 'replied_negative', 'bounced', 'new', 'researching', 'queued']) {
      expect(canOwnerSet(s)).toBe(false)
    }
  })

  it('only names real lifecycle states', () => {
    for (const s of OWNER_SETTABLE_STATUSES) {
      expect(PROSPECT_STATUSES as readonly string[]).toContain(s)
    }
  })
})

describe('seedDraftFromSuggestion', () => {
  const FULL = [
    'OFFSITE PITCH: theestablishment.example - "Best sex toy shops 2026" roundup',
    'Target URL: https://theestablishment.example/best-shops',
    'Contact: editor@theestablishment.example',
    'Subject: An editorially curated shop for your 2026 roundup',
    'Draft:',
    'Hi there,',
    '',
    'I run xdipx.com, a small sexual wellness shop where every product is picked',
    'and written up by hand rather than dumped from a feed.',
    '',
    'Thanks for reading,',
    'Mike',
    'Policy note: earned coverage only, no paid placement offered.',
  ].join('\n')

  it('pulls the subject off the Subject line', () => {
    expect(seedDraftFromSuggestion(FULL).subject)
      .toBe('An editorially curated shop for your 2026 roundup')
  })

  it('starts the body after the draft label and keeps the whole pitch', () => {
    const { body } = seedDraftFromSuggestion(FULL)
    expect(body.startsWith('Hi there,')).toBe(true)
    expect(body).toContain('picked')
    expect(body.endsWith('Mike')).toBe(true)
  })

  it('drops the owner-facing trailer so it cannot ship to the recipient', () => {
    const { body } = seedDraftFromSuggestion(FULL)
    expect(body).not.toContain('Policy note')
    expect(body).not.toContain('Target URL')
    expect(body).not.toContain('Contact:')
  })

  it('treats a subject line as the body boundary when there is no draft label', () => {
    const text = [
      'Subject: A quick note about your roundup',
      'Hi there,',
      'We would fit the list.',
    ].join('\n')
    expect(seedDraftFromSuggestion(text)).toEqual({
      subject: 'A quick note about your roundup',
      body: 'Hi there,\nWe would fit the list.',
    })
  })

  it('never invents a subject', () => {
    const { subject, body } = seedDraftFromSuggestion('Hi there,\n\nWe would fit your list.')
    expect(subject).toBe('')
    expect(body).toBe('Hi there,\n\nWe would fit your list.')
  })

  it('offers the whole text rather than a silent trim when nothing is labelled', () => {
    const text = 'Some rough notes.\nA second line that is still part of the idea.'
    expect(seedDraftFromSuggestion(text).body).toBe(text)
  })

  it('handles CRLF and empty input', () => {
    expect(seedDraftFromSuggestion('Subject: Hello\r\nDraft:\r\nHi,\r\nBye').body).toBe('Hi,\nBye')
    expect(seedDraftFromSuggestion('')).toEqual({ subject: '', body: '' })
    expect(seedDraftFromSuggestion(null)).toEqual({ subject: '', body: '' })
    expect(seedDraftFromSuggestion(undefined)).toEqual({ subject: '', body: '' })
  })
})

// The two shapes actually in the suggestions table, shortened but structurally
// verbatim: #144 is one single line, #1245 carries real newlines inside the
// draft segment. A seeder that only handles one of them ships a broken
// composer for half the backlog.
const ROW_144 = 'OFFSITE PITCH — PureWow (Where to Buy Sex Toys Online: 15 Stores): '
  + 'https://www.purewow.com/wellness/buy-sex-toys-online | contact: candace@purewow.com '
  + '(Candace Davison, VP Editorial Content) | angle: add xdipx to the discretion-tested '
  + 'buy-roundup | draft: Subject: A discreet, hand-curated shop for your guide. '
  + 'Hi Candace, I run editorial at xdipx.com. Warmly, [your name] — hello@xdipx.com | '
  + 'policy note: Owned/earned editorial PR, not a gatekept ad platform.'

const ROW_1245 = [
  'OFFSITE PITCH -- Cara Sutra (READY row, owner-vetted 2026-08-01): https://carasutra.com/contact/ ',
  '| contact: contact form at carasutra.com/contact/ (free contributed-article lane) ',
  '| angle: offer one original answer-shaped buying guide ',
  '| draft: Subject: Guest article: an answer-shaped buying guide for your readers',
  '',
  'Hi Cara Sutra team,',
  '',
  'I look after editorial at xdipx.com. Would any of those angles suit you?',
  '',
  'Warmly,',
  'The xdipx editorial team',
  '',
  'policy note: Owned/earned channel, earned coverage only, we never pay for a link.',
].join('\n')

describe('seedDraftFromSuggestion, against the real suggestion format', () => {
  it('parses the single-line pipe-delimited row', () => {
    const { subject, body } = seedDraftFromSuggestion(ROW_144)
    expect(subject).toBe('A discreet, hand-curated shop for your guide')
    expect(body.startsWith('Hi Candace,')).toBe(true)
    expect(body).toContain('Warmly,')
  })

  it('keeps the owner-facing segments out of the single-line row', () => {
    const { body } = seedDraftFromSuggestion(ROW_144)
    expect(body).not.toContain('policy note')
    expect(body).not.toContain('OFFSITE PITCH')
    expect(body).not.toContain('candace@purewow.com')
    expect(body).not.toContain('angle:')
  })

  it('parses the multi-line row and keeps its paragraphs', () => {
    const { subject, body } = seedDraftFromSuggestion(ROW_1245)
    expect(subject).toBe('Guest article: an answer-shaped buying guide for your readers')
    expect(body.startsWith('Hi Cara Sutra team,')).toBe(true)
    expect(body).toContain('\n\n')
    expect(body.endsWith('The xdipx editorial team')).toBe(true)
    expect(body).not.toContain('policy note')
  })
})

describe('extractPitchTarget', () => {
  it('reads outlet, domain, and contact off a pitch with an email', () => {
    expect(extractPitchTarget(ROW_144)).toEqual({
      domain: 'purewow.com',
      email: 'candace@purewow.com',
      channel: 'email',
      name: 'PureWow',
    })
  })

  it('falls back to the form channel when the pitch names no address', () => {
    const t = extractPitchTarget(ROW_1245)
    expect(t.domain).toBe('carasutra.com')
    expect(t.email).toBeNull()
    expect(t.channel).toBe('form')
    expect(t.name).toBe('Cara Sutra')
  })

  it('never adopts our own domain or our own address as the target', () => {
    const t = extractPitchTarget('OFFSITE PITCH -- Someone: https://xdipx.com/notebook | contact: hello@xdipx.com | draft: hi')
    expect(t.domain).toBeNull()
    expect(t.email).toBeNull()
  })

  it('returns empties rather than guesses on unusable text', () => {
    expect(extractPitchTarget('')).toEqual({ domain: null, email: null, channel: 'email', name: null })
    expect(extractPitchTarget(null).domain).toBeNull()
  })
})

describe('describeSendBlock', () => {
  const now = new Date('2026-08-16T12:00:00Z')

  function reasonFor(over: Parameters<typeof checkSendGuards>[0]): string {
    const r = checkSendGuards(over)
    if (r.ok) throw new Error('expected a blocked send')
    return r.reason
  }

  it('turns every real guard reason into an actionable sentence', () => {
    const base = {
      valveOn: true,
      sentToday: 0,
      dailyCap: 5,
      prospect: { status: 'queued', contactEmail: 'a@b.com' },
      lastOutboundAt: null,
      now,
    }

    expect(describeSendBlock(reasonFor({ ...base, valveOn: false })))
      .toContain('Turn the valve on')
    expect(describeSendBlock(reasonFor({ ...base, sentToday: 5 })))
      .toContain('Raise the cap')
    expect(describeSendBlock(reasonFor({ ...base, prospect: { status: 'new', contactEmail: 'a@b.com' } })))
      .toContain('Queue this prospect first')
    expect(describeSendBlock(reasonFor({ ...base, prospect: { status: 'queued', contactEmail: null } })))
      .toContain('no contact email')
    expect(describeSendBlock(reasonFor({ ...base, lastOutboundAt: new Date('2026-08-14T12:00:00Z') })))
      .toContain('quiet period')
  })

  it('passes an unrecognized reason through rather than swallowing it', () => {
    expect(describeSendBlock('prospect not found')).toBe('prospect not found')
  })
})

describe('agePhrase', () => {
  const now = new Date('2026-08-16T12:00:00Z')

  it('reads in days, then hours, then just now', () => {
    expect(agePhrase(new Date('2026-08-13T12:00:00Z'), now)).toBe('3d')
    expect(agePhrase(new Date('2026-08-16T09:00:00Z'), now)).toBe('3h')
    expect(agePhrase(new Date('2026-08-16T11:59:00Z'), now)).toBe('just now')
    expect(agePhrase(null, now)).toBe('—')
  })

  it('accepts the ISO strings a loader serializes', () => {
    expect(agePhrase('2026-08-14T12:00:00Z', now)).toBe('2d')
  })
})
