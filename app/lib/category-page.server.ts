/**
 * Merchandised category / drop page resolver.
 *
 * Turns a `categoryPage` or `dropPage` document into renderable blocks. The
 * design rule that shapes everything here is per-block failure isolation:
 * every block resolves inside its own timeout and catch, and a block that
 * fails resolves to null and is filtered out. One malformed shelf costs that
 * shelf, never the page — the class of failure that once blanked the homepage
 * for three days (PR #322) is structurally impossible here.
 *
 * Dial honesty: dial values come from the product's own metafields and axes
 * from the dialTaxonomy singleton. A product without dial data renders no
 * dial; a category whose axis set is empty drops the legend. Nothing on these
 * pages fabricates a reading (design doctrine §6).
 *
 * Server-only. Never import from a client component.
 */

import { getClient } from '~/lib/sanity.server'
import { cached } from '~/lib/kv.server'
import { withTimeout } from '~/lib/with-timeout.server'
import {
  getCollectionList,
  getCollectionProducts,
  getProductsByHandles,
  getProductsByTag,
} from '~/lib/shopify.server'
import { getDialTaxonomy } from '~/lib/dial-registry.server'
import { normalizeProductHandles, type ProductHandleEntry } from '~/lib/product-handles'
import type { Product, ProductTypeDial } from '~/types'
import type {
  CategoryCardProduct,
  ResolvedCategoryBlock,
  ResolvedCategoryPage,
  ResolvedDropPage,
} from '~/types/cms'

const BLOCK_TIMEOUT_MS = 6000
const SHELF_SIZE = 4
/** Page-level cache. Underlying fetchers carry their own caches; this bounds
 *  the per-request GROQ read. Must stay <= the route's 600s edge window. */
const PAGE_CACHE_TTL_S = 300

const BLOCKS_PROJECTION = `
  blocks[]{
    _type, _key, anchorId,
    kicker, headline, italicWord, standfirst, heading, intro, label, sticky,
    showCounts, axisSet, title, collectionHandle, sortRationale, seeAllLabel,
    pinnedHandles, productHandle, body, ctaLabel, period,
    "imageUrl": image.asset->url,
    "imageAlt": image.alt,
    claims[]{ claim, detail, source, "sourceUrl": sourceUrl },
    items[]{ headline, subheadline, question, answer },
    options[]{ label, tag, narratorCopy },
    entries[]{ label, note, productHandles },
    posts[]->{ "slug": slug.current, title, "heroImageUrl": heroImage.asset->url, excerpt, status }
  }
`

const CATEGORY_PAGE_GROQ = `
  *[_type == "categoryPage" && shopifyCollectionHandle == $handle && status == "live"][0]{
    shopifyCollectionHandle,
    ${BLOCKS_PROJECTION}
  }
`

const DROP_PAGE_GROQ = `
  *[_type == "dropPage" && routeKey == $routeKey && status == "live"][0]{
    routeKey,
    ${BLOCKS_PROJECTION}
  }
`

/* GROQ rows arrive loosely typed; every field is optional until validated. */
interface RawBlock {
  _type?: string
  _key?: string
  anchorId?: string
  kicker?: string
  headline?: string
  italicWord?: string
  standfirst?: string
  heading?: string
  intro?: string
  label?: string
  sticky?: boolean
  showCounts?: boolean
  axisSet?: string
  title?: string
  collectionHandle?: string
  sortRationale?: string
  seeAllLabel?: string
  pinnedHandles?: ProductHandleEntry[]
  productHandle?: string
  body?: string
  ctaLabel?: string
  period?: string
  imageUrl?: string
  imageAlt?: string
  claims?: { claim?: string; detail?: string; source?: string; sourceUrl?: string }[]
  items?: { headline?: string; subheadline?: string; question?: string; answer?: string }[]
  options?: { label?: string; tag?: string; narratorCopy?: string }[]
  entries?: { label?: string; note?: string; productHandles?: ProductHandleEntry[] }[]
  posts?: { slug?: string; title?: string; heroImageUrl?: string; excerpt?: string; status?: string }[]
}

function toCardProduct(p: Product): CategoryCardProduct {
  // Per-dimension dial values live on the full Deal shape (PDP metafield
  // fetch), not on the lean Product these fetchers return, and nothing here
  // fabricates a reading. Cards ship dial-less until the dial-coverage
  // backfill gives the lean pipeline real values; the field stays in the type
  // so components already render it when that lands.
  const dial: CategoryCardProduct['dial'] = []
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    price: p.price,
    compareAtPrice: p.compareAtPrice ?? null,
    brand: p.brand ?? null,
    imageUrl: p.images[0]?.url ?? null,
    imageAlt: p.images[0]?.altText ?? null,
    dial,
  }
}

