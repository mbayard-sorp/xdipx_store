import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Coral-budget source-scan guard for the repeating product grid tiles
 * (ticket #574, option (b); R-DEV retro 2026-07-31).
 *
 * design-doctrine §3 rations coral: at most ONE primary coral element per
 * viewport, normally the primary CTA. A product grid renders many tiles per
 * viewport, so a tile that puts coral on its resting face (price, eyebrow,
 * border, title) multiplies that one budget by N — the exact drift #336
 * (VaultCard) and #466 (PDP/FBT) were filed for. design-critic cannot
 * screenshot in a scheduled run and the repo has no component render harness,
 * so this pins the rule at the source: the many-per-viewport product tiles
 * carry zero action-coral.
 *
 * Scope note (why only these two): VaultCard and CategoryProductCard are the
 * repeating catalog tiles. Guided-discovery result cards (FitCard, discovery
 * ProductCard) are shown a few at a time and ARE the primary CTA surface, so a
 * single coral add-to-cart button there is the sanctioned one-per-viewport
 * spend, not drift. Add a new repeating tile here when one ships; do not add a
 * card whose coral is a real CTA.
 *
 * Action-coral utilities only (`bg-coral`, `text-coral`, `border-coral`,
 * `ring-coral`, `coral-2`). `coral-soft` (a full-band tint fill) and
 * `link-coral` (a hairline link) are deliberately NOT flagged — they are not
 * the primary-action role.
 */

const GRID_TILES = ['./VaultCard.tsx', '../category/CategoryProductCard.tsx'] as const

// `(?:bg|text|border|ring|from|via|to)-coral` optionally `-2`, but not when a
// further `-` or word char follows (so `coral-soft`/`coral-3` never match).
// `link-coral` is not matched because its prefix is `link`, not a color role.
const ACTION_CORAL = /\b(?:bg|text|border|ring|from|via|to)-coral(?:-2)?(?![-\w])/g

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

describe('coral budget — repeating product tiles carry no action-coral (§3)', () => {
  for (const rel of GRID_TILES) {
    it(`${rel} has no bg-coral/text-coral/border-coral on its face`, () => {
      const src = read(rel)
      const hits = src.match(ACTION_CORAL) ?? []
      expect(
        hits,
        `${rel} added action-coral (${hits.join(', ')}). A repeating grid tile ` +
          `must not spend coral on its resting face (doctrine §3). If this is a ` +
          `genuine single-CTA card, it does not belong in GRID_TILES.`,
      ).toEqual([])
    })
  }

  it('the guard actually detects action-coral (and spares coral-soft / link-coral)', () => {
    // Regression guard for the guard: proves the regex catches the real drift
    // classes and does not false-positive on the allowed tint/link utilities.
    expect('class="text-coral"'.match(ACTION_CORAL)).toEqual(['text-coral'])
    expect('class="bg-coral-2 border-coral"'.match(ACTION_CORAL)).toEqual(['bg-coral-2', 'border-coral'])
    expect('class="bg-coral-soft"'.match(ACTION_CORAL)).toBeNull()
    expect('class="link-coral"'.match(ACTION_CORAL)).toBeNull()
  })
})
