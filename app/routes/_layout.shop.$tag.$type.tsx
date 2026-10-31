import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link, data } from 'react-router'
import { getPseoCombo, buildPseoFaqs, PSEO_MIN_PRODUCTS } from '~/lib/pseo-combos.server'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { Reveal } from '~/components/motion/Reveal'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { ItemListStructuredData } from '~/components/seo/ItemListStructuredData'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import { buildSocialMeta } from '~/lib/social-meta'

const ORIGIN = 'https://xdipx.com'

/**
 * Programmatic SEO pilot (tracker p2-1-pseo, ticket #18009). Crosses an Ask
 * Emma mood/audience/matters tag with a product_type_dial value. A thin
 * combination (fewer than PSEO_MIN_PRODUCTS live products) 404s rather than
 * serving a page with almost nothing on it, so a reader never lands on an
 * empty shelf and the page never earns an index entry it can't support. The
 * sitemap pilot (app/lib/pseo-combos.server.ts::getPseoCombosForSitemap)
 * applies the same floor separately when deciding which combos to submit.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const tagSlug = params['tag'] ?? ''
  const typeSlug = params['type'] ?? ''
  const combo = await getPseoCombo(tagSlug, typeSlug)

  if (!combo || combo.products.length < PSEO_MIN_PRODUCTS) {
    throw data('Not found', { status: 404 })
  }

  const faqs = buildPseoFaqs(combo.tag.label, combo.typeLabel)

  return { combo, faqs }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: 'Not found | xdipx' }]
  const { combo } = loaderData
  const title = `${combo.tag.label} ${combo.typeLabel.toLowerCase()} picks | xdipx`
  const description =
    `Emma's picks for a ${combo.typeLabel.toLowerCase()} that fits ${combo.tag.label.toLowerCase()}, `
    + `pulled from the live catalog.`
  const canonical = `${ORIGIN}/shop/${combo.tag.slug}/${combo.type}`

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `${canonical}.md` },
    ...buildSocialMeta({ title, description, url: canonical, image: null, type: 'article' }),
  ]
}

export default function PseoComboPage() {
  const { combo, faqs } = useLoaderData<typeof loader>()
  const canonical = `${ORIGIN}/shop/${combo.tag.slug}/${combo.type}`
  const products = combo.products

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Shop', href: '/collections' },
    { label: `${combo.tag.label} ${combo.typeLabel.toLowerCase()}` },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: `${ORIGIN}/` },
    { name: 'Shop', url: `${ORIGIN}/collections` },
    { name: `${combo.tag.label} ${combo.typeLabel.toLowerCase()}`, url: canonical },
  ]

  const listItems = products.map(p => ({
    name: p.title,
    url: `${ORIGIN}/products/${p.handle}`,
    image: p.imageUrl,
  }))

  return (
    <article className="max-w-[75rem] mx-auto px-4 md:px-6 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      <ItemListStructuredData
        name={`${combo.tag.label} ${combo.typeLabel.toLowerCase()} picks`}
        url={canonical}
        items={listItems}
      />
      <FAQStructuredData faqs={faqs} />

      <BreadcrumbNav items={breadcrumbs} />

      <header className="mt-6 max-w-[65ch]">
        <p className="kicker text-plum">{combo.typeLabel}</p>
        <h1
          className="mt-2 text-ink text-3xl sm:text-4xl leading-tight"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          {combo.tag.label} {combo.typeLabel.toLowerCase()} picks
        </h1>
        <p className="mt-4 text-lg text-ink-3 leading-relaxed">
          Emma's picks for a {combo.typeLabel.toLowerCase()} that fits {combo.tag.label.toLowerCase()},
          {' '}pulled from the live catalog.
        </p>
      </header>

      <section className="mt-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
          {products.map((p, i) => (
            <Reveal
              key={p.handle}
              variant="up"
              index={i}
              as="div"
              className="flex flex-col bg-paper-2 border border-line rounded-lg overflow-hidden"
            >
              {p.imageUrl && (
                <img
                  src={p.imageUrl}
                  alt={p.imageAlt ?? p.title}
                  className="w-full aspect-[4/3] object-cover bg-paper-3"
                  loading="lazy"
                />
              )}
              <div className="flex flex-col flex-1 p-5">
                <h2
                  className="text-ink text-lg leading-snug"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                >
                  {p.title}
                </h2>
                <Link
                  to={`/products/${p.handle}`}
                  className="link-coral text-coral text-sm font-medium mt-4 inline-block"
                >
                  Take a peek →
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

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
        <Link to="/discover" className="link-coral text-coral">
          ← Find your fit with Emma
        </Link>
      </p>
    </article>
  )
}
