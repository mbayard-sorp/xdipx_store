/**
 * Channel-agnostic SMS message processor, driven by the Twilio webhook
 * (api.twilio.sms.tsx) with simulated: false. The `simulated` flag marks
 * rows created by test harnesses so production metrics can exclude them.
 *
 * Keeps STOP/START/HELP/age-gate/opt-out/rate-limit/history/Claude logic in
 * exactly one place.
 */
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { smsAgeConsent, smsMessages, smsOptouts } from '../../db/schema'
import { generateChatReply } from '~/lib/ai-agent/chat.server'
import type { ChatTurn } from '~/lib/ai-agent/chat-types'
import { getIvrConfig } from '~/lib/ivr-config.server'
import { getSmsConfig } from '~/lib/sms-v2/sms-config.server'
import { splitSmsReplyForMms, type SmsSegment } from '~/lib/sms-reply-segments.server'

export type { SmsSegment } from '~/lib/sms-reply-segments.server'

const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke'])
const START_WORDS = new Set(['start', 'unstop', 'subscribe'])
const HELP_WORDS = new Set(['help', 'info'])
const AGE_CONFIRM_RE = /^(y|ya|yes|yep|yup|sure|ok|okay|confirm|im18|iam18|18|18plus)$/i

export const HELP_REPLY =
  "xdipx: curated wellness picks. Reply STOP to opt out, START to resume. Msg&data rates may apply. Help: hello@xdipx.com"
export const STOP_REPLY = "You're opted out of xdipx messages. Reply START anytime to resume."
export const START_REPLY = "You're back in. Reply STOP to opt out anytime. Msg&data rates may apply."
export const AGE_GATE_REPLY =
  "xdipx is 18+ only. Reply YES to confirm you're 18 or older AND agree to receive recurring marketing texts from xdipx (auto-dialed, ~4 msgs/month, msg & data rates may apply). Reply STOP to opt out anytime, HELP for help."
export const AGE_WELCOME_REPLY =
  "You're in. I'm Emma — ask me anything about our products or your orders. What's on your mind?"

export interface ProcessSmsInput {
  from: string
  body: string
  /** Twilio MessageSid for real inbound messages. Undefined for the simulator. */
  twilioSid?: string
  /** Marks all rows written during this call as simulated. Defaults to false. */
  simulated?: boolean
}

export interface ProcessSmsResult {
  /**
   * Deliverable segments. Each becomes one Twilio <Message>: body text plus
   * an optional MMS image URL. Empty array = silent (opted out, rate-limited,
   * empty body).
   */
  replies: SmsSegment[]
  /**
   * Convenience: the joined body text for callers (UI, logs) that don't care
   * about per-segment splitting. Null when the platform stayed silent.
   */
  reply: string | null
  /** Why we picked this branch — useful for the simulator UI to label what happened. */
  outcome:
    | 'empty'
    | 'stop'
    | 'start'
    | 'help'
    | 'opted_out_silent'
    | 'age_gate_prompt'
    | 'age_gate_confirmed'
    | 'rate_limited_silent'
    | 'reply'
    | 'reply_fallback'
}

