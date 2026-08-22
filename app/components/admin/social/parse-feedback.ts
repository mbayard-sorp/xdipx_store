/**
 * Pure parser for `social_posts.feedback` strings (admin.socials rebuild).
 *
 * `feedback` carries three independent tagged encodings depending on how the
 * row got there, plus plain text for an ordinary owner "needs changes" /
 * "rejected" note:
 *
 *   - `[publish-gate PASS|REVISE|BLOCK|HOLD by REVIEWER on YYYY-MM-DD, product: HANDLE|none]\nNOTES`
 *     written by social-publish-gate (see `formatGateStamp` in
 *     `social-publish-approve.server.ts`).
 *   - `[live:worked|off|pull] NOTE` written by the post-publish retro (see
 *     `formatLiveFeedback` in `live-post-feedback.ts`).
 *   - `[stock-guard] DETAIL` written by the manual post-media publish path
 *     when a linked product goes out of stock after approval.
 *   - anything else is a plain owner note.
 *
 * Deliberately NOT `.server.ts`: the Social post detail pane renders a stored
 * verdict in component code, and a component that reaches into a `.server`
 * module pulls the whole module into the client bundle (same reasoning as
 * `live-post-feedback.ts`). The regexes are duplicated here on purpose rather
 * than imported from `social-publish-approve.server.ts`, if either wire
 * format changes, both copies need updating.
 */

export type GateVerdict = 'PASS' | 'REVISE' | 'BLOCK' | 'HOLD'
export type LiveVerdict = 'worked' | 'off' | 'pull'

export interface ParsedFeedback {
  gateVerdict: GateVerdict | null
  gateReviewer: string | null
  gateDate: string | null
  gateProductHandle: string | null
  gateNotes: string | null
  liveVerdict: LiveVerdict | null
  liveNote: string | null
  stockGuard: string | null
  /** Plain feedback with none of the tags above (a needs_changes / rejected note). */
  ownerNotes: string | null
}

const GATE_RE =
  /^\[publish-gate (PASS|REVISE|BLOCK|HOLD) by ([^\]]+?) on (\d{4}-\d{2}-\d{2}), product: ([a-z0-9._-]+|none)\]\n?([\s\S]*)$/
const LIVE_RE = /^\[live:(worked|off|pull)\]\s*([\s\S]*)$/
const STOCK_RE = /^\[stock-guard\]\s*([\s\S]*)$/

const EMPTY: ParsedFeedback = {
  gateVerdict: null,
  gateReviewer: null,
  gateDate: null,
  gateProductHandle: null,
  gateNotes: null,
  liveVerdict: null,
  liveNote: null,
  stockGuard: null,
  ownerNotes: null,
}

export function parseFeedback(feedback: string | null | undefined): ParsedFeedback {
  if (!feedback || !feedback.trim()) return { ...EMPTY }
  const trimmed = feedback.trim()

  const gate = GATE_RE.exec(trimmed)
  if (gate) {
    const [, verdict, reviewer, date, product, notes] = gate
    return {
      ...EMPTY,
      gateVerdict: verdict as GateVerdict,
      gateReviewer: (reviewer ?? '').trim() || null,
      gateDate: date ?? null,
      gateProductHandle: product === 'none' ? null : (product ?? null),
      gateNotes: (notes ?? '').trim() || null,
    }
  }

  const live = LIVE_RE.exec(trimmed)
  if (live) {
    const [, verdict, note] = live
    return { ...EMPTY, liveVerdict: verdict as LiveVerdict, liveNote: (note ?? '').trim() || null }
  }

  const stock = STOCK_RE.exec(trimmed)
  if (stock) {
    return { ...EMPTY, stockGuard: (stock[1] ?? '').trim() || null }
  }

  return { ...EMPTY, ownerNotes: trimmed }
}
