/**
 * Pure learn-loop helpers for the video program (Phase 2b, plan
 * build-out-a-full-zesty-pike). No .server imports: video-learn.server.ts
 * feeds these rows it read from the database, and the tests drive them
 * directly without a db mock.
 *
 * Two families live here:
 *   1. The dimensions a clip is grouped by (`speaker`, `format`) and the
 *      primary reach metric (IG reach, else X impressions).
 *   2. Per-batch process signals (owner edit ratio, needs_changes rate,
 *      approved rate, frame re-roll rate, hours to decision) and the
 *      thresholds that turn them into flags for the room and the digest.
 */
import type { VideoEpisodeReviewNote, VideoScriptJson } from '../../db/schema'

export const MIN_EPISODES_FOR_SIGNAL = 5

/** Value a clip groups under when neither the pitch nor the script names one. */
export const UNSPECIFIED = 'unspecified'

// ── Dimensions ──────────────────────────────────────────────────────────────

function pitchField(script: VideoScriptJson | null | undefined, key: 'speaker' | 'format'): string | null {
  if (!script || typeof script !== 'object') return null
  const pitch = (script as Record<string, unknown>)['pitch']
  if (pitch && typeof pitch === 'object' && !Array.isArray(pitch)) {
    const v = (pitch as Record<string, unknown>)[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const v = (script as Record<string, unknown>)[key]
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

/**
 * The on-camera speaker of a clip: `scriptJson.pitch.speaker`, else
 * `scriptJson.speaker`, else null. Lowercased so "Maya" and "maya" group
 * together (cast slugs are lowercase; the pitch may carry a display name).
 */
export function episodeSpeaker(script: VideoScriptJson | null | undefined): string | null {
  return pitchField(script, 'speaker')?.toLowerCase() ?? null
}

/** The clip format: `scriptJson.pitch.format`, else `scriptJson.format`, else null. */
export function episodeFormat(script: VideoScriptJson | null | undefined): string | null {
  return pitchField(script, 'format') ?? null
}

/**
 * The primary reach number for a clip: Instagram `reach` when the IG post has
 * it, else X `impressions`. Never an estimate and never a sum across
 * platforms (IG reach counts accounts, X impressions counts views; adding
 * them would be a number nobody can act on).
 */
export function primaryReachOf(
  ig: Record<string, number> | null | undefined,
  x: Record<string, number> | null | undefined,
): { value: number | null; source: 'ig_reach' | 'x_impressions' | null } {
  if (ig && typeof ig['reach'] === 'number' && Number.isFinite(ig['reach'])) return { value: ig['reach'], source: 'ig_reach' }
  if (x && typeof x['impressions'] === 'number' && Number.isFinite(x['impressions'])) return { value: x['impressions'], source: 'x_impressions' }
  return { value: null, source: null }
}

export function median(values: number[]): number | null {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2
}

// ── Owner edit ratio ────────────────────────────────────────────────────────

/**
 * The spoken fields of a script, as `video_script_edits.field` names them:
 * presenterLine, voiceover, and the CTA (the plan has the CTA spoken, not
 * shown). Captions are excluded (a caption is read, not heard).
 * `script.scenes*` covers any future per-scene spokenLine edit;
 * editEpisodeScript does not write one today. Note spokenTextOf in
 * video-episodes.ts does NOT include cta, so the enqueue guard's byte check
 * does not cover it; that is a separate follow-up.
 */
export function isSpokenEditField(field: string): boolean {
  return field === 'script.presenterLine' || field === 'script.voiceover' || field === 'script.cta' || field.startsWith('script.scenes')
}

export function words(text: string | null | undefined): string[] {
  if (!text) return []
  return text.toLowerCase().split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')).filter(Boolean)
}

/** Word-level Levenshtein distance: a swapped word counts once, not twice. */
export function wordEditDistance(before: string | null | undefined, after: string | null | undefined): number {
  const a = words(before)
  const b = words(after)
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]!
}

/** Spoken lines of a script keyed by edit-field name (presenterLine, voiceover, cta, scene spokenLines). */
export function spokenFieldsOf(script: VideoScriptJson | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!script || typeof script !== 'object') return out
  const rec = script as Record<string, unknown>
  for (const k of ['presenterLine', 'voiceover', 'cta'] as const) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim()) out[`script.${k}`] = v
  }
  const scenes = rec['scenes']
  if (Array.isArray(scenes)) {
    scenes.forEach((s, i) => {
      const line = s && typeof s === 'object' ? (s as Record<string, unknown>)['spokenLine'] : undefined
      if (typeof line === 'string' && line.trim()) out[`script.scenes[${i}].spokenLine`] = line
    })
  }
  return out
}

