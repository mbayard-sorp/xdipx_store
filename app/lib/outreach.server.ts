/**
 * Outbound outreach email (guest-post / brand-partnership pitches). The send
 * arm of the pipeline described in docs/store-team/outreach-pipeline.md.
 *
 * Builds its own Zoho SMTP transport the same way owner-alerts.server.ts
 * does (same env vars, same lazy nodemailer import) but is deliberately a
 * separate path: owner alerts are pinned to the owner's addresses and must
 * never grow an external-recipient mode.
 *
 * Every send passes the hard guards in outreach-core.ts, in order:
 *   1. the outreach_send_enabled valve is on (missing row = OFF),
 *   2. today's outbound count is under outreach_daily_send_cap,
 *   3. the prospect exists, is status 'queued', and has a contact_email,
 *   4. no outbound message went to this prospect in the last 7 days.
 * On success the outreach_messages row records the SMTP Message-ID so the
 * inbox poller can recognize replies.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { outreachMessages, outreachProspects, pipelineSettings } from '../../db/schema'
import { buildFooter, checkSendGuards, utcDayStart } from '~/lib/outreach-core'

export const OUTREACH_VALVE_KEY = 'outreach_send_enabled'
export const OUTREACH_CAP_KEY = 'outreach_daily_send_cap'
const DEFAULT_DAILY_CAP = 5

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: pipelineSettings.value })
    .from(pipelineSettings)
    .where(eq(pipelineSettings.key, key))
    .limit(1)
  return row?.value ?? null
}

/** Valve read, uncached: sends are rare and must see a flip immediately. */
export async function isOutreachSendEnabled(): Promise<boolean> {
  return (await readSetting(OUTREACH_VALVE_KEY)) === 'true'
}

export async function getOutreachDailyCap(): Promise<number> {
  const raw = await readSetting(OUTREACH_CAP_KEY)
  const n = raw == null ? NaN : parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP
}

/** Outbound messages sent since UTC midnight. */
export async function countOutboundToday(now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachMessages)
    .where(and(
      eq(outreachMessages.direction, 'out'),
      gte(outreachMessages.sentAt, utcDayStart(now)),
    ))
  return row?.n ?? 0
}

export interface OutreachSendResult {
  sent: boolean
  error?: string
  messageId?: string
}

/**
 * Send one plain-text outreach email to a queued prospect. Non-throwing by
 * contract: guard failures and SMTP failures both come back as
 * { sent: false, error }. On success the prospect moves to 'sent' and the
 * message row carries the SMTP Message-ID.
 */
export async function sendOutreachEmail(input: {
  prospectId: number
  subject: string
  text: string
}): Promise<OutreachSendResult> {
  try {
    const now = new Date()
    const [prospect] = await db
      .select()
      .from(outreachProspects)
      .where(eq(outreachProspects.id, input.prospectId))
      .limit(1)

    const [lastOut] = await db
      .select({ sentAt: outreachMessages.sentAt })
      .from(outreachMessages)
      .where(and(
        eq(outreachMessages.prospectId, input.prospectId),
        eq(outreachMessages.direction, 'out'),
      ))
      .orderBy(desc(outreachMessages.sentAt))
      .limit(1)

    const guard = checkSendGuards({
      valveOn: await isOutreachSendEnabled(),
      sentToday: await countOutboundToday(now),
      dailyCap: await getOutreachDailyCap(),
      prospect: prospect
        ? { status: prospect.status, contactEmail: prospect.contactEmail }
        : null,
      lastOutboundAt: lastOut?.sentAt ?? null,
      now,
    })
    if (!guard.ok) return { sent: false, error: guard.reason }

    const host = process.env['ZOHO_SMTP_HOST'] ?? 'smtp.zoho.com'
    const port = parseInt(process.env['ZOHO_SMTP_PORT'] ?? '465', 10)
    const user = process.env['ZOHO_SMTP_USER']
    const pass = process.env['ZOHO_SMTP_PASS']
    const from = process.env['OUTREACH_FROM'] ?? process.env['EMAIL_FROM'] ?? 'hello@xdipx.com'
    const replyTo = process.env['OUTREACH_REPLY_TO'] ?? from
    if (!user || !pass) {
      return { sent: false, error: 'SMTP credentials not configured' }
    }

    // Lazy dynamic import with a static specifier, same rationale as
    // owner-alerts.server.ts: valid ESM, traceable by Vercel, and a missing
    // package cannot crash module load.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nm: any = null
    try {
      nm = await import('nodemailer')
      nm = nm?.default ?? nm
    } catch (err) {
      return { sent: false, error: `nodemailer could not be loaded: ${String(err)}` }
    }

    const transporter = nm.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    })
    const info = await transporter.sendMail({
      from: `"xdipx" <${from}>`,
      replyTo,
      to: prospect!.contactEmail!,
      subject: input.subject,
      text: input.text + buildFooter(process.env['OUTREACH_POSTAL_ADDRESS']),
    })
    const messageId: string | undefined =
      typeof info?.messageId === 'string' ? info.messageId : undefined

    await db.insert(outreachMessages).values({
      prospectId: input.prospectId,
      direction: 'out',
      subject: input.subject,
      bodyText: input.text,
      messageId: messageId ?? null,
      sentAt: now,
    })
    await db
      .update(outreachProspects)
      .set({ status: 'sent', updatedAt: now })
      .where(eq(outreachProspects.id, input.prospectId))

    const result: OutreachSendResult = { sent: true }
    if (messageId) result.messageId = messageId
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[outreach] send failed:', msg)
    return { sent: false, error: msg }
  }
}
