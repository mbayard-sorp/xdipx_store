import { useEffect } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useOutletContext } from 'react-router'
import {
  getDealByShopifyId, getDealByHandle, getProductsByTag, getBonusDeal,
  getCollectionProducts, getProductsByHandles,
} from '~/lib/shopify.server'
import { db } from '~/lib/db.server'
import { dealHistory, pipelineSettings } from '../../db/schema'
import { eq, inArray } from 'drizzle-orm'
import { kvGet, KV_KEYS } from '~/lib/kv.server'
import { getHomepageSections, getEmmaHeroSettings } from '~/lib/sanity.server'
import { getBundleByHandle }                    from '~/lib/bundles.server'
import { getProductReviews, getProductAggregate } from '~/lib/reviews.server'
import { getEmmaContextRows }    from '~/lib/emma-rails.server'
import { getCartIdFromCookie }   from '~/lib/cart.server'
import { EmmaHero }              from '~/components/store/EmmaHero'
import { BundleHero }            from '~/components/store/BundleHero'
import { QuietEndorsementHero }  from '~/components/store/QuietEndorsementHero'
import { PairBundleHero }        from '~/components/store/PairBundleHero'
import { PairBundleFullBleedHero } from '~/components/store/PairBundleFullBleedHero'
import { ProductCarousel }       from '~/components/cms/ProductCarousel'
import { EmmaContextRow }        from '~/components/home/EmmaContextRow'
import { EmailSubscribe }        from '~/components/store/EmailSubscribe'
import { ContentBlockRenderer }  from '~/components/cms/ContentBlockRenderer'
import { ProductStructuredData } from '~/components/seo/ProductStructuredData'
import type { Product } from '~/types'
import { categoryToLegacyString } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'
import { trackViewItem, trackViewItemList, trackDealView, type GA4Item } from '~/lib/analytics.client'
import { buildSocialMeta } from '~/lib/social-meta'

async function getLiveDealRow() {
  const [dbDeal] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1)
  return dbDeal ?? null
}

