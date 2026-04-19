import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'
import { addToCart, addLinesToCart, createCart, getCart, removeFromCart, updateCartLine } from '~/lib/shopify.server'
import { getBundleByHandle, bundleCartLines } from '~/lib/bundles.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const cartId = getCartIdFromCookie(request)
  const cart   = cartId ? await getCart(cartId) : null
  return Response.json(
    { cart },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function action({ request }: ActionFunctionArgs) {
  const rl = await checkRateLimit(request, 'cart', 60, 60)
  if (!rl.ok) return rateLimited()

  const form   = await request.formData()
  const intent = form.get('intent') as string
  let   cartId = getCartIdFromCookie(request)

  if (intent === 'add-item') {
    const variantId     = form.get('variantId') as string
    const quantity      = parseInt((form.get('quantity') as string) ?? '1', 10)
    const sellingPlanId = (form.get('sellingPlanId') as string) || undefined
    if (!variantId) return { ok: false, error: 'Missing variantId' }
    const headers = new Headers()
    if (!cartId) {
      const cart = await createCart()
      cartId = cart.id
      headers.set('Set-Cookie', setCartCookie(cartId))
    }
    try {
      await addToCart(cartId, variantId, quantity, sellingPlanId)
    } catch {
      // Cart may be expired — create a fresh one and retry once
      try {
        const freshCart = await createCart()
        cartId = freshCart.id
        headers.set('Set-Cookie', setCartCookie(cartId))
        await addToCart(cartId, variantId, quantity, sellingPlanId)
      } catch {
        return Response.json({ ok: false, error: 'Could not add item' }, { status: 400, headers })
      }
    }
    return Response.json({ ok: true }, { headers })
  }

  if (intent === 'add-bundle') {
    const bundleHandle = form.get('bundleHandle') as string
    if (!bundleHandle) return { ok: false, error: 'Missing bundleHandle' }
    const bundle = await getBundleByHandle(bundleHandle)
    if (!bundle) return Response.json({ ok: false, error: 'Bundle not found' }, { status: 404 })
    const lines = bundleCartLines(bundle)
    if (lines.length === 0) return Response.json({ ok: false, error: 'Bundle has no buyable components' }, { status: 400 })
    const headers = new Headers()
    if (!cartId) {
      const cart = await createCart()
      cartId = cart.id
      headers.set('Set-Cookie', setCartCookie(cartId))
    }
    try {
      await addLinesToCart(cartId, lines)
    } catch {
      try {
        const freshCart = await createCart()
        cartId = freshCart.id
        headers.set('Set-Cookie', setCartCookie(cartId))
        await addLinesToCart(cartId, lines)
      } catch {
        return Response.json({ ok: false, error: 'Could not add bundle' }, { status: 400, headers })
      }
    }
    return Response.json({ ok: true, bundleTag: bundle.bundleTag }, { headers })
  }

  if (!cartId) return { ok: false, error: 'No cart' }

  if (intent === 'remove-item') {
    const lineId = form.get('lineId') as string
    if (lineId) await removeFromCart(cartId, [lineId])
  } else if (intent === 'update-quantity') {
    const lineId  = form.get('lineId') as string
    const qty     = parseInt(form.get('quantity') as string, 10)
    if (lineId) {
      if (qty < 1) {
        await removeFromCart(cartId, [lineId])
      } else {
        await updateCartLine(cartId, lineId, qty)
      }
    }
  }

  return { ok: true }
}
