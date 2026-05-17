import { useEffect, useMemo } from 'react'
import type { MetaFunction, MetaDescriptor, LoaderFunctionArgs } from 'react-router'
import { useLoaderData, useSearchParams } from 'react-router'
import { getProductsByTypesOrTag } from '~/lib/shopify.server'
import { getEmmaPresets, getCollectionPage } from '~/lib/sanity.server'
import type { Product } from '~/types'
import { trackViewItemList } from '~/lib/analytics.client'
import { ProductCard } from '~/components/store/ProductCard'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { CollectionStructuredData } from '~/components/seo/CollectionStructuredData'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import { AskEmmaRail, matchesAskEmmaFilters } from '~/components/store/AskEmmaRail'
import { canonicalUrl, robotsContent, pageTitle } from '~/lib/seo'
import { buildSocialMeta } from '~/lib/social-meta'

const FALLBACK_SEO_TITLE   = 'For Her — Pleasure Products'
const FALLBACK_DESCRIPTION = "Curated wellness and pleasure products chosen with her in mind — from everyday intimates to couples-friendly favorites. Every product is hand-picked for quality and value, shipped discreetly, and held to Emma's standards."
const FALLBACK_H1          = 'Made for her. Obviously. ♥'
const PAGE_URL             = 'https://xdipx.com/for-her'

// Treat /for-her as a virtual collection — see /for-him for the full pattern.
const FACET_PARAMS = ['mood', 'audience', 'matters', 'budgetMax'] as const

// Phase 7a.2 (TAXONOMY_SPEC v2.2 §7) — union loader (see /for-him for context).
const FOR_HER_TYPES = [
  'G-Spot Vibrator',
  'Clitoral Vibrator',
  'Rabbit Vibrator',
  'Suction Vibrator',
  'Bullet Vibrator',
  'Wand Massager',
] as const

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const filtersApplied = FACET_PARAMS.some(p => {
    const vals = url.searchParams.getAll(p)
    return vals.some(v => v && v.length > 0)
  })

  const [products, presets, sanity] = await Promise.all([
    getProductsByTypesOrTag(FOR_HER_TYPES, 'for-her', 24),
    getEmmaPresets(),
    getCollectionPage('for-her'),
  ])

  const seoTitle       = sanity?.seoTitle       ?? FALLBACK_SEO_TITLE
  const seoDescription = sanity?.seoDescription ?? FALLBACK_DESCRIPTION
  const h1             = sanity?.h1             ?? FALLBACK_H1
  const introHtml      = sanity?.introHtml      ?? null
  const heroImageUrl   = sanity?.heroImageUrl   ?? null
  const heroImageAlt   = sanity?.heroImageAlt   ?? h1
  const faqs           = sanity?.faqs ?? []

  const canonical = canonicalUrl({ path: '/for-her' })

  return {
    products, presets,
    seoTitle, seoDescription, h1, introHtml, heroImageUrl, heroImageAlt, faqs,
    canonical, filtersApplied,
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: pageTitle([FALLBACK_SEO_TITLE]) }]
  const title = pageTitle([data.seoTitle])
  const description = data.seoDescription

  const tags: MetaDescriptor[] = [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: data.canonical },
    ...buildSocialMeta({
      title,
      description,
      url: data.canonical,
      image: data.heroImageUrl,
      type: 'website',
      imageAlt: data.heroImageAlt,
    }),
  ]

  if (data.filtersApplied) {
    tags.push({ name: 'robots', content: robotsContent({ index: false, follow: true }) })
  }

  return tags
}

export default function ForHerPage() {
  const { products, presets, seoTitle, seoDescription, h1, introHtml, faqs } = useLoaderData<typeof loader>()
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
        name={seoTitle}
        description={seoDescription}
        url={PAGE_URL}
        items={products.map(p => ({ handle: p.handle, title: p.title }))}
      />
      {faqs.length > 0 ? <FAQStructuredData faqs={faqs} /> : null}

      <div className="max-w-6xl mx-auto px-4 py-10 min-h-screen">
        <h1 className="text-3xl font-bold text-ink mb-1" style={{ fontFamily: 'var(--font-display)' }}>
          {h1}
        </h1>
        <p className="text-ink/60 mb-6">The good stuff, curated with care.</p>

        <div className="mb-8 max-w-3xl">
          {introHtml ? (
            <div
              className="prose prose-sm text-ink/80 leading-relaxed mb-4 max-w-none"
              dangerouslySetInnerHTML={{ __html: introHtml }}
            />
          ) : (
            <p className="text-ink/80 leading-relaxed mb-4">{seoDescription}</p>
          )}
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

        {faqs.length > 0 && (
          <section className="mt-12 max-w-3xl">
            <h2 className="text-xl font-bold text-ink mb-4" style={{ fontFamily: 'var(--font-display)' }}>
              Questions ♥
            </h2>
            <div className="divide-y divide-line border-y border-line">
              {faqs.map((faq, i) => (
                <details key={i} className="group py-4">
                  <summary className="cursor-pointer text-sm font-medium text-ink list-none flex items-start gap-3">
                    <span className="text-coral shrink-0 group-open:rotate-45 transition-transform" aria-hidden="true">+</span>
                    <span>{faq.question}</span>
                  </summary>
                  <div className="text-sm text-ink/75 leading-relaxed mt-3 ml-6">{faq.answer}</div>
                </details>
              ))}
            </div>
          </section>
        )}
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
