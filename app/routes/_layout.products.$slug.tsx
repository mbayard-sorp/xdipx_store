import { useState, useRef, useEffect } from 'react'
import type { LoaderFunctionArgs, MetaFunction, ActionFunctionArgs } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import {
  getDealByHandle, getAccessoryProducts, getProductsByTag,
  getCart, addToCart, createCart,
} from '~/lib/shopify.server'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'
import { getProductPageBlocks } from '~/lib/sanity.server'
import { ProductStructuredData }  from '~/components/seo/ProductStructuredData'
import { ProductTabs }            from '~/components/store/ProductTabs'
import { SocialProofBar }         from '~/components/store/SocialProofBar'
import { StockIndicator }         from '~/components/store/StockIndicator'
import { AccessoryCard }          from '~/components/store/AccessoryCard'
import { WaitlistButton }         from '~/components/store/WaitlistButton'
import { EmailSubscribe }         from '~/components/store/EmailSubscribe'
import { ContentBlockRenderer }   from '~/components/cms/ContentBlockRenderer'
import type { Product } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const deal = await getDealByHandle(params['slug']!)
  if (!deal) throw new Response('Product not found', { status: 404 })

  const [accessories, pdpBlocks] = await Promise.all([
    getAccessoryProducts(deal.accessoryProductIds.slice(0, 4)),
    getProductPageBlocks(params['slug']!),
  ])

  // Resolve Shopify products for any productCarousel blocks
  const carouselBlocks = pdpBlocks.filter(
    (b): b is ProductCarouselBlock => b._type === 'productCarousel',
  )
  const carouselProductMap: Record<string, Product[]> = {}
  if (carouselBlocks.length > 0) {
    const results = await Promise.all(
      carouselBlocks.map(b => getProductsByTag(b.shopifyTag, b.productLimit ?? 8)),
    )
    carouselBlocks.forEach((b, i) => { carouselProductMap[b._key] = results[i] ?? [] })
  }

  const cartId = getCartIdFromCookie(request)
  return { deal, accessories, pdpBlocks, carouselProductMap, cartId }
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.deal) return [{ title: 'Product not found | xdipx' }]
  const { deal } = data
  return [
    { title: `${deal.seoTitle} | xdipx` },
    { name: 'description', content: deal.metaDescription || `${deal.seoTitle} — ships discreet from xdipx.` },
    { tagName: 'link', rel: 'canonical', href: `https://xdipx.com/products/${deal.handle}` },
    { property: 'og:image', content: deal.images[0]?.url ?? '' },
  ]
}

// ─── Action (accessory add-to-cart only — main CTA posts to /checkout-extras) ─

