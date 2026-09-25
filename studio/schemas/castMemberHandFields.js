/**
 * castMember hand-reference extension field (ticket #11476) — ADDITIVE ONLY.
 *
 * Defined in this NEW file (never edit existing field definitions) and spread
 * into castMember.js's fields array, exactly as castMemberBodyFields.js and
 * the other extension files already do.
 *
 * Why this exists: `bodyReferencePhoto` (castMemberBodyFields.js) is a single
 * static seated plate, and the on-skin composite path EDITS that plate as a
 * strong pose prior. A briefed hand grip cannot escape that prior: a hand is
 * never pose-neutral the way a tight, cropped edit of the seated pose can be,
 * so a held-product frame built from the body plate alone tends to render
 * with no hand in the frame at all, or the plate's own flat open palm
 * surviving the edit regardless of what the brief asked for. This gives the
 * composite path a second, dedicated reference for the hand itself so a held
 * contact mode has something real to anchor a closed grip to, the same way
 * bodyReferencePhoto gives a macro/close crop something real to anchor skin
 * tone to.
 *
 * Owner sign-off happens outside Sanity, on the owner blocker list, the same
 * process as bodyReferencePhoto — not a new boolean here.
 */

const castMemberHandFields = [
  {
    name: 'handReferencePhoto',
    title: 'Hand reference photo (held-product register)',
    type: 'image',
    description:
      'That member\'s own hand in a closed grip around a neutral cylindrical object, plus an open upturned palm, in the same clinical style and background as bodyReferencePhoto. Passed alongside (never instead of) the presenter reference for a held contact mode (self-held, other-held, drawn), so the composite path has a real hand to anchor a grip to instead of editing the seated body plate. Owner sign-off happens outside Sanity, on the owner blocker list; leaving it empty means a held-contact frame gets no extra hand reference.',
  },
]

export default castMemberHandFields
