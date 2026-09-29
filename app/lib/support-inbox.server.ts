/**
 * Autonomous inbound-support-email pipeline (ticket #12095, tracker
 * p2-4-support). The `.claude/agents/customer-service-emma.md` autonomy note
 * asks for exactly this: IMAP poll or webhook -> Express endpoint -> Anthropic
 * SDK -> the agent's system prompt, replies draft-only until the owner
 * graduates it.
 *
 * DRAFT-ONLY BY DESIGN: this module never sends an email and never calls
 * Shopify Admin. It reads the mailbox, writes one `support_messages` row per
 * genuine inbound message with a drafted reply, and emails the owner so a
 * human can act on it. Taking the live actions `customer-service-emma.md`
 * describes (refunds, cancellations, draft orders) from an unattended cron is
 * a deliberately separate, later, owner-gated step -- not this ticket's scope.
 *
 * CRITICAL SAFETY: hello@xdipx.com is also the outreach-reply mailbox
 * (`outreach-inbox.server.ts`) and the human-monitored support inbox. This
 * poller shares that file's read-only contract and its exact IMAP credential
 * resolution (`resolveImapConfig`/`createImapClient`, re-exported from there
 * rather than duplicated):
 *   - every fetch uses BODY.PEEK (uid fetch / mailbox opened read-only) so
 *     nothing is ever marked \Seen,
 *   - it never deletes, never moves, never flags any message,
 *   - it skips any message that matches an outreach thread (`matchOutreachReply`),
 *     so outreach replies stay exactly outreach-inbox.server.ts's job and are
 *     never double-drafted here.
 *
 * Gated by the `support_inbox_enabled` pipeline setting (default OFF, same
 * off-until-armed shape as every other autonomous pipeline in this repo). No
 * dedicated admin toggle exists yet -- out of scope for this ticket's DONE
 * WHEN -- so the owner flips it via the existing generic
 * `POST /admin/settings` (`intent=save-setting`, `key=support_inbox_enabled`,
 * `value=true`) action in `app/routes/admin.settings.tsx`.
 */

import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { outreachMessages, supportMessages } from '../../db/schema'
import { matchOutreachReply, inboundDedupeKey } from '~/lib/outreach-core'
import {
  createImapClient,
  headerValue,
  resolveImapConfig,
} from '~/lib/outreach-inbox.server'
import { generateWithSystem } from '~/lib/claude.server'
import { SONNET } from '~/lib/models.server'
import { EMMA_VOICE_SUPPORT } from '~/lib/emma-voice.server'
import { escapeHtml, sendOwnerEmail } from '~/lib/owner-alerts.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'

const LOOKBACK_DAYS = 3
const SUPPORT_INBOX_VALVE_KEY = 'support_inbox_enabled'

export async function isSupportInboxEnabled(): Promise<boolean> {
  return (await getPipelineSetting(SUPPORT_INBOX_VALVE_KEY)) === 'true'
}

/**
 * The task half of the system prompt: what `customer-service-emma.md` adds on
 * top of the voice charter for an unattended run. Mirrors that file's
 * `<must_escalate_to_human>` and `<output_format>` sections; kept in code
 * (not read from the `.claude/agents/*.md` file, which is a Claude Code
 * subagent definition, not a runtime asset the production bundle can read)
 * so a change to the escalation rules is a reviewable diff to this constant,
 * the same way every other production Emma prompt works.
 */
const SUPPORT_TASK_PROMPT = `You are handling one inbound email to hello@xdipx.com, xdipx's customer support inbox. This run is UNATTENDED and DRAFT-ONLY: you have no ability to look up orders, issue refunds, cancel orders, or take any Shopify action. Never claim you did one. Write a draft a human support agent can send after checking the account, not a confirmation of something already done.

Escalate (start the reply with "[NEEDS HUMAN REVIEW: reason]") rather than draft normally when the email:
- reports product safety, injury, or an allergic reaction
- mentions a chargeback, fraud claim, attorney, or a regulator (FTC, AG, etc.)
- asks for a refund or action you cannot evaluate without account access
- raises a privacy or data-deletion request beyond an unsubscribe
- reads as abusive, threatening, or in real distress
- is anything else you are not confident handling

Otherwise, draft a short, warm reply: acknowledge what they asked, say plainly what a human will check or do next, and sign off as "Emma". Keep it tight. Do not repeat explicit product names back to the shopper; refer to "your recent order" instead.

Reply with the draft text only, no preamble, no subject line.`

const SUPPORT_SYSTEM_PROMPT = `${EMMA_VOICE_SUPPORT}\n\n${SUPPORT_TASK_PROMPT}`

export interface SupportDraft {
  replyText: string
  needsHumanReview: boolean
}

