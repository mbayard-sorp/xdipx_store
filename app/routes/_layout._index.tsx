import type { LoaderFunctionArgs, MetaFunction, ActionFunctionArgs } from 'react-router'
import { useLoaderData, redirect } from 'react-router'
import {
  getDealByShopifyId, getProductsByTag, getBonusDeal, getRecentVaultDeals,
  getAccessoryProducts, getCart, addToCart, createCart,
} from '~/lib/shopify.server'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'
import { kvGet, KV_KEYS }                      from '~/lib/kv.server'
import { getHomepageSections }                  from '~/lib/sanity.server'
import { CountdownTimer }        from '~/components/store/CountdownTimer'
import { DailyDealHero }         from '~/components/store/DailyDealHero'
import { AccessoryCard }         from '~/components/store/AccessoryCard'
import { ProductCarousel }       from '~/components/cms/ProductCarousel'
import { BonusDeal }             from '~/components/store/BonusDeal'
import { VaultCard }             from '~/components/store/VaultCard'
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

export async function loader({ request }: LoaderFunctionArgs) {
  const [deal, forHim, forHer, bonusDeal, vaultPreview, cmsData] = await Promise.all([
    getLiveDeal(),
    getProductsByTag('for-him', 8),
    getProductsByTag('for-her', 8),
    getBonusDeal(),
    getRecentVaultDeals(7),
    getHomepageSections(),
  ])

  // Resolve Shopify products for any CMS productCarousel blocks
  const carouselBlocks = (cmsData?.sections ?? []).filter(
    (s): s is ProductCarouselBlock => s._type === 'productCarousel',
  )
  const carouselProductMap: Record<string, Product[]> = {}
  if (carouselBlocks.length > 0) {
    const results = await Promise.all(
      carouselBlocks.map(b => getProductsByTag(b.shopifyTag, b.productLimit ?? 8)),
    )
    carouselBlocks.forEach((b, i) => { carouselProductMap[b._key] = results[i] ?? [] })
  }

  if (!deal) {
    return {
      deal: null, accessories: [], forHim, forHer, bonusDeal, vaultPreview,
      cartId: null, viewers: 0, soldToday: 0, cmsData, carouselProductMap,
    }
  }

  const [accessories, viewers] = await Promise.all([
    getAccessoryProducts(deal.accessoryProductIds.slice(0, 4)),
    kvGet<number>(KV_KEYS.viewerCount(deal.handle)).then(n => n ?? 0),
  ])

  const cartId = getCartIdFromCookie(request)

  return {
    deal, accessories, forHim, forHer, bonusDeal, vaultPreview,
    cartId, viewers, soldToday: 0, cmsData, carouselProductMap,
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

export async function action({ request }: ActionFunctionArgs) {
  const form      = await request.formData()
  const intent    = form.get('intent')
  const variantId = form.get('variantId') as string
  const quantity  = parseInt((form.get('quantity') as string) ?? '1')

  if (intent === 'add-to-cart') {
    let cartId = (form.get('cartId') as string | null) ?? getCartIdFromCookie(request)
    let cart = cartId ? await getCart(cartId) : null
    if (!cart) {
      cart   = await createCart()
      cartId = cart.id
    }
    await addToCart(cartId, variantId, quantity)

    const headers = new Headers()
    if (!getCartIdFromCookie(request)) {
      headers.set('Set-Cookie', setCartCookie(cartId))
    }
    return redirect('/checkout-extras', { headers })
  }

  return null
}

export default function Homepage() {
  const {
    deal, accessories, forHim, forHer, bonusDeal, vaultPreview,
    cartId, viewers, soldToday, cmsData, carouselProductMap,
  } = useLoaderData<typeof loader>()

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
            cartId={cartId ?? undefined}
            viewers={viewers}
            soldToday={soldToday}
          />

          {accessories.length > 0 && (
            <section className="max-w-4xl mx-auto px-4 pb-8">
              <h2
                className="text-xl font-bold text-brand-charcoal mb-4"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Make it better ♥
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {accessories.map(acc => (
                  <AccessoryCard key={acc.id} product={acc} cartId={cartId ?? undefined} />
                ))}
              </div>
            </section>
          )}

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

      {bonusDeal && <BonusDeal product={bonusDeal} />}

      {vaultPreview.length > 0 && (
        <section className="py-12 px-4 bg-white">
          <div className="max-w-6xl mx-auto">
            <h2
              className="text-2xl font-bold text-brand-charcoal mb-6"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              From The Vault ♥
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {vaultPreview.slice(0, 4).map(v => (
                <VaultCard key={v.id} deal={v} />
              ))}
            </div>
          </div>
        </section>
      )}

      <EmailSubscribe />
      <OrganizationStructuredData />
    </>
  )
}
