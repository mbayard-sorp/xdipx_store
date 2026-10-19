/**
 * app/lib/lead-sms.server.ts
 *
 * SMS consent on the paid-lead funnel (curious.xdipx.com/hello), on Twilio.
 *
 * The form's phone and consent box used to feed Klaviyo's SMS list, which is
 * unset in production (owner blocker 731) and not expected to be approved
 * for a sex-toy store. This module runs the flow the xdipx A2P 10DLC campaign
 * (QE2c6890da8086d771620e9b13fadeba0b, Low Volume Mixed, VERIFIED) is
 * registered for: double opt-in.
 *
 *   1. enrollLeadSms(): the form consent writes a lead_sms_subscriptions row
 *      (status pending) and sends one confirmation text through sendSms. A
 *      number already in sms_optouts gets no text and a row at opted_out, so
 *      the consent is on record without a send.
 *   2. handleLeadSmsInbound(): called from the Twilio inbound webhook before
 *      the pipeline. YES or START from a pending number confirms the row and
 *      sends the welcome text exactly once (welcome_sent_at is the latch).
 *      STOP flips the row to opted_out. The carrier compliance path in
 *      sms-processor.server.ts (sms_optouts insert on STOP, delete on START,
 *      the STOP/START replies) still runs after this; nothing here replaces
 *      it.
 *
 * No further sends exist. Copy is support register (2 to 3): plain facts, the
 * offer terms in full, the carrier closers the campaign's samples carry.
 *
 * Gate: the same kill switch the /hello page reads to show the phone field
 * at all (app/lib/lead-sms-optin.server.ts: `lead_sms_optin_enabled`, default
 * on, LEAD_SMS_OPTIN_ENABLED=0 forces off).
 */

