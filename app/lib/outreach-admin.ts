/**
 * Pure logic for /admin/outreach, the owner's approve-and-send surface for the
 * outreach pipeline (docs/store-team/outreach-pipeline.md).
 *
 * The send guards themselves live in outreach-core.ts and are shared with the
 * team API; nothing here re-implements them. What lives here is the part the
 * UI needs and the API does not: turning an offsite-scout pitch suggestion
 * into a seeded subject and body, deciding which lifecycle buttons a row may
 * show, and phrasing a blocked send in words the owner can act on.
 *
 * No DB, no SMTP: the effectful half is outreach-admin.server.ts.
 */

import type { ProspectStatus } from '~/lib/outreach-core'

/**
 * Statuses the 'queue' op accepts. Same list the team API enforces, kept here
 * so the page can hide a button it would only be told 409 about, and so both
 * paths move together when the lifecycle changes.
 */
export const QUEUEABLE_STATUSES: readonly ProspectStatus[] = [
  'new', 'researching', 'on_hold', 'queued',
]

export function canQueue(status: string): boolean {
  return (QUEUEABLE_STATUSES as readonly string[]).includes(status)
}

/**
 * Statuses the owner sets by hand, per the pipeline doc. The send path and the
 * inbox poller own every other transition, so the page must not offer them:
 * 'sent' is a consequence of sending, and the replied_* pair is the
 * classifier's verdict, not a button.
 */
export const OWNER_SETTABLE_STATUSES: readonly ProspectStatus[] = [
  'on_hold', 'landed', 'rejected',
]

export function canOwnerSet(status: string): status is ProspectStatus {
  return (OWNER_SETTABLE_STATUSES as readonly string[]).includes(status)
}

export interface SeededDraft {
  subject: string
  body: string
}

/**
 * The offsite-scout writes one pipe-delimited paragraph per pitch:
 *
 *   OFFSITE PITCH -- Outlet (list title): https://url | contact: a@b.com |
 *   angle: ... | draft: Subject: ... <body> | policy note: ...
 *
 * Sometimes the draft segment carries real newlines, sometimes the whole row
 * is a single line. Both shapes are in production, so the parser works on
 * label boundaries rather than on lines, and a label counts at a pipe or at
 * the start of a line.
 */
const LABEL_BOUNDARY = String.raw`(?:^|\||\n)\s*`
const DRAFT_LABEL = new RegExp(`${LABEL_BOUNDARY}(?:draft(?:\\s+copy)?|pitch(?:\\s+copy)?|body|email)\\s*:\\s*`, 'i')

/**
 * Sections that are notes to the owner, not part of the email. Everything from
 * the first one onward is cut: a pitch that ships its own policy note to the
 * recipient is worse than one with no seed at all.
 */
const TRAILING_LABEL = new RegExp(
  `${LABEL_BOUNDARY}(?:policy note|policy|residual risk|contact|contact path|target|target url|angle|why|rationale|notes?)\\s*:`,
  'i',
)

const SUBJECT_LABEL = new RegExp(`${LABEL_BOUNDARY}subject\\s*:\\s*`, 'i')

/**
 * Where an inline subject ends when it is not terminated by a newline: the
 * first sentence break followed by a capital, which is where the greeting
 * starts. Not a parser, a heuristic, and the owner sees the raw suggestion
 * next to the composer precisely because it can guess wrong.
 */
const INLINE_SUBJECT_END = /[.!?]\s+(?=[A-Z])/

/**
 * Seed the composer from an offsite-scout pitch suggestion.
 *
 * Deliberately conservative. When the text has no recognizable subject the
 * subject comes back empty rather than invented, because the owner sending a
 * pitch under a subject line Claude made up is exactly the failure this page
 * exists to prevent. Same for the body: nothing recognized means the whole
 * text is offered as a starting point, visibly rough, rather than silently
 * trimmed to something that reads finished but is missing a paragraph.
 */
export function seedDraftFromSuggestion(text: string | null | undefined): SeededDraft {
  if (!text || !text.trim()) return { subject: '', body: '' }

  const normalized = text.replace(/\r\n/g, '\n')

  // 1. Narrow to the draft segment when the row labels one.
  const draftMatch = normalized.match(DRAFT_LABEL)
  let segment = draftMatch
    ? normalized.slice(draftMatch.index! + draftMatch[0].length)
    : normalized

  // 2. Drop the owner-facing trailer.
  const trailer = segment.match(TRAILING_LABEL)
  if (trailer) segment = segment.slice(0, trailer.index)

  // 3. Lift the subject out of the front of the segment. It usually sits
  //    inside the draft ("draft: Subject: ..."), but some rows put it in the
  //    preamble above the draft label, so fall back to the text before the
  //    label rather than losing a subject the scout did write.
  let subject = ''
  const subjectMatch = segment.match(SUBJECT_LABEL)
  if (subjectMatch) {
    const after = segment.slice(subjectMatch.index! + subjectMatch[0].length)
    const end = subjectEnd(after)
    subject = tidySubject(after.slice(0, end))
    segment = segment.slice(0, subjectMatch.index) + after.slice(end)
  } else if (draftMatch) {
    const preamble = normalized.slice(0, draftMatch.index)
    const preMatch = preamble.match(SUBJECT_LABEL)
    if (preMatch) {
      const after = preamble.slice(preMatch.index! + preMatch[0].length)
      subject = tidySubject(after.slice(0, subjectEnd(after)))
    }
  }

  return { subject, body: segment.trim() }
}

