/**
 * The scene-axis vocabulary, in ONE place (ticket #10480).
 *
 * Before this module the four variety axes existed as three unlinked copies:
 * the header comments of `db/migrations/099_social_scene_variety_fields.sql`,
 * the art director's row-fields block, and the literal sets inside
 * `social-mix-report.server.ts`. Nothing validated against any of them. The
 * draft op checked `typeof string && length <= 40`, so `hip_hollow` or
 * `Hip-Hollow` persisted cleanly and then matched neither `CEILING_ZONES` nor
 * `MID_ZONES`, which is a typo turning into an invisible hole in the
 * compliance report rather than a 400 the caller can fix.
 *
 * This is the data-and-query standard the conversation-channels audit wrote
 * down (`docs/audits/conversation-channels-product-lookup-audit-2026-08-04.md`):
 * canonical vocab is imported, never re-typed. `social-mix-report.server.ts`
 * declares its own `CEILING_ZONES` / `MID_ZONES` / `PLUG_ZONE` /
 * `CLOSE_CROP_SCALES` as local `Set` literals rather than importing from
 * here, but `social-mix-report.server.test.ts` asserts each of those sets is
 * a subset of `BODY_ZONES` / `CROP_SCALES` above, so the report can never
 * classify against a token the writers cannot produce — the guarantee is
 * test-enforced, not import-enforced.
 *
 * Pure constants and pure functions only, no `.server` suffix: the same
 * vocabulary is used by the generation route, the draft route, the rework
 * parser and the report, and nothing here touches a database or a secret.
 *
 * THE "none" SENTINEL. The art director is instructed to emit `bodyZone:
 * "none"` for a frame that touches no bare skin, and `contactMode: "none"`
 * the same way. That is a real answer, not a missing one: it says "this frame
 * was judged and it is not an on-skin frame", which is exactly the
 * distinction `null` cannot make. The vocabulary carries it explicitly and
 * every reader has to treat it as "known, not on-skin" rather than as an
 * on-skin frame in an unnamed zone.
 */

/** A frame the writer judged and found carries no bare skin / no contact. */
export const NON_SKIN_SENTINEL = 'none'

/**
 * Body zones. The migration-099 header list, plus the two the on-skin
 * campaign added after it was written:
 *  - `gluteal-cleft`, the plug placement §3.2c licenses at one per rolling 7
 *    (it is a `CEILING_ZONES` member in the report, so it must be in here or
 *    the subset test fails);
 *  - `top-of-thigh`, which is the spelling in use, kept alongside the
 *    migration header's `thigh-top` rather than silently dropping either.
 *    Both name the same zone; the report assigns neither a charge tier.
 * `nape` stays in the vocabulary although §3.2c retired it as a MID zone: it
 * is still a writable value, it simply scores as neither tier.
 */
export const BODY_ZONES = [
  'hip-hollow',
  'sternum',
  'small-of-back',
  'nape',
  'inner-wrist',
  'forearm',
  'stomach',
  'thigh-top',
  'top-of-thigh',
  'behind-knee',
  'shoulder-blade',
  'ankle',
  'gluteal-cleft',
  NON_SKIN_SENTINEL,
] as const
export type BodyZone = (typeof BODY_ZONES)[number]

/** Contact modes, migration 099's header list plus the `none` sentinel. */
export const CONTACT_MODES = [
  'resting',
  'self-held',
  'other-held',
  'drawn',
  'worn',
  'balanced',
  NON_SKIN_SENTINEL,
] as const
export type ContactMode = (typeof CONTACT_MODES)[number]

/**
 * Crop scales. No `none` sentinel: every frame has a crop, so an absent value
 * here is a genuine omission rather than a judgment.
 */
export const CROP_SCALES = ['macro', 'close', 'medium', 'wide'] as const
export type CropScale = (typeof CROP_SCALES)[number]

/**
 * Scene location is deliberately NOT a closed enum. The other three axes are
 * a fixed vocabulary the campaign doc enumerates; locations are open-ended by
 * design (§3.8 asks for rotation, not for a list), and closing the set here
 * would refuse the first legitimately new room.
 *
 * It is NORMALIZED rather than refused, for the same reason the draft op
 * backfills instead of 400-ing: the location window is an equality compare,
 * so `Bedroom Loft`, `bedroom_loft` and `bedroom-loft` are one location
 * written three ways and would rotate as three. Lowercase kebab-case is the
 * convention migration 093 documents (`bedroom-loft`, `bathroom-spa`), so
 * every value is coerced to it. The only failure is a value that normalizes
 * to nothing, or one still over the column's 80 characters afterwards.
 */
