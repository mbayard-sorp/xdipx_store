import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, redirect } from 'react-router'
import { getCart, getProductsByTag, addToCart, createCart } from '~/lib/shopify.server'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'
import { AccessoryCard } from '~/components/store/AccessoryCard'

export const meta: MetaFunction = () => [
  { title: 'Make it even better — xdipx' },
]

export async function loader({ request }: LoaderFunctionArgs) {
  const cartId = getCartIdFromCookie(request)
  const [cart, accessories] = await Promise.all([
    cartId ? getCart(cartId) : null,
    getProductsByTag('accessories', 4),
  ])
  return { cart, accessories, cartId }
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')

  let cartId   = getCartIdFromCookie(request)
  const headers = new Headers()

  if (intent === 'add-accessory') {
    const variantId = form.get('variantId') as string
    let cart = cartId ? await getCart(cartId) : null
    if (!cart) {
      cart   = await createCart()
      cartId = cart.id
      headers.set('Set-Cookie', setCartCookie(cartId))
    }
    await addToCart(cartId, variantId, 1)
    return Response.json({ ok: true }, { headers })
  }

  if (intent === 'proceed') {
    if (!cartId) return redirect('/')
    const cart = await getCart(cartId)
    if (!cart) return redirect('/')
    return redirect(cart.checkoutUrl)
  }

  return null
}

export default function CheckoutExtras() {
  const { cart, accessories, cartId } = useLoaderData<typeof loader>()

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-10 text-xs font-medium">
        {['Cart', 'Extras', 'Checkout'].map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            {i > 0 && <span className="text-brand-charcoal/20">→</span>}
            <span className={i === 1 ? 'text-brand-coral font-bold' : 'text-brand-charcoal/40'}>
              {i === 1 ? `Step ${i + 1}: ${step}` : step}
            </span>
          </div>
        ))}
      </div>

      <h1
        className="text-2xl font-bold text-brand-charcoal mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        You've got great taste.
      </h1>
      <p className="text-brand-charcoal/60 mb-8">Want to make it even better?</p>

      {accessories.length > 0 && (
        <div className="space-y-3 mb-8">
          {accessories.map(acc => (
            <AccessoryCard key={acc.id} product={acc} cartId={cartId ?? undefined} />
          ))}
        </div>
      )}

      {/* Proceed */}
      <form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="proceed" />
        <button
          type="submit"
          className="w-full bg-brand-gradient text-white font-bold py-4 rounded-full text-lg hover:opacity-90 transition-opacity"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          To Checkout ♥
        </button>
        <a
          href={cart?.checkoutUrl ?? '#'}
          className="block text-center text-brand-charcoal/50 text-sm hover:text-brand-charcoal transition-colors"
        >
          Skip extras
        </a>
      </form>
    </div>
  )
}
