import { useRouteLoaderData, useFetcher } from 'react-router'
import type { Cart } from '~/types'

export function useCart() {
  const root = useRouteLoaderData('root') as { cart?: Cart } | undefined
  const cart = root?.cart ?? null

  return {
    cart,
    itemCount:  cart?.totalQuantity ?? 0,
    totalPrice: cart ? parseFloat(cart.cost.totalAmount.amount) : 0,
    checkoutUrl: cart?.checkoutUrl ?? null,
  }
}

export function useAddToCart() {
  const fetcher = useFetcher()
  return {
    add: (variantId: string, quantity = 1, cartId?: string) => {
      fetcher.submit(
        { intent: 'add-to-cart', variantId, quantity: String(quantity), ...(cartId ? { cartId } : {}) },
        { method: 'post' },
      )
    },
    isPending: fetcher.state !== 'idle',
  }
}