export async function processSmsMessage(input: ProcessSmsInput): Promise<ProcessSmsResult> {
  const from = input.from.trim()
  const body = input.body.trim()
  const twilioSid = (input.twilioSid ?? '').trim()
  const simulated = input.simulated ?? false

  if (!from || !body) return single(null, 'empty')

  const keyword = body.toLowerCase().replace(/[^a-z]/g, '')

  if (STOP_WORDS.has(keyword)) {
    await recordInbound(from, body, twilioSid, simulated)
    await db
      .insert(smsOptouts)
      .values({ phone: from, reason: 'stop' })
      .onConflictDoNothing({ target: smsOptouts.phone })
    await recordOutbound(from, STOP_REPLY, null, simulated)
    return single(STOP_REPLY, 'stop')
  }

  if (START_WORDS.has(keyword)) {
    await recordInbound(from, body, twilioSid, simulated)
    await db.delete(smsOptouts).where(eq(smsOptouts.phone, from))
    await recordOutbound(from, START_REPLY, null, simulated)
    return single(START_REPLY, 'start')
  }

  if (HELP_WORDS.has(keyword)) {
    await recordInbound(from, body, twilioSid, simulated)
    await recordOutbound(from, HELP_REPLY, null, simulated)
    return single(HELP_REPLY, 'help')
  }

  if (await isOptedOut(from)) {
    await recordInbound(from, body, twilioSid, simulated)
    return single(null, 'opted_out_silent')
  }

  // 18+ age gate — required before any product content.
  if (!(await hasAgeConsent(from))) {
    await recordInbound(from, body, twilioSid, simulated)
    if (AGE_CONFIRM_RE.test(body)) {
      await db
        .insert(smsAgeConsent)
        .values({ phone: from, method: simulated ? 'sms_yes_v2_sim' : 'sms_yes_v2' })
        .onConflictDoNothing({ target: smsAgeConsent.phone })
      // Welcome copy is admin-editable via /admin/voice-and-sms; falls back
      // to AGE_WELCOME_REPLY when no override is saved or the DB is slow.
      const smsConfig = await getSmsConfig()
      const welcome = smsConfig.ageWelcome
      await recordOutbound(from, welcome, null, simulated)
      return single(welcome, 'age_gate_confirmed')
    }
    // AGE_GATE_REPLY is regulatory copy and is intentionally NOT admin-editable.
    await recordOutbound(from, AGE_GATE_REPLY, null, simulated)
    return single(AGE_GATE_REPLY, 'age_gate_prompt')
  }

  const config = await getIvrConfig()

  if (await isRateLimited(from, config.smsMaxPerHour)) {
    console.warn(`[sms] rate-limited from=${from} simulated=${simulated}`)
    await recordInbound(from, body, twilioSid, simulated)
    return single(null, 'rate_limited_silent')
  }

  // Load history first, then record the inbound. The simulator and the live
  // webhook see history the same way: the loader returns ALL rows for the
  // phone (simulated and real together) when running in simulated mode, but
  // ONLY real rows when running for a live customer. That way an admin's
  // dry-run doesn't leak into a real shopper's thread.
  const history = await loadHistory(from, config.smsHistoryWindowHours, config.smsHistoryTurns, simulated)
  history.push({ role: 'user', text: body })
  await recordInbound(from, body, twilioSid, simulated)

  let reply: string
  let outcome: ProcessSmsResult['outcome'] = 'reply'
  try {
    const result = await generateChatReply(history, { phone: from, channel: 'sms' })
    reply = result.reply
  } catch (err) {
    console.error('[sms] claude failed', err)
    reply = "Thanks — we got your message and will get back to you shortly."
    outcome = 'reply_fallback'
  }

  if (!reply) {
    reply = "Thanks — we got your message."
    outcome = 'reply_fallback'
  }

  // Split the reply into MMS-shaped segments (one per product pitch), then
  // persist + return one row per segment. Single-product replies and the
  // commit/upsell branches collapse to a single segment.
  const segments = await splitSmsReplyForMms(reply)
  for (const seg of segments) {
    await recordOutbound(from, seg.body, null, simulated, seg.mediaUrl)
  }
  return {
    replies: segments,
    reply: segments.map((s) => s.body).join('\n---\n'),
    outcome,
  }
}

function single(text: string | null, outcome: ProcessSmsResult['outcome']): ProcessSmsResult {
  return text == null
    ? { replies: [], reply: null, outcome }
    : { replies: [{ body: text }], reply: text, outcome }
}

async function hasAgeConsent(phone: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ phone: smsAgeConsent.phone })
      .from(smsAgeConsent)
      .where(eq(smsAgeConsent.phone, phone))
      .limit(1)
    return rows.length > 0
  } catch (err) {
    console.error('[sms] age consent check failed', err)
    return false
  }
}

async function isOptedOut(phone: string): Promise<boolean> {
  try {
    const rows = await db.select({ id: smsOptouts.id }).from(smsOptouts).where(eq(smsOptouts.phone, phone)).limit(1)
    return rows.length > 0
  } catch (err) {
    console.error('[sms] optout check failed', err)
    return false
  }
}

async function isRateLimited(phone: string, maxPerHour: number): Promise<boolean> {
  if (maxPerHour <= 0) return false
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.phone, phone),
          eq(smsMessages.direction, 'inbound'),
          gte(smsMessages.createdAt, oneHourAgo),
        ),
      )
    return (rows[0]?.n ?? 0) >= maxPerHour
  } catch {
    return false
  }
}

async function loadHistory(
  phone: string,
  windowHours: number,
  turns: number,
  simulated: boolean,
): Promise<ChatTurn[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)
  // Real customers: only see their real prior turns. Simulator: only see
  // simulator turns. Either way, real and simulated threads stay isolated.
  const rows = await db
    .select({ direction: smsMessages.direction, body: smsMessages.body, createdAt: smsMessages.createdAt })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.phone, phone),
        gte(smsMessages.createdAt, since),
        eq(smsMessages.simulated, simulated),
      ),
    )
    .orderBy(asc(smsMessages.createdAt))
    .limit(turns * 2)

  return rows.map((r) => ({
    role: r.direction === 'inbound' ? 'user' : 'assistant',
    text: r.body,
  }))
}

async function recordInbound(phone: string, body: string, twilioSid: string, simulated: boolean): Promise<void> {
  try {
    await db.insert(smsMessages).values({
      phone,
      direction: 'inbound',
      body,
      twilioSid: twilioSid || null,
      simulated,
    })
  } catch (err) {
    console.error('[sms] failed to record inbound', err)
  }
}

async function recordOutbound(
  phone: string,
  body: string,
  twilioSid: string | null,
  simulated: boolean,
  mediaUrl?: string,
): Promise<void> {
  try {
    await db.insert(smsMessages).values({
      phone,
      direction: 'outbound',
      body,
      twilioSid,
      simulated,
      mediaUrl: mediaUrl ?? null,
    })
  } catch (err) {
    console.error('[sms] failed to record outbound', err)
  }
}