export interface ScriptEditRow {
  field: string
  before: string | null
  after: string
  createdAt: Date | string
}

/**
 * Words the owner changed in the spoken track, over the spoken words the
 * writers delivered. The denominator is the ORIGINAL script: for a field the
 * owner edited, its earliest recorded `before`; for an untouched field, its
 * current value. Returns null when the script has no spoken words at all.
 */
export function episodeEditStats(
  currentScript: VideoScriptJson | null | undefined,
  edits: ScriptEditRow[],
): { changedWords: number; spokenWords: number } | null {
  const spoken = edits
    .filter(e => isSpokenEditField(e.field))
    .sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime())
  const original: Record<string, string> = { ...spokenFieldsOf(currentScript) }
  const seen = new Set<string>()
  for (const e of spoken) {
    if (seen.has(e.field)) continue
    seen.add(e.field)
    if (e.before != null) original[e.field] = e.before
    else delete original[e.field]
  }
  const spokenWords = Object.values(original).reduce((n, v) => n + words(v).length, 0)
  if (!spokenWords) return null
  const changedWords = spoken.reduce((n, e) => n + wordEditDistance(e.before, e.after), 0)
  return { changedWords, spokenWords }
}

// ── Batch signals ───────────────────────────────────────────────────────────

const OWNER_DECISIONS = new Set(['approved', 'needs_changes', 'rejected'])

export interface BatchEpisodeInput {
  episodeId: number
  batchId: string
  createdAt: Date | string
  approvedAt: Date | string | null
  reviewNotes: VideoEpisodeReviewNote[] | null
  scriptJson: VideoScriptJson | null
  edits: ScriptEditRow[]
  /**
   * Frame re-roll count per video_jobs row this episode rendered through
   * (current plus prior retakes), from `scriptJson.frameFeedback.length`,
   * which retrySceneFrames appends on every re-roll. Empty when the episode
   * never reached a job.
   */
  jobFrameRetries: number[]
}

export interface BatchSignals {
  batchId: string
  startedAt: string
  episodes: number
  /** Episodes with at least one owner decision; the denominator of the two rates. */
  decided: number
  /** Changed spoken words / delivered spoken words across the batch. Null with no spoken words. */
  editRatio: number | null
  needsChangesRate: number | null
  approvedRate: number | null
  /** Mean frame re-rolls per rendered job. Null when no episode in the batch reached a job. */
  rerollRate: number | null
  /**
   * Median hours from pitch filed (the row is inserted at pending_approval)
   * to the owner's FIRST decision. A revise-then-redecide cycle is not
   * timed: nothing records when a revised row went back to pending.
   */
  medianHoursToDecision: number | null
}

