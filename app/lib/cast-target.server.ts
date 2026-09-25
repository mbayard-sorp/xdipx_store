/**
 * `xdipx.cast_target` derivation (ADR-015, ticket #10730).
 *
 * Incident: Instagram row 293 showed Marcus (a male cast member) alone,
 * holding a ROMP Presto Wand (`product_type_dial=vibrator`). Owner, verbatim:
 * "When we have a man holding a vibrator; we look like idiots." Owner
 * direction 2026-09-22: bind merchandising and social agents to a
 * male/female/universal product classification, and require the social team
 * to check it before casting a male or female cast member solo with a
 * product.
 *
 * `deriveCastTarget` is a pure, deterministic function of the two closed
 * taxonomy enums every product already carries (`app/types/index.ts`), the
 * same shape as the `gmcGender` / `gmcProductCategory` functions in
 * `gmc-metafields.server.ts`. It is a lookup table, not an LLM judgment: the
 * enricher already emits both dials in every `ProductWrites` payload, so
 * re-deriving this fact with a model call would add cost and drift risk for
 * zero benefit.
 *
 * This is a DEFAULT, not a verdict. An explicit `xdipx.cast_target` metafield
 * value on the product always wins and is never overwritten by the enrich-time
 * write or the backfill script (see `applyFullEnrichmentWrites` and
 * `scripts/backfill-cast-target.ts`) — that is the escape hatch for the two
 * rows the ADR itself flags as weak-signal (`harness`, `sex-machine`).
 */

import type { ProductSubtypeDial, ProductTypeDial } from '~/types'

export type CastTarget = 'male' | 'female' | 'universal'

export const CAST_TARGETS = ['male', 'female', 'universal'] as const satisfies readonly CastTarget[]

interface DialDefault {
  default: CastTarget
  /** Subtype overrides, keyed by ProductSubtypeDial value. */
  subtypes?: Partial<Record<ProductSubtypeDial, CastTarget>>
}

/**
 * The derivation table from ADR-015 §1, transcribed verbatim. Keyed off
 * `product_type_dial` first, `product_subtype_dial` second. `harness` and
 * `sex-machine` are the two rows the ADR names as weakest-signal — real
 * per-SKU overrides are expected there, not a defect in this table.
 */
const CAST_TARGET_TABLE: Record<ProductTypeDial, DialDefault> = {
  vibrator:  { default: 'female' },
  dildo:     { default: 'female', subtypes: { packer: 'male' } },
  anal:      { default: 'universal', subtypes: { prostate: 'male' } },
  bondage:   { default: 'universal' },
  'cock-ring': { default: 'male' },
  stroker:   { default: 'male' },
  couples:   { default: 'universal' },
  harness:   { default: 'universal' },
  extender:  { default: 'male', subtypes: { 'strap-on': 'universal' } },
  pump:      { default: 'male' },
  lube:      { default: 'universal' },
  massage:   { default: 'universal' },
  enhancer:  { default: 'universal', subtypes: { 'male-arousal': 'male', 'female-arousal': 'female' } },
  wear: {
    default: 'universal',
    subtypes: {
      'mens-underwear': 'male',
      panty: 'female',
      'bra-panty-set': 'female',
      'bodysuit-teddy': 'female',
      bodystocking: 'female',
      hosiery: 'female',
      pasty: 'female',
      'plus-queen': 'female',
    },
  },
  condom:    { default: 'universal' },
  wellness:  { default: 'universal', subtypes: { kegel: 'female' } },
  novelty:   { default: 'universal' },
  'book-media': { default: 'universal' },
  'sex-machine': { default: 'universal' },
}

/**
 * Derives the default `xdipx.cast_target` for a product from its type/subtype
 * dials. An unrecognized `productTypeDial` falls back to `'universal'` (the
 * safest default — it never restricts casting) rather than throwing, since
 * this runs at enrich time and backfill time over live catalog data that may
 * predate the taxonomy or carry a value this table has not seen yet.
 */
export function deriveCastTarget(
  productTypeDial: ProductTypeDial | string | null | undefined,
  productSubtypeDial?: ProductSubtypeDial | string | null | undefined,
): CastTarget {
  const row = productTypeDial ? CAST_TARGET_TABLE[productTypeDial as ProductTypeDial] : undefined
  if (!row) return 'universal'
  if (productSubtypeDial && row.subtypes) {
    const override = row.subtypes[productSubtypeDial as ProductSubtypeDial]
    if (override) return override
  }
  return row.default
}
