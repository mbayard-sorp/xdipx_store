/**
 * Detection-to-ticket bridge.
 *
 * The cron detectors (log-monitor, homepage healthcheck + render-truth,
 * checkout probe, notebook healthcheck) all found problems the owner had to
 * read out of an email or a GitHub issue and then hand to someone. This module
 * turns a detection into a row on the improvement bus so the dev/QA loop can
 * claim it like any other ticket.
 *
 * Two invariants, both load-bearing:
 *
 *  1. **Filing a ticket can never break a detector.** Every entry point is
 *     wrapped in its own try/catch and returns 0 instead of throwing. These run
 *     on crons sitting next to revenue-critical jobs; a Neon hiccup while
 *     writing a bookkeeping row must not abort a checkout probe or suppress the
 *     owner email that follows it.
 *  2. **A ticket is an addition, never a replacement.** Callers keep their
 *     existing Sentry / owner-email / GitHub-issue alerting exactly as it was.
 *     This is especially binding for the checkout probe: checkout is a
 *     protected path, so the owner still gets paged and no automated fix path
 *     may ever touch it.
 *
 * Dedupe: `createSuggestion` inserts with ON CONFLICT DO NOTHING against the
 * `dedupe_key` partial-unique index (migration 070, live where status is not
 * applied/dismissed). A signal that trips every cron tick therefore reopens the
 * conversation on one ticket instead of flooding the queue, and a repeat filing
 * comes back as id 0.
 *
 * Server-only.
 */
import { createSuggestion } from '~/lib/team.server'
import type { DedupeScope } from '~/lib/dedupe-key'
import type { TeamId } from '~/lib/team.server'
import { db } from '~/lib/db.server'
import { suggestionLinks } from '../../db/schema'

/** `homepage_team_suggestions.dedupe_key` is varchar(64) (migration 070). */
export const MAX_DEDUPE_KEY_LENGTH = 64

/** Severity labels the detectors already speak, mapped to ticket priority. */
export type DetectionSeverity = 'P0' | 'P1' | 'P2' | 'P3'

const SEVERITY_PRIORITY: Record<DetectionSeverity, number> = {
  P0: 1,
  P1: 2,
  P2: 3,
  P3: 4,
}

/** P0 -> 1 (highest) .. P3 -> 4. Anything unrecognised lands on the default 3. */
export function priorityFromSeverity(severity: string): number {
  return SEVERITY_PRIORITY[severity as DetectionSeverity] ?? 3
}

/**
 * Stable, short, non-cryptographic hash (djb2 -> base36). Used to fold a long
 * or unstable identifier (a stack-trace-derived issue title) into a fixed-width
 * dedupe token. Deterministic across processes and deploys, which is the whole
 * requirement: the same signal tomorrow must produce the same key.
 */
export function hashToken(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

/** Lowercase, collapse to a key-safe alphabet, trim separator runs. */
function slugPart(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Build a `namespace:detail:detail` dedupe key that always fits varchar(64).
 *
 * Over-length keys are truncated and given a hash suffix derived from the FULL
 * joined key, so two long keys that share a 55-character prefix still dedupe
 * apart. Empty parts are dropped rather than producing `foo::bar`.
 */
export function makeDedupeKey(...parts: Array<string | number | null | undefined>): string {
  const joined = parts
    .filter((p): p is string | number => p !== null && p !== undefined && String(p).length > 0)
    .map(p => slugPart(String(p)))
    .filter(p => p.length > 0)
    .join(':')
  if (joined.length <= MAX_DEDUPE_KEY_LENGTH) return joined
  const suffix = `~${hashToken(joined)}`
  return `${joined.slice(0, MAX_DEDUPE_KEY_LENGTH - suffix.length)}${suffix}`
}

export interface DetectionTicketLink {
  /** pr | issue | run | url | doc | commit (varchar(12) in `suggestion_links`). */
  kind: string
  ref: string
  state?: string | undefined
}

export interface DetectionTicketInput {
  /** Detector name, used only for log lines. */
  detector: string
  /** Stable identity for the recurring signal. Build it with makeDedupeKey. */
  dedupeKey: string
  /**
   * `daily` when each day's occurrence is its own incident (a render break
   * on one day's slate is not the same event as the same section breaking a
   * week later). Defaults to `recurring`, which strips date stamps so a
   * condition that trips every morning reuses one ticket.
   */
  dedupeScope?: DedupeScope | undefined
  /** 1 (highest) .. 5. Use priorityFromSeverity for P0/P1/P2 detectors. */
  priority: number
  /** The ticket body, written for whoever claims it. */
  suggestion: string
  /** Improvement-bus category. Defaults to 'other'. */
  category?: string | undefined
  /** Ticket kind. Detection tickets are code work by default. */
  kind?: string | undefined
  /** Team that ACTS on the ticket. Defaults to homepage (the dev/QA loop). */
  targetTeam?: TeamId | undefined
  /** Evidence to hang off the ticket (the GitHub issue, a run URL). */
  links?: DetectionTicketLink[] | undefined
}

/**
 * File a ticket for a detection. Returns the new suggestion id, or 0 when the
 * signal deduped against a still-live ticket OR when anything at all went
 * wrong. Never throws.
 */
export async function fileDetectionTicket(input: DetectionTicketInput): Promise<number> {
  try {
    const id = await createSuggestion({
      team: 'homepage',
      targetTeam: input.targetTeam ?? 'homepage',
      category: input.category ?? 'other',
      kind: input.kind ?? 'code',
      suggestion: input.suggestion,
      cxRisk: input.priority <= 2 ? 'high' : 'low',
      priority: input.priority,
      dedupeKey: input.dedupeKey,
      dedupeScope: input.dedupeScope,
    })
    if (!id) {
      // Deduped against a live ticket carrying the same key. Nothing to link.
      console.info(`[${input.detector}] ticket deduped on "${input.dedupeKey}"`)
      return 0
    }
    const links = (input.links ?? []).filter(l => l.ref)
    if (links.length > 0) {
      await db.insert(suggestionLinks).values(
        links.map(l => ({
          suggestionId: id,
          kind: l.kind.slice(0, 12),
          ref: l.ref,
          state: l.state ? l.state.slice(0, 16) : null,
        })),
      )
    }
    console.info(`[${input.detector}] filed ticket #${id} (${input.dedupeKey}, P${input.priority})`)
    return id
  } catch (err) {
    // Deliberately swallowed: see invariant 1 in the module doc.
    console.error(`[${input.detector}] filing ticket "${input.dedupeKey}" failed (ignored):`, err)
    return 0
  }
}
