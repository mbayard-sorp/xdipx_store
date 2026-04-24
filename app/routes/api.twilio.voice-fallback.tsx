/**
 * POST /api/twilio/voice-fallback
 *
 * Twilio hits this URL if the primary /api/twilio/voice handler errors OR if
 * the Fly WebSocket is unreachable. We degrade to a simple <Say> + <Record>
 * voicemail flow so the caller is never left hanging.
 *
 * Wire this URL into the Twilio phone number's "Primary Handler Fails" field.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { twiml, verifyTwilioRequest, xmlEscape } from '~/lib/twilio.server'
import { normalizeForTTS } from '~/lib/tts-normalize'

function fallbackTwiml(): string {
  const appUrl = process.env['APP_URL'] ?? ''
  const cb = appUrl ? `${appUrl}/api/twilio/recording-status` : '/api/twilio/recording-status'
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${xmlEscape(normalizeForTTS("Hey — you've reached ex-dip-ex. We're having a hiccup answering live right now. Leave a message after the beep and we'll get back to you."))}</Say>
  <Record maxLength="120" playBeep="true" trim="trim-silence" recordingStatusCallback="${xmlEscape(cb)}"/>
  <Say voice="Polly.Joanna">${xmlEscape(normalizeForTTS('Thanks — talk soon.'))}</Say>
  <Hangup/>
</Response>`
}

export async function action({ request }: ActionFunctionArgs) {
  const { ok } = await verifyTwilioRequest(request)
  if (!ok) return new Response('Forbidden', { status: 403 })
  console.info('[ivr] fallback triggered')
  return twiml(fallbackTwiml())
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  if (process.env['NODE_ENV'] === 'production') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return twiml(fallbackTwiml())
}