export async function action({ request }: ActionFunctionArgs) {
  const form      = await request.formData()
  const intent    = form.get('intent') as string
  const variantId = form.get('variantId') as string

  if (intent === 'add-accessory') {
    let cartId = (form.get('cartId') as string | null) ?? getCartIdFromCookie(request)
    let cart   = cartId ? await getCart(cartId) : null
    if (!cart) { cart = await createCart(); cartId = cart.id }
    await addToCart(cartId, variantId, 1)
    const headers = new Headers()
    if (!getCartIdFromCookie(request)) headers.set('Set-Cookie', setCartCookie(cartId))
    return new Response(JSON.stringify({ ok: true }), { headers, status: 200 })
  }

  return null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductPage() {
  const { deal, accessories, pdpBlocks, carouselProductMap, cartId } = useLoaderData<typeof loader>()
  const fetcher = useFetcher()
  const isPending = fetcher.state !== 'idle'

  const variants     = deal.variants ?? []
  const options      = deal.options  ?? []
  const multiVariant = variants.length > 1

  const firstAvailable = variants.find(v => v.availableForSale) ?? variants[0]
  const [selectedId, setSelectedId] = useState(firstAvailable?.id ?? deal.variantId)
  const [quantity,   setQuantity]   = useState(1)
  const [activeImg,  setActiveImg]  = useState(0)
  const [showSticky, setShowSticky] = useState(false)
  const ctaRef = useRef<HTMLButtonElement>(null)

  const selectedVariant = variants.find(v => v.id === selectedId) ?? variants[0]
  const price    = selectedVariant ? parseFloat(selectedVariant.price) : deal.dealPrice
  const inStock  = selectedVariant?.availableForSale ?? deal.qty > 0
  const qty      = selectedVariant?.quantityAvailable ?? deal.qty
  const discount = deal.msrp > 0 && deal.msrp > price
    ? Math.round(((deal.msrp - price) / deal.msrp) * 100)
    : 0

  const worksFor: [boolean, boolean, boolean] = [
    deal.category === 'for-him'  || deal.category === 'both' || deal.category === 'couples',
    deal.category === 'for-her'  || deal.category === 'both' || deal.category === 'couples',
    deal.category === 'couples',
  ]

  // Sticky mobile CTA — appears when main button scrolls out of view
  useEffect(() => {
    const el = ctaRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setShowSticky(!entry!.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const heroContent = (
    <section className="max-w-6xl mx-auto px-4 py-8 relative">
      <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start">

        {/* ── Left: Image gallery ────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="relative aspect-square rounded-2xl overflow-hidden bg-brand-mist shadow-sm">
            {deal.images[activeImg] ? (
              <img
                src={deal.images[activeImg]!.url}
                alt={deal.images[activeImg]!.altText || deal.seoTitle}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-brand-charcoal/20 text-6xl">♥</div>
            )}
            {discount > 0 && (
              <div className="absolute top-3 left-3 bg-brand-gradient text-white text-xs font-bold px-2.5 py-1 rounded-full">
                {discount}% OFF
              </div>
            )}
          </div>

          {deal.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {deal.images.slice(0, 8).map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImg(i)}
                  className={[
                    'shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all',
                    i === activeImg
                      ? 'border-brand-coral'
                      : 'border-transparent opacity-60 hover:opacity-100',
                  ].join(' ')}
                  aria-label={`View image ${i + 1}`}
                >
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Product info ─────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Brand + title */}
          <div>
            <p className="text-brand-charcoal/50 text-sm font-medium uppercase tracking-widest">
              {deal.brand}
            </p>
            <h1
              className="text-2xl md:text-3xl font-bold text-brand-charcoal mt-1 leading-snug"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {deal.seoTitle}
            </h1>
            {deal.tagline && (
              <p className="text-brand-charcoal/70 mt-2 italic">{deal.tagline}</p>
            )}
          </div>

          {/* Price */}
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-4xl font-black text-brand-gradient"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              ${price.toFixed(2)}
            </span>
            {deal.msrp > price && (
              <>
                <span className="text-brand-charcoal/40 text-xl line-through">
                  ${deal.msrp.toFixed(2)}
                </span>
                <span className="bg-brand-gradient text-white text-sm font-bold px-3 py-1 rounded-full">
                  {discount}% off
                </span>
              </>
            )}
          </div>

          {/* Social proof */}
          <SocialProofBar />

          {/* Feature bullets */}
          {deal.featureBullets.length > 0 && (
            <ul className="space-y-1.5">
              {deal.featureBullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-brand-charcoal/80">
                  <span className="text-brand-purple mt-0.5 shrink-0" aria-hidden="true">♥</span>
                  {bullet}
                </li>
              ))}
            </ul>
          )}

          {/* Works for */}
          {(worksFor[0] || worksFor[1] || worksFor[2]) && (
            <div className="flex items-center gap-2 text-sm text-brand-charcoal/60 flex-wrap">
              <span>Works for:</span>
              {worksFor[0] && <WorksForBadge label="Him"     emoji="♂" />}
              {worksFor[1] && <WorksForBadge label="Her"     emoji="♀" />}
              {worksFor[2] && <WorksForBadge label="Couples" emoji="🫶" />}
            </div>
          )}

          {/* Variant selector */}
          {multiVariant && options.length > 0 && (
            <div className="space-y-3">
              {options.map(opt => (
                <div key={opt.name}>
                  <p className="text-sm font-semibold text-brand-charcoal mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                    {opt.name}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {opt.values.map(val => {
                      const match = variants.find(v =>
                        v.selectedOptions.some(o => o.name === opt.name && o.value === val)
                      )
                      const isSelected  = match?.id === selectedId
                      const isAvailable = match?.availableForSale ?? false
                      return (
                        <button
                          key={val}
                          onClick={() => match && setSelectedId(match.id)}
                          disabled={!isAvailable}
                          className={[
                            'px-4 py-2 rounded-full text-sm font-medium border-2 transition-all',
                            isSelected
                              ? 'border-brand-coral bg-brand-coral/10 text-brand-coral font-semibold'
                              : isAvailable
                                ? 'border-brand-mist text-brand-charcoal hover:border-brand-coral/40'
                                : 'border-brand-mist text-brand-charcoal/30 cursor-not-allowed line-through',
                          ].join(' ')}
                          style={{ fontFamily: 'var(--font-display)' }}
                        >
                          {val}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Qty + Add to cart */}
          {inStock ? (
            <fetcher.Form method="post" action="/checkout-extras" className="space-y-3">
              <input type="hidden" name="intent"    value="add-to-cart" />
              <input type="hidden" name="variantId" value={selectedVariant?.id ?? deal.variantId} />
              {cartId && <input type="hidden" name="cartId" value={cartId} />}

              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-brand-charcoal/70" htmlFor="qty">Qty</label>
                <div className="flex items-center border border-brand-mist rounded-full overflow-hidden bg-white">
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    className="px-3 py-2 text-brand-charcoal hover:bg-brand-mist transition-colors"
                    aria-label="Decrease quantity"
                  >−</button>
                  <input id="qty" type="hidden" name="quantity" value={quantity} />
                  <span className="px-4 text-sm font-semibold text-brand-charcoal">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.min(3, q + 1))}
                    className="px-3 py-2 text-brand-charcoal hover:bg-brand-mist transition-colors"
                    aria-label="Increase quantity"
                  >+</button>
                </div>
                <span className="text-xs text-brand-charcoal/40">Max 3</span>
              </div>

              <button
                ref={ctaRef}
                type="submit"
                disabled={isPending}
                className="w-full py-4 rounded-full font-bold text-lg bg-brand-gradient text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-brand-coral/20 transition-all"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {isPending ? 'Adding...' : 'Dip In ♥'}
              </button>
            </fetcher.Form>
          ) : (
            <WaitlistButton productHandle={deal.handle} />
          )}

          {/* Stock + Trust badges */}
          <StockIndicator qty={qty} />

          <div className="flex flex-wrap gap-3 pt-1">
            {['🔒 Secure checkout', '📦 Ships discreetly', '↩️ 14-day returns'].map(badge => (
              <span
                key={badge}
                className="text-xs text-brand-charcoal/50 bg-brand-mist px-3 py-1 rounded-full"
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Tabbed content */}
      <ProductTabs
        fullStory={deal.fullStory}
        bullets={deal.featureBullets}
        forHim={deal.worksForHim}
        forHer={deal.worksForHer}
      />
    </section>
  )

  return (
    <>
      {/* Mood image background — matches DailyDealHero */}
      {deal.moodImageUrl ? (
        <div className="relative overflow-hidden">
          <img
            src={deal.moodImageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-brand-cream/97 via-brand-cream/90 to-brand-cream/60" />
          {heroContent}
        </div>
      ) : heroContent}

      {/* Accessories */}
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
              <AccessoryCard key={acc.id} product={acc as Product} cartId={cartId ?? undefined} />
            ))}
          </div>
        </section>
      )}

      {/* CMS content blocks configured in Sanity for this product */}
      {pdpBlocks.map(block => (
        <ContentBlockRenderer
          key={block._key}
          block={block}
          carouselProductMap={carouselProductMap}
        />
      ))}

      <EmailSubscribe />

      {/* Sticky mobile CTA */}
      {inStock && showSticky && (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-brand-mist px-4 py-3 flex items-center gap-3 shadow-lg shadow-brand-charcoal/10">
          {deal.images[0] && (
            <img
              src={deal.images[0].url}
              alt=""
              aria-hidden="true"
              className="w-12 h-12 rounded-xl object-cover bg-brand-mist shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-brand-charcoal/60 truncate">{deal.brand}</p>
            <p
              className="text-sm font-bold text-brand-charcoal truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              ${price.toFixed(2)}
              {deal.msrp > price && (
                <span className="text-brand-charcoal/40 line-through ml-2 font-normal">
                  ${deal.msrp.toFixed(2)}
                </span>
              )}
            </p>
          </div>
          <fetcher.Form method="post" action="/checkout-extras">
            <input type="hidden" name="intent"    value="add-to-cart" />
            <input type="hidden" name="variantId" value={selectedVariant?.id ?? deal.variantId} />
            <input type="hidden" name="quantity"  value={quantity} />
            {cartId && <input type="hidden" name="cartId" value={cartId} />}
            <button
              type="submit"
              disabled={isPending}
              className="bg-brand-gradient text-white font-bold text-sm px-5 py-2.5 rounded-full hover:opacity-90 transition-opacity shrink-0"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {isPending ? 'Adding...' : 'Dip In ♥'}
            </button>
          </fetcher.Form>
        </div>
      )}

      <ProductStructuredData deal={deal} />
    </>
  )
}

function WorksForBadge({ label, emoji }: { label: string; emoji: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-brand-mist px-2.5 py-0.5 rounded-full text-xs font-medium text-brand-charcoal/70">
      <span aria-hidden="true">{emoji}</span>
      {label}
    </span>
  )
}
