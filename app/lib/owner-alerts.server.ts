/**
 * Owner alerting channels (p0-6): transactional email via Zoho SMTP and SMS
 * via Twilio. This is ops-facing plumbing for the store owner, not customer
 * messaging. Klaviyo stays customer-facing; nothing here touches consent lists.
 *
 * Both senders are non-throwing by contract: they return { sent, error } so
 * call sites inside healthchecks and cron handlers can fire-and-forget without
 * risking the primary path.
 */

import { sendSms } from '~/lib/twilio.server'
import {
  escalationChannel,
  isPagingClass,
  type EscalationClassName,
  type PagingClass,
} from '~/lib/owner-escalation'

/**
 * The queue valve, read here rather than passed in.
 *
 * Absent means OFF, so every `queue` and `lane` class keeps sending exactly as
 * it does today until the owner queue that replaces them is live and the valve
 * is flipped. A failed read also means off: a settings blip must never silently
 * mute the owner.
 */
const OWNER_QUEUE_SETTING = 'owner_queue_enabled'

let queueEnabledCache: { value: boolean; at: number } | null = null
const QUEUE_CACHE_MS = 60_000

async function ownerQueueEnabled(now = Date.now()): Promise<boolean> {
  if (queueEnabledCache && now - queueEnabledCache.at < QUEUE_CACHE_MS) return queueEnabledCache.value
  try {
    const { getPipelineSetting } = await import('~/lib/feed-processor.server')
    const value = (await getPipelineSetting(OWNER_QUEUE_SETTING)) === 'true'
    queueEnabledCache = { value, at: now }
    return value
  } catch {
    return false
  }
}

/** Test seam: drop the memoised valve read. */
export function resetOwnerQueueCache(): void {
  queueEnabledCache = null
}

/** Fallback recipients, matching the original pricing-report hardcoded pair. */
const DEFAULT_RECIPIENTS = ['mike@xdipx.com', 'mikebayard@me.com']

export function ownerAlertEmails(): string[] {
  const raw = process.env['OWNER_ALERT_EMAILS']
  if (!raw) return DEFAULT_RECIPIENTS
  const list = raw.split(',').map(s => s.trim()).filter(Boolean)
  return list.length > 0 ? list : DEFAULT_RECIPIENTS
}

/** Minimal HTML escape for interpolating plain text into alert emails. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface OwnerSendResult {
  sent: boolean
  error?: string
  /** `'sms-off'`: SMS paging is off by owner decision (2026-09-02), so the SMS
   *  half of a page is a recorded no-op; the email half still went. Not an
   *  error. */
  skipped?: 'sms-off'
  /** Set when the send was withheld because its class is rendered by the owner
   *  queue instead. Not an error: the information reached the owner by another
   *  surface, and distinguishing the two is what keeps a real failure legible. */
  suppressed?: 'queue' | 'lane'
}

/**
 * Send an HTML email to the owner via Zoho SMTP. Skips (sent:false) when SMTP
 * credentials or nodemailer are absent; never throws.
 */
export async function sendOwnerEmail(
  subject: string,
  html: string,
  opts: { escalation: EscalationClassName; fromName?: string },
): Promise<OwnerSendResult> {
  // The class decides whether this send happens at all. Enforcement lives here
  // rather than in a lint because a lint is a rule someone can forget to run,
  // and the thing being fixed is precisely a prose rule that nothing enforced.
  //
  // A paging class is never suppressed, whatever the valve says: muting the
  // money path by flipping a queue setting would be a far worse bug than the
  // noise this is reducing.
  const channel = escalationChannel(opts.escalation)
  if (channel !== 'page' && !isPagingClass(opts.escalation) && (await ownerQueueEnabled())) {
    console.log(
      `[owner-alerts] withheld "${subject}" (${opts.escalation}, ${channel}): rendered by the owner queue`,
    )
    return { sent: false, suppressed: channel }
  }

  const host = process.env['ZOHO_SMTP_HOST'] ?? 'smtp.zoho.com'
  const port = parseInt(process.env['ZOHO_SMTP_PORT'] ?? '465', 10)
  const user = process.env['ZOHO_SMTP_USER']
  const pass = process.env['ZOHO_SMTP_PASS']
  const from = process.env['EMAIL_FROM'] ?? 'hello@xdipx.com'

  if (!user || !pass) {
    console.warn('[owner-alerts] ZOHO_SMTP_USER or ZOHO_SMTP_PASS not set. Skipping email send.')
    return { sent: false, error: 'SMTP credentials not configured' }
  }

  // Lazy dynamic import, not require(): the Vercel entry is bundled as ESM
  // (server/vercel-entry.mjs), where bare `require` is not defined, so the old
  // call threw a ReferenceError that this catch reported as "not installed" on
  // every send. `await import()` is valid ESM, stays lazy so a missing package
  // cannot crash module load, and is a static specifier Vercel's file tracer
  // can follow when deciding what to ship.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nm: any = null
  try {
    nm = await import('nodemailer')
    nm = nm?.default ?? nm
  } catch (err) {
    console.warn('[owner-alerts] nodemailer could not be loaded. Skipping email send.', err)
    return { sent: false, error: `nodemailer could not be loaded: ${String(err)}` }
  }

  try {
    const transporter = nm.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    })
    await transporter.sendMail({
      from: `"${opts.fromName ?? 'xdipx ops'}" <${from}>`,
      to: ownerAlertEmails().join(', '),
      subject,
      html,
    })
    return { sent: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[owner-alerts] SMTP send failed:', msg)
    return { sent: false, error: msg }
  }
}

/**
 * Send an SMS to the owner.
 *
 * OFF BY OWNER DECISION (2026-09-02): the owner does not want to be paged by
 * SMS, so `OWNER_ALERT_PHONE` is deliberately unset in every environment and
 * this returns `{ sent: false, skipped: 'sms-off' }` without logging a
 * warning. The paging classes still reach the owner by email at any hour. The
 * function and its `PagingClass` fence stay so that turning SMS back on is one
 * env var and a reviewable decision, not a rebuild. Never throws.
 */
export async function sendOwnerSms(body: string, escalation: PagingClass): Promise<OwnerSendResult> {
  // `escalation` is typed to the two-member PagingClass union, so anything else
  // is a compile error at the call site rather than a review note. That is the
  // whole enforcement: there is no runtime list to fall out of date with.
  void escalation
  const to = process.env['OWNER_ALERT_PHONE']
  if (!to) return { sent: false, skipped: 'sms-off' }
  try {
    await sendSms(to, body.length > 320 ? `${body.slice(0, 317)}...` : body)
    return { sent: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[owner-alerts] SMS send failed:', msg)
    return { sent: false, error: msg }
  }
}
