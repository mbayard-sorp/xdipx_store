/**
 * POST /api/twilio/recording-status
 *
 * Twilio fires this when a <Start><Recording/> finalises. We match on CallSid
 * and paint the recording URL onto any voicemail row already persisted by the
 * IVR bridge. Rows without a voicemail (silent-caller hangups, FAQ-only calls)
 * are ignored — the recording exists in Twilio's storage regardless.
 *
 * Wire this URL into the phone number's recordingStatusCallback, or on the
 * <Recording recordingStatusCallback="…"/> verb in TwiML.
 */
import type { ActionFunctionArgs } from 'react-router'
import { eq } from 'drizzle-orm'
import { verifyTwilioRequest } from '~/lib/twilio.server'
import { db } from '~/lib/db.server'
import { voicemails } from '../../db/schema'

export async function action({ request }: ActionFunctionArgs) {
  const { ok, params } = await verifyTwilioRequest(request)
  if (!ok) return new Response('Forbidden', { status: 403 })

  const callSid = params['CallSid'] ?? ''
  const recordingUrl = params['RecordingUrl'] ?? ''
  const status = params['RecordingStatus'] ?? ''

  if (!callSid || !recordingUrl || status !== 'completed') {
    return new Response('ok', { status: 200 })
  }

  try {
    await db
      .update(voicemails)
      .set({ recordingUrl })
      .where(eq(voicemails.callSid, callSid))
  } catch (err) {
    console.error('[ivr] recording-status update failed', err)
  }

  return new Response('ok', { status: 200 })
}
