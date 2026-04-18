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
import { callLog, pipelineSettings } from '../../db/schema'

const MAX_CALLS_PER_HOUR = Number(process.env['IVR_MAX_CALLS_PER_HOUR'] ?? 5)

// Comma-separated E.164 numbers (e.g. "+18187267258,+15551234567") that bypass
// the per-hour rate limit. Use for staff/test phones during dev.
const RATE_LIMIT_ALLOWLIST = new Set(
  (process.env['IVR_RATE_LIMIT_ALLOWLIST'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

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
const BUSINESS_HOURS = process.env['IVR_BUSINESS_HOURS'] ?? ''
const BUSINESS_TZ = process.env['IVR_BUSINESS_TZ'] ?? 'America/Chicago'

const REJECT_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We've got too many calls from this number right now. Try again in an hour, or reach us online at ex-dip dot com.</Say>
  <Hangup/>
</Response>`

function afterHoursTwiml(): string {
  const appUrl = process.env['APP_URL'] ?? ''
  const cb = appUrl ? `${appUrl}/api/twilio/recording-status` : '/api/twilio/recording-status'
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hey — you've reached ex-dip. We're closed right now but leave a message after the beep and we'll get back to you first thing.</Say>
  <Record maxLength="120" playBeep="true" trim="trim-silence" recordingStatusCallback="${xmlEscape(cb)}"/>
  <Say voice="Polly.Joanna">Thanks — talk soon.</Say>
  <Hangup/>
</Response>`
}

const DEFAULT_GREETING =
  "Hey, you've reached ex-dip. I'm {feeling} you called. This call may be recorded. What's going on?"

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
  return template.replace('{feeling}', feeling).replace('{activity}', activity)
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
 */
function buildTwiml(greeting: string): string | null {
  const base = process.env['IVR_WS_URL'] ?? ''
  const secret = process.env['IVR_WS_SECRET'] ?? ''
  const voiceId = process.env['ELEVENLABS_VOICE_ID_IVR'] ?? ''
  if (!base || !voiceId) {
    console.error('[ivr] missing required env — IVR_WS_URL or ELEVENLABS_VOICE_ID_IVR not set; falling back to voicemail')
    return null
  }
  // Append shared secret so the Fly WS rejects connections that didn't come
  // via our signed TwiML response. Also forward the resolved greeting so the
  // IVR server can speak it as its first text message — no independent random pick.
  let wsUrl = secret ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(secret)}` : base
  const sep = wsUrl.includes('?') ? '&' : '?'
  wsUrl += `${sep}greeting=${encodeURIComponent(greeting)}`

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
  try {
    const { ok, params } = await verifyTwilioRequest(request)
    if (!ok) return new Response('Forbidden', { status: 403 })

    const fromNumber = params['From'] ?? ''
    const callSid = params['CallSid'] ?? ''
    const toNumber = params['To'] ?? null

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
      return twiml(afterHoursTwiml())
    }

    if (fromNumber && (await withTimeout(isRateLimited(fromNumber), 2000, false, 'isRateLimited'))) {
      console.warn(`[ivr] rate-limited caller from=${fromNumber} sid=${callSid}`)
      await withTimeout(
        recordRejectedCall(callSid, fromNumber, toNumber, 'rate_limited'),
        2000,
        undefined,
        'recordRejectedCall.rate_limited',
      )
      return twiml(REJECT_TWIML)
    }

    if (!isBusinessHoursNow()) {
      console.info(`[ivr] after-hours sid=${callSid} tz=${BUSINESS_TZ} window=${BUSINESS_HOURS}`)
      await withTimeout(
        recordRejectedCall(callSid, fromNumber, toNumber, 'after_hours'),
        2000,
        undefined,
        'recordRejectedCall.after_hours',
      )
      return twiml(afterHoursTwiml())
    }

    const greeting = await getGreeting()
    const xml = buildTwiml(greeting)
    // Missing env → no valid ConversationRelay TwiML; send caller to voicemail
    // rather than letting Twilio play a generic "application error" message.
    if (!xml) return twiml(afterHoursTwiml())
    return twiml(xml)
  } catch (err) {
    // Never throw out of this action — Twilio would serve its generic error
    // message or (worse) Vercel returns FUNCTION_INVOCATION_FAILED. Always
    // return a valid TwiML voicemail response so the caller gets heard.
    console.error('[ivr] voice action crashed — falling back to voicemail', err)
    return twiml(afterHoursTwiml())
  }
}

async function isRateLimited(fromNumber: string): Promise<boolean> {
  // 0 (or negative) = disabled — use during testing so every call goes through.
  if (MAX_CALLS_PER_HOUR <= 0) return false
  if (RATE_LIMIT_ALLOWLIST.has(fromNumber)) return false
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(callLog)
      .where(and(eq(callLog.fromNumber, fromNumber), gte(callLog.createdAt, oneHourAgo)))
    return (rows[0]?.n ?? 0) >= MAX_CALLS_PER_HOUR
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
 * Returns true when current local time (in BUSINESS_TZ) falls inside the
 * configured hours window. Unconfigured = always open.
 */
function isBusinessHoursNow(): boolean {
  if (!BUSINESS_HOURS) return true
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(BUSINESS_HOURS)
  if (!m) return true
  const openHour = Number(m[1])
  const closeHour = Number(m[2])
  if (!Number.isFinite(openHour) || !Number.isFinite(closeHour)) return true
  // Reject out-of-range hours loudly — otherwise a typo ("25-30") silently
  // bypasses the gate and every caller hits the live agent.
  if (openHour < 0 || openHour > 23 || closeHour < 0 || closeHour > 23) {
    console.warn(`[ivr] IVR_BUSINESS_HOURS out of range: ${BUSINESS_HOURS} — gate disabled`)
    return true
  }
  let hour: number
  try {
    const s = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: BUSINESS_TZ }).format(new Date())
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
  const xml = buildTwiml('Hi, thanks for calling xdipx. How can I help you today?')
  return twiml(xml ?? afterHoursTwiml())
}
