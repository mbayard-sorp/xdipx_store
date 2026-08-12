import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link, data } from 'react-router'
import { getComparison, isPreviewRequest } from '~/lib/sanity.server'
import { getProductsByHandles } from '~/lib/shopify.server'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { Reveal } from '~/components/motion/Reveal'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { ItemListStructuredData } from '~/components/seo/ItemListStructuredData'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import { buildSocialMeta } from '~/lib/social-meta'
import type { Product } from '~/types'

const ORIGIN = 'https://xdipx.com'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const preview = isPreviewRequest(request)
  const comparison = await getComparison(slug, preview)

  if (!comparison) throw data('Comparison not found', { status: 404 })

  // Resolve product-backed items to live titles/images/canonical links the same
  // way the Notebook resolves blogProductEmbed handles. Items without a handle
  // are non-catalog options and carry no product.
  const handles = [...new Set(
    (comparison.items ?? [])
      .map(i => i.productHandle)
      .filter((h): h is string => Boolean(h)),
  )]

  let productMap: Record<string, Product> = {}
  if (handles.length > 0) {
    const products = await getProductsByHandles(handles)
    productMap = Object.fromEntries(products.map(p => [p.handle, p]))
  }

  return { comparison, productMap }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: 'Comparison not found | xdipx' }]
  const { comparison } = loaderData
  const title = (comparison.seoTitle ?? comparison.title) + ' | Compare | xdipx'
  const description = comparison.seoDescription ?? comparison.excerpt
  const canonical = `${ORIGIN}/compare/${comparison.slug}`

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `${canonical}.md` },
    ...buildSocialMeta({ title, description, url: canonical, image: null, type: 'article' }),
    ...(comparison.noIndex ? [{ name: 'robots', content: 'noindex' }] : []),
  ]
}

export default function ComparePage() {
  const { comparison, productMap } = useLoaderData<typeof loader>()
  const canonical = `${ORIGIN}/compare/${comparison.slug}`
  const items = comparison.items ?? []
  const attributes = comparison.attributes ?? []
  const faqs = comparison.faqs ?? []

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Compare', href: '/compare' },
    { label: comparison.title },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: `${ORIGIN}/` },
    { name: 'Compare', url: `${ORIGIN}/compare` },
    { name: comparison.title, url: canonical },
  ]

  // ItemList JSON-LD from the compared options, in the order shown. Product-
  // backed options point at their canonical PDP; a non-catalog option points at
  // this page. Built from the same items the reader sees, so the list stays 1:1.
  const listItems = items.map(item => {
    const product = item.productHandle ? productMap[item.productHandle] : undefined
    return {
      name: item.name,
      url: item.productHandle ? `${ORIGIN}/products/${item.productHandle}` : canonical,
      image: product?.images?.[0]?.url ?? null,
    }
  })

  return (
    <article className="max-w-[75rem] mx-auto px-4 md:px-6 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      {listItems.length > 0 && (
        <ItemListStructuredData
          name={comparison.seoTitle ?? comparison.title}
          url={canonical}
          items={listItems}
        />
      )}
      {faqs.length > 0 && <FAQStructuredData faqs={faqs} />}

      <BreadcrumbNav items={breadcrumbs} />

      <header className="mt-6 max-w-[65ch]">
        <p className="kicker text-plum">Compare</p>
        <h1
          className="mt-2 text-ink text-3xl sm:text-4xl leading-tight"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          {comparison.title}
        </h1>
        {comparison.excerpt && (
          <p className="mt-4 text-lg text-ink-3 leading-relaxed">{comparison.excerpt}</p>
        )}
      </header>

      {/* The options, one card per compared item */}
      {items.length > 0 && (
        <section className="mt-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {items.map((item, i) => {
              const product = item.productHandle ? productMap[item.productHandle] : undefined
              const image = product?.images?.[0]
              return (
                <Reveal
                  key={i}
                  variant="up"
                  index={i}
                  as="div"
                  className="flex flex-col bg-paper-2 border border-line rounded-lg overflow-hidden"
                >
                  {image?.url && (
                    <img
                      src={image.url}
                      alt={image.altText ?? item.name}
                      className="w-full aspect-[4/3] object-cover bg-paper-3"
                      loading="lazy"
                    />
                  )}
                  <div className="flex flex-col flex-1 p-5">
                    <h2
                      className="text-ink text-xl leading-snug"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                    >
                      {item.name}
                    </h2>
                    {item.bestFor && (
                      <p className="kicker mt-1.5 text-sage">Best for {item.bestFor}</p>
                    )}
                    {item.blurb && (
                      <p className="mt-3 text-[15px] text-ink-3 leading-[1.55]">{item.blurb}</p>
                    )}
                    {item.productHandle && (
                      <Link
                        to={`/products/${item.productHandle}`}
                        className="link-coral text-coral text-sm font-medium mt-4 inline-block"
                      >
                        Take a peek →
                      </Link>
                    )}
                  </div>
                </Reveal>
              )
            })}
          </div>
        </section>
      )}

      {/* At-a-glance table */}
      {attributes.length > 0 && items.length > 0 && (
        <section className="mt-12">
          <h2
            className="text-ink text-2xl leading-tight"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            At a glance
          </h2>
          <div className="mt-4 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left font-medium text-ink-3 py-3 pr-4">Attribute</th>
                  {items.map((item, i) => (
                    <th
                      key={i}
                      className="text-left text-ink py-3 px-4"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                    >
                      {item.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attributes.map((row, ri) => (
                  <tr key={ri} className="border-b border-line align-top">
                    <th scope="row" className="text-left font-medium text-ink-3 py-3 pr-4">
                      {row.label}
                    </th>
                    {items.map((_, ci) => (
                      <td key={ci} className="text-ink-2 py-3 px-4 leading-[1.5]">
                        {row.values?.[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Verdict */}
      {comparison.verdict && (
        <Reveal variant="fade" as="section" className="mt-12 bg-plum-soft rounded-lg p-6 md:p-8 max-w-[65ch]">
          <p className="kicker text-plum mb-2.5">The verdict</p>
          <p className="text-ink text-lg leading-relaxed">{comparison.verdict}</p>
        </Reveal>
      )}

      {/* FAQ */}
      {faqs.length > 0 && (
        <section className="mt-12 max-w-[65ch]">
          <h2
            className="text-ink text-2xl leading-tight"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            Frequently asked questions
          </h2>
          <dl className="mt-5 space-y-5">
            {faqs.map((f, i) => (
              <div key={i} className="border-b border-line pb-5">
                <dt
                  className="text-ink text-base"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                >
                  {f.question}
                </dt>
                <dd className="mt-2 text-[15px] text-ink-3 leading-[1.55]">{f.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <p className="mt-12 text-sm text-ink-4">
        <Link to="/compare" className="link-coral text-coral">
          ← All comparisons
        </Link>
      </p>
    </article>
  )
}
