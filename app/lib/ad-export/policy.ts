/**
 * Pre-export policy gates. An export refuses to build when a creative carries a
 * gate block, or when the lane's rules fail. This is the successor to the old
 * `citesHealthCarveOut` guard on the push stubs: the same idea (policy is a
 * structural precondition, not a reviewer's afterthought) applied before a file
 * ever exists. Rules come from docs/ads-policy.md (Meta M1 to M7, Google Search
 * row) and docs/store-team/google-ads-ad-copy.md (no glyphs, no prices).
 *
 * Pure functions returning issue lists, so the builders and the tests share them.
 */
import { PLEASURE_CLAIMS, META_CATEGORY_WORDS, destinationOkForMeta } from '~/lib/ad-copy-gates.server'
import { ExportRefusal, blockedGateReasons, clip, type ExportCreative, type ExportIdea } from './common'

// ---------------------------------------------------------------------------
// Google Search and Microsoft Search (responsive search ads)
// ---------------------------------------------------------------------------

export const RSA_HEADLINE_MAX = 30
export const RSA_DESCRIPTION_MAX = 90
export const RSA_PATH_MAX = 15
export const RSA_HEADLINES_MAX = 15
export const RSA_DESCRIPTIONS_MAX = 4

/** Printable ASCII only. Covers the CTA glyphs (arrow, heart), smart quotes, dashes and emoji. */
const NON_ASCII = /[^\x20-\x7E]/
/** Price, discount or MAP-sensitive framing never goes in ad text (launch plan, creative rules). */
const PRICE_OR_PROMO = /(\$\s?\d|\d\s?%|\b\d+\s?(percent|off)\b|\b(discount|coupon|promo code|sale price|clearance)\b|\bbuy now\b)/i

export function glyphIn(text: string): string | null {
  const m = NON_ASCII.exec(text)
  return m ? m[0] : null
}

export interface GoogleTextInput {
  headlines: readonly string[]
  descriptions: readonly string[]
  finalUrl: string
  paths?: readonly string[]
}

/** Issues for one RSA. Empty list means it can be exported. */
export function googleTextIssues(input: GoogleTextInput): string[] {
  const issues: string[] = []
  for (const h of input.headlines) {
    if (h.length > RSA_HEADLINE_MAX) issues.push(`Headline over ${RSA_HEADLINE_MAX} characters (${h.length}): "${clip(h)}"`)
    if (h.includes('!')) issues.push(`Exclamation mark in headline "${clip(h)}" (Google rejects it in headlines)`)
  }
  for (const d of input.descriptions) {
    if (d.length > RSA_DESCRIPTION_MAX) issues.push(`Description over ${RSA_DESCRIPTION_MAX} characters (${d.length}): "${clip(d)}"`)
  }
  for (const p of input.paths ?? []) {
    if (p.length > RSA_PATH_MAX) issues.push(`Display path over ${RSA_PATH_MAX} characters: "${p}"`)
  }
  for (const t of [...input.headlines, ...input.descriptions, ...(input.paths ?? [])]) {
    const g = glyphIn(t)
    if (g) issues.push(`Glyph "${g}" in ad text "${clip(t)}" (Search ad text is plain ASCII: no arrows, hearts, smart quotes or dashes)`)
    if (PRICE_OR_PROMO.test(t)) issues.push(`Price, discount or "buy now" framing in "${clip(t)}" (never in ad text)`)
  }
  if (input.headlines.length < 3) issues.push(`Need at least 3 headlines, have ${input.headlines.length}`)
  if (input.descriptions.length < 2) issues.push(`Need at least 2 descriptions, have ${input.descriptions.length}`)
  try {
    const u = new URL(input.finalUrl)
    if (!u.searchParams.get('utm_content')) issues.push('Final URL has no utm_content (attribution reads orders by it)')
    if (u.protocol !== 'https:') issues.push('Final URL must be https')
  } catch {
    issues.push(`Final URL is not a valid URL: "${clip(input.finalUrl)}"`)
  }
  return issues
}

// ---------------------------------------------------------------------------
// Meta paused draft (ads-policy.md M1 to M5)
// ---------------------------------------------------------------------------

export interface MetaCopy {
  headline: string
  primaryText: string
  description: string | null
  destination: string
}

