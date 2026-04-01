import type { LoaderFunctionArgs, MetaFunction, ActionFunctionArgs } from 'react-router'
import { useLoaderData, redirect } from 'react-router'
import { getDailyDeal, getProductsByTag, getBonusDeal, getRecentVaultDeals, getAccessoryProducts, getCart, addToCart, createCart } from '~/lib/shopify.server'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'
import { kvGet, kvIncr, KV_KEYS } from '~/lib/kv.server'
import { CountdownTimer }      from '~/components/store/CountdownTimer'
import { DailyDealHero }       from '~/components/store/DailyDealHero'
import { AccessoryCard }       from '~/components/store/AccessoryCard'
import { ForHimSection }       from '~/components/store/ForHimSection'
import { ForHerSection }       from '~/components/store/ForHerSection'
import { BonusDeal }           from '~/components/store/BonusDeal'
import { VaultCard }           from '~/components/store/VaultCard'
import { EmailSubscribe }      from '~/components/store/EmailSubscribe'
import { ProductStructuredData } from '~/components/seo/ProductStructuredData'
import { OrganizationStructuredData } from '~/components/seo/OrganizationStructuredData'

export async function loader({ request }: LoaderFunctionArgs) {
  const [deal, forHim, forHer, bonusDeal, vaultPreview] = await Promise.all([
    getDailyDeal(),
    getProductsByTag('for-him', 3),
    getProductsByTag('for-her', 3),
    getBonusDeal(),
    getRecentVaultDeals(7),
  ])

  if (!deal) {
    return {
      deal: null, accessories: [], forHim, forHer, bonusDeal, vaultPreview,
      cartId: null, viewers: 0, soldToday: 0,
    }
  }

  const [accessories, viewers] = await Promise.all([
    getAccessoryProducts(deal.accessoryProductIds.slice(0, 4)),
    kvGet<number>(KV_KEYS.viewerCount(deal.handle)).then(n => n ?? 0),
  ])

  const cartId = getCartIdFromCookie(request)

  return { deal, accessories, forHim, forHer, bonusDeal, vaultPreview, cartId, viewers, soldToday: deal.qty > 0 ? 0 : 0 }
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
    // Homepage canonical points to itself
    { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/' },
  ]
}

export async function action({ request }: ActionFunctionArgs) {
  const form      = await request.formData()
  const intent    = form.get('intent')
  const variantId = form.get('variantId') as string
  const quantity  = parseInt((form.get('quantity') as string) ?? '1')

  if (intent === 'add-to-cart') {
    let cartId = form.get('cartId') as string | null ?? getCartIdFromCookie(request)
    let cart = cartId ? await getCart(cartId) : null
    if (!cart) {
      cart  = await createCart()
      cartId = cart.id
    }
    await addToCart(cartId, variantId, quantity)

    // Redirect to checkout-extras interstitial
    const headers = new Headers()
    if (!getCartIdFromCookie(request)) {
      headers.set('Set-Cookie', setCartCookie(cartId))
    }
    return redirect('/checkout-extras', { headers })
  }

  return null
}

export default function Homepage() {
  const { deal, accessories, forHim, forHer, bonusDeal, vaultPreview, cartId, viewers, soldToday } =
    useLoaderData<typeof loader>()

  return (
    <>
      <CountdownTimer />

      {deal ? (
        <>
          <DailyDealHero deal={deal} cartId={cartId ?? undefined} viewers={viewers} soldToday={soldToday} />

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

      <ForHimSection products={forHim} />
      <ForHerSection products={forHer} />

      {bonusDeal && <BonusDeal product={bonusDeal} />}

      {vaultPreview.length > 0 && (
        <section className="py-12 px-4">
          <div className="max-w-6xl mx-auto">
            <h2
              className="text-2xl font-bold text-brand-charcoal mb-6"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              From The Vault ♥
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {vaultPreview.slice(0, 4).map(deal => (
                <VaultCard key={deal.id} deal={deal} />
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
