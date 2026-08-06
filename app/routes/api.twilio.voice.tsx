/**
 * POST /api/twilio/voice
 *
 * Twilio Voice webhook. Returns TwiML that hands the call off to our Fly.io
 * ConversationRelay WebSocket, where Claude + ElevenLabs drive the conversation.
 *
 * Fallback/voicemail handling + business-hours gating land in later phases.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { and, eq, gte, sql } from 'drizzle-orm'
import { twiml, verifyTwilioRequest, withTimeout, xmlEscape } from '~/lib/twilio.server'
import { db } from '~/lib/db.server'
import { normalizeForTTS } from '~/lib/tts-normalize'
import { callLog, pipelineSettings } from '../../db/schema'
import { getActiveIvrVoiceId } from '~/lib/ivr-voice.server'
import { getIvrConfig, type IvrConfig } from '~/lib/ivr-config.server'
import { persistPlaceholderVoicemail } from '~/lib/ivr-voicemail.server'

// Kept in sync with ivr/src/config.ts CallEndReason. The IVR service writes
// the first five from the Fly runtime; this Vercel route owns the last three
// (pre-agent gates).
type CallEndReason =
  | 'user_hangup'
  | 'silent_caller'
  | 'max_duration'
  | 'max_prompts'
  | 'error'
  | 'anonymous'
  | 'rate_limited'
  | 'after_hours'

// Business hours gate — outside window, skip live agent and go straight to voicemail.
// Format: "9-21" (9am–9pm local). Empty/invalid disables the gate (always live).
// Resolved per-request from getIvrConfig() so admin edits take effect without redeploy.

// All human-authored strings here pass through normalizeForTTS so punctuation
// quirks (smart quotes, em-dashes, stray URLs, markdown) can't leak into what
// Polly actually speaks. Brand name is always "ex-dip-ex" (three syllables,
// matching xdipx) — never "ex-dip". The normalizer turns word-internal
// hyphens into spaces so Polly reads it as "ex dip ex".
const REJECT_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${xmlEscape(normalizeForTTS("We've got too many calls from this number right now. Try again in an hour, or reach us online at ex-dip-ex dot com."))}</Say>
  <Hangup/>
</Response>`

// Voicemail intros per branch. The reason the caller can't reach the live
// agent differs — telling an anonymous midday caller "we're closed" reads as
// a lie, so each gate gets honest copy.
const VOICEMAIL_INTROS = {
  afterHours:
    "Hey, you've reached ex-dip-ex. We're closed right now but leave a message after the beep and we'll get back to you first thing.",
  anonymous:
    "Hey, you've reached ex-dip-ex. I can't pick up live calls from a blocked number, but leave a message with a callback number after the beep and we'll get right back to you.",
  unavailable:
    "Hey, you've reached ex-dip-ex. We can't take live calls right now, but leave a message after the beep and we'll get back to you as soon as we can.",
} as const

function voicemailTwiml(
  maxLengthSec: number,
  intro: string = VOICEMAIL_INTROS.afterHours,
): string {
  const appUrl = process.env['APP_URL'] ?? ''
  const cb = appUrl ? `${appUrl}/api/twilio/recording-status` : '/api/twilio/recording-status'
  const safeMax = Number.isFinite(maxLengthSec) && maxLengthSec > 0 ? Math.min(maxLengthSec, 600) : 120
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${xmlEscape(normalizeForTTS(intro))}</Say>
  <Record maxLength="${safeMax}" playBeep="true" trim="trim-silence" recordingStatusCallback="${xmlEscape(cb)}"/>
  <Say voice="Polly.Joanna">${xmlEscape(normalizeForTTS('Thanks — talk soon.'))}</Say>
  <Hangup/>
</Response>`
}

const DEFAULT_GREETING =
  "Hey, you've reached ex-dip-ex. I'm {feeling} you called. This call may be recorded. What's going on?"

const DEFAULT_FEELINGS = 'so happy,thrilled,super excited,really glad,pumped,stoked,delighted'
const DEFAULT_ACTIVITIES = "browsing the vault,curating today's deal,testing out some new arrivals,organizing the stockroom"

function pickRandom(csv: string, fallback: string): string {
  const items = csv.split(',').map(s => s.trim()).filter(Boolean)
  if (!items.length) return fallback
  return items[Math.floor(Math.random() * items.length)]!
}

function resolveGreeting(
  template: string,
  feelingsCsv: string,
  activitiesCsv: string,
): string {
  const feeling = pickRandom(feelingsCsv, 'happy')
  const activity = pickRandom(activitiesCsv, 'working')
  const interpolated = template.replace('{feeling}', feeling).replace('{activity}', activity)
  // Normalize before the string reaches either the ConversationRelay greeting
  // query param (ElevenLabs) or static Polly Say. Covers DB-sourced quirks in
  // ivrGreeting / ivrFeelings / ivrActivities.
  return normalizeForTTS(interpolated)
}

async function getGreeting(): Promise<string> {
  const fallback = resolveGreeting(DEFAULT_GREETING, DEFAULT_FEELINGS, DEFAULT_ACTIVITIES)
  try {
    const rows = await withTimeout(
      db
        .select({ key: pipelineSettings.key, value: pipelineSettings.value })
        .from(pipelineSettings)
        .where(sql`${pipelineSettings.key} IN ('ivrGreeting', 'ivrFeelings', 'ivrActivities')`),
      3000,
      [] as { key: string; value: string | null }[],
      'getGreeting',
    )
    const map = new Map(rows.map((r) => [r.key, r.value]))
    return resolveGreeting(
      map.get('ivrGreeting') || DEFAULT_GREETING,
      map.get('ivrFeelings') || DEFAULT_FEELINGS,
      map.get('ivrActivities') || DEFAULT_ACTIVITIES,
    )
  } catch (err) {
    console.error('[ivr] getGreeting failed — using fallback', err)
    return fallback
  }
}

// Vocabulary hint biases Deepgram's STT. ConversationRelay has no profanity-
// off toggle, so without these hints Deepgram redacts terms like "anal" and
// "vibrator" to asterisks and Claude can't act on what the caller asked for.
// Keep ≤ ~30 terms; longer lists dilute the bias.
const STT_HINTS = [
  'xdipx',
  'anal', 'vibrator', 'dildo', 'cock ring', 'butt plug', 'plug',
  'lube', 'lubricant', 'harness', 'strap on', 'masturbator',
  'wand', 'rabbit', 'bullet', 'pleasure', 'kink', 'bdsm', 'fetish',
  'lingerie', 'corset', 'bra', 'underwire',
  'lovense', 'fleshlight', 'tenga', 'satisfyer', 'romp', 'icicles', 'oh la la cheri',
].join(',')

/**
 * Returns null when required ConversationRelay config is missing — caller
 * should route to voicemail instead of emitting broken TwiML that Twilio
 * would render as an "application error" to the caller.
 *
 * `limits` is optional: when present, its values are appended as URL params
 * so the Fly WS server can apply admin-configured per-call overrides without
 * a Fly redeploy. The Fly side falls back to its own env-based defaults if
 * any param is missing or unparseable.
 */