/** One Claude call: the inbound email in, a draft-only reply out. Never throws. */
export async function draftSupportReply(input: {
  fromEmail: string | null
  subject: string | null
  bodyText: string
}): Promise<SupportDraft> {
  const user = [
    `From: ${input.fromEmail ?? '(unknown)'}`,
    `Subject: ${input.subject ?? '(no subject)'}`,
    '',
    input.bodyText.slice(0, 8000),
  ].join('\n')
  const replyText = await generateWithSystem({
    system: SUPPORT_SYSTEM_PROMPT,
    user,
    model: SONNET,
    maxTokens: 600,
    timeoutMs: 30000,
    feature: 'support-inbox',
    caller: 'support-inbox-draft',
  })
  return { replyText, needsHumanReview: replyText.trimStart().startsWith('[NEEDS HUMAN REVIEW') }
}

export interface SupportPollResult {
  ok: boolean
  scanned: number
  drafted: number
  error?: string
}

/**
 * Poll the inbox once. Never throws: every failure comes back as
 * { ok: false, error } so the cron handler can report it without retrying
 * against the live support mailbox.
 */
export async function pollSupportInbox(): Promise<SupportPollResult> {
  const result: SupportPollResult = { ok: true, scanned: 0, drafted: 0 }
  try {
    if (!(await isSupportInboxEnabled())) return result

    const cfg = resolveImapConfig()
    if (!cfg) return { ...result, ok: false, error: 'IMAP credentials not configured' }

    // Outreach's own outbound Message-IDs, so an outreach-thread reply is
    // skipped here and left entirely to outreach-inbox.server.ts.
    const outboundIds = new Set(
      (
        await db
          .select({ messageId: outreachMessages.messageId })
          .from(outreachMessages)
          .where(and(eq(outreachMessages.direction, 'out'), isNotNull(outreachMessages.messageId)))
      ).map(r => r.messageId!),
    )

    const seen = new Set(
      (await db.select({ messageId: supportMessages.messageId }).from(supportMessages)).map(r => r.messageId),
    )

    const { simpleParser } = await import('mailparser')
    const client = await createImapClient(cfg)

    await client.connect()
    try {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      try {
        const uidValidity =
          typeof client.mailbox === 'object' && client.mailbox ? client.mailbox.uidValidity : undefined
        const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
        const uids = await client.search({ since }, { uid: true })
        const uidList = Array.isArray(uids) ? uids : []

        for (const uid of uidList) {
          result.scanned++
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

          // Outreach's own reply thread: leave it to outreach-inbox.server.ts.
          if (matchOutreachReply({ inReplyTo, references }, outboundIds)) continue

          const dedupeKey = inboundDedupeKey({ messageId, uidValidity, uid })
          if (seen.has(dedupeKey)) continue

          const full = await client.fetchOne(String(uid), { source: true }, { uid: true })
          const source = full && full.source ? full.source : null
          const parsed = source ? await simpleParser(source) : null
          const subject = parsed?.subject ?? msg.envelope?.subject ?? null
          const bodyText = (parsed?.text ?? '').trim()
          if (!bodyText) continue // nothing to draft against

          const fromEmail =
            parsed?.from?.value?.[0]?.address ?? msg.envelope?.from?.[0]?.address ?? null

          const draft = await draftSupportReply({ fromEmail, subject, bodyText })

          await db.insert(supportMessages).values({
            messageId: dedupeKey,
            fromEmail,
            subject,
            bodyText: bodyText.slice(0, 20000),
            draftReply: draft.replyText,
            needsHumanReview: draft.needsHumanReview,
            receivedAt: parsed?.date ?? msg.envelope?.date ?? new Date(),
          })
          seen.add(dedupeKey)
          result.drafted++

          await sendOwnerEmail(
            `Support draft ready: ${subject ?? '(no subject)'}`,
            [
              `<p>New message at hello@xdipx.com from <strong>${escapeHtml(fromEmail ?? 'unknown')}</strong>.</p>`,
              `<p>Subject: ${escapeHtml(subject ?? '(none)')}</p>`,
              '<p>Draft reply (nothing sent, no action taken):</p>',
              `<pre style="white-space:pre-wrap;">${escapeHtml(draft.replyText)}</pre>`,
              '<p>Original message:</p>',
              `<pre style="white-space:pre-wrap;">${escapeHtml(bodyText.slice(0, 3000))}</pre>`,
              '<p>Reply from hello@xdipx.com directly to send.</p>',
            ].join('\n'),
            { escalation: 'inbox', fromName: 'xdipx support' },
          )
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
    console.error('[support-inbox] poll failed:', msg)
    return { ...result, ok: false, error: msg }
  }
}
