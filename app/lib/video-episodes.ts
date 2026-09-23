/**
 * Pure helpers for the serialized video program's episode ledger (ticket
 * #5712). No imports from .server files: the admin UI and the API route both
 * use these, and the validators are unit-tested without a database.
 *
 * The two vocabularies here are the SCHEMA-LEVEL enforcement of
 * shoppers-not-owners (the charter's invented-testimonial ban): there is
 * deliberately no 'owned' role and no 'personal_experience' mention type, so a
 * placement that would require lived experience cannot be expressed at all.
 */
import type { VideoEpisodePlacement, VideoScriptJson } from '../../db/schema'

export const PLACEMENT_ROLES = ['considered', 'compared', 'gifted', 'rejected'] as const
export const PLACEMENT_MENTION_TYPES = ['spec_cited', 'review_pattern', 'price', 'category'] as const
export const ARC_POSITIONS = ['setup', 'escalation', 'turn', 'payoff', 'standalone'] as const

/**
 * production_status values a script may no longer be edited from (ticket
 * #7558): a render has started, finished, or the episode has moved past
 * render entirely. Lives here (not the .server twin) so the admin UI's
 * client-rendered component can read it without pulling a .server module
 * into the client bundle — React Router only strips server code out of
 * `loader`/`action`/`middleware`/`headers`, not other route exports.
 */
export const SCRIPT_LOCKED_STATUSES = ['rendering', 'rendered', 'scheduled', 'posted', 'measured', 'shelved'] as const

/**
 * Validate a raw product_placements payload. Returns the normalized array or
 * throws with a message naming the first defect. Empty is allowed (an episode
 * may carry no product, and that absence is a choice the script justifies).
 */
export function validatePlacements(raw: unknown): VideoEpisodePlacement[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new Error('productPlacements must be an array')
  return raw.map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`productPlacements[${i}] must be an object`)
    const o = p as Record<string, unknown>
    if (typeof o['handle'] !== 'string' || !o['handle'].trim()) throw new Error(`productPlacements[${i}].handle is required`)
    if (!(PLACEMENT_ROLES as readonly string[]).includes(o['role'] as string)) {
      throw new Error(`productPlacements[${i}].role must be one of ${PLACEMENT_ROLES.join('|')} (there is deliberately no 'owned': shoppers, not owners)`)
    }
    if (!(PLACEMENT_MENTION_TYPES as readonly string[]).includes(o['mentionType'] as string)) {
      throw new Error(`productPlacements[${i}].mentionType must be one of ${PLACEMENT_MENTION_TYPES.join('|')}`)
    }
    return {
      handle: (o['handle'] as string).trim(),
      ...(typeof o['shopifyProductGid'] === 'string' ? { shopifyProductGid: o['shopifyProductGid'] } : {}),
      role: o['role'] as VideoEpisodePlacement['role'],
      mentionType: o['mentionType'] as VideoEpisodePlacement['mentionType'],
    }
  })
}

/**
 * The spoken surface of a script, flattened to one canonical string. This is
 * what the enqueue guard compares byte-for-byte against the owner-approved
 * episode row: presenterLine, per-scene spoken lines (forward-compatible with
 * per-scene dialogue), voiceover, and every caption, in a stable order with
 * field markers so a move between fields can never read as "identical".
 */
export function spokenTextOf(script: VideoScriptJson | null | undefined): string {
  if (!script || typeof script !== 'object') return ''
  const parts: string[] = []
  const push = (label: string, v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(`${label}:${v}`)
  }
  push('presenterLine', script.presenterLine)
  push('voiceover', (script as Record<string, unknown>)['voiceover'])
  const scenes = (script as Record<string, unknown>)['scenes']
  if (Array.isArray(scenes)) {
    scenes.forEach((s, i) => {
      if (s && typeof s === 'object') push(`scene[${i}].spokenLine`, (s as Record<string, unknown>)['spokenLine'])
    })
  }
  const captions = (script as Record<string, unknown>)['captions']
  if (captions && typeof captions === 'object' && !Array.isArray(captions)) {
    for (const k of Object.keys(captions as Record<string, unknown>).sort()) {
      push(`caption.${k}`, (captions as Record<string, unknown>)[k])
    }
  }
  return parts.join('\n')
}

/** True when two scripts speak exactly the same words in the same fields. */
export function scriptsSpeakIdentically(a: VideoScriptJson | null | undefined, b: VideoScriptJson | null | undefined): boolean {
  return spokenTextOf(a) === spokenTextOf(b)
}

