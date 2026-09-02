/**
 * IMAP poll for outreach replies. The ear of the pipeline in
 * docs/store-team/outreach-pipeline.md, run by /cron/outreach-inbox.
 *
 * CRITICAL SAFETY: hello@xdipx.com is also the live support inbox. This
 * poller is read-only towards the mailbox by construction:
 *   - every fetch uses BODY.PEEK (uid fetch with the peek flag) so nothing
 *     is ever marked \Seen,
 *   - it acts ONLY on messages whose In-Reply-To/References match a stored
 *     outbound outreach Message-ID; everything else is ignored untouched,
 *   - it never deletes, never moves, never flags any message.
 *
 * For a matched reply: store the inbound outreach_messages row, classify it
 * with one short Claude call (one-word answer), update the prospect status,
 * and on a positive reply loop the owner in via sendOwnerEmail so the human
 * takes over the thread from his alert addresses.
 */

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { outreachMessages, outreachProspects } from '../../db/schema'
import {
  buildClassifyPrompt,
  CLASSIFY_SYSTEM_PROMPT,
  inboundDedupeKey,
  matchOutreachReply,
  parseClassification,
  statusForClassification,
  type ReplyClassification,
} from '~/lib/outreach-core'
import { generateWithSystem } from '~/lib/claude.server'
import { SONNET } from '~/lib/models.server'
import { escapeHtml, sendOwnerEmail } from '~/lib/owner-alerts.server'

/** How far back the poll looks. Overlapping windows are fine: processed
 * message-ids are skipped by the inbound-dedupe check. */
const LOOKBACK_DAYS = 14

// ---------------------------------------------------------------------------
// Shared IMAP config + client, used by both the poller and the probe
// ---------------------------------------------------------------------------

interface ImapConfig {
  host: string
  port: number
  user: string
  pass: string
}

/**
 * One resolution path for every IMAP consumer: OUTREACH_IMAP_* with fallback
 * to the Zoho SMTP account, defaults imap.zoho.com:993. Null when no usable
 * credentials are configured.
 */
function resolveImapConfig(): ImapConfig | null {
  const host = process.env['OUTREACH_IMAP_HOST'] ?? 'imap.zoho.com'
  const port = parseInt(process.env['OUTREACH_IMAP_PORT'] ?? '993', 10)
  const user = process.env['OUTREACH_IMAP_USER'] ?? process.env['ZOHO_SMTP_USER']
  const pass = process.env['OUTREACH_IMAP_PASS'] ?? process.env['ZOHO_SMTP_PASS']
  if (!user || !pass) return null
  return { host, port, user, pass }
}

type ImapClient = import('imapflow').ImapFlow

/** Identical client setup for the poller and the probe: implicit TLS, no logging. */
async function createImapClient(cfg: ImapConfig): Promise<ImapClient> {
  const { ImapFlow } = await import('imapflow')
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  })
}

export interface OutreachPollResult {
  ok: boolean
  scanned: number
  matched: number
  classified: Partial<Record<ReplyClassification, number>>
  error?: string
}

/**
 * Poll the inbox once. Never throws: every failure comes back as
 * { ok: false, error } so the cron handler can report it without a 500
 * cascading into retries against the live support mailbox.
 */