export const SCENE_LOCATION_MAX = 80

export function normalizeSceneLocation(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isBodyZone(v: unknown): v is BodyZone {
  return typeof v === 'string' && (BODY_ZONES as readonly string[]).includes(v)
}
export function isContactMode(v: unknown): v is ContactMode {
  return typeof v === 'string' && (CONTACT_MODES as readonly string[]).includes(v)
}
export function isCropScaleValue(v: unknown): v is CropScale {
  return typeof v === 'string' && (CROP_SCALES as readonly string[]).includes(v)
}
export function isSceneLocation(v: unknown): boolean {
  if (typeof v !== 'string') return false
  const slug = normalizeSceneLocation(v)
  return slug.length > 0 && slug.length <= SCENE_LOCATION_MAX
}

/** The four axes, as one optional bag. Every field is independently optional. */
export interface SceneAxes {
  bodyZone?: string | undefined
  contactMode?: string | undefined
  cropScale?: string | undefined
  sceneLocation?: string | undefined
}

export const SCENE_AXIS_KEYS = ['bodyZone', 'contactMode', 'cropScale', 'sceneLocation'] as const
export type SceneAxisKey = (typeof SCENE_AXIS_KEYS)[number]

export type SceneAxisValidation =
  | { ok: true; value: string }
  | { ok: false; error: string }

/**
 * Validate one axis value against the vocabulary. Returns the trimmed value
 * so a caller never persists a token that differs from what it validated.
 */
export function validateSceneAxis(key: SceneAxisKey, raw: unknown): SceneAxisValidation {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: `${key}, when present, must be a non-empty string` }
  }
  const value = raw.trim()
  switch (key) {
    case 'bodyZone':
      return isBodyZone(value)
        ? { ok: true, value }
        : { ok: false, error: `bodyZone must be one of ${BODY_ZONES.join('|')}` }
    case 'contactMode':
      return isContactMode(value)
        ? { ok: true, value }
        : { ok: false, error: `contactMode must be one of ${CONTACT_MODES.join('|')}` }
    case 'cropScale':
      return isCropScaleValue(value)
        ? { ok: true, value }
        : { ok: false, error: `cropScale must be one of ${CROP_SCALES.join('|')}` }
    case 'sceneLocation':
      // Coerced to the kebab-case convention, never refused for its shape:
      // "Bedroom Loft" and "bedroom-loft" are one location, and the rotation
      // window compares by equality.
      return isSceneLocation(value)
        ? { ok: true, value: normalizeSceneLocation(value) }
        : {
            ok: false,
            error:
              'sceneLocation must be a location slug of at most ' +
              `${SCENE_LOCATION_MAX} characters once normalized (e.g. bedroom-loft, bathroom-spa)`,
          }
  }
}

export type SceneAxesParse =
  | { ok: true; axes: SceneAxes }
  | { ok: false; error: string }

/**
 * Validate every axis present on a payload. Absent keys stay absent (this is
 * never a requirement check: ticket #10479 is explicit that a missing axis is
 * backfilled from the asset, never 400'd at draft time, because a 400 there
 * strands an image that has already been generated and billed). A PRESENT but
 * out-of-vocabulary value is an error, because that one is free to fix and
 * expensive to leave: it persists and then classifies as nothing.
 */
export function parseSceneAxes(raw: Record<string, unknown>, prefix = ''): SceneAxesParse {
  const axes: SceneAxes = {}
  for (const key of SCENE_AXIS_KEYS) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    // An empty or whitespace-only string is "I do not have one", which is the
    // absent case, not a bad token. Refusing it would 400 a draft over a
    // frame that is already paid for, for no information gained.
    if (typeof value === 'string' && value.trim() === '') continue
    const parsed = validateSceneAxis(key, value)
    if (!parsed.ok) return { ok: false, error: `Bad Request: ${prefix}${parsed.error}` }
    axes[key] = parsed.value
  }
  return { ok: true, axes }
}

