/**
 * Content for the PDP health and body-literacy block (Ad Studio v2 PR-D,
 * ads-policy M1). Pure and isomorphic: it reads fields the product already
 * carries (type dial, specification bullets, audience tags, care steps) and
 * invents nothing. A product with none of those fields gets `null`, and the
 * block does not render.
 *
 * Register 3-4: what it is, what it is made of, who it is for, how to look
 * after it. No efficacy claim beyond the label, no pleasure outcome.
 */

import type { Deal } from '~/types'

export const HEALTH_DISCLAIMER = 'This is a personal wellness product, not a medical device.'

export interface HealthBlockContent {
  /** One plain sentence on how the product works, from its type. */
  mechanism: string | null
  /** Verbatim spec lines that describe how it runs (power, waterproofing, noise). */
  mechanismSpecs: string[]
  /** Verbatim material spec lines. A body-safe claim appears only if a spec line itself says so. */
  materials: string[]
  /** Audience tags, humanized. */
  audience: string[]
  /** Care steps from the xdipx.care_instructions metafield. */
  care: string[]
}

// Definitional, true of the whole type, and free of any outcome claim.
const MECHANISM_BY_TYPE: Partial<Record<string, string>> = {
  vibrator: 'Runs on a small motor.',
  lube: 'A lubricant, used to reduce friction.',
}

const MECHANISM_SPEC_RE = /^(power|battery|charging|waterproof|water.?resistant|noise|motor|speeds?|modes?|runtime|run time)\b/i
// A material line is one whose label says so, or one that itself states body-safe
// or phthalate-free. A bare mention of silicone or latex is not enough: lube
// listings say "Toy compatibility: Safe for use with silicone", which is not a material.
const MATERIAL_LABEL_RE = /^[^:]*\b(materials?|finish|composition|body.?safe|phthalate)/i
const MATERIAL_STATED_RE = /body.?safe|phthalate.?free/i

function humanizeTag(tag: string): string {
  return tag.replace(/[-_]+/g, ' ').trim().toLowerCase()
}

export function buildHealthBlockContent(
  deal: Pick<Deal, 'productTypeDial' | 'specifications' | 'audienceTags' | 'careInstructions'>,
): HealthBlockContent | null {
  const specs = (deal.specifications ?? []).map(s => s.trim()).filter(Boolean)
  const mechanism = (deal.productTypeDial && MECHANISM_BY_TYPE[deal.productTypeDial]) || null
  const mechanismSpecs = specs.filter(s => MECHANISM_SPEC_RE.test(s)).slice(0, 3)
  const materials = specs.filter(s => !MECHANISM_SPEC_RE.test(s) && (MATERIAL_LABEL_RE.test(s) || MATERIAL_STATED_RE.test(s))).slice(0, 3)
  const audience = Array.from(new Set((deal.audienceTags ?? []).map(humanizeTag).filter(Boolean))).slice(0, 4)
  const care = (deal.careInstructions ?? []).map(s => s.trim()).filter(Boolean).slice(0, 4)

  const hasContent =
    !!mechanism || mechanismSpecs.length > 0 || materials.length > 0 || audience.length > 0 || care.length > 0
  if (!hasContent) return null
  return { mechanism, mechanismSpecs, materials, audience, care }
}
