/**
 * POST /api/twilio/sms
 *
 * Inbound SMS webhook. Verifies the Twilio signature, then hands off to the
 * shared processSmsMessage() pipeline (STOP/HELP/age-gate/opt-out/rate-limit/
 * Claude).
 *
 * Phase 0.5: pickPipelineVersion() selects v1 or v2 per-request. An allowlist
 * in SMS_V2_PHONES forces v2 for specific phones (dark-launch). The global
 * SMS_PIPELINE_VERSION env controls the default (defaults to 'v1').
 * processSmsMessageV2 is a byte-identical pass-through to v1 in Phase 0.5.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { twiml, verifyTwilioRequest, xmlEscape } from '~/lib/twilio.server'
import { processSmsMessage, isComplianceKeyword, isOptedOut, type SmsSegment } from '~/lib/sms-processor.server'
import { getKillSwitch } from '~/lib/team.server'
import { VALVE_KEYS } from '~/lib/team-keys'
import { processSmsMessageV2 } from '~/lib/sms-v2/processor.server'
import { withTurnLogging } from '~/lib/sms-v2/turn-logger.server'
import { pickPipelineVersion } from '~/lib/sms-v2/pipeline-flag.server'

/**
 * Build a TwiML response with one <Message> per segment. Segments with a
 * mediaUrl include a <Media> child so Twilio sends them as MMS — image
 * preview attached, body text alongside. Carriers that don't support MMS
 * fall back to body-only delivery, so the text always lands.
 */
function repliesTwiml(segments: SmsSegment[]): string {
  const messages = segments
    .filter((s) => s.body)
    .map((s) => {
      const body = `<Body>${xmlEscape(s.body)}</Body>`
      const media = s.mediaUrl ? `<Media>${xmlEscape(s.mediaUrl)}</Media>` : ''
      return `<Message>${body}${media}</Message>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${messages}</Response>`
}

const EMPTY_TWIML = `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`

// Static (never AI-generated) holding reply for the sms_agent_enabled-off
// state. Honest about the channel being down, points at a human, no promises
// about timing, no em-dashes. Emma-empathy-reviewed 2026-08-01.
const AGENT_OFF_HOLDING_REPLY =
  "Hey, this is xdipx. We can't text back right now, but you can reach us at hello@xdipx.com or xdipx.com. Thanks for your patience."

export async function action({ request }: ActionFunctionArgs) {
  try {
    return await handleSmsAction(request)
  } catch (err) {
    // Never throw out of the action — Vercel would return FUNCTION_INVOCATION_FAILED
    // and Twilio would retry with exponential backoff, amplifying the outage.
    // Empty TwiML = 200 with no auto-reply, which is safe.
    console.error('[sms] action crashed — returning empty TwiML', err)
    return twiml(EMPTY_TWIML)
  }
}

async function handleSmsAction(request: Request): Promise<Response> {
  const { ok, params } = await verifyTwilioRequest(request)
  if (!ok) return new Response('Forbidden', { status: 403 })

  const from = (params['From'] ?? '').trim()
  const body = (params['Body'] ?? '').trim()
  const twilioSid = params['MessageSid'] ?? params['SmsMessageSid'] ?? ''

  const version = pickPipelineVersion(from)
  const input = { from, body, twilioSid, simulated: false }

  // Kill switch (076): when sms_agent_enabled is 'false' the conversational
  // agent is off, but carrier-required STOP/HELP/START keywords still route
  // through v1's compliance path — an off switch must never make an opt-out
  // request go unrecorded. Everyone else gets one static holding reply
  // (emma-empathy-reviewer: dead air on a support channel reads as being
  // ignored or judged; a brief honest pointer to a human closes the loop).
  // Opted-out numbers stay silent — they revoked consent to receive texts.
  // Fail-open read: missing row or slow DB keeps the channel live.
  if (!(await getKillSwitch(VALVE_KEYS.smsAgentEnabled))) {
    if (isComplianceKeyword(body)) {
      const complianceResult = await withTurnLogging(input, processSmsMessage, 'v1')
      if (complianceResult.replies.length === 0) return twiml(EMPTY_TWIML)
      return twiml(repliesTwiml(complianceResult.replies))
    }
    if (await isOptedOut(from)) return twiml(EMPTY_TWIML)
    console.warn(`[sms] sms_agent_enabled=false — holding reply for from=${from}`)
    return twiml(repliesTwiml([{ body: AGENT_OFF_HOLDING_REPLY }]))
  }

  // v2 owns its own turn-logging (per-stage observability is built into
  // processSmsMessageV2 in Phase 5.5). v1 is unchanged — the route wraps it
  // with withTurnLogging so v1 turns are logged with pipeline_version='v1'.
  const result =
    version === 'v2'
      ? await processSmsMessageV2(input)
      : await withTurnLogging(input, processSmsMessage, 'v1')

  if (result.replies.length === 0) return twiml(EMPTY_TWIML)
  return twiml(repliesTwiml(result.replies))
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  if (process.env['NODE_ENV'] === 'production') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return twiml(EMPTY_TWIML)
}
