/**
 * castMember editorial extension fields (ticket #2751) — ADDITIVE ONLY.
 *
 * Defined in this NEW file (never edit existing field definitions) and spread
 * into castMember.js's fields array, so existing castMember content and the
 * original schema definitions are untouched.
 *
 * Why these exist:
 *   - archetype / ageRange / description / emotionTags make the roster
 *     SELECTABLE programmatically. Without them, any agent picking a presenter
 *     per post had to open each photo and eyeball it — the exact hand-judgment
 *     that let the same light/young pattern recur (run-269 keeper note).
 *     A post's reader-emotion is matched against emotionTags instead of
 *     guessed.
 *   - editorialPhoto exists because referencePhotos were shot for VIDEO
 *     presenting and their wardrobe register propagates into every downstream
 *     frame (docs/media-model-routing.md: Maya's deep-V referencePhoto carried
 *     its neckline into frames briefed as elevated loungewear; not fixable
 *     with prompt negatives). Notebook §0-H compositing reads
 *     editorialPhoto ?? referencePhoto; the video pipeline keeps reading
 *     referencePhoto so identity consistency across existing videos is
 *     unaffected.
 */

const castMemberEditorialFields = [
  {
    name: 'archetype',
    title: 'Archetype',
    type: 'string',
    description:
      'One-line selection handle for agents (e.g. "warm best friend", "calm minimalist"). Complements shortBio, which is admin flavor.',
  },
  {
    name: 'ageRange',
    title: 'Age range (presented)',
    type: 'string',
    description:
      'The age the character visually presents, e.g. "early 30s". Written explicitly because generation models drift young and prompts must state adult age markers.',
  },
  {
    name: 'description',
    title: 'Selection description',
    type: 'text',
    rows: 3,
    description:
      'Queryable physical description for deliberate, rotatable casting: age presentation, build, skin tone, hair. What an agent needs to pick WITHOUT opening the photo.',
  },
  {
    name: 'emotionTags',
    title: 'Emotion tags',
    type: 'array',
    of: [{ type: 'string' }],
    options: { layout: 'tags' },
    description:
      'Reader-emotions this presenter carries well (e.g. "tender", "playful", "reassured", "confident"). A post\'s reader-emotion is matched against these instead of guessed from the photo.',
  },
  {
    name: 'editorialPhoto',
    title: 'Editorial photo (Notebook register)',
    type: 'image',
    description:
      'Crew-neck, waist-up, plain coral-soft or plum-soft ground. The Notebook §0-H compositing path reads editorialPhoto ?? referencePhoto; the video pipeline keeps using referencePhoto. Exists because the video-register referencePhoto\'s wardrobe propagates into composited frames (see docs/media-model-routing.md).',
  },
]

export default castMemberEditorialFields
