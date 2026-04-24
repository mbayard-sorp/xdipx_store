import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { ivrVoices } from '../../db/schema'

export async function getActiveIvrVoiceId(): Promise<string> {
  try {
    const rows = await db
      .select({ voiceId: ivrVoices.voiceId })
      .from(ivrVoices)
      .where(eq(ivrVoices.active, true))
      .limit(1)
    if (rows[0]?.voiceId) return rows[0].voiceId
  } catch (err) {
    console.error('[ivr-voice] DB lookup failed — falling back to env', err)
  }
  return process.env['ELEVENLABS_VOICE_ID_IVR'] ?? ''
}
