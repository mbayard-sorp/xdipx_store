import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useOutletContext } from 'react-router'
import {
  getDealByShopifyId, getProductsByTag, getBonusDeal,
  getCollectionProducts, getProductsByHandles,
} from '~/lib/shopify.server'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { kvGet, KV_KEYS } from '~/lib/kv.server'
import { getHomepageSections }                  from '~/lib/sanity.server'
import { getProductReviews, getProductAggregate } from '~/lib/reviews.server'
import { CountdownTimer }        from '~/components/store/CountdownTimer'
import { DailyDealHero }         from '~/components/store/DailyDealHero'
import { ProductCarousel }       from '~/components/cms/ProductCarousel'
import { EmailSubscribe }        from '~/components/store/EmailSubscribe'
import { ContentBlockRenderer }  from '~/components/cms/ContentBlockRenderer'
import { ProductStructuredData } from '~/components/seo/ProductStructuredData'
import { OrganizationStructuredData } from '~/components/seo/OrganizationStructuredData'
import type { Product } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'

async function getLiveDeal() {
  const [dbDeal] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1)
  if (!dbDeal?.shopifyProductId) return null
  return getDealByShopifyId(dbDeal.shopifyProductId)
}

export async function loader(_args: LoaderFunctionArgs) {
  const [deal, forHim, forHer, bonusDeal, cmsData] = await Promise.all([
    getLiveDeal(),
    getProductsByTag('for-him', 8),
    getProductsByTag('for-her', 8),
    getBonusDeal(),
    getHomepageSections(),
  ])

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

  if (!deal) {
    return {
      deal: null, forHim, forHer, bonusDeal,
      viewers: 0, soldToday: 0, cmsData, carouselProductMap,
    }
  }

  const [viewers, reviewData, aggregate] = await Promise.all([
    kvGet<number>(KV_KEYS.viewerCount(deal.handle)).then(n => n ?? 0),
    getProductReviews(deal.shopifyProductId, { sort: 'newest', page: 1, perPage: 10 }),
    getProductAggregate(deal.shopifyProductId),
  ])

  return {
    deal, forHim, forHer, bonusDeal,
    viewers, soldToday: 0, cmsData, carouselProductMap,
    reviews: reviewData.reviews,
    reviewTotal: reviewData.total,
    aggregate: aggregate ?? null,
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.deal) {
    return [
      { title: 'xdipx — Daily Wellness Deals' },
      { name: 'description', content: 'One deal. Every day. Ships discreet.' },
    ]
  }
  const { deal } = data
  return [
    { title: `${deal.seoTitle} — Today Only | xdipx` },
    { name: 'description', content: deal.metaDescription || `${deal.seoTitle} — today's deal at xdipx. Ships discreet.` },
    { property: 'og:title',       content: `${deal.seoTitle} — Today Only | xdipx` },
    { property: 'og:description', content: deal.metaDescription },
    { property: 'og:image',       content: deal.images[0]?.url ?? '' },
    { property: 'og:type',        content: 'website' },
    { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/' },
  ]
}

export default function Homepage() {
  const {
    deal, forHim, forHer, bonusDeal,
    viewers, soldToday, cmsData, carouselProductMap,
    reviews, reviewTotal, aggregate,
  } = useLoaderData<typeof loader>()
  const { buyButtonText } = useOutletContext<{ buyButtonText: string }>()

  // Split CMS sections: those that sit above BonusDeal/Vault vs below
  const cmsSections = cmsData?.sections ?? []
  // announcementBar is handled in _layout.tsx — exclude it here
  const contentBlocks = cmsSections.filter(s => s._type !== 'announcementBar')

  return (
    <>
      <CountdownTimer />

      {deal ? (
        <>
          <DailyDealHero
            deal={deal}
            viewers={viewers}
            soldToday={soldToday}
            reviews={reviews ?? []}
            reviewTotal={reviewTotal ?? 0}
            aggregate={aggregate}
            buyButtonText={buyButtonText}
          />

          <ProductStructuredData deal={deal} />
        </>
      ) : (
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <p className="text-brand-purple text-5xl mb-4">♥</p>
          <h1
            className="text-3xl font-bold text-brand-charcoal mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Something good is coming.
          </h1>
          <p className="text-brand-charcoal/60">
            Today's deal is being set up. Check back at midnight.
          </p>
        </div>
      )}

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
      <OrganizationStructuredData />
    </>
  )
}
