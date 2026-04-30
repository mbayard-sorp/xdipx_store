/**
 * POST /api/twilio/sms
 *
 * Inbound SMS webhook. Verifies the Twilio signature, then hands off to the
 * shared processSmsMessage() pipeline (STOP/HELP/age-gate/opt-out/rate-limit/
 * Claude). The same pipeline backs the /admin/sms-tester simulator with
 * `simulated: true` so the two paths can never drift.
 *
 * Phase 0: every turn is wrapped in withTurnLogging() which writes to
 * sms_turns and deduplicates Twilio retries via the twilio_message_sid unique
 * index. SMS_PIPELINE_VERSION env var defaults to 'v1'; 'v2' is a no-op in
 * Phase 0 (logs a warning and falls through to v1).
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { twiml, verifyTwilioRequest, xmlEscape } from '~/lib/twilio.server'
import { processSmsMessage, type SmsSegment } from '~/lib/sms-processor.server'
import { withTurnLogging } from '~/lib/sms-v2/turn-logger.server'

const PIPELINE_VERSION = (process.env['SMS_PIPELINE_VERSION'] ?? 'v1').trim()

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

  if (PIPELINE_VERSION !== 'v1') {
    console.warn(`[sms] SMS_PIPELINE_VERSION=${PIPELINE_VERSION} is not yet wired — falling through to v1`)
  }

  const result = await withTurnLogging(
    { from, body, twilioSid, simulated: false },
    processSmsMessage,
    'v1',
  )
  if (result.replies.length === 0) return twiml(EMPTY_TWIML)
  return twiml(repliesTwiml(result.replies))
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  if (process.env['NODE_ENV'] === 'production') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return twiml(EMPTY_TWIML)
}
