/**
 * Cast/product casting gate (ADR-015, ticket #10730).
 *
 * Incident: Instagram row 293 showed Marcus (a male cast member) alone,
 * holding a ROMP Presto Wand. Owner, verbatim: "When we have a man holding a
 * vibrator; we look like idiots." Refined: "If you want to show a man
 * holding a vibrator he should be holding it against a woman's skin." /
 * "A man should show products that men use!"
 *
 * Naming mirrors `social-vision-gate.server.ts` on purpose — same "code
 * enforcement of what used to be doctrine + judgment" pattern, same
 * precedent: `social-art-director.md`'s own `<role>` section documents that a
 * single agent juggling product choice + caption + scene + cast + variety
 * under load reverts to the safest frame every time, so loading one more
 * judgment call ("is this cast/product pairing okay?") onto an already
 * overloaded agent repeats the mistake. A deterministic check is the fix.
 *
 * Pure data check, no image/model call required: `universal` always passes;
 * for `male`/`female`, a solo cast member must match, and a multi-cast frame
 * (the owner's own "against a woman's skin" refinement — a mismatched cast
 * member may appear WITH a matching one, never alone) needs at least one
 * matching member in frame.
 *
 * FAILS CLOSED, matching `social-vision-gate.server.ts` and
 * `social-publish-gate.server.ts`'s own contract: "could not check" and
 * "checked and it's fine" are different answers, and only the second one is
 * `pass: true`. A missing `castTarget` or a cast member with no recorded
 * `bodyPresentation` is evidence nobody checked, not evidence of safety.
 */

import type { CastTarget } from './cast-target.server'

export type BodyPresentation = 'masculine' | 'feminine'

export interface CastTargetCheckResult {
  pass: boolean
  reason?: string
}

/**
 * `castTarget` — the product's `xdipx.cast_target` value, or `null` when the
 * product carries no classification (fails closed, per ADR-015 §5).
 * `castSlugs` — the cast members drafted into this frame.
 * `presentationBySlug` — every known cast member's `bodyPresentation`, keyed
 * by slug. A slug missing from this map (an unknown or un-backfilled member)
 * is treated the same as a recorded `null`.
 */
export function checkCastTargetMatch(
  castTarget: CastTarget | null,
  castSlugs: readonly string[],
  presentationBySlug: ReadonlyMap<string, BodyPresentation | null | undefined>,
): CastTargetCheckResult {
  if (castTarget === null) {
    return {
      pass: false,
      reason:
        'Product carries no xdipx.cast_target classification. Missing data is not evidence the ' +
        'pairing is safe (ADR-015 §5 — fail closed, not open).',
    }
  }
  if (castTarget === 'universal') return { pass: true }

  if (castSlugs.length === 0) {
    return {
      pass: false,
      reason: `Product is cast_target=${castTarget} but the draft names no cast member to check against.`,
    }
  }

  const presentations = castSlugs.map(slug => ({ slug, presentation: presentationBySlug.get(slug) ?? null }))
  const unknown = presentations.filter(p => p.presentation == null)
  const wantPresentation: BodyPresentation = castTarget === 'male' ? 'masculine' : 'feminine'
  const matching = presentations.filter(p => p.presentation === wantPresentation)

  if (matching.length > 0) return { pass: true }

  if (unknown.length > 0) {
    return {
      pass: false,
      reason:
        `Product is cast_target=${castTarget}; none of the cast in frame (${castSlugs.join(', ')}) has a ` +
        `recorded bodyPresentation matching it, and ${unknown.map(u => u.slug).join(', ')} ` +
        `${unknown.length === 1 ? 'has' : 'have'} no bodyPresentation on file at all. Missing data is ` +
        'not evidence the pairing is safe (ADR-015 §5).',
    }
  }

  return {
    pass: false,
    reason:
      `Product is cast_target=${castTarget}; none of the cast in frame (${castSlugs.join(', ')}) presents as ` +
      `${wantPresentation}. A mismatched cast member may appear WITH a matching one, never alone ` +
      "(owner direction 2026-09-22: \"if you want to show a man holding a vibrator he should be holding it " +
      'against a woman\'s skin").',
  }
}
