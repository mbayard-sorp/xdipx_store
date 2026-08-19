/**
 * app/lib/sms-v2/web-sms-link.server.ts
 *
 * Ticket #3916 (depends on #3518 item 2). Web v2 conversations never wrote
 * customerGid, so findRecentCrossChannelActivity() in cross-channel.server.ts
 * was structurally dead on the web channel — there was nothing to key off.
 *
 * This module is the opt-in "text me this, continue on SMS" beat: a web
 * visitor who explicitly gives us a phone number gets
 *   1. a sms_conversations row (created if it doesn't exist yet) seeded with
 *      whatever the web conversation was already discussing, so the SMS
 *      thread doesn't start cold, and
 *   2. customerGid written onto BOTH web_conversations and sms_conversations
 *      when it resolves to a real Shopify customer, so
 *      findRecentCrossChannelActivity() has something to match on the next
 *      time either channel is touched.
 *
 * No schema change: both tables already carry a `customer_gid` text column
 * (Phase 10, migration precedes this ticket) — the gap was purely that
 * nothing on the web write path ever populated it. See
 * docs/audits/conversation-channels-product-lookup-audit-2026-08-04.md for
 * the broader pattern this campaign is closing.
 *
 * Compliance: a phone number that has never cleared the SMS age/consent gate
 * gets the exact same AGE_GATE_REPLY a cold inbound text would get (verbatim
 * from compliance-templates.ts), typing a phone into a web form is not a
 * substitute for the carrier-required "reply YES" opt-in. An already-
 * consented number gets the reviewed cross-channel continuation copy from
 * cross-channel-templates.ts instead. Neither outbound SMS body introduces
 * new customer-facing prose, so this file's own strings did not need a fresh
 * empathy-reviewer pass. The in-widget "reply" copy shown back to the web
 * visitor lives in app/routes/api.web-sms-optin.tsx, not here, and IS new
 * prose — see the voice-gate note in that file's header.
 */
import { getOrCreateConversation, applyStateWrites, bridgeSummary } from './conversation.server'
import { getOrCreateWebConversation, applyWebStateWrites } from './web-conversation.server'
import { isOptedOut, hasAgeConsent } from '~/lib/sms-processor.server'
import { sendSms } from '~/lib/twilio.server'
import { findCustomerByPhone, getProductByHandle } from '~/lib/shopify.server'
import { AGE_GATE_REPLY } from './templates/compliance-templates'
import { pickCrossChannelTemplate } from './templates/cross-channel-templates'

export interface LinkWebSessionToSmsInput {
  /** Web chat session id (web_conversations.session_id / the cookieId echoed by ask-emma). */
  sessionId: string
  /** Already-normalized E.164 phone number — see normalizePhoneToE164(). */
  phone: string
}

export type LinkWebSessionToSmsResult =
  | { ok: true; sent: boolean; alreadyConsented: boolean; customerGidLinked: boolean }
  | { ok: false; reason: 'opted_out' }

/**
 * Normalize a user-typed phone string to E.164.
 *
 * Mirrors the 10/11-digit US-number handling already used for Shopify
 * customer updates in _layout.account.profile.tsx. Returns null when the
 * input can't be confidently normalized (reject rather than guess).
 */
export function normalizePhoneToE164(raw: string): string | null {
  const trimmed = raw.trim()
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/**
 * Link a web chat session to a phone number: seed/create the sms_conversations
 * row, resolve + write customerGid on both rows when it matches a real
 * Shopify customer, and send the appropriate outbound SMS.
 */
export async function linkWebSessionToSms(
  input: LinkWebSessionToSmsInput,
): Promise<LinkWebSessionToSmsResult> {
  const { sessionId, phone } = input

  if (await isOptedOut(phone)) {
    return { ok: false, reason: 'opted_out' }
  }

  const alreadyConsented = await hasAgeConsent(phone)

  // Load (or create) both sides of the link.
  const webRow = await getOrCreateWebConversation(sessionId)
  const smsRow = await getOrCreateConversation(phone)

  // Resolve the identity to link on. getOrCreateConversation() already tried
  // Shopify enrichment on insert (tryEnrichCustomer); for a pre-existing SMS
  // row that never resolved, or a web row that already carries a gid (e.g.
  // a logged-in Shopify customer), fall back through whatever we already
  // have rather than re-querying Shopify on every opt-in.
  let resolvedGid: string | null = smsRow.customerGid ?? webRow.customerGid ?? null
  if (!resolvedGid) {
    try {
      const customer = await findCustomerByPhone(phone)
      resolvedGid = customer?.id ?? null
    } catch (err) {
      console.warn('[web-sms-link] findCustomerByPhone failed (non-fatal)', err)
    }
  }

  let customerGidLinked = false
  if (resolvedGid) {
    const writes: Promise<void>[] = []
    if (!webRow.customerGid) writes.push(applyWebStateWrites(sessionId, { customerGid: resolvedGid }))
    if (!smsRow.customerGid) writes.push(applyStateWrites(phone, { customerGid: resolvedGid }))
    if (writes.length > 0) {
      await Promise.all(writes)
      customerGidLinked = true
    } else {
      // Already linked on both sides from a prior opt-in.
      customerGidLinked = webRow.customerGid === resolvedGid && smsRow.customerGid === resolvedGid
    }
  }

  // Bridge whatever the web conversation was already discussing onto the SMS
  // row, but only fill gaps — never clobber an SMS thread that's already
  // mid-conversation about something else.
  const smsWrites: Parameters<typeof applyStateWrites>[1] = {}
  if (webRow.currentPitchHandle && !smsRow.currentPitchHandle) {
    smsWrites.currentPitchHandle = webRow.currentPitchHandle
  }
  if (webRow.lastQuoteUrl && !smsRow.lastQuoteUrl) {
    smsWrites.lastQuoteUrl = webRow.lastQuoteUrl
  }
  if (webRow.lastQuoteItems && !smsRow.lastQuoteItems) {
    smsWrites.lastQuoteItems = webRow.lastQuoteItems
  }
  if (webRow.conversationSummary && !smsRow.conversationSummary) {
    const bridged = bridgeSummary(webRow.conversationSummary)
    if (bridged) smsWrites.conversationSummary = bridged
  }
  if (Object.keys(smsWrites).length > 0) {
    await applyStateWrites(phone, smsWrites)
  }

  // Outbound message. A number that hasn't cleared the SMS age/consent gate
  // gets exactly what a cold inbound text would get — typing a phone number
  // into a web form isn't itself carrier-compliant consent to recurring
  // marketing texts. An already-consented number gets the reviewed
  // cross-channel continuation copy.
  const pitchHandle = webRow.currentPitchHandle ?? smsRow.currentPitchHandle ?? null
  let productTitle = 'your pick'
  if (pitchHandle) {
    try {
      const product = await getProductByHandle(pitchHandle)
      productTitle = product?.title ?? pitchHandle
    } catch {
      productTitle = pitchHandle
    }
  }

  const outboundBody = alreadyConsented
    ? pickCrossChannelTemplate({ channelLabel: 'the site', productTitle }, 'sms')
    : AGE_GATE_REPLY

  let sent = true
  try {
    await sendSms(phone, outboundBody)
  } catch (err) {
    sent = false
    console.warn('[web-sms-link] outbound SMS send failed (non-fatal — link is still saved)', err)
  }

  return { ok: true, sent, alreadyConsented, customerGidLinked }
}
