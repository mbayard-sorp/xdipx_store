import { useEffect, useRef, useState } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useFetcher, useLoaderData } from 'react-router'
import { data } from 'react-router'
import { getPublicList } from '~/lib/wishlist.server'

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Wishlist not found — xdipx' }]
  return [
    { title: `${data.list.name} — Shared Wishlist | xdipx` },
    { name: 'robots', content: 'noindex, nofollow' },
  ]
}

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params.slug
  if (!slug) throw data('Not found', { status: 404 })
  const list = await getPublicList(slug)
  if (!list) throw data('Not found', { status: 404 })
  return { list }
}

export default function PublicWishlistPage() {
  const { list } = useLoaderData<typeof loader>()
  const availableItems = list.items.filter(i => i.product)
  const giftMode = !!list.giftMode

  const cartFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const [grabAllState, setGrabAllState] = useState<'idle' | 'pending' | 'added'>('idle')
  const wasSubmitting = useRef(false)

  useEffect(() => {
    if (cartFetcher.state === 'submitting') wasSubmitting.current = true
    else if (cartFetcher.state === 'idle' && wasSubmitting.current) {
      wasSubmitting.current = false
      if (cartFetcher.data?.ok) {
        setGrabAllState('added')
        window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
        const t = setTimeout(() => setGrabAllState('idle'), 2500)
        return () => clearTimeout(t)
      } else {
        setGrabAllState('idle')
      }
    }
  }, [cartFetcher.state, cartFetcher.data])

  function handleGrabAll() {
    const lines = availableItems
      .map(item => {
        const p = item.product!
        const variant = p.variants?.find(v => v.availableForSale) ?? p.variants?.[0]
        return variant?.availableForSale ? variant.id : null
      })
      .filter((x): x is string => x !== null)
      .slice(0, 25)
    if (!lines.length) return
    const fd = new FormData()
    fd.set('intent', 'addMany')
    lines.forEach((variantId, i) => {
      fd.set(`variantId_${i}`, variantId)
      fd.set(`quantity_${i}`, '1')
    })
    setGrabAllState('pending')
    cartFetcher.submit(fd, { method: 'post', action: '/api/cart' })
  }

  const inStockCount = availableItems.filter(
    item => item.product!.variants?.some(v => v.availableForSale),
  ).length

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
      {/* Coral banner */}
      <div className="rounded-2xl bg-coral text-white px-5 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 mb-8">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-mono uppercase tracking-wider opacity-80">
            Someone shared their picks
          </p>
          <h1
            className="text-white text-2xl sm:text-3xl leading-tight mt-1"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
          >
            {list.name} <span className="opacity-80">♥</span>
          </h1>
        </div>
        {inStockCount > 0 && (
          <button
            type="button"
            onClick={handleGrabAll}
            disabled={grabAllState !== 'idle'}
            className="shrink-0 px-5 py-2.5 rounded-full bg-white text-coral text-sm font-bold hover:bg-cream transition-colors disabled:opacity-70"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {grabAllState === 'added'
              ? 'Added to cart ♥'
              : grabAllState === 'pending'
                ? 'Adding…'
                : `Grab all ${inStockCount} →`}
          </button>
        )}
      </div>

      {list.note && (
        <p className="text-sm text-ink/70 italic mb-6 max-w-2xl leading-snug">
          "{list.note}"
        </p>
      )}

      {giftMode && (
        <p className="text-xs font-mono text-muted uppercase tracking-wider mb-4">
          Gift mode · prices hidden
        </p>
      )}

      {availableItems.length === 0 ? (
        <div className="border border-line rounded-2xl p-10 text-center">
          <p
            className="text-lg text-ink mb-2"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
          >
            Nothing in this list right now ♥
          </p>
          <p className="text-sm text-ink/60">
            The products may have been removed or are out of stock.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {availableItems.map(item => {
            const p = item.product!
            const image = p.images[0]
            const variant = p.variants?.find(v => v.availableForSale) ?? p.variants?.[0]
            const inStock = !!variant?.availableForSale
            return (
              <li key={item.id}>
                <Link
                  to={`/products/${item.handle}`}
                  className="group block border border-line rounded-xl overflow-hidden hover:border-coral transition-colors bg-paper"
                >
                  <div className="aspect-[4/5] bg-cream-2 overflow-hidden">
                    {image ? (
                      <img
                        src={image.url}
                        alt={image.altText || p.title}
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-ink/10">
                        ♥
                      </div>
                    )}
                  </div>
                  <div className="p-3 sm:p-4">
                    {p.brand && (
                      <p className="text-[10px] font-mono text-muted uppercase tracking-wider">
                        {p.brand}
                      </p>
                    )}
                    <p
                      className="text-sm text-ink mt-1 line-clamp-2 group-hover:text-coral transition-colors"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                    >
                      {p.title}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      {giftMode ? (
                        <span className="text-[11px] font-mono text-muted">
                          ✿ surprise
                        </span>
                      ) : (
                        <span className="text-coral font-bold text-sm">
                          ${p.price.toFixed(2)}
                        </span>
                      )}
                      {!inStock && (
                        <span className="text-[10px] font-mono text-muted uppercase tracking-wider">
                          Sold out
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <section className="mt-14 border border-line rounded-2xl p-6 sm:p-8 text-center bg-cream-2">
        <h2
          className="text-ink text-xl sm:text-2xl mb-2"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
        >
          Want a wishlist of your own? <span className="text-coral">♥</span>
        </h2>
        <p className="text-sm text-ink/70 max-w-md mx-auto mb-4">
          Sign up to save your favorites and share them privately with anyone.
        </p>
        <Link
          to="/account/register"
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-bold text-white bg-coral hover:bg-coral-deep transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Start my list ♥
        </Link>
      </section>
    </div>
  )
}