export function headers() {
  // Edge-cache the homepage so burst traffic doesn't fan out to Shopify/Sanity.
  // Deal rotations happen at midnight (and inventory sellouts), so 60s
  // revalidation is safe — SWR keeps users fast during revalidation.
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    // Explicit Vercel CDN directive — overrides browser Cache-Control at the edge
    // so the CDN serves cached HTML for 60s with 600s SWR while origin revalidates.
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Read the live-deal row first (indexed, cheap); then fan out the Shopify
  // fetch alongside the other branches so it overlaps rather than chains.
  const dbDeal = await getLiveDealRow()
  const [deal, forHim, forHer, bonusDeal, cmsData, emmaHero, templateRows] = await Promise.all([
    dbDeal?.shopifyProductId ? getDealByShopifyId(dbDeal.shopifyProductId) : Promise.resolve(null),
    getProductsByTag('for-him', 8),
    getProductsByTag('for-her', 8),
    getBonusDeal(),
    getHomepageSections(),
    getEmmaHeroSettings(),
    db.select().from(pipelineSettings).where(inArray(pipelineSettings.key, [
      'homepage_template',
      'homepage_show_free_shipping',
      'homepage_pair_product_handle',
      'homepage_pair_discount_pct',
    ])),
  ])

  const homepageSettings = {
    template: (templateRows.find(r => r.key === 'homepage_template')?.value ?? 'default') as 'default' | 'quiet_endorsement' | 'pair_bundle' | 'pair_bundle_fullbleed',
    showFreeShipping: (templateRows.find(r => r.key === 'homepage_show_free_shipping')?.value ?? 'true') === 'true',
    pairProductHandle: (templateRows.find(r => r.key === 'homepage_pair_product_handle')?.value ?? '').trim(),
    pairDiscountPct: parseInt(templateRows.find(r => r.key === 'homepage_pair_discount_pct')?.value ?? '10', 10) || 10,
  }

  // Resolve pair deal only when a pair_bundle template is active
  const pairBundleDeal = (homepageSettings.template === 'pair_bundle' || homepageSettings.template === 'pair_bundle_fullbleed') && homepageSettings.pairProductHandle
    ? await getDealByHandle(homepageSettings.pairProductHandle)
    : null

  // Resolve optional pair product for bundle variant (Shopify handle → Deal)
  const pairDeal = emmaHero?.heroVariant === 'bundle' && emmaHero.pairProductHandle
    ? await getDealByHandle(emmaHero.pairProductHandle)
    : null

  // If the live deal's Sanity doc is flagged as a bundle, render the bundle hero
  // instead of the DailyDealHero. Falls back to the regular product hero when
  // Sanity has no bundle doc for this handle.
  const bundle = deal?.handle ? await getBundleByHandle(deal.handle) : null

  // Resolve Shopify products for any CMS productCarousel blocks
  const carouselBlocks = (cmsData?.sections ?? []).filter(
    (s): s is ProductCarouselBlock => s._type === 'productCarousel',
  )
  const carouselProductMap: Record<string, Product[]> = {}
  if (carouselBlocks.length > 0) {
    const results = await Promise.all(
      carouselBlocks.map(b => {
        const limit = b.productLimit ?? 8
        const source = b.source ?? 'tag'
        if (source === 'collection' && b.collectionHandle) {
          return getCollectionProducts(b.collectionHandle, limit)
        }
        if (source === 'manual' && b.productHandles?.length) {
          return getProductsByHandles(b.productHandles.map(p => p.handle))
        }
        // Default: tag-based (backwards compatible)
        return b.shopifyTag ? getProductsByTag(b.shopifyTag, limit) : Promise.resolve([])
      }),
    )
    carouselBlocks.forEach((b, i) => { carouselProductMap[b._key] = results[i] ?? [] })
  }

  // Resolve Shopify products for any Emma-curated rail blocks (manual handles only)
  const emmaRailBlocks = (cmsData?.sections ?? []).filter(
    (s): s is import('~/types/cms').EmmaCuratedRailBlock => s._type === 'emmaCuratedRail',
  )
  if (emmaRailBlocks.length > 0) {
    const results = await Promise.all(
      emmaRailBlocks.map(b =>
        b.productHandles?.length
          ? getProductsByHandles(b.productHandles.map(p => p.handle))
          : Promise.resolve([] as Product[]),
      ),
    )
    emmaRailBlocks.forEach((b, i) => { carouselProductMap[b._key] = results[i] ?? [] })
  }

  if (!deal) {
    return {
      deal: null, bundle: null, forHim, forHer, bonusDeal,
      viewers: 0, soldToday: 0, cmsData, carouselProductMap,
      emmaHero: null, pairDeal: null, homepageSettings, pairBundleDeal: null,
      emmaContextRows: [],
    }
  }

  // Session seed: prefer the cart cookie (stable per visitor once they engage);
  // anon visitors fall back to a 60s rotating bucket so the edge-cached window
  // naturally reshuffles on each revalidation. Cheap enough to compute inline.
  const cartId  = getCartIdFromCookie(request)
  const minuteBucket = Math.floor(Date.now() / 60_000)
  const sessionSeed = cartId ?? `anon-${minuteBucket}`

  const [viewers, reviewData, aggregate, emmaContextRows] = await Promise.all([
    kvGet<number>(KV_KEYS.viewerCount(deal.handle)).then(n => n ?? 0),
    getProductReviews(deal.shopifyProductId, { sort: 'newest', page: 1, perPage: 10 }),
    getProductAggregate(deal.shopifyProductId),
    getEmmaContextRows({ dealHandle: deal.handle, sessionSeed }).catch(err => {
      console.error('[homepage] emma context rows failed:', err)
      return []
    }),
  ])

  return {
    deal, bundle, forHim, forHer, bonusDeal,
    viewers, soldToday: 0, cmsData, carouselProductMap,
    reviews: reviewData.reviews,
    reviewTotal: reviewData.total,
    aggregate: aggregate ?? null,
    emmaHero, pairDeal, homepageSettings, pairBundleDeal,
    emmaContextRows,
  }
}