export async function pollOutreachInbox(): Promise<OutreachPollResult> {
  const result: OutreachPollResult = { ok: true, scanned: 0, matched: 0, classified: {} }
  try {
    // Outbound Message-IDs we have ever sent. No rows = nothing can match,
    // so skip connecting at all.
    const outRows = await db
      .select({ id: outreachMessages.id, prospectId: outreachMessages.prospectId, messageId: outreachMessages.messageId })
      .from(outreachMessages)
      .where(and(eq(outreachMessages.direction, 'out'), isNotNull(outreachMessages.messageId)))
    if (outRows.length === 0) return result

    const knownIds = new Set(outRows.map(r => r.messageId!))
    const prospectByMessageId = new Map(outRows.map(r => [r.messageId!, r.prospectId]))

    // Inbound messages already stored, so a reply is processed exactly once.
    const seenInbound = new Set(
      (
        await db
          .select({ messageId: outreachMessages.messageId })
          .from(outreachMessages)
          .where(and(eq(outreachMessages.direction, 'in'), isNotNull(outreachMessages.messageId)))
      ).map(r => r.messageId!),
    )

    const cfg = resolveImapConfig()
    if (!cfg) {
      return { ...result, ok: false, error: 'IMAP credentials not configured' }
    }

    const { simpleParser } = await import('mailparser')
    const client = await createImapClient(cfg)

    await client.connect()
    try {
      // readOnly mailbox open: even an imapflow bug could not write flags.
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      try {
        // UIDVALIDITY of the opened mailbox, part of the fallback dedupe key
        // for inbound messages that carry no Message-ID header.
        const uidValidity =
          typeof client.mailbox === 'object' && client.mailbox ? client.mailbox.uidValidity : undefined
        const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
        const uids = await client.search({ since }, { uid: true })
        const uidList = Array.isArray(uids) ? uids : []

        for (const uid of uidList) {
          result.scanned++
          // Envelope + headers only first; body is fetched only on a match.
          // headers:['in-reply-to','references','message-id'] arrives via
          // BODY.PEEK[HEADER.FIELDS (...)] so the message stays unseen.
          const msg = await client.fetchOne(
            String(uid),
            { headers: ['in-reply-to', 'references', 'message-id'], envelope: true },
            { uid: true },
          )
          if (!msg || !msg.headers) continue
          const rawHeaders = msg.headers.toString()
          const inReplyTo = headerValue(rawHeaders, 'in-reply-to')
          const references = headerValue(rawHeaders, 'references')
          const messageId = headerValue(rawHeaders, 'message-id')

          const matchedId = matchOutreachReply({ inReplyTo, references }, knownIds)
          if (!matchedId) continue // not ours: leave it completely alone
          // Dedupe on the Message-ID when present, otherwise on the stable
          // IMAP coordinates, so a reply without a Message-ID is still
          // processed exactly once instead of on every poll.
          const dedupeKey = inboundDedupeKey({ messageId, uidValidity, uid })
          if (seenInbound.has(dedupeKey)) continue // already processed

          const prospectId = prospectByMessageId.get(matchedId)
          if (!prospectId) continue
          result.matched++

          // Full body, still via peek (imapflow's `source` download does not
          // set \Seen when the mailbox is opened readOnly).
          const full = await client.fetchOne(String(uid), { source: true }, { uid: true })
          const source = full && full.source ? full.source : null
          const parsed = source ? await simpleParser(source) : null
          const subject = parsed?.subject ?? msg.envelope?.subject ?? null
          const bodyText = (parsed?.text ?? '').trim()

          const classification = await classifyReply(subject, bodyText)
          result.classified[classification] = (result.classified[classification] ?? 0) + 1

          await db.insert(outreachMessages).values({
            prospectId,
            direction: 'in',
            subject,
            bodyText: bodyText.slice(0, 20000),
            messageId: dedupeKey,
            inReplyTo: inReplyTo ?? null,
            referencesHeader: references ?? null,
            classification,
            sentAt: parsed?.date ?? msg.envelope?.date ?? new Date(),
          })
          seenInbound.add(dedupeKey)

          const nextStatus = statusForClassification(classification)
          if (nextStatus) {
            await db
              .update(outreachProspects)
              .set({ status: nextStatus, updatedAt: new Date() })
              .where(and(
                eq(outreachProspects.id, prospectId),
                // Never regress a hand-set terminal state.
                inArray(outreachProspects.status, ['queued', 'sent', 'replied_positive', 'replied_negative']),
              ))
          }

          if (classification === 'positive') {
            const [prospect] = await db
              .select({ domain: outreachProspects.domain, contactEmail: outreachProspects.contactEmail })
              .from(outreachProspects)
              .where(eq(outreachProspects.id, prospectId))
              .limit(1)
            const domain = prospect?.domain ?? `prospect ${prospectId}`
            await sendOwnerEmail(
              `Outreach reply: ${domain} is interested`,
              [
                `<p><strong>${escapeHtml(domain)}</strong> replied positively to our outreach email.</p>`,
                `<p>From: ${escapeHtml(prospect?.contactEmail ?? 'unknown')}<br>`,
                `Subject: ${escapeHtml(subject ?? '(none)')}</p>`,
                `<pre>${escapeHtml(bodyText.slice(0, 3000))}</pre>`,
                '<p>The thread is in hello@xdipx.com. Reply from there to take over.</p>',
              ].join('\n'),
              { escalation: 'inbox', fromName: 'xdipx outreach' },
            )
          }
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => client.close())
    }
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[outreach-inbox] poll failed:', msg)
    return { ...result, ok: false, error: msg }
  }
}

/** Pull one header's value out of a raw HEADER.FIELDS blob (unfolded). */
function headerValue(raw: string, name: string): string | null {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ')
  const re = new RegExp(`^${name}:[ \\t]*(.+)$`, 'im')
  return unfolded.match(re)?.[1]?.trim() ?? null
}

/** One short Claude call; any failure degrades to 'neutral'. */
async function classifyReply(subject: string | null, bodyText: string): Promise<ReplyClassification> {
  try {
    const raw = await generateWithSystem({
      system: CLASSIFY_SYSTEM_PROMPT,
      user: buildClassifyPrompt({ subject, bodyText }),
      model: SONNET,
      maxTokens: 8,
      timeoutMs: 20000,
      feature: 'outreach',
      caller: 'outreach-inbox-classify',
    })
    return parseClassification(raw)
  } catch (err) {
    console.error('[outreach-inbox] classification failed, treating as neutral:', err)
    return 'neutral'
  }
}

/** True when there is at least one outreach_messages row of any direction. */
export async function hasAnyOutreachMessages(): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachMessages)
  return (row?.n ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Connection probe
// ---------------------------------------------------------------------------

export type ImapProbeStage = 'config' | 'connect' | 'auth' | 'mailbox'

export type ImapProbeResult =
  | { ok: true; host: string; port: number; user: string; mailbox: 'INBOX'; messages: number }
  | { ok: false; stage: ImapProbeStage; error: string }

/** Overall wall-clock budget for the probe, connect through logout. */
const PROBE_TIMEOUT_MS = 15000

/**
 * Mask an IMAP login for JSON output: first 2 chars of the local part, then
 * ***, then the @domain when present. hello@xdipx.com -> he***@xdipx.com.
 */
export function maskImapUser(user: string): string {
  const at = user.indexOf('@')
  const local = at >= 0 ? user.slice(0, at) : user
  const domain = at >= 0 ? user.slice(at) : ''
  return `${local.slice(0, 2)}***${domain}`
}

/**
 * Strip credential material from an error message before it leaves the
 * server. Exact-substring replacement, no regex: the secret is data here, not
 * a pattern, and must never be interpreted as one.
 */
export function sanitizeImapError(message: string, secrets: ReadonlyArray<string | undefined>): string {
  let out = message
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]')
  }
  return out
}