/** Where the subject stops: the line break, or the inline sentence break. */
function subjectEnd(after: string): number {
  const newlineAt = after.indexOf('\n')
  if (newlineAt !== -1) return newlineAt
  const inline = after.match(INLINE_SUBJECT_END)
  return inline ? inline.index! + 1 : after.length
}

function tidySubject(raw: string): string {
  return raw.trim().replace(/[.\s]+$/, '')
}

export interface PitchTarget {
  /** Best guess at the outlet's domain, or null when the text names none. */
  domain: string | null
  /** Contact address when the pitch names one. */
  email: string | null
  /** How to reach them, inferred from the contact note. */
  channel: 'email' | 'form' | 'dm'
  /** Outlet name for the prospect row, when the headline gives one. */
  name: string | null
}

const OUR_DOMAIN = 'xdipx.com'
const URL_RE = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi
const EMAIL_RE = /[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi
/** A bare domain in a contact note ("contact form at carasutra.com/contact/"). */
const BARE_DOMAIN_RE = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|co|uk|io|shop|store|blog|news))\b/gi

/**
 * Pull the prospect fields out of a drafted pitch so the owner can adopt it
 * into the pipeline in one click instead of retyping what the scout already
 * researched. Every field is a guess shown in an editable form; nothing here
 * writes anything on its own.
 */
export function extractPitchTarget(text: string | null | undefined): PitchTarget {
  const empty: PitchTarget = { domain: null, email: null, channel: 'email', name: null }
  if (!text) return empty

  const notOurs = (host: string) => !host.toLowerCase().endsWith(OUR_DOMAIN)
  const clean = (host: string) => host.toLowerCase().replace(/^www\./, '').replace(/[.,)]+$/, '')

  let domain: string | null = null
  for (const m of text.matchAll(URL_RE)) {
    const host = clean(m[1]!)
    if (notOurs(host)) { domain = host; break }
  }

  let email: string | null = null
  for (const m of text.matchAll(EMAIL_RE)) {
    if (notOurs(m[1]!)) { email = m[0]!.toLowerCase().replace(/[.,)]+$/, ''); break }
  }

  if (!domain && email) domain = clean(email.split('@')[1]!)
  if (!domain) {
    for (const m of text.matchAll(BARE_DOMAIN_RE)) {
      const host = clean(m[1]!)
      if (notOurs(host)) { domain = host; break }
    }
  }

  // The contact note says how to reach them when there is no address.
  const contactNote = text.match(/contact\s*:\s*([^|\n]{0,160})/i)?.[1] ?? ''
  const channel: PitchTarget['channel'] = email
    ? 'email'
    : /\bdm\b|direct message|instagram|twitter/i.test(contactNote)
      ? 'dm'
      : /form/i.test(contactNote)
        ? 'form'
        : 'email'

  // "OFFSITE PITCH -- PureWow (Where to Buy...)" -> "PureWow"
  const name = text
    .match(/OFFSITE PITCH\s*[-–—]{1,2}\s*([^(:|\n]{1,80})/i)?.[1]
    ?.trim()
    .replace(/[,\s]+$/, '') || null

  return { domain, email, channel, name }
}

/**
 * One sentence naming what the owner would have to change to make Send work,
 * given the reason string checkSendGuards produced. The guard reasons are
 * written for logs and API callers; these are written for a person looking at
 * a disabled button.
 */
export function describeSendBlock(reason: string): string {
  if (reason.includes('outreach_send_enabled')) {
    return 'Sending is off. Turn the valve on above to send from this page.'
  }
  if (reason.startsWith('daily send cap')) {
    return `${reason}. Raise the cap above, or send the rest tomorrow.`
  }
  if (reason.includes("not 'queued'")) {
    return `${reason}. Queue this prospect first.`
  }
  if (reason.includes('no contact_email')) {
    return 'This prospect has no contact email. Add one before sending.'
  }
  if (reason.includes('within')) {
    return `${reason}. The quiet period protects the prospect from a second pitch.`
  }
  return reason
}

/** Short relative age, matching the vocabulary the blockers page uses. */
export function agePhrase(from: Date | string | null, now = new Date()): string {
  if (!from) return '—'
  const then = typeof from === 'string' ? new Date(from) : from
  const ms = now.getTime() - then.getTime()
  if (!Number.isFinite(ms)) return '—'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `${hours}h`
  return 'just now'
}