// LCP preload — mirrors the helper in _layout.products.$slug.tsx so the
// daily-deal hero image starts fetching during initial parse, before React
// boots. Same imagesrcset/imagesizes contract as the PDP gallery.
function preloadHeroImageTag(imageUrl: string | undefined | null) {
  if (!imageUrl) return null
  const sep = imageUrl.includes('?') ? '&' : '?'
  return {
    tagName: 'link',
    rel: 'preload',
    as: 'image',
    href: `${imageUrl}${sep}width=1024`,
    imagesrcset: [
      `${imageUrl}${sep}width=480 480w`,
      `${imageUrl}${sep}width=768 768w`,
      `${imageUrl}${sep}width=1024 1024w`,
      `${imageUrl}${sep}width=1600 1600w`,
    ].join(', '),
    imagesizes: '(max-width: 768px) 100vw, 50vw',
    fetchpriority: 'high',
  } as const
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const canonical = 'https://xdipx.com/'
  if (!data?.deal) {
    const title = "xdipx — Emma's picks · sexual wellness, edited"
    const description = "Emma's picks — sexual wellness we've actually tried. Ships discreet."
    return [
      { title },
      { name: 'description', content: description },
      { tagName: 'link', rel: 'canonical', href: canonical },
      ...buildSocialMeta({ title, description, url: canonical, image: null, type: 'website' }),
    ]
  }
  const { deal } = data
  const title = `${deal.seoTitle} — Emma's pick | xdipx`
  const description = deal.metaDescription || `${deal.seoTitle} — Emma's pick at xdipx. Ships discreet.`
  const heroPreload = preloadHeroImageTag(deal.images[0]?.url)
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    ...(heroPreload ? [heroPreload] : []),
    ...buildSocialMeta({
      title,
      description,
      url: canonical,
      image: deal.images[0]?.url ?? null,
      type: 'website',
      imageAlt: deal.seoTitle,
    }),
  ]
}

