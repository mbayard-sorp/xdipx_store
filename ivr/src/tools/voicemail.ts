/**
 * recordVoicemail — persist a conversational voicemail to Neon and trigger
 * an admin notification. Claude calls this after confirming the caller wants
 * to leave a message and it has a callback number + a written summary.
 */
import { insertVoicemail } from '../db.ts'
import type { Session } from '../session.ts'

const APP_URL = process.env['XDIPX_APP_URL'] ?? 'https://xdipx.com'
const SECRET = process.env['INTERNAL_API_SECRET'] ?? ''

export interface RecordVoicemailInput {
  callbackNumber?: string | undefined
  summary: string
  contextOrderNumber?: string | undefined
}

export async function recordVoicemail(
  session: Session,
  input: RecordVoicemailInput,
): Promise<{ ok: true } | { ok: false; error: string; message?: string }> {
  if (!session.callSid) {
    return { ok: false, error: 'no_call_sid', message: 'Call context missing.' }
  }
  if (!input.summary || input.summary.trim().length < 4) {
    return { ok: false, error: 'summary_required', message: 'Summary is required.' }
  }

  const transcript = session.history
    .map((t) => `${t.role === 'user' ? 'Caller' : 'Agent'}: ${t.content}`)
    .join('\n')

  const callbackNumber = (input.callbackNumber ?? session.fromNumber ?? '').trim() || null

  try {
    await insertVoicemail({
      callSid: session.callSid,
      fromNumber: session.fromNumber,
      callbackNumber,
      summary: input.summary.trim(),
      transcript,
      recordingUrl: null, // populated by Twilio webhook after call ends
      contextOrderNumber: input.contextOrderNumber?.trim() || null,
    })
  } catch (err) {
    return {
      ok: false,
      error: 'db_write_failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  // Fire-and-forget admin notification. Do not block the caller on Klaviyo.
  void fetch(`${APP_URL}/api/internal/notify-voicemail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': SECRET,
    },
    body: JSON.stringify({
      callSid: session.callSid,
      fromNumber: session.fromNumber,
      callbackNumber,
      summary: input.summary.trim(),
      contextOrderNumber: input.contextOrderNumber ?? null,
    }),
  }).catch((err) => {
    console.error('[ivr] notify-voicemail failed', err)
  })

  return { ok: true }
}
