/**
 * app/lib/ivr-voicemail.server.ts
 *
 * Shared voicemail persistence + admin notification for the Twilio <Record>
 * gates that run WITHOUT the live agent.
 *
 * The live-agent path (Fly.io IVR bridge) inserts its own `voicemails` row and
 * then calls /api/internal/notify-voicemail. But the pre-agent gates in
 * api.twilio.voice.tsx (after-hours / anonymous / unavailable) and the fallback
 * handler (api.twilio.voice-fallback.tsx) drop straight to <Record> without the
 * Fly bridge, so nothing ever wrote a `voicemails` row for them. The message
 * went into a black hole: invisible to /admin/voicemails, no Klaviyo notify,
 * and the recording-status callback — a pure UPDATE keyed on callSid — had no
 * row to paint the recording URL onto.
 *
 * persistPlaceholderVoicemail() closes that gap by inserting the row at Record
 * time (idempotent on callSid, matching recordRejectedCall's precedent) and
 * firing the same notify the internal endpoint fires. recording-status stays a
 * pure UPDATE that later attaches the recording URL to this row.
 */
import { trackEvent } from './klaviyo.server'
import { db } from './db.server'
import { voicemails } from '../../db/schema'

export type VoicemailGateReason = 'after_hours' | 'anonymous' | 'unavailable' | 'fallback'

// Internal admin summaries — shown in /admin/voicemails and the Klaviyo notify
// email to the team, never spoken to the caller. Nothing transcribes the raw
// recording at record time, so the summary points staff at the audio.
const PLACEHOLDER_SUMMARIES: Record<VoicemailGateReason, string> = {
  after_hours: 'Voicemail left after hours. No live transcript, listen to the recording.',
  anonymous:   'Voicemail left by a blocked or anonymous caller. No live transcript, listen to the recording.',
  unavailable: 'Voicemail left while the live agent was unavailable. No live transcript, listen to the recording.',
  fallback:    'Voicemail left via the fallback handler. No live transcript, listen to the recording.',
}

export interface VoicemailNotifyPayload {
  callSid: string
  fromNumber: string
  callbackNumber: string | null
  summary: string
  contextOrderNumber: string | null
}

/**
 * Fire the admin Klaviyo notification for a received voicemail. Swallows all
 * errors and honours ADMIN_NOTIFICATION_EMAIL exactly as the internal endpoint
 * did — a notify failure must never break the TwiML response the caller is
 * waiting on, and the row is already persisted regardless. Returns whether the
 * event was actually sent.
 */
export async function notifyVoicemailReceived(payload: VoicemailNotifyPayload): Promise<boolean> {
  const adminEmail = process.env['ADMIN_NOTIFICATION_EMAIL']
  if (!adminEmail) {
    console.warn('[ivr-voicemail] ADMIN_NOTIFICATION_EMAIL not set — skipping Klaviyo notify')
    return false
  }
  try {
    await trackEvent(adminEmail, 'IVR Voicemail Received', {
      call_sid: payload.callSid,
      from_number: payload.fromNumber,
      callback_number: payload.callbackNumber,
      summary: payload.summary,
      context_order_number: payload.contextOrderNumber,
      admin_url: 'https://xdipx.com/admin/voicemails',
    })
    return true
  } catch (err) {
    console.error('[ivr-voicemail] klaviyo notify failed', err)
    return false
  }
}

/**
 * Insert a placeholder `voicemails` row for a pre-agent <Record> gate and fire
 * the admin notify. Never throws.
 *
 * Idempotent on callSid via onConflictDoNothing, so a retried webhook — or the
 * live-agent path, if it ever raced this — cannot duplicate the row, and the
 * notify only fires when THIS call actually inserted the row. `summary` and
 * `transcript` are NOT NULL in the schema and nothing transcribes the raw
 * recording here, so we store a human placeholder summary and an empty
 * transcript; the recording URL is attached later by recording-status.
 */
export async function persistPlaceholderVoicemail(args: {
  callSid: string
  fromNumber: string
  reason: VoicemailGateReason
  callbackNumber?: string | null
  contextOrderNumber?: string | null
}): Promise<void> {
  const { callSid, reason } = args
  // No callSid means no way to key the row or attach the recording later — skip
  // rather than insert an unjoinable row. (Guards the voice.tsx catch branch,
  // where a crash before params are parsed leaves callSid empty.)
  if (!callSid) return

  const fromNumber = args.fromNumber || 'anonymous'
  const summary = PLACEHOLDER_SUMMARIES[reason]
  const callbackNumber = args.callbackNumber ?? null
  const contextOrderNumber = args.contextOrderNumber ?? null

  try {
    const inserted = await db
      .insert(voicemails)
      .values({
        callSid,
        fromNumber,
        callbackNumber,
        summary,
        transcript: '',
        contextOrderNumber,
      })
      .onConflictDoNothing({ target: voicemails.callSid })
      .returning({ id: voicemails.id })

    // Empty result means the row already existed (its notify already fired).
    if (inserted.length > 0) {
      await notifyVoicemailReceived({ callSid, fromNumber, callbackNumber, summary, contextOrderNumber })
    }
  } catch (err) {
    console.error('[ivr-voicemail] failed to persist placeholder voicemail', err)
  }
}
