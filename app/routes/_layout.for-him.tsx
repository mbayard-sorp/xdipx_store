import { useEffect } from 'react'
import type { MetaFunction, LoaderFunctionArgs } from 'react-router'
import { useLoaderData } from 'react-router'
import { getProductsByTag } from '~/lib/shopify.server'
import { Link } from 'react-router'
import type { Product } from '~/types'
import { trackViewItemList } from '~/lib/analytics.client'
import { HeartButton } from '~/components/store/HeartButton'

export const meta: MetaFunction = () => [
  { title: 'For Him — Pleasure Products | xdipx' },
  { name: 'description', content: "Hand-picked pleasure products for him. Ships discreet." },
  { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/for-him' },
]

export async function loader(_: LoaderFunctionArgs) {
  const products = await getProductsByTag('for-him', 24)
  return { products }
}

export default function ForHimPage() {
  const { products } = useLoaderData<typeof loader>()

  useEffect(() => {
    if (products.length > 0) {
      trackViewItemList('for_him', 'For Him', products.map((p, i) => ({
        item_id: p.id, item_name: p.title, ...(p.brand ? { item_brand: p.brand } : {}), price: p.price, index: i,
      })))
    }
  }, [products])

  return <ProductGrid title="For Him ♥" subtitle="Dialed in. Just for him." products={products} />
}

function ProductGrid({ title, subtitle, products }: { title: string; subtitle: string; products: Product[] }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-brand-charcoal mb-1" style={{ fontFamily: 'var(--font-display)' }}>
        {title}
      </h1>
      <p className="text-brand-charcoal/60 mb-8">{subtitle}</p>
      {products.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {products.map(p => (
            <article key={p.id} className="bg-white rounded-2xl overflow-hidden shadow-sm card-lift group relative">
              <HeartButton
                shopifyProductId={p.id}
                handle={p.handle}
                productTitle={p.title}
                price={p.price}
                variant="overlay"
                size="sm"
              />
              <Link to={`/products/${p.handle}`} className="block">
                <div className="aspect-square bg-brand-mist overflow-hidden">
                  {p.images[0] ? (
                    <img src={p.images[0].url} alt={p.images[0].altText || p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl text-brand-charcoal/10">♥</div>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-brand-charcoal/50 text-xs">{p.brand}</p>
                  <p className="font-semibold text-sm text-brand-charcoal mt-0.5 line-clamp-2" style={{ fontFamily: 'var(--font-display)' }}>{p.title}</p>
                  <p className="text-brand-gradient font-bold text-sm mt-2">${p.price.toFixed(2)}</p>
                </div>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-center text-brand-charcoal/40 py-24">Products coming soon. ♥</p>
      )}
    </div>
  )
}