export const META_HEADLINE_MAX = 40
export const META_DESCRIPTION_MAX = 30
export const META_PRIMARY_RECOMMENDED = 125
export const META_PRIMARY_MAX = 2200

export interface MetaPolicyInput {
  idea: Pick<ExportIdea, 'registerTier' | 'conceptSlug'>
  creative: Pick<ExportCreative, 'onSkin' | 'slogan' | 'format'>
  copy: MetaCopy
  /** Optional M5 check from the curated subset (PR-D). Null means the subset is not loaded here. */
  inSubset?: ((handle: string) => boolean) | null
  handle?: string | null
}

export function metaIssues(input: MetaPolicyInput): { issues: string[]; warnings: string[] } {
  const issues: string[] = []
  const warnings: string[] = []
  const { copy } = input
  if (input.idea.registerTier !== '3-4') issues.push(`Meta copy runs at register 3-4, this idea is ${input.idea.registerTier} (M3)`)
  if (input.creative.onSkin) issues.push('On-skin creative is never allowed on Meta, it must be object-first (M2)')
  const texts = [input.creative.slogan ?? '', copy.headline, copy.primaryText, copy.description ?? ''].filter(Boolean)
  for (const t of texts) {
    if (PLEASURE_CLAIMS.test(t)) issues.push(`Pleasure or category claim in "${clip(t)}" (M3)`)
    if (META_CATEGORY_WORDS.test(t)) issues.push(`Category word in "${clip(t)}" (M3, M5: renamed display titles carry none)`)
  }
  if (!destinationOkForMeta(copy.destination)) {
    issues.push('Destination must be the bridge host (curious.xdipx.com) or a /products/ page with the health block (M1)')
  }
  if (copy.headline.length > META_HEADLINE_MAX) issues.push(`Headline over ${META_HEADLINE_MAX} characters (${copy.headline.length})`)
  if (copy.description && copy.description.length > META_DESCRIPTION_MAX) issues.push(`Description over ${META_DESCRIPTION_MAX} characters`)
  if (copy.primaryText.length > META_PRIMARY_MAX) issues.push(`Primary text over ${META_PRIMARY_MAX} characters`)
  else if (copy.primaryText.length > META_PRIMARY_RECOMMENDED) warnings.push(`Primary text is ${copy.primaryText.length} characters, past the ${META_PRIMARY_RECOMMENDED} where "See more" cuts the hook.`)
  if (!/utm_content=/.test(copy.destination)) issues.push('Destination has no utm_content')
  if (input.inSubset && input.handle) {
    if (!input.inSubset(input.handle)) issues.push(`Product ${input.handle} is not in the curated Meta subset (M5)`)
  } else {
    warnings.push('Curated Meta subset (M5) not checked here: the subset ships with PR-D. Confirm the product is in it before creating the draft in Meta.')
  }
  return { issues, warnings }
}

// ---------------------------------------------------------------------------
// The gate every exporter runs first
// ---------------------------------------------------------------------------

/** Refuse when any creative is blocked or carries a gate block. */
export function assertCreativesExportable(creatives: readonly ExportCreative[], opts: { needAsset: boolean }): void {
  if (creatives.length === 0) throw new ExportRefusal('no_subjects', 'Nothing to export: no creatives matched.')
  const issues: string[] = []
  for (const c of creatives) {
    if (c.status === 'blocked') issues.push(`Creative #${c.id} is blocked.`)
    for (const r of blockedGateReasons(c.gates)) issues.push(`Creative #${c.id}: ${r}`)
    if (c.status === 'failed' || c.status === 'rendering') issues.push(`Creative #${c.id} is ${c.status}, not a finished render.`)
    if (opts.needAsset && !c.assetUrl) issues.push(`Creative #${c.id} has no rendered image yet.`)
  }
  if (issues.length) throw new ExportRefusal(creatives.some(c => c.status === 'blocked' || blockedGateReasons(c.gates).length) ? 'gate_blocked' : 'no_asset', issues)
}

export function assertSingleLane(creatives: readonly Pick<ExportCreative, 'lane'>[]): string {
  const lanes = [...new Set(creatives.map(c => c.lane))]
  if (lanes.length !== 1) throw new ExportRefusal('mixed_lanes', `Pick creatives from one lane at a time (got ${lanes.join(', ') || 'none'}).`)
  return lanes[0]!
}