function toMs(d: Date | string): number {
  return (d instanceof Date ? d : new Date(d)).getTime()
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp

export function computeBatchSignals(rows: BatchEpisodeInput[]): BatchSignals[] {
  const byBatch = new Map<string, BatchEpisodeInput[]>()
  for (const r of rows) {
    const g = byBatch.get(r.batchId) ?? []
    g.push(r)
    byBatch.set(r.batchId, g)
  }
  const out: BatchSignals[] = []
  for (const [batchId, eps] of byBatch) {
    let changed = 0
    let spoken = 0
    let decided = 0
    let needsChanges = 0
    let approved = 0
    const hours: number[] = []
    const retries: number[] = []
    for (const ep of eps) {
      const stats = episodeEditStats(ep.scriptJson, ep.edits)
      if (stats) { changed += stats.changedWords; spoken += stats.spokenWords }
      const decisions = (ep.reviewNotes ?? []).filter(n => OWNER_DECISIONS.has(n.decision))
      if (decisions.length || ep.approvedAt) decided++
      if (decisions.some(n => n.decision === 'needs_changes')) needsChanges++
      if (ep.approvedAt || decisions.some(n => n.decision === 'approved')) approved++
      const first = decisions.map(n => toMs(n.at)).filter(Number.isFinite).sort((a, b) => a - b)[0]
      if (first != null) hours.push((first - toMs(ep.createdAt)) / 3_600_000)
      retries.push(...ep.jobFrameRetries)
    }
    const startedAt = new Date(Math.min(...eps.map(e => toMs(e.createdAt)))).toISOString()
    out.push({
      batchId,
      startedAt,
      episodes: eps.length,
      decided,
      editRatio: spoken ? round(changed / spoken) : null,
      needsChangesRate: decided ? round(needsChanges / decided) : null,
      approvedRate: decided ? round(approved / decided) : null,
      rerollRate: retries.length ? round(retries.reduce((a, b) => a + b, 0) / retries.length, 2) : null,
      medianHoursToDecision: hours.length ? round(median(hours)!, 1) : null,
    })
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export const LEARN_THRESHOLDS = {
  editRatio: 0.2,
  approvedRate: 0.6,
  rerollRate: 1.5,
  hoursToDecision: 72,
} as const

export interface LearnFlag {
  key: 'edit_ratio_high' | 'approved_rate_low' | 'reroll_high' | 'time_to_approve_slow'
  triggered: boolean
  /** What the process read says to do when it trips. */
  action: string
  detail: string
}

/**
 * Turns batch signals (oldest first) into flags. The two-batch rules need
 * the latest two batches that carry the signal; a single bad batch is not a
 * trend. Re-roll and time-to-approve read the latest batch with a value.
 */
export function learnFlags(batches: BatchSignals[]): LearnFlag[] {
  const lastTwo = (pick: (b: BatchSignals) => number | null) =>
    batches.map(b => ({ id: b.batchId, v: pick(b) })).filter((x): x is { id: string; v: number } => x.v != null).slice(-2)
  const last = (pick: (b: BatchSignals) => number | null) =>
    [...batches].reverse().map(b => ({ id: b.batchId, v: pick(b) })).find((x): x is { id: string; v: number } => x.v != null) ?? null
  const fmt = (xs: { id: string; v: number }[]) => xs.map(x => `${x.id.slice(0, 8)}=${x.v}`).join(', ') || 'no data'

  const edit = lastTwo(b => b.editRatio)
  const appr = lastTwo(b => b.approvedRate)
  const reroll = last(b => b.rerollRate)
  const hours = last(b => b.medianHoursToDecision)

  return [
    {
      key: 'edit_ratio_high',
      triggered: edit.length === 2 && edit.every(x => x.v > LEARN_THRESHOLDS.editRatio),
      action: 'file an episode-writer instruction from the owner edits',
      detail: `edit ratio over ${LEARN_THRESHOLDS.editRatio} in the last two batches (${fmt(edit)})`,
    },
    {
      key: 'approved_rate_low',
      triggered: appr.length === 2 && appr.every(x => x.v < LEARN_THRESHOLDS.approvedRate),
      action: 'drop the weekly pitch from 5 clips to 3',
      detail: `approved rate under ${LEARN_THRESHOLDS.approvedRate} in the last two batches (${fmt(appr)})`,
    },
    {
      key: 'reroll_high',
      triggered: reroll != null && reroll.v > LEARN_THRESHOLDS.rerollRate,
      action: 'file a social-art-director instruction on first frames',
      detail: `frame re-rolls per job over ${LEARN_THRESHOLDS.rerollRate} in the latest batch (${fmt(reroll ? [reroll] : [])})`,
    },
    {
      key: 'time_to_approve_slow',
      triggered: hours != null && hours.v > LEARN_THRESHOLDS.hoursToDecision,
      action: 'escalate in the owner digest',
      detail: `median hours to the owner decision over ${LEARN_THRESHOLDS.hoursToDecision} in the latest batch (${fmt(hours ? [hours] : [])})`,
    },
  ]
}
