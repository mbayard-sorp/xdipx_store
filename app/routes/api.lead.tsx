/**
 * POST /api/lead: Door A of the paid-lead funnel (curious.xdipx.com).
 *
 * Takes { firstName, email, phone?, smsConsent?, interest?, slug, company }
 * as JSON. `company` is a honeypot: a filled one is answered as a success and
 * dropped. On a real signup it:
 *   1. subscribes the email to the paid-leads Klaviyo list with first name,
 *      phone, interest and the ad's UTMs on the profile (the welcome series
 *      splits on `interest`);
 *   2. only when the SMS box was ticked AND the lead SMS opt-in kill switch
 *      is on (app/lib/lead-sms-optin.server.ts, default on), enrolls the
 *      number in the Twilio double opt-in (app/lib/lead-sms.server.ts: a
 *      pending lead_sms_subscriptions row plus one confirmation text, nothing
 *      for a number in sms_optouts) and logs that consent. Klaviyo SMS is not
 *      used for leads (owner blocker 731 is superseded by this path). With
 *      the switch off, phone and smsConsent are dropped before validation
 *      even if a client sends them: no phone on the profile, no enrollment,
 *      no consent_log row;
 *   3. sends a Meta Lead through CAPI and returns its event id so the
 *      browser pixel's Lead dedupes against it;
 *   4. returns the code, its terms, and the shop link that puts the code on
 *      the cart.
 * After a successful subscribe it also writes one lead_post_event row to
 * ad_health_samples, the counter the hourly L3 funnel-break check reads
 * (app/lib/ads/health.server.ts, ticket #16410). Awaited, never throws.
 * Klaviyo failure is the only hard failure: without the subscribe there is no
 * lead. SMS enrollment, consent log and CAPI failures are logged and never
 * cost the visitor their code.
 */

import type { ActionFunctionArgs } from 'react-router'
import { recordLeadPostEvent } from '~/lib/ads/health.server'
import { getStoredUTM } from '~/lib/attribution.server'
import { rejectIfBot } from '~/lib/botid.server'
import { logConsent } from '~/lib/consent.server'
import { subscribeLead } from '~/lib/klaviyo.server'
import { LEAD_OFFER } from '~/lib/lead-interests'
import { buildShopUrl, validateLeadInput, type FunnelUtm } from '~/lib/lead-funnel'
import { isLeadSmsOptinEnabled } from '~/lib/lead-sms-optin.server'
import { enrollLeadSms } from '~/lib/lead-sms.server'
import { sendCapiLead } from '~/lib/meta-capi.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import { normalizePhoneToE164 } from '~/lib/sms-v2/web-sms-link.server'

/** Version stamp for the consent wording the visitor saw (consent_log.policy_version, max 10 chars). */
export const LEAD_CONSENT_VERSION = 'lead-v1'

const ALLOWED_ORIGINS = new Set(['https://curious.xdipx.com', 'https://xdipx.com', 'https://www.xdipx.com'])

export function isAllowedLeadOrigin(origin: string | null): boolean {
  if (process.env['NODE_ENV'] !== 'production') return true
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const host = new URL(origin).hostname
    return host.endsWith('.vercel.app') && host.includes('xdipx')
  } catch {
    return false
  }
}

// Loader required so fetcher revalidation doesn't 404.
export async function loader() {
  return Response.json(null)
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  if (!isAllowedLeadOrigin(request.headers.get('origin'))) {
    return Response.json({ error: 'forbidden_origin' }, { status: 403 })
  }

  const bot = await rejectIfBot()
  if (bot) return bot
  const rl = await checkRateLimit(request, 'lead', 5, 3600)
  if (!rl.ok) return rateLimited()

  let body: Record<string, unknown>
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const utm: FunnelUtm = getStoredUTM(request) ?? {}
  // Switch off: the page never rendered the fields, so anything here came from
  // a stale tab or a hand-built request. Strip it before validation so a stray
  // smsConsent cannot even 400 the signup.
  const smsOptin = await isLeadSmsOptinEnabled()
  if (!smsOptin) {
    delete body['phone']
    delete body['smsConsent']
  }
  const parsed = validateLeadInput(body)

  // Honeypot: look successful, do nothing.
  if (typeof body['company'] === 'string' && body['company'].trim() !== '') {
    const slug = parsed.ok ? parsed.value.slug : 'hello'
    return Response.json({ ok: true, code: LEAD_OFFER.code, terms: LEAD_OFFER.terms, shopUrl: buildShopUrl(null, utm, slug), eventId: null })
  }
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  const lead = parsed.value

  let phone: string | null = null
  if (smsOptin && lead.phone) {
    phone = normalizePhoneToE164(lead.phone)
    if (!phone) return Response.json({ error: 'invalid_phone' }, { status: 400 })
  }

  const now = new Date()
  const properties: Record<string, unknown> = {
    lead_source: `curious-${lead.slug}`,
    lead_offer_code: LEAD_OFFER.code,
    lead_captured_at: now.toISOString(),
    ...(lead.interest ? { interest: lead.interest } : {}),
    ...(utm.source ? { utm_source: utm.source } : {}),
    ...(utm.medium ? { utm_medium: utm.medium } : {}),
    ...(utm.campaign ? { utm_campaign: utm.campaign } : {}),
    ...(utm.content ? { utm_content: utm.content } : {}),
  }

  try {
    await subscribeLead({ email: lead.email, firstName: lead.firstName, phone, properties })
  } catch (err) {
    console.error('[api.lead] Klaviyo subscribe failed:', err)
    return Response.json({ error: 'subscribe_failed' }, { status: 502 })
  }

  await recordLeadPostEvent({ slug: lead.slug, ...(utm.content ? { utmContent: utm.content } : {}) })

  if (smsOptin && phone && lead.smsConsent) {
    try {
      await enrollLeadSms({
        phone,
        email: lead.email,
        firstName: lead.firstName,
        interest: lead.interest,
        source: `curious-${lead.slug}`,
        consentedAt: now,
      })
    } catch (err) {
      console.error('[api.lead] SMS enrollment failed:', err)
    }
    try {
      await logConsent(request, { sessionId: `lead:sms:${now.getTime()}`, consentType: 'all', policyVersion: LEAD_CONSENT_VERSION })
    } catch (err) {
      console.error('[api.lead] consent log failed:', err)
    }
  }

  const eventId = await sendCapiLead(request, {
    email: lead.email,
    phone,
    firstName: lead.firstName,
    contentName: `curious-${lead.slug}`,
    ...(lead.interest ? { category: lead.interest } : {}),
  })

  return Response.json({
    ok: true,
    code: LEAD_OFFER.code,
    terms: LEAD_OFFER.terms,
    shopUrl: buildShopUrl(lead.interest, utm, lead.slug),
    eventId,
  })
}
