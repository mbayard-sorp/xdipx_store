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
