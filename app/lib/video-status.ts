/**
 * The one owner-facing status vocabulary for the video program (ticket #5716).
 *
 * Pure and client-safe on purpose (the studio board renders it, the test pins
 * it, nothing here touches a database): status is DERIVED from the episode
 * row, its job, and its fanned-out posts, exactly the way the Social Studio's
 * studioStatusOf derives from social_posts columns. A stored display status
 * would be a second source of truth that drifts the first time a job fails
 * outside the app.
 *
 * Eleven states. Coral is reserved for the three that are genuinely the
 * owner's turn (scripted, framing, review); everything else reads neutral,
 * plum for the machine, sage for fine, amber for owed, red for broken.
 */

export interface EpisodeLike {
  productionStatus: string
  logline?: string | null
  scriptJson?: unknown
  storyboardJson?: unknown
  castSlugs?: string[] | null
  productPlacements?: unknown[] | null
}

export interface JobLike {
  stage: string
  status: string
  sceneStateJson?: { status: string }[] | null
}

export interface PostLike {
  status: string
}

export type VideoStatusKey =
  | 'shelved' | 'failed' | 'posted' | 'scheduled' | 'review' | 'framing'
  | 'rendering' | 'approved' | 'changes' | 'scripted' | 'concept'

export interface VideoStatus {
  key: VideoStatusKey
  word: string
  /** Whose turn: 'owner' | 'machine' | 'room' | 'social' | 'nobody' */
  turn: 'owner' | 'machine' | 'room' | 'social' | 'nobody'
  /** Tailwind classes for the pill (glyph + word, never colour alone). */
  cls: string
  glyph: string
}

const S: Record<VideoStatusKey, Omit<VideoStatus, 'key'>> = {
  shelved:   { word: 'Shelved',      turn: 'nobody',  cls: 'border-line bg-paper-3 text-ink-4 line-through', glyph: '∅' },
  failed:    { word: 'Failed',       turn: 'owner',   cls: 'border-red-200 bg-red-50 text-red-800',          glyph: '✕' },
  posted:    { word: 'Posted',       turn: 'nobody',  cls: 'border-transparent bg-[#4F6150] text-white',     glyph: '✓' },
  scheduled: { word: 'Scheduled',    turn: 'social',  cls: 'border-transparent bg-plum text-white',          glyph: '◷' },
  review:    { word: 'Review cut',   turn: 'owner',   cls: 'border-coral bg-coral-soft text-ink',            glyph: '▶' },
  framing:   { word: 'Pick frame',   turn: 'owner',   cls: 'border-coral bg-coral-soft text-ink',            glyph: '▣' },
  rendering: { word: 'Rendering',    turn: 'machine', cls: 'border-line bg-plum-soft text-plum-2',           glyph: '⟳' },
  approved:  { word: 'Approved',     turn: 'machine', cls: 'border-line bg-sage/10 text-[#4F6150]',          glyph: '✓' },
  changes:   { word: 'Changes',      turn: 'room',    cls: 'border-amber-200 bg-amber-50 text-amber-800',    glyph: '↺' },
  scripted:  { word: 'Needs read',   turn: 'owner',   cls: 'border-coral bg-coral-soft text-ink',            glyph: '✎' },
  concept:   { word: 'Concept',      turn: 'room',    cls: 'border-line bg-paper text-ink-3',                glyph: '·' },
}

const IN_FLIGHT_JOB = new Set(['queued', 'running', 'awaiting_provider', 'applying'])

/**
 * Collapse (episode, job, posts) to the one status the owner reads. First
 * match wins, ordered so a broken or waiting-on-you state can never hide
 * behind a calmer one. Works for job-only rows too (episode null: ad-hoc
 * composes and pre-program jobs).
 */
export function videoStatusOf(
  episode: EpisodeLike | null,
  job: JobLike | null,
  posts: PostLike[] = [],
): VideoStatus {
  const key = keyOf(episode, job, posts)
  return { key, ...S[key] }
}

function keyOf(episode: EpisodeLike | null, job: JobLike | null, posts: PostLike[]): VideoStatusKey {
  const ps = episode?.productionStatus
  if (ps === 'shelved' || ps === 'rejected') return 'shelved'
  if (ps === 'failed') return 'failed'
  if (job && (job.stage === 'failed' || job.status === 'failed')) return 'failed'
  if (posts.some(p => p.status === 'posted') || ps === 'posted' || ps === 'measured') return 'posted'
  if (posts.length > 0 || ps === 'scheduled') return 'scheduled'
  if (job && job.stage === 'done' && job.status === 'done') return 'review'
  if (job && (job.status === 'awaiting_frame_approval'
    || (job.sceneStateJson ?? []).some(sc => sc.status === 'awaiting_frame_approval'))) return 'framing'
  if (job && IN_FLIGHT_JOB.has(job.status)) return 'rendering'
  if (ps === 'rendering') return 'rendering'
  if (ps === 'approved') return 'approved'
  if (ps === 'needs_changes') return 'changes'
  if (ps === 'pending_approval') return 'scripted'
  return 'concept'
}

/** The six-dot stage rail: where this episode sits on the production line. */
export const STAGE_STEPS = ['Concept', 'Script', 'Storyboard', 'Cast+Product', 'Render', 'Posted'] as const

export function stageIndexOf(status: VideoStatusKey, episode: EpisodeLike | null): number {
  switch (status) {
    case 'posted': return 5
    case 'scheduled': return 5
    case 'review': return 4
    case 'framing': return 4
    case 'rendering': return 4
    case 'approved': return 3
    case 'changes': return 1
    case 'scripted': {
      const hasBoard = episode?.storyboardJson != null
      const hasCast = (episode?.castSlugs?.length ?? 0) > 0 || (episode?.productPlacements?.length ?? 0) > 0
      return hasCast ? 3 : hasBoard ? 2 : 1
    }
    case 'shelved':
    case 'failed':
    case 'concept':
    default:
      return 0
  }
}

/** The one verb the board offers per row; null when it is not the owner's turn. */
export function nextActionOf(status: VideoStatusKey, episodeId: number | null, jobRowId: number | null): { label: string; to: string } | null {
  switch (status) {
    case 'scripted':
      return episodeId != null ? { label: 'Read script', to: `/admin/video-studio/scripts/${episodeId}` } : null
    case 'framing':
      return { label: 'Pick frame', to: '/admin/video-studio/render' }
    case 'review':
      return { label: 'Review cut', to: '/admin/video-studio/render' }
    case 'failed':
      return jobRowId != null ? { label: 'See error', to: '/admin/video-studio/render' } : null
    default:
      return null
  }
}