function buildTwiml(
  greeting: string,
  voiceId: string,
  limits?: Pick<
    IvrConfig,
    | 'initialSilenceMs'
    | 'interTurnSilenceMs'
    | 'maxCallDurationMs'
    | 'maxPrompts'
    | 'reEngageAttempts'
    | 'softTokenBudget'
  >,
): string | null {
  const base = process.env['IVR_WS_URL'] ?? ''
  const secret = process.env['IVR_WS_SECRET'] ?? ''
  if (!base || !voiceId) {
    console.error('[ivr] missing required config — IVR_WS_URL or active IVR voice not set; falling back to voicemail')
    return null
  }
  // Append shared secret so the Fly WS rejects connections that didn't come
  // via our signed TwiML response. Also forward the resolved greeting so the
  // IVR server can speak it as its first text message — no independent random pick.
  let wsUrl = secret ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(secret)}` : base
  const sep = wsUrl.includes('?') ? '&' : '?'
  wsUrl += `${sep}greeting=${encodeURIComponent(greeting)}`

  if (limits) {
    const params: Record<string, number> = {
      initialSilenceMs: limits.initialSilenceMs,
      interTurnSilenceMs: limits.interTurnSilenceMs,
      maxCallDurationMs: limits.maxCallDurationMs,
      maxPrompts: limits.maxPrompts,
      reEngageAttempts: limits.reEngageAttempts,
      softTokenBudget: limits.softTokenBudget,
    }
    for (const [k, v] of Object.entries(params)) {
      if (Number.isFinite(v) && v > 0) wsUrl += `&${k}=${encodeURIComponent(String(v))}`
    }
  }

  // ConversationRelay keeps the call media on Twilio; we exchange text over WSS.
  // ElevenLabs handles TTS; Deepgram handles STT on Twilio's side.
  // <Start><Siprec> isn't needed — we use Twilio's dual-channel call recording
  // kicked off via <Start><Recording/>. The recording URL is fetched by the
  // status callback in Phase H and stitched onto the voicemail row.
  const appUrl = process.env['APP_URL'] ?? ''
  const recordingCallback = appUrl ? `${appUrl}/api/twilio/recording-status` : ''
  // The greeting is NOT set via welcomeGreeting because that TwiML attribute
  // silently truncates long strings, cutting off greetings with multiple
  // placeholders.  Instead the IVR WebSocket server sends the full greeting
  // as its first text message (the resolved text is in the URL query param).
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Recording recordingStatusCallback="${xmlEscape(recordingCallback)}"/>
  </Start>
  <Connect>
    <ConversationRelay
      url="${xmlEscape(wsUrl)}"
      ttsProvider="ElevenLabs"
      voice="${xmlEscape(voiceId)}"
      transcriptionProvider="Deepgram"
      speechModel="nova-2-phonecall"
      hints="${xmlEscape(STT_HINTS)}"
      profanityFilter="false"
      interruptible="true"
      dtmfDetection="true"
    />
  </Connect>
</Response>`
}

