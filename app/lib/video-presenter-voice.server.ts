/**
 * Resolves which ElevenLabs voice a video job's speaking presenter uses
 * (ticket #6584).
 *
 * Before this file existed, every video TTS call resolved its voice through
 * getActiveIvrVoiceId() (app/lib/ivr-voice.server.ts) — a lookup meant for the
 * phone support line. That coupled the video pipeline to an IVR decision (a
 * phone voice swap silently reflowed every video render) and gave every cast
 * member the same one voice: the support line's.
 *
 * Kept in its own file, not inlined in video-pipeline.server.ts, so it stays
 * cheaply unit-testable against a mocked sanity.server without pulling in
 * that file's full db/blob/token-log import graph.
 */

import { getApprovedCastMembers } from '~/lib/sanity.server'
import { getActiveIvrVoiceId } from '~/lib/ivr-voice.server'

/**
 * Resolution order: a friend cast member's own Sanity voiceId; a dedicated
 * Emma video voice (env ELEVENLABS_VOICE_ID_EMMA) for 'emma' and 'none'
 * (narration with no on-screen presenter is Emma's line); hard fail for a
 * friend with no voiceId assigned rather than substituting the IVR or Emma
 * voice — a character speaking in the wrong voice is a brand defect a $2
 * render is the wrong place to discover.
 *
 * ELEVENLABS_VOICE_ID_EMMA is optional and not yet configured anywhere, so
 * 'emma'/'none' fall back to today's getActiveIvrVoiceId() lookup until the
 * owner sets it — no behavior change for existing single-Emma jobs. Setting
 * it is the decoupling step: once set, video Emma audio stops depending on
 * the IVR table entirely.
 */
export async function resolvePresenterVoiceId(presenter: string): Promise<string> {
  if (presenter === 'none' || presenter === 'emma') {
    const dedicated = process.env['ELEVENLABS_VOICE_ID_EMMA']
    if (dedicated) return dedicated
    return getActiveIvrVoiceId()
  }
  if (presenter.startsWith('friend:')) {
    const slug = presenter.slice('friend:'.length)
    const cast = await getApprovedCastMembers()
    const member = cast.find(m => m.slug === slug)
    // Fail fast — never silently substitute Emma/IVR for an unapproved character.
    if (!member) throw new Error(`Cast member '${slug}' not found or not approved for use (castMember.approvedForUse)`)
    if (!member.voiceId) {
      throw new Error(
        `Cast member '${slug}' has no voiceId assigned in Sanity. Refusing to enqueue rather than render this ` +
        'character in the IVR or Emma voice; assign a voice on the castMember doc first.',
      )
    }
    return member.voiceId
  }
  throw new Error(`Unknown presenter '${presenter}' (expected none | emma | friend:{slug})`)
}