export default function Homepage() {
  const {
    deal, bundle, forHim, forHer, bonusDeal,
    cmsData, carouselProductMap,
    emmaHero, pairDeal, homepageSettings, pairBundleDeal,
    emmaContextRows,
  } = useLoaderData<typeof loader>()
  const { buyButtonText } = useOutletContext<{ buyButtonText: string }>()

  // ── GA4: track deal view + item lists ───────────────────────────────────
  useEffect(() => {
    if (!deal) return
    const item: GA4Item = {
      item_id: deal.shopifyProductId,
      item_name: deal.seoTitle,
      item_brand: deal.brand,
      item_category: categoryToLegacyString(deal.category),
      price: deal.dealPrice,
    }
    trackViewItem(item, deal.dealPrice)
    trackDealView(deal.handle, deal.seoTitle, deal.dealPrice)
  }, [deal?.handle])

  useEffect(() => {
    if (forHim.length > 0) {
      trackViewItemList('for_him', 'For Him', forHim.map((p, i) => ({
        item_id: p.id, item_name: p.title, ...(p.brand ? { item_brand: p.brand } : {}), price: p.price, index: i,
      })))
    }
    if (forHer.length > 0) {
      trackViewItemList('for_her', 'For Her', forHer.map((p, i) => ({
        item_id: p.id, item_name: p.title, ...(p.brand ? { item_brand: p.brand } : {}), price: p.price, index: i,
      })))
    }
  }, [forHim, forHer])

  // Split CMS sections: those that sit above BonusDeal/Vault vs below
  const cmsSections = cmsData?.sections ?? []
  // announcementBar is handled in _layout.tsx — exclude it here
  const contentBlocks = cmsSections.filter(s => s._type !== 'announcementBar')

  // MAP-restricted: prefer the Shopify metafield; fall back to MAP-vs-MSRP heuristic
  // for legacy products without the `map_restricted` flag set.
  const mapRestricted = !!(deal && (deal.mapRestricted ?? (deal.mapPrice > 0 && deal.mapPrice >= deal.msrp)))

  // Priority: Shopify `xdipx.emma_hero` metafield (Claude-generated on promotion)
  // → Sanity `emmaHero` doc (manual editorial override) → component defaults.
  const shopifyEmma = deal?.emmaHero
  const heroVariant = shopifyEmma?.variant ?? emmaHero?.heroVariant ?? 'loving'
  const heroCopy = shopifyEmma
    ? {
        eyebrow:  shopifyEmma.eyebrow,
        headline: shopifyEmma.headline,
        body:     shopifyEmma.body,
        aside:    shopifyEmma.aside,
        ...(shopifyEmma.pullQuote ? { pullQuote: shopifyEmma.pullQuote } : {}),
      }
    : emmaHero
      ? {
          ...(emmaHero.eyebrow   ? { eyebrow:   emmaHero.eyebrow }   : {}),
          ...(emmaHero.headline  ? { headline:  emmaHero.headline }  : {}),
          ...(emmaHero.body      ? { body:      emmaHero.body }      : {}),
          ...(emmaHero.aside     ? { aside:     emmaHero.aside }     : {}),
          ...(emmaHero.pullQuote ? { pullQuote: emmaHero.pullQuote } : {}),
        }
      : undefined

  return (
    <>
      {bundle ? (
        <BundleHero bundle={bundle} buyButtonText={buyButtonText} />
      ) : deal && homepageSettings.template === 'pair_bundle' && pairBundleDeal && deal.pairBundleCopy ? (
        <>
          <PairBundleHero
            primary={deal}
            partner={pairBundleDeal}
            copy={deal.pairBundleCopy}
            discountPct={homepageSettings.pairDiscountPct}
          />
          <ProductStructuredData deal={deal} />
        </>
      ) : deal && homepageSettings.template === 'pair_bundle_fullbleed' && pairBundleDeal && deal.pairBundleCopy ? (
        <>
          <PairBundleFullBleedHero
            primary={deal}
            partner={pairBundleDeal}
            copy={deal.pairBundleCopy}
            discountPct={homepageSettings.pairDiscountPct}
          />
          <ProductStructuredData deal={deal} />
        </>
      ) : deal && homepageSettings.template === 'quiet_endorsement' && deal.quietEndorsementCopy ? (
        <>
          <QuietEndorsementHero deal={deal} showFreeShipping={homepageSettings.showFreeShipping} />
          <ProductStructuredData deal={deal} />
        </>
      ) : deal ? (
        <>
          <EmmaHero
            deal={deal}
            variant={heroVariant}
            mapRestricted={mapRestricted}
            {...(heroCopy ? { copy: heroCopy } : {})}
            pairDeal={pairDeal}
          />

          <ProductStructuredData deal={deal} />
        </>
      ) : (
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <p className="text-sage text-5xl mb-4">♥</p>
          <h1
            className="text-3xl font-bold text-ink mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Something good is coming.
          </h1>
          <p className="text-ink/60">
            Emma's next pick is just around the corner.
          </p>
        </div>
      )}

      {/* ── Emma context rows (AI-personalized rails under the hero) ──────── */}
      {emmaContextRows && emmaContextRows.length > 0 && emmaContextRows.map(row => (
        <EmmaContextRow key={row.rail.id} row={row} />
      ))}

      {/* ── CMS content blocks (ordered by Sanity `order` field) ──────────── */}
      {contentBlocks.map(block => (
        <ContentBlockRenderer
          key={block._key}
          block={block}
          carouselProductMap={carouselProductMap}
          bonusDealProduct={bonusDeal}
        />
      ))}

      {/* ── Hardcoded sections (shown when no CMS carousel blocks replace them) */}
      {!contentBlocks.some(b => b._type === 'productCarousel') && (
        <>
          <ProductCarousel
            heading="Dialed in. Just for him. ♥"
            eyebrow="For Him"
            ctaLink="/for-him"
            ctaLabel="See all →"
            bgStyle="mist"
            products={forHim}
          />
          <ProductCarousel
            heading="Made for her. Obviously. ♥"
            eyebrow="For Her"
            ctaLink="/for-her"
            ctaLabel="See all →"
            bgStyle="cream"
            products={forHer}
          />
        </>
      )}

      <EmailSubscribe />
    </>
  )
}
