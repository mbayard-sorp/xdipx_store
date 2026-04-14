import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLoaderData } from 'react-router'
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <header className="text-center mb-10">
        <p className="text-xs uppercase tracking-wide text-brand-charcoal/50">
          A shared wishlist
        </p>
        <h1
          className="text-3xl md:text-4xl font-bold text-brand-charcoal mt-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {list.name} <span className="text-brand-purple">♥</span>
        </h1>
        <p className="text-sm text-brand-charcoal/60 mt-2">
          {availableItems.length}{' '}
          {availableItems.length === 1 ? 'pick' : 'picks'} worth checking out.
        </p>
      </header>

      {availableItems.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <p
            className="text-lg font-bold text-brand-charcoal mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Nothing in this list right now ♥
          </p>
          <p className="text-sm text-brand-charcoal/60">
            The products may have been removed or are out of stock.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {availableItems.map(item => {
            const p = item.product!
            const image = p.images[0]
            return (
              <li key={item.id}>
                <Link to={`/products/${item.handle}`} className="group block">
                  <article className="bg-white rounded-2xl overflow-hidden shadow-sm card-lift">
                    <div className="aspect-square bg-brand-mist overflow-hidden">
                      {image ? (
                        <img
                          src={image.url}
                          alt={image.altText || p.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl text-brand-charcoal/10">
                          ♥
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      {p.brand && (
                        <p className="text-brand-charcoal/50 text-xs uppercase tracking-wide">
                          {p.brand}
                        </p>
                      )}
                      <p
                        className="font-semibold text-sm text-brand-charcoal mt-0.5 line-clamp-2 group-hover:text-brand-coral transition-colors"
                        style={{ fontFamily: 'var(--font-display)' }}
                      >
                        {p.title}
                      </p>
                      <p className="text-brand-gradient font-bold text-sm mt-2">
                        ${p.price.toFixed(2)}
                      </p>
                    </div>
                  </article>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <section className="mt-14 bg-brand-mist rounded-2xl p-8 text-center">
        <h2
          className="text-xl font-bold text-brand-charcoal mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Want a wishlist of your own? <span className="text-brand-purple">♥</span>
        </h2>
        <p className="text-sm text-brand-charcoal/60 max-w-md mx-auto mb-4">
          Sign up to save your favorites and share them with anyone.
        </p>
        <Link
          to="/account/register"
          className="inline-flex items-center justify-center px-6 py-3 rounded-full text-sm font-semibold text-white bg-brand-gradient hover:opacity-90 transition-opacity"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Create your wishlist ♥
        </Link>
      </section>
    </div>
  )
}
