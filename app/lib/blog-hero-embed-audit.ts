/**
 * blog-hero-embed-audit.ts
 *
 * Pure detection logic for ticket #886: a published Notebook post whose hero
 * image depicts a product the article never embeds is a credibility leak on a
 * surface whose whole job is being citable (run 155 found a draft of
 * "mini-vs-full-size-vibrator-does-size-matter" carrying a Wanda Lust wand hero
 * while its three embeds were femmefunn-ultra-bullet / magic-wand-mini /
 * magic-wand-rechargeable).
 *
 * The hero carries no structured product reference — only free-text
 * `heroImageAlt` and `imagePrompt` — so the coupling can only be checked
 * heuristically: does the hero copy NAME a catalog product whose handle is not
 * among the post's blogProductEmbed handles? This module is the matcher; the
 * live Sanity query lives in scripts/audit-blog-hero-embed.ts. Kept pure and
 * dependency-free so it is unit-testable without network access.
 *
 * The heuristic is tuned for PRECISION over recall — this is a cheap check that
 * surfaces candidates for human review, and a noisy audit is a useless one.
 */

export interface AuditBlogPost {
  slug: string
  /** Free-text alt on the hero image. */
  heroImageAlt: string | null
  /** Free-text prompt used to generate the hero image (often names the product). */
  imagePrompt?: string | null
  /** productHandle values of every blogProductEmbed in the post body. */
  embedHandles: string[]
}

export interface CatalogProduct {
  /** Shopify handle (slug) — the identity that embeds reference. */
  handle: string
  /** Product title, if known. Falls back to the handle when absent. */
  title: string | null
}

export interface HeroEmbedMismatch {
  slug: string
  /** Handle of the catalog product the hero copy appears to name. */
  matchedHandle: string
  matchedTitle: string | null
  /** The distinctive tokens that triggered the match, for reviewer context. */
  matchedOn: string[]
  heroImageAlt: string | null
  embedHandles: string[]
}

// Generic category / material / size / marketing words. Stripped from a
// product's name before matching so only distinctive brand/model tokens remain
// — otherwise every "wand" hero would match every wand product.
const GENERIC_TOKENS = new Set<string>([
  'the', 'and', 'for', 'with', 'set', 'kit', 'edition', 'pack',
  'wand', 'wands', 'vibrator', 'vibrators', 'vibe', 'vibes', 'dildo', 'dildos',
  'bullet', 'bullets', 'plug', 'plugs', 'massager', 'massagers', 'lube',
  'lubricant', 'lubricants', 'ring', 'rings', 'harness', 'stroker', 'strokers',
  'masturbator', 'masturbators', 'beads', 'rabbit',
  'mini', 'max', 'pro', 'plus', 'lite', 'xl', 'deluxe',
  'rechargeable', 'silicone', 'waterproof', 'wireless', 'remote', 'app',
  'adult', 'wellness', 'product', 'toy', 'toys', 'pleasure', 'couples',
])

/** Lowercase, replace non-alphanumerics with spaces, collapse whitespace. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The name a product is recognizable by: its title, or its handle words. */
function productName(p: CatalogProduct): string {
  const t = p.title && p.title.trim() ? p.title : p.handle.replace(/-/g, ' ')
  return normalize(t)
}

/**
 * Distinctive tokens of a name: words >= 3 chars that are not generic category
 * words. These are the brand/model words ("wanda", "lust", "femmefunn") that
 * actually identify one product versus another.
 */
export function distinctiveTokens(name: string): string[] {
  return normalize(name)
    .split(' ')
    .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t))
}

/**
 * A product is "named" in the hero copy when either:
 *   - it has >= 2 distinctive tokens and ALL of them appear in the copy, or
 *   - it has a single distinctive token that is long (>= 6 chars) and present.
 * Both require whole-word token presence, which keeps precision high.
 */
function isNamedIn(dt: string[], copyTokens: Set<string>): boolean {
  if (dt.length === 0) return false
  if (dt.length === 1) return dt[0]!.length >= 6 && copyTokens.has(dt[0]!)
  return dt.every((t) => copyTokens.has(t))
}

/**
 * Find published posts whose hero copy names a catalog product that is not one
 * of the post's embeds.
 *
 * Guardrails against false positives:
 *   - Products the post already embeds are never candidates.
 *   - A candidate whose distinctive tokens are a subset of an EMBEDDED
 *     product's tokens is skipped — the hero is almost certainly referring to
 *     the embedded sibling SKU (e.g. a non-embedded "wanda-lust-max" when
 *     "wanda-lust-mini" is embedded and the alt just says "wanda lust").
 */
export function findHeroEmbedMismatches(
  posts: AuditBlogPost[],
  catalog: CatalogProduct[],
): HeroEmbedMismatch[] {
  const productsWithTokens = catalog.map((p) => ({ p, dt: distinctiveTokens(productName(p)) }))
  const results: HeroEmbedMismatch[] = []

  for (const post of posts) {
    const copy = normalize([post.heroImageAlt ?? '', post.imagePrompt ?? ''].join(' '))
    if (!copy) continue
    const copyTokens = new Set(copy.split(' ').filter(Boolean))
    const embedSet = new Set(post.embedHandles.map((h) => h.toLowerCase().trim()).filter(Boolean))

    // Distinctive tokens of every product this post DOES embed — used to
    // suppress sibling-SKU false positives.
    const embeddedTokenSets = productsWithTokens
      .filter(({ p }) => embedSet.has(p.handle.toLowerCase()))
      .map(({ dt }) => new Set(dt))

    for (const { p, dt } of productsWithTokens) {
      if (embedSet.has(p.handle.toLowerCase())) continue
      if (!isNamedIn(dt, copyTokens)) continue
      // Skip if this candidate is indistinguishable from an embedded sibling.
      const subsetOfEmbedded = embeddedTokenSets.some(
        (emb) => dt.length > 0 && dt.every((t) => emb.has(t)),
      )
      if (subsetOfEmbedded) continue

      results.push({
        slug: post.slug,
        matchedHandle: p.handle,
        matchedTitle: p.title,
        matchedOn: dt,
        heroImageAlt: post.heroImageAlt,
        embedHandles: post.embedHandles,
      })
    }
  }

  return results
}

/**
 * True when the hero copy (alt + prompt) names AT LEAST ONE catalog product,
 * using the same whole-word distinctive-token test as the mismatch finder.
 *
 * The complement is the failure mode findHeroEmbedMismatches is blind to by
 * construction: it only fires when a hero names a product the post does NOT
 * embed, so a hero that names NO product at all (a generic editorial scene on a
 * post that does carry embeds) slips through. A per-post pre-flight checks
 * `post.embedHandles.length > 0 && !heroNamesAnyProduct(post, catalog)` to catch
 * exactly that (ticket #2750).
 */
export function heroNamesAnyProduct(post: AuditBlogPost, catalog: CatalogProduct[]): boolean {
  const copy = normalize([post.heroImageAlt ?? '', post.imagePrompt ?? ''].join(' '))
  if (!copy) return false
  const copyTokens = new Set(copy.split(' ').filter(Boolean))
  return catalog.some((p) => isNamedIn(distinctiveTokens(productName(p)), copyTokens))
}
