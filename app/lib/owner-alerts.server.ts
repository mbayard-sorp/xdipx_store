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
}

/**
 * Send an HTML email to the owner via Zoho SMTP. Skips (sent:false) when SMTP
 * credentials or nodemailer are absent; never throws.
 */
export async function sendOwnerEmail(
  subject: string,
  html: string,
  opts: { fromName?: string } = {},
): Promise<OwnerSendResult> {
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
 * Send an SMS to the owner. No-ops (sent:false) until OWNER_ALERT_PHONE is
 * set, so the P0 hooks are safe to ship before the env var exists. Never
 * throws.
 */
export async function sendOwnerSms(body: string): Promise<OwnerSendResult> {
  const to = process.env['OWNER_ALERT_PHONE']
  if (!to) {
    console.warn('[owner-alerts] OWNER_ALERT_PHONE not set. Skipping SMS.')
    return { sent: false, error: 'OWNER_ALERT_PHONE not set' }
  }
  try {
    await sendSms(to, body.length > 320 ? `${body.slice(0, 317)}...` : body)
    return { sent: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[owner-alerts] SMS send failed:', msg)
    return { sent: false, error: msg }
  }
}