/**
 * Classify a probe failure into its stage. imapflow surfaces LOGIN rejections
 * out of connect() (one call does TCP + TLS + LOGIN), so an auth failure has
 * to be told apart from a transport failure by the error's shape rather than
 * by where it was thrown.
 */
export function classifyImapProbeFailure(err: unknown, fallback: ImapProbeStage): ImapProbeStage {
  if (err && typeof err === 'object') {
    const e = err as { authenticationFailed?: unknown; serverResponseCode?: unknown; message?: unknown }
    if (e.authenticationFailed === true) return 'auth'
    if (typeof e.serverResponseCode === 'string' && e.serverResponseCode.toUpperCase() === 'AUTHENTICATIONFAILED') {
      return 'auth'
    }
    const msg = typeof e.message === 'string' ? e.message : ''
    if (/authenticat|invalid credentials|login failed/i.test(msg)) return 'auth'
  }
  return fallback
}

/**
 * Verify the IMAP login end-to-end without waiting for the first outbound
 * send: connect, authenticate, open INBOX read-only, capture the message
 * count, log out. Read-only by construction exactly like the poller, and this
 * probe fetches nothing at all, so no message can ever be marked \Seen.
 *
 * Never throws and never leaks the password: every outcome is a JSON-safe
 * object, error text is sanitized, and the whole probe is capped at 15s.
 */
export async function probeOutreachImap(): Promise<ImapProbeResult> {
  const cfg = resolveImapConfig()
  if (!cfg) return { ok: false, stage: 'config', error: 'IMAP credentials not configured' }

  let stage: ImapProbeStage = 'connect'
  let client: ImapClient | null = null

  const run = async (): Promise<ImapProbeResult> => {
    try {
      client = await createImapClient(cfg)
      await client.connect()
      stage = 'mailbox'
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      let messages = 0
      try {
        const mb = client.mailbox
        messages = typeof mb === 'object' && mb ? mb.exists : 0
      } finally {
        lock.release()
      }
      return { ok: true, host: cfg.host, port: cfg.port, user: maskImapUser(cfg.user), mailbox: 'INBOX', messages }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      return { ok: false, stage: classifyImapProbeFailure(err, stage), error: sanitizeImapError(raw, [cfg.pass]) }
    } finally {
      if (client) await client.logout().catch(() => client?.close())
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ImapProbeResult>((resolve) => {
    timer = setTimeout(() => {
      // Best-effort teardown of whatever the run left hanging; close() is
      // synchronous socket destruction and is safe on a half-open client.
      try {
        client?.close()
      } catch {
        // already gone
      }
      resolve({ ok: false, stage, error: `probe timed out after ${PROBE_TIMEOUT_MS}ms` })
    }, PROBE_TIMEOUT_MS)
  })

  try {
    return await Promise.race([run(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
