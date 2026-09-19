/**
 * castMember body-reference extension fields (ticket #10270) — ADDITIVE ONLY.
 *
 * Defined in this NEW file (never edit existing field definitions) and spread
 * into castMember.js's fields array, exactly as castMemberEditorialFields.js
 * and castMemberVoiceFields.js already do.
 *
 * Why these exist: section 3.2a is explicit that identity comes from the
 * reference photo and NEVER from the prompt, and that adding appearance words
 * to the prompt is the second most common way identity breaks. `referencePhoto`
 * is a portrait crop, so a macro/close on-skin frame of a hip or sternum (no
 * face in it) has nothing to anchor to: the model invents the skin tone, and
 * the doctrine's "vary skin tone deliberately across assets" becomes
 * unverifiable. `bodyReferencePhoto` gives that crop something real to anchor
 * to, the same way `editorialPhoto` gives the Notebook compositing path
 * something real to anchor to instead of the video-register referencePhoto.
 *
 * Owner sign-off on each cast member's body reference is a separate step from
 * `approvedForUse` (the look overall) and is tracked on the owner blocker
 * list, not a new boolean here — see the blocker filed alongside this ticket.
 */

const castMemberBodyFields = [
  {
    name: 'bodyReferencePhoto',
    title: 'Body reference photo (on-skin register)',
    type: 'image',
    description:
      'Neck-down reference establishing skin tone, body hair, and any tattoos or jewellery that serve as adult identity markers. The on-skin generation path uses this instead of referencePhoto for a macro or close crop that carries no face. Owner sign-off on this photo happens outside Sanity, on the owner blocker list; leaving it empty means the on-skin path falls back to referencePhoto.',
  },
  {
    name: 'skinToneNote',
    title: 'Skin tone note',
    type: 'string',
    description:
      'A plain description (e.g. "warm deep brown", "fair with pink undertones") for the generation brief to STATE rather than the model to invent. Optional; only meaningful once bodyReferencePhoto exists.',
  },
]

export default castMemberBodyFields