function anchorOf(raw: RawBlock, fallback: string): string {
  const a = raw.anchorId?.trim()
  return a && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a) ? a : fallback
}

/**
 * Resolve one raw block. Returns null for anything unrecognized, empty, or
 * broken; the caller filters nulls. All Shopify legs go through the guarded
 * fetchers, which have their own caches.
 */
async function resolveBlock(
  raw: RawBlock,
  index: number,
  ctx: { counts: Map<string, number | null>; shelfAnchors: { label: string; anchorId: string; handle: string }[] },
): Promise<ResolvedCategoryBlock | null> {
  const key = raw._key ?? `block-${index}`

  switch (raw._type) {
    case 'categoryMasthead': {
      if (!raw.headline?.trim()) return null
      return {
        _type: 'categoryMasthead',
        key,
        anchorId: anchorOf(raw, 'top'),
        kicker: raw.kicker?.trim() || null,
        headline: raw.headline.trim(),
        italicWord: raw.italicWord?.trim() || null,
        standfirst: raw.standfirst?.trim() || null,
        imageUrl: raw.imageUrl ?? null,
        imageAlt: raw.imageAlt ?? null,
      }
    }

    case 'shelfNav': {
      // Tiles derive from the page's own shelves so anchors always resolve;
      // the shelves themselves mirror the Shopify menu, so the design's
      // "from the menu" contract holds transitively.
      const showCounts = raw.showCounts !== false
      const tiles = ctx.shelfAnchors.map(s => ({
        label: s.label,
        anchorId: s.anchorId,
        count: showCounts ? (ctx.counts.get(s.handle) ?? null) : null,
      }))
      if (tiles.length === 0) return null
      return {
        _type: 'shelfNav',
        key,
        anchorId: anchorOf(raw, 'shelves'),
        label: raw.label?.trim() || 'Jump to',
        sticky: raw.sticky !== false,
        tiles,
      }
    }

    case 'sensationLegend': {
      const taxonomy = await getDialTaxonomy()
      const axisSet = (raw.axisSet?.trim() || 'vibrator') as ProductTypeDial
      const axes = (taxonomy[axisSet] ?? [])
        .filter(a => a?.label)
        .map(a => ({
          label: a.label,
          definition: a.definition ?? null,
          scaleLow: a.scaleLow ?? null,
          scaleMid: a.scaleMid ?? null,
          scaleHigh: a.scaleHigh ?? null,
        }))
      // No axes = no legend. Never render an empty teaching block.
      if (axes.length === 0) return null
      return {
        _type: 'sensationLegend',
        key,
        anchorId: anchorOf(raw, 'legend'),
        heading: raw.heading?.trim() || 'How we describe these',
        intro: raw.intro?.trim() || null,
        axes,
      }
    }

    case 'editorialFeature': {
      const handle = raw.productHandle?.trim()
      if (!handle || !raw.headline?.trim()) return null
      const products = await getProductsByHandles([handle])
      const product = products[0] ? toCardProduct(products[0]) : null
      // A feature whose product is gone renders nothing rather than an
      // argument for a dead link.
      if (!product) {
        console.warn(`[category-page] editorialFeature product "${handle}" not found, dropping block`)
        return null
      }
      return {
        _type: 'editorialFeature',
        key,
        anchorId: anchorOf(raw, `feature-${handle}`),
        kicker: raw.kicker?.trim() || null,
        headline: raw.headline.trim(),
        italicWord: raw.italicWord?.trim() || null,
        body: raw.body?.trim() || null,
        ctaLabel: raw.ctaLabel?.trim() || 'Take a peek →',
        product,
        imageUrl: raw.imageUrl ?? null,
        imageAlt: raw.imageAlt ?? null,
      }
    }

    case 'shelfSection': {
      const handle = raw.collectionHandle?.trim()
      if (!handle || !raw.title?.trim()) return null
      const pinned = normalizeProductHandles(raw.pinnedHandles ?? [])
      const [pinnedProducts, fillProducts] = await Promise.all([
        pinned.length > 0 ? getProductsByHandles(pinned) : Promise.resolve([] as Product[]),
        getCollectionProducts(handle, SHELF_SIZE * 2),
      ])
      const seen = new Set<string>()
      const products: CategoryCardProduct[] = []
      for (const p of [...pinnedProducts, ...fillProducts]) {
        if (seen.has(p.handle) || products.length >= SHELF_SIZE) continue
        seen.add(p.handle)
        products.push(toCardProduct(p))
      }
      // An empty shelf renders nothing; shelfNav drops its tile too because
      // the anchors list is built only from shelves that survived.
      if (products.length === 0) {
        console.warn(`[category-page] shelf "${handle}" is empty, dropping block`)
        return null
      }
      return {
        _type: 'shelfSection',
        key,
        anchorId: anchorOf(raw, `shelf-${handle}`),
        title: raw.title.trim(),
        collectionHandle: handle,
        intro: raw.intro?.trim() || null,
        sortRationale: raw.sortRationale?.trim() || null,
        seeAllLabel: raw.seeAllLabel?.trim() || 'See all →',
        products,
      }
    }

    case 'learnStrip': {
      const posts = (raw.posts ?? [])
        .filter(p => p?.slug && p?.title && p?.status === 'published')
        .map(p => ({
          slug: p.slug!,
          title: p.title!,
          heroImageUrl: p.heroImageUrl ?? null,
          excerpt: p.excerpt ?? null,
        }))
      if (posts.length === 0) return null
      return {
        _type: 'learnStrip',
        key,
        anchorId: anchorOf(raw, 'learn'),
        heading: raw.heading?.trim() || 'Worth reading first',
        posts,
      }
    }

    case 'benefitEditorial': {
      // The schema already refuses unsourced claims; this re-check makes the
      // renderer safe against documents written around the Studio (e.g. via
      // the HTTP API with validation skipped).
      const claims = (raw.claims ?? [])
        .filter(c => c?.claim?.trim() && c?.source?.trim())
        .map(c => ({
          claim: c.claim!.trim(),
          detail: c.detail?.trim() || null,
          source: c.source!.trim(),
          sourceUrl: c.sourceUrl ?? null,
        }))
      if (claims.length === 0) return null
      return {
        _type: 'benefitEditorial',
        key,
        anchorId: anchorOf(raw, 'why'),
        heading: raw.heading?.trim() || null,
        claims,
      }
    }

    case 'categoryTrust': {
      const items = (raw.items ?? [])
        .filter(i => i?.headline?.trim())
        .map(i => ({ headline: i.headline!.trim(), subheadline: i.subheadline?.trim() || null }))
      if (items.length === 0) return null
      return { _type: 'categoryTrust', key, anchorId: anchorOf(raw, 'trust'), items }
    }

    case 'chooserBlock': {
      const options = (raw.options ?? [])
        .filter(o => o?.label?.trim() && o?.tag?.trim())
        .map(o => ({ label: o.label!.trim(), tag: o.tag!.trim(), narratorCopy: o.narratorCopy?.trim() || null }))
      if (options.length < 2) return null
      return {
        _type: 'chooserBlock',
        key,
        anchorId: anchorOf(raw, 'chooser'),
        heading: raw.heading?.trim() || 'What are you after?',
        options,
      }
    }

    case 'faqBlock': {
      const items = (raw.items ?? [])
        .filter(i => i?.question?.trim() && i?.answer?.trim())
        .map(i => ({ question: i.question!.trim(), answer: i.answer!.trim() }))
      if (items.length === 0) return null
      return {
        _type: 'faqBlock',
        key,
        anchorId: anchorOf(raw, 'faq'),
        heading: raw.heading?.trim() || 'Questions, answered.',
        items,
      }
    }

    case 'dropMasthead': {
      if (!raw.headline?.trim()) return null
      return {
        _type: 'dropMasthead',
        key,
        anchorId: anchorOf(raw, 'top'),
        period: raw.period?.trim() || null,
        headline: raw.headline.trim(),
        italicWord: raw.italicWord?.trim() || null,
        standfirst: raw.standfirst?.trim() || null,
        imageUrl: raw.imageUrl ?? null,
        imageAlt: raw.imageAlt ?? null,
      }
    }

    case 'justLanded': {
      const handle = raw.productHandle?.trim()
      if (!handle) return null
      const products = await getProductsByHandles([handle])
      const product = products[0] ? toCardProduct(products[0]) : null
      if (!product) return null
      return {
        _type: 'justLanded',
        key,
        anchorId: anchorOf(raw, 'just-landed'),
        kicker: raw.kicker?.trim() || 'Just landed',
        body: raw.body?.trim() || null,
        product,
      }
    }

    case 'dropTimeline': {
      const rawEntries = (raw.entries ?? []).filter(e => e?.label?.trim())
      if (rawEntries.length === 0) return null
      const resolved = await Promise.all(
        rawEntries.map(async e => {
          const handles = normalizeProductHandles(e.productHandles ?? [])
          const products = handles.length > 0 ? await getProductsByHandles(handles) : []
          return {
            label: e.label!.trim(),
            note: e.note?.trim() || null,
            products: products.map(toCardProduct),
          }
        }),
      )
      const entries = resolved.filter(e => e.products.length > 0)
      if (entries.length === 0) return null
      return {
        _type: 'dropTimeline',
        key,
        anchorId: anchorOf(raw, 'timeline'),
        heading: raw.heading?.trim() || 'What landed, and when',
        entries,
      }
    }

    case 'makersNote': {
      if (!raw.body?.trim()) return null
      return {
        _type: 'makersNote',
        key,
        anchorId: anchorOf(raw, 'note'),
        heading: raw.heading?.trim() || 'Why these',
        body: raw.body.trim(),
      }
    }

    case 'comingSoon': {
      return {
        _type: 'comingSoon',
        key,
        anchorId: anchorOf(raw, 'soon'),
        heading: raw.heading?.trim() || null,
        body: raw.body?.trim() || null,
        ctaLabel: raw.ctaLabel?.trim() || 'Show me',
      }
    }

    default:
      return null
  }
}

