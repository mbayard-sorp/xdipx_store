/**
 * castMember voice extension (ticket #6584) — ADDITIVE ONLY.
 *
 * Defined in this NEW file (never edit existing field definitions) and spread
 * into castMember.js's fields array, same pattern as
 * ./castMemberEditorialFields.js.
 *
 * Why this exists: every video TTS call resolved its voice through
 * getActiveIvrVoiceId(), an IVR-scoped (phone support) lookup with no
 * presenter->voice mapping anywhere in the tree. That means every cast member
 * spoke in the phone support voice, and flipping the phone voice would
 * silently reflow every video render. voiceId gives each character their own
 * ElevenLabs voice so the video pipeline can stop depending on the IVR table.
 */

const castMemberVoiceFields = [
  {
    name: 'voiceId',
    title: 'ElevenLabs voice ID',
    type: 'string',
    description:
      'This character\'s ElevenLabs voice for video TTS (avatar speech, lipsync perform). Distinct from ' +
      'the IVR phone-support voice and from Emma\'s own voice. The video pipeline refuses to enqueue this ' +
      'character rather than substitute another voice when this is empty — assign one here first, or use ' +
      'the voice audition script to confirm it against the character\'s speech signature.',
  },
]

export default castMemberVoiceFields
