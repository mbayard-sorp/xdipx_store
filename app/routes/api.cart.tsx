import type { ActionFunctionArgs } from 'react-router'
import { getCartIdFromCookie } from '~/lib/cart.server'
import { removeFromCart, updateCartLine } from '~/lib/shopify.server'

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent') as string
  const cartId = getCartIdFromCookie(request)

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
