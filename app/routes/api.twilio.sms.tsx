/**
 * POST /api/twilio/sms
 *
 * Inbound SMS webhook. Honors STOP/HELP/START keywords (carrier compliance +
 * our own opt-out table), loads short per-phone history, asks Claude for a
 * reply, records both sides, and returns TwiML <Message> so Twilio sends it.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { twiml, verifyTwilioRequest, xmlEscape } from '~/lib/twilio.server'
import { db } from '~/lib/db.server'
import { smsMessages, smsOptouts } from '../../db/schema'
import { generateSmsReply, type SmsTurn } from '~/lib/ai-agent/sms.server'

const HISTORY_TURNS = 10
const HISTORY_WINDOW_HOURS = 24
const MAX_SMS_PER_HOUR = Number(process.env['SMS_MAX_PER_HOUR'] ?? 15)

const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke'])
const START_WORDS = new Set(['start', 'unstop', 'yes', 'subscribe'])
const HELP_WORDS = new Set(['help', 'info'])

const HELP_REPLY =
  "xdipx: daily flash-sale wellness deals. Reply STOP to opt out, START to resume. Msg&data rates may apply. Help: support@xdipx.com"
const STOP_REPLY = "You're opted out of xdipx messages. Reply START anytime to resume."
const START_REPLY = "You're back in. Reply STOP to opt out anytime. Msg&data rates may apply."

function replyTwiml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${xmlEscape(body)}</Message></Response>`
}

const EMPTY_TWIML = `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`

export async function action({ request }: ActionFunctionArgs) {
  const { ok, params } = await verifyTwilioRequest(request)
  if (!ok) return new Response('Forbidden', { status: 403 })

  const from = (params['From'] ?? '').trim()
  const body = (params['Body'] ?? '').trim()
  const twilioSid = params['MessageSid'] ?? params['SmsMessageSid'] ?? ''

  if (!from || !body) return twiml(EMPTY_TWIML)

  const keyword = body.toLowerCase().replace(/[^a-z]/g, '')

  // STOP — always honor, even if already opted out.
  if (STOP_WORDS.has(keyword)) {
    await recordInbound(from, body, twilioSid)
    await db
      .insert(smsOptouts)
      .values({ phone: from, reason: 'stop' })
      .onConflictDoNothing({ target: smsOptouts.phone })
    await recordOutbound(from, STOP_REPLY, null)
    return twiml(replyTwiml(STOP_REPLY))
  }

  // START — remove opt-out if present.
  if (START_WORDS.has(keyword)) {
    await recordInbound(from, body, twilioSid)
    await db.delete(smsOptouts).where(eq(smsOptouts.phone, from))
    await recordOutbound(from, START_REPLY, null)
    return twiml(replyTwiml(START_REPLY))
  }

  // HELP — always reply with program info regardless of opt-out.
  if (HELP_WORDS.has(keyword)) {
    await recordInbound(from, body, twilioSid)
    await recordOutbound(from, HELP_REPLY, null)
    return twiml(replyTwiml(HELP_REPLY))
  }

  // Opted out → log inbound (for auditing) but never reply.
  if (await isOptedOut(from)) {
    await recordInbound(from, body, twilioSid)
    return twiml(EMPTY_TWIML)
  }

  // Rate limit — swallow further messages silently so we don't feed a loop.
  if (await isRateLimited(from)) {
    console.warn(`[sms] rate-limited from=${from}`)
    await recordInbound(from, body, twilioSid)
    return twiml(EMPTY_TWIML)
  }

  await recordInbound(from, body, twilioSid)

  // Build short history window, then append the new message.
  const history = await loadHistory(from)
  history.push({ role: 'user', text: body })

  let reply: string
  try {
    reply = await generateSmsReply(history, { phone: from, channel: 'sms' })
  } catch (err) {
    console.error('[sms] claude failed', err)
    reply = "Thanks — we got your message and will get back to you shortly."
  }

  if (!reply) reply = "Thanks — we got your message."

  await recordOutbound(from, reply, null)
  return twiml(replyTwiml(reply))
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

async function isRateLimited(phone: string): Promise<boolean> {
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
    return (rows[0]?.n ?? 0) >= MAX_SMS_PER_HOUR
  } catch {
    return false
  }
}

async function loadHistory(phone: string): Promise<SmsTurn[]> {
  const since = new Date(Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000)
  const rows = await db
    .select({ direction: smsMessages.direction, body: smsMessages.body, createdAt: smsMessages.createdAt })
    .from(smsMessages)
    .where(and(eq(smsMessages.phone, phone), gte(smsMessages.createdAt, since)))
    .orderBy(asc(smsMessages.createdAt))
    .limit(HISTORY_TURNS * 2)

  return rows.map((r) => ({
    role: r.direction === 'inbound' ? 'user' : 'assistant',
    text: r.body,
  }))
}

async function recordInbound(phone: string, body: string, twilioSid: string): Promise<void> {
  try {
    await db.insert(smsMessages).values({ phone, direction: 'inbound', body, twilioSid: twilioSid || null })
  } catch (err) {
    console.error('[sms] failed to record inbound', err)
  }
}

async function recordOutbound(phone: string, body: string, twilioSid: string | null): Promise<void> {
  try {
    await db.insert(smsMessages).values({ phone, direction: 'outbound', body, twilioSid })
  } catch (err) {
    console.error('[sms] failed to record outbound', err)
  }
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  if (process.env['NODE_ENV'] === 'production') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return twiml(EMPTY_TWIML)
}