async function resolveBlocks(rawBlocks: RawBlock[]): Promise<ResolvedCategoryBlock[]> {
  // Shelf anchors + counts are shared context: shelfNav derives its tiles from
  // the shelves that exist, and counts come from one collection-list read.
  const shelfAnchors = rawBlocks
    .filter(b => b._type === 'shelfSection' && b.collectionHandle?.trim() && b.title?.trim())
    .map(b => ({
      label: b.title!.trim(),
      anchorId: anchorOf(b, `shelf-${b.collectionHandle!.trim()}`),
      handle: b.collectionHandle!.trim(),
    }))

  const counts = new Map<string, number | null>()
  try {
    const list = await getCollectionList()
    for (const c of list) counts.set(c.handle, c.productsCount)
  } catch {
    // Counts are decoration; shelves render without them.
  }

  const resolved = await Promise.all(
    rawBlocks.map((raw, i) =>
      withTimeout(
        resolveBlock(raw, i, { counts, shelfAnchors }),
        BLOCK_TIMEOUT_MS,
        null,
        `resolveBlock(${raw._type ?? 'unknown'})`,
      ).catch((err: unknown) => {
        console.error(`[category-page] block ${raw._type ?? 'unknown'} failed, dropping it:`, err)
        return null
      }),
    ),
  )

  const blocks = resolved.filter((b): b is ResolvedCategoryBlock => b !== null)

  // A live shelfNav pointing at shelves that all failed would render dead
  // anchors; rebuild its tiles from the shelves that actually survived.
  const liveShelfAnchors = new Set(
    blocks.filter(b => b._type === 'shelfSection').map(b => b.anchorId),
  )
  return blocks.flatMap((b): ResolvedCategoryBlock[] => {
    if (b._type !== 'shelfNav') return [b]
    const tiles = b.tiles.filter(t => liveShelfAnchors.has(t.anchorId))
    return tiles.length > 0 ? [{ ...b, tiles }] : []
  })
}