import { desc, eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { leadSmsSubscriptions, smsOptouts } from '../../db/schema'
import { buildShopUrl } from '~/lib/lead-funnel'
import { getLeadInterest, LEAD_OFFER, type LeadInterestSlug } from '~/lib/lead-interests'
import { isLeadSmsOptinEnabled } from '~/lib/lead-sms-optin.server'
import { START_WORDS, STOP_WORDS, complianceKeyword } from '~/lib/sms-processor.server'
import { sendSms } from '~/lib/twilio.server'

/** How each interest reads inside a text ("You asked about <this>"). */
const INTEREST_SMS_PHRASE: Record<LeadInterestSlug, string> = {
  'curious': 'first-time picks',
  'hands-free': 'hands-free and suction toys',
  'wands': 'wands',
  'for-two': 'toys for two',
  'back-door': 'back-door play',
  'for-him': 'toys for him',
  'play': 'games and play',
}

/** UTMs on the welcome link. Short on purpose: the link is most of the segment budget. */
const WELCOME_UTM = { source: 'sms', medium: 'sms', campaign: 'lead-sms' } as const
const WELCOME_SLUG = 'sms'

/** Bodies that confirm a pending number, after complianceKeyword() normalisation. */
const YES_WORDS = new Set(['y', 'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'confirm'])

/** The text a consented number gets. Built from the campaign's registered opt-in message, accurate for this funnel. */
export function confirmationSms(interest: LeadInterestSlug | null): string {
  const phrase = interest ? INTEREST_SMS_PHRASE[interest] : null
  const asked = phrase ? `You asked about ${phrase} on curious.xdipx.com.` : 'You signed up on curious.xdipx.com.'
  return `xdipx: Reply YES to confirm texts from Emma. ${asked} Msg freq varies. Reply HELP for help, STOP to cancel. Msg&data rates may apply.`
}

/**
 * The first name as it goes into a text: first word only, GSM-7 letters,
 * capped so the welcome stays inside two segments for any name. Anything
 * else greets with "there".
 */
export function greetingName(firstName: string): string {
  const first = firstName.trim().split(/\s+/)[0] ?? ''
  if (first.length === 0 || first.length > 12) return 'there'
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(first)) return 'there'
  return first
}

/** The one welcome text, sent once on YES or START. Two GSM-7 segments at most for every interest and name. */
export function welcomeSms(firstName: string, interest: LeadInterestSlug | null): string {
  const url = buildShopUrl(getLeadInterest(interest)?.slug ?? null, WELCOME_UTM, WELCOME_SLUG)
  return (
    `xdipx: Hi ${greetingName(firstName)}, your code ${LEAD_OFFER.code} takes ${LEAD_OFFER.percentOff}% off $${LEAD_OFFER.minimumSubtotal}+ orders, ` +
    `one use per customer, Lovense and Playground excluded. ${url} Reply HELP for help, STOP to cancel.`
  )
}

export type LeadSmsStatus = 'pending' | 'confirmed' | 'opted_out'

export interface EnrollLeadSmsInput {
  /** E.164. */
  phone: string
  email: string
  firstName: string
  interest: LeadInterestSlug | null
  /** Attribution slug, e.g. `curious-hello`. */
  source: string
  consentedAt: Date
}

export type EnrollLeadSmsResult =
  | { outcome: 'disabled' }
  | { outcome: 'pending'; id: number; messageSid: string | null }
  | { outcome: 'opted_out'; id: number }

async function isInOptouts(phone: string): Promise<boolean> {
  const rows = await db.select({ id: smsOptouts.id }).from(smsOptouts).where(eq(smsOptouts.phone, phone)).limit(1)
  return rows.length > 0
}

/**
 * Record the form consent and send the confirmation text. Throws only on the
 * row insert failing; a failed send is logged and the row stays pending with
 * no message sid (nothing retries it in this version).
 */
export async function enrollLeadSms(input: EnrollLeadSmsInput): Promise<EnrollLeadSmsResult> {
  if (!(await isLeadSmsOptinEnabled())) return { outcome: 'disabled' }

  const optedOut = await isInOptouts(input.phone)
  const now = new Date()
  const [row] = await db
    .insert(leadSmsSubscriptions)
    .values({
      phone: input.phone,
      email: input.email,
      firstName: input.firstName,
      interest: input.interest,
      source: input.source,
      status: optedOut ? 'opted_out' : 'pending',
      consentedAt: input.consentedAt,
      optedOutAt: optedOut ? now : null,
    })
    .returning({ id: leadSmsSubscriptions.id })
  const id = row!.id

  if (optedOut) {
    console.warn(`[lead-sms] ${input.phone} is in sms_optouts, consent recorded as opted_out, no text sent`)
    return { outcome: 'opted_out', id }
  }

  let messageSid: string | null = null
  try {
    messageSid = await sendSms(input.phone, confirmationSms(input.interest))
    await db.update(leadSmsSubscriptions).set({ confirmMessageSid: messageSid }).where(eq(leadSmsSubscriptions.id, id))
  } catch (err) {
    console.error('[lead-sms] confirmation send failed:', err)
  }
  return { outcome: 'pending', id, messageSid }
}

export type LeadSmsInboundOutcome =
  /** No live lead row for this number, or the body is not a keyword this module acts on. */
  | 'none'
  /** YES or START on a pending row: confirmed and welcomed. */
  | 'confirmed'
  /** START on an opted_out row: back to confirmed; the welcome went out already or goes out now. */
  | 'resumed'
  /** STOP on a live row: now opted_out. */
  | 'opted_out'

async function latestSubscription(phone: string) {
  const rows = await db
    .select()
    .from(leadSmsSubscriptions)
    .where(eq(leadSmsSubscriptions.phone, phone))
    .orderBy(desc(leadSmsSubscriptions.createdAt))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Lead-row side of an inbound text. Never throws: the carrier compliance path
 * that runs after it must not depend on this table. Returns what it did so
 * the webhook can stay silent on a YES it has answered with the welcome.
 */
export async function handleLeadSmsInbound(from: string, body: string, inboundSid?: string): Promise<LeadSmsInboundOutcome> {
  try {
    const keyword = complianceKeyword(body)
    const isStop = STOP_WORDS.has(keyword)
    const isStart = START_WORDS.has(keyword)
    const isYes = YES_WORDS.has(keyword)
    if (!isStop && !isStart && !isYes) return 'none'

    const row = await latestSubscription(from)
    if (!row) return 'none'
    const now = new Date()

    if (isStop) {
      if (row.status === 'opted_out') return 'none'
      await db.update(leadSmsSubscriptions).set({ status: 'opted_out', optedOutAt: now }).where(eq(leadSmsSubscriptions.id, row.id))
      return 'opted_out'
    }

    // YES confirms a pending row only. START confirms pending and resumes
    // opted_out, mirroring what the compliance path does to sms_optouts.
    if (row.status === 'pending' || (isStart && row.status === 'opted_out')) {
      const resumed = row.status === 'opted_out'
      await db
        .update(leadSmsSubscriptions)
        .set({ status: 'confirmed', confirmedAt: now, confirmedVia: isStart ? 'start' : 'yes', optedOutAt: null })
        .where(eq(leadSmsSubscriptions.id, row.id))
      if (!row.welcomeSentAt) {
        // Latch first so a webhook retry cannot send the welcome twice.
        await db.update(leadSmsSubscriptions).set({ welcomeSentAt: now }).where(eq(leadSmsSubscriptions.id, row.id))
        try {
          const sid = await sendSms(from, welcomeSms(row.firstName, getLeadInterest(row.interest)?.slug ?? null))
          await db.update(leadSmsSubscriptions).set({ welcomeMessageSid: sid }).where(eq(leadSmsSubscriptions.id, row.id))
        } catch (err) {
          console.error(`[lead-sms] welcome send failed for row ${row.id} (inbound ${inboundSid ?? 'n/a'}):`, err)
        }
      }
      return resumed ? 'resumed' : 'confirmed'
    }
    return 'none'
  } catch (err) {
    console.error('[lead-sms] inbound handling failed:', err)
    return 'none'
  }
}
