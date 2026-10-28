/**
 * Programmatic SEO pilot (ticket #18009 / tracker p2-1-pseo): crosses the
 * Ask Emma mood/audience/matters tag vocab with the `xdipx.product_type_dial`
 * taxonomy to produce capped landing-page combinations, e.g. /shop/playful/vibrator.
 *
 * Deliberately reuses the existing discovery index (`getDiscoveryIndex`,
 * app/lib/discovery.server.ts) rather than querying Shopify directly per
 * combination: it already carries normalized mood/audience/matters tags plus
 * productTypeDial for every live product, cached, and is the same payload
 * the home page discovery surface reads. Building a second Shopify query path
 * for the same three tag dimensions would just be a second place to drift.
 *
 * Tag values are normalized with the SAME `normalizeTag` the index itself
 * uses to store mood/audience/matters (Title-Case-Hyphenated), not the
 * lowercase-hyphenated form the Ask Emma vocab lists use for chip rendering.
 * Comparing un-normalized vocab strings against the index would silently
 * match zero products (CLAUDE.md / routine-dev-daily.md 3g precedent: #1258).
 */

import { getAskEmmaVocabulary } from '~/lib/ask-emma-vocab.server'
import { normalizeTag } from '~/lib/discovery-tags'
import { getDiscoveryIndex } from '~/lib/discovery.server'
import { PRODUCT_TYPE_DIALS } from '~/types'
import type { ProductTypeDial } from '~/types'
import { MATTERS_V2 } from '~/types/discovery'
import type { DiscoveryProduct } from '~/types/discovery'

/** Pages below this live, non-discontinued product count 404/noindex and never enter the sitemap. */
export const PSEO_MIN_PRODUCTS = 6

/** Pilot cap: only this many combinations ever reach the sitemap. See CLAUDE.md's cron/SEO notes. */
export const PSEO_SITEMAP_LIMIT = 25

export interface PseoTag {
  /** URL segment, e.g. "playful", "beginner-friendly". */
  slug: string
  /** Display label, e.g. "Playful", "Beginner-Friendly". */
  label: string
  /** The exact normalizeTag() form stored on DiscoveryProduct.mood/audience/matters. */
  normalized: string
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function typeDialLabel(dial: string): string {
  return dial
    .split('-')
    .filter(Boolean)
    .map(w => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * The full crossable tag vocab: Ask Emma's mood + audience axes (Sanity-
 * editable, Shopify-fallback) plus the locked matters v2 set. Deduped by slug
 * so two vocab entries that only differ by case/punctuation never produce two
 * identical URLs.
 */
export async function getPseoTags(): Promise<PseoTag[]> {
  const vocab = await getAskEmmaVocabulary()
  const raw = [...vocab.mood, ...vocab.audience, ...MATTERS_V2]
  const seen = new Set<string>()
  const tags: PseoTag[] = []
  for (const value of raw) {
    const normalized = normalizeTag(value)
    const slug = toSlug(value)
    if (!slug || !normalized || seen.has(slug)) continue
    seen.add(slug)
    tags.push({ slug, label: normalized.replace(/-/g, ' '), normalized })
  }
  return tags
}

export function getPseoTypeSlugs(): readonly ProductTypeDial[] {
  return PRODUCT_TYPE_DIALS
}

function matchesCombo(product: DiscoveryProduct, tag: PseoTag, type: ProductTypeDial): boolean {
  if (product.discontinuedAt) return false
  if (product.productTypeDial !== type) return false
  return (
    product.mood.includes(tag.normalized)
    || product.audience.includes(tag.normalized)
    || product.matters.includes(tag.normalized)
  )
}

export interface PseoCombo {
  tag: PseoTag
  type: ProductTypeDial
  typeLabel: string
  products: DiscoveryProduct[]
}

/**
 * Resolves one /shop/:tag/:type combination against the live catalog.
 * Returns null for an unknown tag or type slug (always 404, never noindex,
 * since the URL itself is invalid). A known combination with a thin result
 * set is still returned so the caller can decide 404-vs-noindex and log which
 * one it chose; it never gates on `PSEO_MIN_PRODUCTS` itself.
 */
export async function getPseoCombo(tagSlug: string, typeSlug: string): Promise<PseoCombo | null> {
  if (!(PRODUCT_TYPE_DIALS as readonly string[]).includes(typeSlug)) return null
  const type = typeSlug as ProductTypeDial

  const tags = await getPseoTags()
  const tag = tags.find(t => t.slug === tagSlug)
  if (!tag) return null

  const index = await getDiscoveryIndex()
  const products = index.filter(p => matchesCombo(p, tag, type))

  return { tag, type, typeLabel: typeDialLabel(type), products }
}

export interface PseoFaq {
  question: string
  answer: string
}

/**
 * Two short, honest FAQs per combination. Deliberately generic rather than
 * claiming anything about a specific product (CLAUDE.md: never fabricate
 * proof); the per-product specifics stay on the PDP, which every card here
 * links straight to.
 */
export function buildPseoFaqs(tagLabel: string, typeLabel: string): PseoFaq[] {
  const tagLower = tagLabel.toLowerCase()
  const typeLower = typeLabel.toLowerCase()
  return [
    {
      question: `What makes a ${typeLower} a good fit for ${tagLower}?`,
      answer:
        `It comes down to how the piece feels to use. Emma tags each ${typeLower} for `
        + `${tagLower} based on what it's actually designed to do, and every pick below `
        + `fits on that basis.`,
    },
    {
      question: `Are these picks beginner-friendly?`,
      answer:
        `It varies by product. Each card links straight to its own page, where the `
        + `details, materials, and sizing are laid out so you can check fit before you buy.`,
    },
  ]
}

export interface PseoComboSummary {
  tagSlug: string
  typeSlug: ProductTypeDial
  tagLabel: string
  typeLabel: string
  count: number
}

/**
 * The combinations eligible for the sitemap: at least `PSEO_MIN_PRODUCTS`
 * live products, ranked by product count (most-covered first, so the capped
 * 25 are the ones most likely to be worth a crawl) and capped at `limit`.
 * Pilot scope per ticket #18009: stays at 25 until the GSC canonical-mismatch
 * count (see app/lib/gsc-index.server.ts) stops rising.
 */
export async function getPseoCombosForSitemap(limit: number = PSEO_SITEMAP_LIMIT): Promise<PseoComboSummary[]> {
  const [tags, index] = await Promise.all([getPseoTags(), getDiscoveryIndex()])

  const summaries: PseoComboSummary[] = []
  for (const tag of tags) {
    for (const type of PRODUCT_TYPE_DIALS) {
      const count = index.filter(p => matchesCombo(p, tag, type)).length
      if (count >= PSEO_MIN_PRODUCTS) {
        summaries.push({
          tagSlug: tag.slug,
          typeSlug: type,
          tagLabel: tag.label,
          typeLabel: typeDialLabel(type),
          count,
        })
      }
    }
  }

  summaries.sort((a, b) =>
    b.count - a.count
    || a.tagSlug.localeCompare(b.tagSlug)
    || a.typeSlug.localeCompare(b.typeSlug),
  )

  return summaries.slice(0, limit)
}