export async function getCategoryPage(
  handle: string,
  preview = false,
): Promise<ResolvedCategoryPage | null> {
  const fetcher = async (): Promise<ResolvedCategoryPage | null> => {
    try {
      const client = getClient(false, preview)
      if (!client) return null
      const raw = await client.fetch<{ shopifyCollectionHandle?: string; blocks?: RawBlock[] } | null>(
        CATEGORY_PAGE_GROQ,
        { handle },
      )
      if (!raw?.blocks?.length) return null
      const blocks = await resolveBlocks(raw.blocks)
      // A page needs its masthead: without one there is no H1 and the plain
      // collection rendering is the better page.
      if (!blocks.some(b => b._type === 'categoryMasthead')) return null
      return { handle, blocks }
    } catch (err) {
      console.error(`[category-page] getCategoryPage(${handle}) failed:`, err)
      return null
    }
  }

  if (preview) return fetcher()
  return cached(`category-page:${handle}`, PAGE_CACHE_TTL_S, fetcher)
}

export async function getDropPage(
  routeKey: 'new' | 'on-sale',
  preview = false,
): Promise<ResolvedDropPage | null> {
  const fetcher = async (): Promise<ResolvedDropPage | null> => {
    try {
      const client = getClient(false, preview)
      if (!client) return null
      const raw = await client.fetch<{ routeKey?: string; blocks?: RawBlock[] } | null>(
        DROP_PAGE_GROQ,
        { routeKey },
      )
      if (!raw?.blocks?.length) return null
      const blocks = await resolveBlocks(raw.blocks)
      if (!blocks.some(b => b._type === 'dropMasthead')) return null
      return { routeKey, blocks }
    } catch (err) {
      console.error(`[category-page] getDropPage(${routeKey}) failed:`, err)
      return null
    }
  }

  if (preview) return fetcher()
  return cached(`drop-page:${routeKey}`, PAGE_CACHE_TTL_S, fetcher)
}

/** Exposed for the drop pages' sourceRule=tag default. */
export async function getDropTagProducts(tag = 'new-arrival', limit = 12): Promise<CategoryCardProduct[]> {
  try {
    const products = await getProductsByTag(tag, limit)
    return products.map(toCardProduct)
  } catch {
    return []
  }
}
