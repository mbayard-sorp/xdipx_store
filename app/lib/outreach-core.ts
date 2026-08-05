/**
 * Pure logic for the outreach pipeline: send guards, reply matching, and the
 * reply classifier prompt. No DB, no SMTP, no IMAP, so every decision the
 * pipeline makes is unit-testable without touching production services.
 * The effectful halves live in outreach.server.ts (send) and
 * outreach-inbox.server.ts (poll).
 */

/** Prospect lifecycle states. Sending requires exactly 'queued'. */
export const PROSPECT_STATUSES = [
  'new', 'researching', 'queued', 'sent', 'replied_positive', 'replied_negative',
  'bounced', 'on_hold', 'landed', 'rejected',
] as const
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number]

export function isProspectStatus(v: unknown): v is ProspectStatus {
  return typeof v === 'string' && (PROSPECT_STATUSES as readonly string[]).includes(v)
}

export const CONTACT_CHANNELS = ['email', 'form', 'dm'] as const
export type ContactChannel = (typeof CONTACT_CHANNELS)[number]

/** Minimum quiet period between outbound emails to the same prospect. */
export const DEDUPE_WINDOW_DAYS = 7

export interface SendGuardInput {
  /** The outreach_send_enabled valve, read fresh from pipeline_settings. */
  valveOn: boolean
  /** Outbound messages already sent today (UTC day). */
  sentToday: number
  /** outreach_daily_send_cap. */
  dailyCap: number
  /** The prospect row, or null when the id resolved to nothing. */
  prospect: { status: string; contactEmail: string | null } | null
  /** When the last outbound message to this prospect went out, if ever. */
  lastOutboundAt: Date | null
  now: Date
}

export type SendGuardResult = { ok: true } | { ok: false; reason: string }

/**
 * The hard guards on every outbound send, checked in order. First failure
 * wins so the caller's error names the actual blocker.
 */
export function checkSendGuards(input: SendGuardInput): SendGuardResult {
  if (!input.valveOn) {
    return { ok: false, reason: 'outreach_send_enabled is off' }
  }
  if (input.sentToday >= input.dailyCap) {
    return { ok: false, reason: `daily send cap reached (${input.sentToday}/${input.dailyCap})` }
  }
  if (!input.prospect) {
    return { ok: false, reason: 'prospect not found' }
  }
  if (input.prospect.status !== 'queued') {
    return { ok: false, reason: `prospect status is '${input.prospect.status}', not 'queued'` }
  }
  if (!input.prospect.contactEmail) {
    return { ok: false, reason: 'prospect has no contact_email' }
  }
  if (input.lastOutboundAt) {
    const ageMs = input.now.getTime() - input.lastOutboundAt.getTime()
    if (ageMs < DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      return { ok: false, reason: `already emailed this prospect within ${DEDUPE_WINDOW_DAYS} days` }
    }
  }
  return { ok: true }
}

/** Start of the current UTC day, for the daily-cap count. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * Plain identification footer appended to every outbound email. Kept short
 * and honest: who we are and where we are. postalAddress comes from the
 * OUTREACH_POSTAL_ADDRESS env placeholder.
 */
export function buildFooter(postalAddress?: string): string {
  const lines = ['', '--', 'xdipx.com, editorially curated sexual wellness']
  if (postalAddress) lines.push(postalAddress)
  return lines.join('\n')
}

/**
 * Extract every RFC 5322 message-id token ("<...>") from a header value.
 * References can carry many ids separated by whitespace; In-Reply-To usually
 * carries one. Ids are normalized to include their angle brackets.
 */
export function extractMessageIds(header: string | null | undefined): string[] {
  if (!header) return []
  return header.match(/<[^<>\s]+>/g) ?? []
}

/**
 * Match an inbound message against our stored outbound Message-IDs by
 * In-Reply-To and References. Returns the first known id it references, or
 * null when the message is not part of any outreach thread. Null means the
 * poller must leave the message completely untouched: hello@ is also the
 * live support inbox.
 */
export function matchOutreachReply(
  headers: { inReplyTo?: string | null; references?: string | null },
  knownMessageIds: ReadonlySet<string>,
): string | null {
  if (knownMessageIds.size === 0) return null
  for (const id of extractMessageIds(headers.inReplyTo)) {
    if (knownMessageIds.has(id)) return id
  }
  for (const id of extractMessageIds(headers.references)) {
    if (knownMessageIds.has(id)) return id
  }
  return null
}

export const REPLY_CLASSIFICATIONS = ['positive', 'negative', 'neutral', 'auto_reply'] as const
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number]

export const CLASSIFY_SYSTEM_PROMPT =
  'You classify replies to a guest-post or brand-partnership outreach email. ' +
  'Answer with exactly one word: positive (they are interested, want to proceed, or ask for the draft), ' +
  'negative (they decline, ask us to stop, or reject the pitch), ' +
  'auto_reply (out-of-office, autoresponder, or delivery notification), ' +
  'or neutral (anything else, including questions that are neither a yes nor a no).'

/** The one-word classification user prompt. Truncates long bodies. */
export function buildClassifyPrompt(input: { subject: string | null; bodyText: string }): string {
  const body = input.bodyText.length > 4000 ? `${input.bodyText.slice(0, 4000)}...` : input.bodyText
  return `Subject: ${input.subject ?? '(none)'}\n\n${body}\n\nOne word:`
}

/**
 * Parse the model's one-word answer. Anything unrecognized degrades to
 * 'neutral', which never triggers an owner alert and never closes a prospect.
 */
export function parseClassification(raw: string): ReplyClassification {
  const word = raw.trim().toLowerCase().replace(/[^a-z_]/g, '')
  return (REPLY_CLASSIFICATIONS as readonly string[]).includes(word)
    ? (word as ReplyClassification)
    : 'neutral'
}

/** The prospect status a classified reply moves the row to. */
export function statusForClassification(c: ReplyClassification): ProspectStatus | null {
  if (c === 'positive') return 'replied_positive'
  if (c === 'negative') return 'replied_negative'
  return null // neutral and auto_reply leave the status alone
}
