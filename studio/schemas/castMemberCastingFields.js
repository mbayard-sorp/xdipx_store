/**
 * castMember imagery-casting extension (ADR-015, ticket #10730) — ADDITIVE ONLY.
 *
 * Defined in this NEW file (never edit existing field definitions) and spread
 * into castMember.js's fields array, exactly as castMemberEditorialFields.js,
 * castMemberVoiceFields.js, and castMemberBodyFields.js already do.
 *
 * Why this exists: the cast/product casting gate
 * (app/lib/social-cast-target-gate.server.ts) needs to know which
 * `xdipx.cast_target` products ('male' | 'female') a given presenter may be
 * shown ALONE with. `bodyPresentation` is that answer, sourced once from the
 * free-text `description` field every roster member already carries (e.g.
 * "Latino man presenting late 20s" -> masculine). Production/casting
 * metadata only, mirroring bodyReferencePhoto's "never surfaced
 * storefront-side" posture — see ADR-015 §3 and the owner's `/for-him`
 * `/for-her` retirement, which this field must never reopen.
 */

const castMemberCastingFields = [
  {
    name: 'bodyPresentation',
    title: 'Body presentation (imagery casting)',
    type: 'string',
    options: { list: [
      { title: 'Masculine', value: 'masculine' },
      { title: 'Feminine', value: 'feminine' },
    ]},
    description:
      'Which body-target products (xdipx.cast_target) this presenter may be ' +
      'shown alone with. Production/casting metadata only -- never surfaced ' +
      'storefront-side. Backfilled once for the roster from the existing ' +
      'description field; owner ruling 2026-09-22.',
  },
]

export default castMemberCastingFields