/**
 * Maps a storyboard beat's free-text `speaker` (video_episodes.storyboardJson
 * entries carry `speaker?: string` — a cast slug or display name, e.g. "Maya"
 * or "maya") to the `none | emma | friend:{slug}` presenter grammar a
 * VideoSceneSpec.presenter needs (ADR-014, ticket #6586). This mapping did
 * not exist anywhere before this: the story layer already writes `speaker`
 * per beat (.claude/agents/episode-writer.md's `<speaker>: "<line>"` beat
 * format) but nothing converted that prose into a presenter string, and
 * getting it wrong renders a scene in the wrong identity or wrong voice
 * silently — so an unresolved speaker throws rather than guessing.
 *
 * No `.server` import (kept alongside this file's other pure helpers, per its
 * header comment): callers pass whichever `{ slug, name }[]` cast list they
 * already have (typically `getApprovedCastMembers()`), so this stays cheaply
 * unit-testable without a Sanity client.
 */
export function mapSpeakerToPresenter(speaker: string | null | undefined, cast: { slug: string; name: string }[]): string {
  const raw = (speaker ?? '').trim()
  if (!raw) return 'none'
  const lower = raw.toLowerCase()
  if (lower === 'emma') return 'emma'
  if (lower === 'none') return 'none'
  const bySlug = cast.find(c => c.slug.toLowerCase() === lower)
  if (bySlug) return `friend:${bySlug.slug}`
  const byName = cast.find(c => c.name.toLowerCase() === lower)
  if (byName) return `friend:${byName.slug}`
  throw new Error(`speaker '${speaker}' matches no approved cast member's slug or name, and is not 'emma' or 'none'`)
}

/* ── The pitch (plan Phase 2b) ──────────────────────────────────────────────
 * What the Writers Room hands the owner per clip on Tuesday: the product, the
 * format, who speaks, the one fact the clip rests on and where it came from,
 * the laugh, the first-frame concept, the room's cost estimate, and (when the
 * room produced one) the ElevenLabs read in the cast voice. Stored on
 * video_episodes.script_json.pitch, so it needs no migration and rides with
 * the script it describes. None of it is spoken text: spokenTextOf ignores it,
 * so a pitch never trips the enqueue's byte-identity guard.
 */

export const PITCH_FACT_SOURCES = ['spec', 'material', 'reviews'] as const
export type PitchFactSource = (typeof PITCH_FACT_SOURCES)[number]

export interface EpisodePitch {
  /** One of the format slugs in the video strategy doc. Free string on purpose (no hand-copied enum). */
  format: string
  speaker: string
  listener?: string
  fact: string
  factSource: PitchFactSource
  laugh: string
  firstFrameConcept: string
  estCostUsd: number
  readAudioUrl?: string
  /** Set by episode-revise when a spoken line changed after the read was recorded. */
  readAudioStale?: boolean
  productHandle: string
  alternate?: boolean
}

/** The flat per-clip keys episode-propose accepts for the pitch. */
export const PITCH_KEYS = [
  'format', 'speaker', 'listener', 'fact', 'factSource', 'laugh',
  'firstFrameConcept', 'estCostUsd', 'readAudioUrl', 'productHandle', 'alternate',
] as const

/** True when a proposed clip carries any pitch key (flat or under `pitch`). */
export function hasPitchInput(raw: Record<string, unknown>): boolean {
  if (raw['pitch'] && typeof raw['pitch'] === 'object') return true
  return PITCH_KEYS.some(k => raw[k] !== undefined)
}

function reqStr(o: Record<string, unknown>, key: string, where: string, max: number): string {
  const v = o[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${where}.${key} is required`)
  if (v.trim().length > max) throw new Error(`${where}.${key} over ${max} chars`)
  return v.trim()
}

/** An https URL, or throws. The read plays in the admin, so nothing else is accepted. */
export function validateAudioUrl(v: unknown, where: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${where} must be a non-empty https URL`)
  let u: URL
  try { u = new URL(v.trim()) } catch { throw new Error(`${where} is not a valid URL`) }
  if (u.protocol !== 'https:') throw new Error(`${where} must be https`)
  return u.toString()
}

/**
 * Validate one clip's pitch. Accepts the keys flat on the clip (the documented
 * shape) or nested under `pitch`; flat keys win. Throws naming the first defect.
 */