export async function action({ request }: ActionFunctionArgs) {
  // Hoisted so the catch branch can still persist a voicemail row when the
  // crash happens after params are parsed.
  let callSid = ''
  let fromNumber = ''
  try {
    const { ok, params } = await verifyTwilioRequest(request)
    if (!ok) return new Response('Forbidden', { status: 403 })

    fromNumber = params['From'] ?? ''
    callSid = params['CallSid'] ?? ''
    const toNumber = params['To'] ?? null

    const config = await getIvrConfig()

    // Anonymous / blocked callers skip the live agent — voicemail only.
    const isAnonymous = !fromNumber || /anonymous|private|unknown/i.test(fromNumber)
    if (isAnonymous) {
      console.warn(`[ivr] anonymous caller sid=${callSid}`)
      await withTimeout(
        recordRejectedCall(callSid, fromNumber || 'anonymous', toNumber, 'anonymous'),
        2000,
        undefined,
        'recordRejectedCall.anonymous',
      )
      // Blocked callers have no usable callback number.
      await withTimeout(
        persistPlaceholderVoicemail({ callSid, fromNumber, reason: 'anonymous', callbackNumber: null }),
        2500,
        undefined,
        'persistVoicemail.anonymous',
      )
      return twiml(voicemailTwiml(config.voicemailMaxLengthSec, VOICEMAIL_INTROS.anonymous))
    }

    if (fromNumber && (await withTimeout(isRateLimited(fromNumber, config), 2000, false, 'isRateLimited'))) {
      console.warn(`[ivr] rate-limited caller from=${fromNumber} sid=${callSid}`)
      await withTimeout(
        recordRejectedCall(callSid, fromNumber, toNumber, 'rate_limited'),
        2000,
        undefined,
        'recordRejectedCall.rate_limited',
      )
      return twiml(REJECT_TWIML)
    }

    if (!isBusinessHoursNow(config.businessHours, config.businessTz)) {
      console.info(`[ivr] after-hours sid=${callSid} tz=${config.businessTz} window=${config.businessHours}`)
      await withTimeout(
        recordRejectedCall(callSid, fromNumber, toNumber, 'after_hours'),
        2000,
        undefined,
        'recordRejectedCall.after_hours',
      )
      await withTimeout(
        persistPlaceholderVoicemail({ callSid, fromNumber, reason: 'after_hours', callbackNumber: fromNumber || null }),
        2500,
        undefined,
        'persistVoicemail.after_hours',
      )
      return twiml(voicemailTwiml(config.voicemailMaxLengthSec, VOICEMAIL_INTROS.afterHours))
    }

    const greeting = await getGreeting()
    const voiceId = await getActiveIvrVoiceId()
    const xml = buildTwiml(greeting, voiceId, config)
    // Missing env → no valid ConversationRelay TwiML; send caller to voicemail
    // rather than letting Twilio play a generic "application error" message.
    if (!xml) {
      await withTimeout(
        persistPlaceholderVoicemail({ callSid, fromNumber, reason: 'unavailable', callbackNumber: fromNumber || null }),
        2500,
        undefined,
        'persistVoicemail.unavailable',
      )
      return twiml(voicemailTwiml(config.voicemailMaxLengthSec, VOICEMAIL_INTROS.unavailable))
    }
    return twiml(xml)
  } catch (err) {
    // Never throw out of this action — Twilio would serve its generic error
    // message or (worse) Vercel returns FUNCTION_INVOCATION_FAILED. Always
    // return a valid TwiML voicemail response so the caller gets heard.
    console.error('[ivr] voice action crashed — falling back to voicemail', err)
    // Best-effort: persist a row if we got far enough to know the callSid, so
    // the crash-path voicemail is still visible and its recording attaches.
    await withTimeout(
      persistPlaceholderVoicemail({ callSid, fromNumber, reason: 'unavailable', callbackNumber: fromNumber || null }),
      2500,
      undefined,
      'persistVoicemail.catch',
    )
    return twiml(voicemailTwiml(120, VOICEMAIL_INTROS.unavailable))
  }
}

