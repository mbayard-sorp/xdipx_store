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

const PAGE_TITLE       = 'For Him — Pleasure Products'
const PAGE_DESCRIPTION = "Hand-picked wellness and pleasure products chosen with him in mind — from sleeves and strokers to performance accessories and couples-friendly gear. Every product is curated for quality and value, shipped discreetly, and priced against Emma's standards."
const PAGE_URL         = 'https://xdipx.com/for-him'

export const meta: MetaFunction = () => [
  { title: `${PAGE_TITLE} | xdipx` },
  { name: 'description', content: "Hand-picked pleasure products for him. Ships discreet." },
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
    getProductsByTag('for-him', 24),
    getEmmaPresets(),
  ])
  return { products, presets }
}

export default function ForHimPage() {
  const { products, presets } = useLoaderData<typeof loader>()
  const [params] = useSearchParams()

  useEffect(() => {
    if (products.length > 0) {
      trackViewItemList('for_him', 'For Him', products.map((p, i) => ({
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

  return (
    <>
      <BreadcrumbStructuredData items={[
        { name: 'Home',    url: 'https://xdipx.com/' },
        { name: 'For Him', url: PAGE_URL },
      ]} />
      <CollectionStructuredData
        name={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        url={PAGE_URL}
        items={products.map(p => ({ handle: p.handle, title: p.title }))}
      />
      <ProductGrid
        title="For Him ♥"
        subtitle="Dialed in. Just for him."
        intro={PAGE_DESCRIPTION}
        bullets={[
          'Strokers, sleeves, and solo-play essentials',
          'Performance and stamina accessories',
          'Couples-friendly gear he loves to bring to bed',
          'Men-forward wellness and care',
          'Discreet packaging and billing on every order',
        ]}
        products={filtered}
        ask={{ moods, audiences, matters, priceMin, priceMax, presets }}
      />
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

function ProductGrid({
  title, subtitle, intro, bullets, products, ask,
}: {
  title:    string
  subtitle: string
  intro:    string
  bullets:  string[]
  products: Product[]
  ask: {
    moods:     string[]
    audiences: string[]
    matters:   string[]
    priceMin:  number
    priceMax:  number
    presets:   Awaited<ReturnType<typeof getEmmaPresets>>
  }
}) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-ink mb-1" style={{ fontFamily: 'var(--font-display)' }}>
        {title}
      </h1>
      <p className="text-ink/60 mb-6">{subtitle}</p>

      <div className="mb-8 max-w-3xl">
        <p className="text-ink/80 leading-relaxed mb-4">{intro}</p>
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
          availableMoods={ask.moods}
          availableAudiences={ask.audiences}
          availableMatters={ask.matters}
          priceMin={ask.priceMin}
          priceMax={ask.priceMax}
          presets={ask.presets}
        />

        <div className="flex-1 min-w-0">
          {products.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {products.map(p => (
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
          ) : (
            <p className="text-center text-ink/40 py-24">Nothing matches those filters. Try loosening a chip ♥</p>
          )}
        </div>
      </div>
    </div>
  )
}
