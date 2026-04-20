import { useEffect, useMemo } from 'react'
import type { MetaFunction, LoaderFunctionArgs } from 'react-router'
import { useLoaderData, useSearchParams } from 'react-router'
import { getProductsByTag } from '~/lib/shopify.server'
import { getEmmaPresets } from '~/lib/sanity.server'
import type { Product } from '~/types'
import { trackViewItemList } from '~/lib/analytics.client'
import { ProductCard } from '~/components/store/ProductCard'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { CollectionStructuredData } from '~/components/seo/CollectionStructuredData'
import { AskEmmaRail, matchesAskEmmaFilters } from '~/components/store/AskEmmaRail'

const PAGE_TITLE       = 'For Her — Pleasure Products'
const PAGE_DESCRIPTION = "Curated wellness and pleasure products chosen with her in mind — from everyday intimates to couples-friendly favorites. Every product is hand-picked for quality and value, shipped discreetly, and held to Emma's standards."
const PAGE_URL         = 'https://xdipx.com/for-her'

export const meta: MetaFunction = () => [
  { title: `${PAGE_TITLE} | xdipx` },
  { name: 'description', content: 'Made for her — curated picks from the best pleasure brands. Ships discreet.' },
  { tagName: 'link', rel: 'canonical', href: PAGE_URL },
]

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  }
}

export async function loader(_: LoaderFunctionArgs) {
  const [products, presets] = await Promise.all([
    getProductsByTag('for-her', 24),
    getEmmaPresets(),
  ])
  return { products, presets }
}

export default function ForHerPage() {
  const { products, presets } = useLoaderData<typeof loader>()
  const [params] = useSearchParams()

  useEffect(() => {
    if (products.length > 0) {
      trackViewItemList('for_her', 'For Her', products.map((p, i) => ({
        item_id: p.id, item_name: p.title, ...(p.brand ? { item_brand: p.brand } : {}), price: p.price, index: i,
      })))
    }
  }, [products])

  const filtered = useMemo(
    () => products.filter(p => matchesAskEmmaFilters(
      {
        ...(p.moodTags     ? { moodTags:     p.moodTags     } : {}),
        ...(p.audienceTags ? { audienceTags: p.audienceTags } : {}),
        ...(p.mattersTags  ? { mattersTags:  p.mattersTags  } : {}),
        price: p.price,
      },
      params,
    )),
    [products, params],
  )

  const { moods, audiences, matters, priceMin, priceMax } = useMemo(
    () => deriveFacets(products),
    [products],
  )

  const bullets = [
    'Vibrators, wands, and solo-play favorites',
    'Intimates, lubricants, and everyday wellness',
    'Couples-friendly gear for shared play',
    'Body-safe materials from trusted brands',
    'Discreet packaging and billing on every order',
  ]

  return (
    <>
      <BreadcrumbStructuredData items={[
        { name: 'Home',    url: 'https://xdipx.com/' },
        { name: 'For Her', url: PAGE_URL },
      ]} />
      <CollectionStructuredData
        name={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        url={PAGE_URL}
        items={products.map(p => ({ handle: p.handle, title: p.title }))}
      />

      <div className="max-w-6xl mx-auto px-4 py-10 min-h-screen">
        <h1 className="text-3xl font-bold text-ink mb-1" style={{ fontFamily: 'var(--font-display)' }}>
          Made for her. Obviously. ♥
        </h1>
        <p className="text-ink/60 mb-6">The good stuff, curated with care.</p>

        <div className="mb-8 max-w-3xl">
          <p className="text-ink/80 leading-relaxed mb-4">{PAGE_DESCRIPTION}</p>
          <ul className="space-y-1.5">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink/75">
                <span className="text-sage mt-0.5 shrink-0" aria-hidden="true">♥</span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          <AskEmmaRail
            availableMoods={moods}
            availableAudiences={audiences}
            availableMatters={matters}
            priceMin={priceMin}
            priceMax={priceMax}
            presets={presets}
          />

          <div className="flex-1 min-w-0">
            {filtered.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {filtered.map(p => (
                  <ProductCard
                    key={p.id}
                    id={p.id}
                    handle={p.handle}
                    title={p.title}
                    price={p.price}
                    {...(p.brand ? { brand: p.brand } : {})}
                    {...(p.compareAtPrice ? { compareAt: p.compareAtPrice } : {})}
                    {...(p.images[0] ? { image: p.images[0] } : {})}
                    {...(p.heroVideo ? { heroVideo: p.heroVideo } : {})}
                  />
                ))}
              </div>
            ) : products.length > 0 ? (
              <p className="text-center text-ink/40 py-24">Nothing matches those filters. Try loosening a chip ♥</p>
            ) : (
              <p className="text-center text-ink/40 py-24">Products coming soon. ♥</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function deriveFacets(items: Product[]) {
  const moods     = new Set<string>()
  const audiences = new Set<string>()
  const matters   = new Set<string>()
  let priceMin = Infinity
  let priceMax = 0
  for (const p of items) {
    p.moodTags?.forEach(t => moods.add(t))
    p.audienceTags?.forEach(t => audiences.add(t))
    p.mattersTags?.forEach(t => matters.add(t))
    if (p.price < priceMin) priceMin = p.price
    if (p.price > priceMax) priceMax = p.price
  }
  return {
    moods:     Array.from(moods).sort(),
    audiences: Array.from(audiences).sort(),
    matters:   Array.from(matters).sort(),
    priceMin:  Number.isFinite(priceMin) ? priceMin : 0,
    priceMax:  Math.max(priceMax, 50),
  }
}