async function isRateLimited(fromNumber: string, config: IvrConfig): Promise<boolean> {
  // 0 (or negative) = disabled — use during testing so every call goes through.
  if (config.maxCallsPerHour <= 0) return false
  if (config.rateLimitAllowlist.has(fromNumber)) return false
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(callLog)
      .where(and(eq(callLog.fromNumber, fromNumber), gte(callLog.createdAt, oneHourAgo)))
    return (rows[0]?.n ?? 0) >= config.maxCallsPerHour
  } catch (err) {
    console.error('[ivr] rate-limit query failed — allowing call', err)
    return false
  }
}

async function recordRejectedCall(
  callSid: string,
  from: string,
  to: string | null,
  endReason: CallEndReason,
): Promise<void> {
  if (!callSid) return
  try {
    await db
      .insert(callLog)
      .values({ callSid, fromNumber: from, toNumber: to, direction: 'inbound', endReason })
      .onConflictDoNothing({ target: callLog.callSid })
  } catch (err) {
    console.error('[ivr] failed to record rejected call', err)
  }
}

/**
 * Returns true when current local time (in `tz`) falls inside the configured
 * hours window. Unconfigured = always open.
 */
function isBusinessHoursNow(window: string, tz: string): boolean {
  if (!window) return true
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(window)
  if (!m) return true
  const openHour = Number(m[1])
  const closeHour = Number(m[2])
  if (!Number.isFinite(openHour) || !Number.isFinite(closeHour)) return true
  // Reject out-of-range hours loudly — otherwise a typo ("25-30") silently
  // bypasses the gate and every caller hits the live agent.
  if (openHour < 0 || openHour > 23 || closeHour < 0 || closeHour > 23) {
    console.warn(`[ivr] business hours out of range: ${window} — gate disabled`)
    return true
  }
  let hour: number
  try {
    const s = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date())
    hour = Number(s.replace(/[^\d]/g, ''))
  } catch {
    return true
  }
  if (!Number.isFinite(hour)) return true
  if (openHour <= closeHour) return hour >= openHour && hour < closeHour
  // Overnight window (e.g., 20-6 = 8pm to 6am)
  return hour >= openHour || hour < closeHour
}

// Twilio always POSTs, but respond to GET in dev so you can preview the TwiML.
export async function loader({ request: _request }: LoaderFunctionArgs) {
  if (process.env['NODE_ENV'] === 'production') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  const voiceId = await getActiveIvrVoiceId()
  const xml = buildTwiml('Hi, thanks for calling xdipx. How can I help you today?', voiceId)
  return twiml(xml ?? voicemailTwiml(120, VOICEMAIL_INTROS.unavailable))
}