/**
 * Which of the four axes generation MUST supply, given the parsed set
 * (ticket #10501). `parseSceneAxes` only ever validates a value that is
 * PRESENT — every axis stays optional there by design, because a 400 at
 * draft time would strand an already-billed image (see that function's own
 * doc comment). Generation is the opposite: it runs before any money is
 * spent, so a missing axis there costs exactly one retry, not a stranded
 * frame. Two call sites need the identical rule (the CLI,
 * `scripts/gen-social-image.ts`, and the route it delegates to,
 * `app/routes/api.team.social-image.tsx`, which a caller could hit directly
 * and route around the CLI's own check), so the rule lives here once rather
 * than being retyped at both.
 *
 * `sceneLocation` is required unconditionally — it is the one axis with no
 * `NON_SKIN_SENTINEL`, so there is no "not applicable" answer for it to
 * carry. `bodyZone` and `contactMode` are required only when `cropScale` is
 * `macro` or `close`: those are the on-skin crops (docs/store-team/
 * routine-social-daily.md §5.0a), and a wide or medium crop legitimately has
 * neither a zone nor a contact mode to report.
 */
export function requireSceneAxesForGeneration(axes: SceneAxes): { ok: true } | { ok: false; error: string } {
  if (!axes.sceneLocation) {
    return { ok: false, error: 'sceneLocation is required on every social image generation' }
  }
  if ((axes.cropScale === 'macro' || axes.cropScale === 'close') && (!axes.bodyZone || !axes.contactMode)) {
    return { ok: false, error: `bodyZone and contactMode are required when cropScale is ${axes.cropScale}` }
  }
  return { ok: true }
}

// --- Asset tag encoding ----------------------------------------------------

/**
 * How an axis rides on `social_media_assets.tags` (ticket #10479). The axes
 * are persisted where they are CHOSEN (image generation) rather than where
 * they are RECALLED (draft time), and `tags` is an existing jsonb string
 * array on the asset row, so this needs no migration and no new column. One
 * tag per axis, `axis:<key>=<value>`, which stays greppable in the Studio's
 * tag filter and cannot collide with a human-authored tag.
 */
export const SCENE_AXIS_TAG_PREFIX = 'axis:'

export function sceneAxisTags(axes: SceneAxes): string[] {
  const out: string[] = []
  for (const key of SCENE_AXIS_KEYS) {
    const value = axes[key]
    if (typeof value === 'string' && value.trim() !== '') {
      out.push(`${SCENE_AXIS_TAG_PREFIX}${key}=${value.trim()}`)
    }
  }
  return out
}

/**
 * Read the axes back off a tag list. Unknown tags are ignored, and a tag
 * carrying an out-of-vocabulary value is dropped rather than returned: the
 * report classifies on these, so a bad token must not travel from an old
 * asset row onto a fresh post.
 */
export function parseSceneAxisTags(tags: readonly string[] | null | undefined): SceneAxes {
  const axes: SceneAxes = {}
  for (const tag of tags ?? []) {
    if (typeof tag !== 'string' || !tag.startsWith(SCENE_AXIS_TAG_PREFIX)) continue
    const body = tag.slice(SCENE_AXIS_TAG_PREFIX.length)
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq)
    const value = body.slice(eq + 1)
    if (!(SCENE_AXIS_KEYS as readonly string[]).includes(key)) continue
    const parsed = validateSceneAxis(key as SceneAxisKey, value)
    if (parsed.ok) axes[key as SceneAxisKey] = parsed.value
  }
  return axes
}

/**
 * `supplied` wins over `fallback`, field by field. The draft-time field
 * becomes a confirmation of what generation already recorded, never a memory
 * test: whatever the caller omits comes from the asset.
 */
export function mergeSceneAxes(supplied: SceneAxes, fallback: SceneAxes): SceneAxes {
  const out: SceneAxes = {}
  for (const key of SCENE_AXIS_KEYS) {
    const value = supplied[key] ?? fallback[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/** True when all four axes carry a value. The report's coverage line. */
export function hasAllSceneAxes(axes: SceneAxes): boolean {
  return SCENE_AXIS_KEYS.every(k => typeof axes[k] === 'string' && axes[k] !== '')
}
