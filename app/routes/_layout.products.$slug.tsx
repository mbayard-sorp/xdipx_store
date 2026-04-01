import type { LoaderFunctionArgs, MetaFunction, ActionFunctionArgs } from 'react-router'
import { useLoaderData, redirect } from 'react-router'
import { getProductByHandle, getCart, addToCart, createCart } from '~/lib/shopify.server'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'
import { ProductStructuredData } from '~/components/seo/ProductStructuredData'
import { StockIndicator }   from '~/components/store/StockIndicator'
import { WaitlistButton }   from '~/components/store/WaitlistButton'
import type { Deal } from '~/types'

export async function loader({ params }: LoaderFunctionArgs) {
  const product = await getProductByHandle(params['slug']!)
  if (!product) throw new Response('Product not found', { status: 404 })
  return { product }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.product) return [{ title: 'Product not found | xdipx' }]
  const { product } = data
  return [
    { title: `${product.seoTitle ?? product.title} | xdipx` },
    { name: 'description', content: product.metaDescription ?? `${product.title} — ships discreet from xdipx.` },
    { tagName: 'link', rel: 'canonical', href: `https://xdipx.com/products/${product.handle}` },
    { property: 'og:image', content: product.images[0]?.url ?? '' },
  ]
}

export async function action({ request }: ActionFunctionArgs) {
  const form      = await request.formData()
  const intent    = form.get('intent')
  const variantId = form.get('variantId') as string

  if (intent === 'add-to-cart') {
    let cartId = form.get('cartId') as string | null ?? getCartIdFromCookie(request)
    let cart   = cartId ? await getCart(cartId) : null
    if (!cart) { cart = await createCart(); cartId = cart.id }
    await addToCart(cartId, variantId, 1)
    const headers = new Headers()
    if (!getCartIdFromCookie(request)) headers.set('Set-Cookie', setCartCookie(cartId))
    return redirect('/checkout-extras', { headers })
  }
  return null
}

export default function ProductPage() {
  const { product } = useLoaderData<typeof loader>()
  const variant     = product.variants[0]
  const inStock     = variant?.availableForSale ?? false

  // Build a lightweight Deal shape for ProductStructuredData
  const dealForSchema = {
    id: product.id, shopifyProductId: product.id, sku: '', handle: product.handle,
    seoTitle: product.seoTitle ?? product.title, tagline: '', fullStory: '',
    worksForHim: '', worksForHer: '', featureBullets: [],
    images: product.images, dealPrice: product.price, msrp: product.compareAtPrice ?? product.price,
    wholesaleCost: 0, mapPrice: 0, brand: product.brand ?? '', category: 'both' as const,
    dealStatus: 'live' as const, dealDate: '', qty: variant?.quantityAvailable ?? 0,
    accessoryProductIds: [], metaDescription: product.metaDescription ?? '', variantId: variant?.id ?? '',
  } satisfies Deal

  return (
    <>
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Image */}
          <div className="aspect-square rounded-2xl overflow-hidden bg-brand-mist">
            {product.images[0] ? (
              <img src={product.images[0].url} alt={product.images[0].altText || product.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-5xl text-brand-charcoal/10">♥</div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-4">
            <p className="text-brand-charcoal/50 text-sm uppercase tracking-wide">{product.brand}</p>
            <h1 className="text-3xl font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
              {product.seoTitle ?? product.title}
            </h1>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-black text-brand-gradient" style={{ fontFamily: 'var(--font-display)' }}>
                ${product.price.toFixed(2)}
              </span>
              {product.compareAtPrice && product.compareAtPrice > product.price && (
                <span className="text-brand-charcoal/40 text-lg line-through">${product.compareAtPrice.toFixed(2)}</span>
              )}
            </div>

            <StockIndicator qty={variant?.quantityAvailable ?? 0} />

            {inStock ? (
              <form method="post">
                <input type="hidden" name="intent"    value="add-to-cart" />
                <input type="hidden" name="variantId" value={variant?.id ?? ''} />
                <button
                  type="submit"
                  className="w-full bg-brand-gradient text-white font-bold py-4 rounded-full text-lg hover:opacity-90 transition-opacity"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Dip In ♥
                </button>
              </form>
            ) : (
              <WaitlistButton productHandle={product.handle} />
            )}
          </div>
        </div>
      </div>
      <ProductStructuredData deal={dealForSchema} />
    </>
  )
}