export function validatePitch(raw: Record<string, unknown>, where: string): EpisodePitch {
  const nested = raw['pitch'] && typeof raw['pitch'] === 'object' && !Array.isArray(raw['pitch'])
    ? raw['pitch'] as Record<string, unknown>
    : {}
  const o: Record<string, unknown> = { ...nested }
  for (const k of PITCH_KEYS) if (raw[k] !== undefined) o[k] = raw[k]

  const factSource = o['factSource']
  if (!(PITCH_FACT_SOURCES as readonly string[]).includes(factSource as string)) {
    throw new Error(`${where}.factSource must be one of ${PITCH_FACT_SOURCES.join('|')}`)
  }
  const est = o['estCostUsd']
  if (typeof est !== 'number' || !Number.isFinite(est) || est < 0) {
    throw new Error(`${where}.estCostUsd must be a non-negative number`)
  }
  if (o['alternate'] !== undefined && typeof o['alternate'] !== 'boolean') {
    throw new Error(`${where}.alternate must be a boolean`)
  }
  let listener: string | undefined
  if (o['listener'] != null) {
    if (typeof o['listener'] !== 'string') throw new Error(`${where}.listener must be a string`)
    listener = o['listener'].trim() || undefined
  }
  return {
    format: reqStr(o, 'format', where, 48),
    speaker: reqStr(o, 'speaker', where, 64),
    ...(listener ? { listener } : {}),
    fact: reqStr(o, 'fact', where, 400),
    factSource: factSource as PitchFactSource,
    laugh: reqStr(o, 'laugh', where, 400),
    firstFrameConcept: reqStr(o, 'firstFrameConcept', where, 600),
    estCostUsd: Math.round(est * 100000) / 100000,
    ...(o['readAudioUrl'] != null ? { readAudioUrl: validateAudioUrl(o['readAudioUrl'], `${where}.readAudioUrl`) } : {}),
    productHandle: reqStr(o, 'productHandle', where, 255),
    ...(o['alternate'] === true ? { alternate: true } : {}),
  }
}

/** Tolerant reader for a stored pitch (older rows have none). */
export function readPitch(script: VideoScriptJson | null | undefined): EpisodePitch | null {
  if (!script || typeof script !== 'object') return null
  const p = (script as Record<string, unknown>)['pitch']
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  const o = p as Record<string, unknown>
  if (typeof o['productHandle'] !== 'string' || typeof o['format'] !== 'string') return null
  return o as unknown as EpisodePitch
}

/* ── Line notes ─────────────────────────────────────────────────────────────
 * The owner's per-line comment in the script reader, appended to
 * review_notes_json as { decision: 'line_note', field, lineIdx, note }. The
 * field names the spoken surface; lineIdx indexes scenes/beats and is 0 for a
 * single-line field. Read back by the owner-edits op for the Writers Room retro.
 */
export const LINE_NOTE_FIELDS = ['hookText', 'scenes', 'beats', 'presenterLine', 'voiceover', 'shareLine', 'cta'] as const
export type LineNoteField = (typeof LINE_NOTE_FIELDS)[number]
export const LINE_NOTE_MAX = 500

export function validateLineNote(raw: { field: unknown; lineIdx: unknown; note: unknown }): { field: LineNoteField; lineIdx: number; note: string } {
  if (!(LINE_NOTE_FIELDS as readonly string[]).includes(raw.field as string)) {
    throw new Error(`field must be one of ${LINE_NOTE_FIELDS.join('|')}`)
  }
  const idx = typeof raw.lineIdx === 'string' && raw.lineIdx.trim() !== '' ? Number(raw.lineIdx) : raw.lineIdx
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 50) {
    throw new Error('lineIdx must be an integer from 0 to 50')
  }
  const field = raw.field as LineNoteField
  if (field !== 'scenes' && field !== 'beats' && idx !== 0) {
    throw new Error(`${field} is a single line; lineIdx must be 0`)
  }
  if (typeof raw.note !== 'string' || !raw.note.trim()) throw new Error('note is required')
  if (raw.note.trim().length > LINE_NOTE_MAX) throw new Error(`note over ${LINE_NOTE_MAX} chars`)
  return { field, lineIdx: idx, note: raw.note.trim() }
}

/* ── Room revisions (episode-revise) ──────────────────────────────────────── */

/** The only editor name the team token may write a revision under, so it can never forge an owner edit. */
export const ROOM_EDITORS = ['video-room'] as const
export const REVISABLE_STATUSES = ['pending_approval', 'needs_changes'] as const
export const REVISE_FIELDS = ['presenterLine', 'voiceover', 'shareLine', 'cta', 'captionIg', 'captionX'] as const
export type ReviseField = (typeof REVISE_FIELDS)[number]
/** Spoken-aloud fields whose change makes a recorded read stale. */
export const READ_AFFECTING_FIELDS = ['presenterLine', 'voiceover'] as const
