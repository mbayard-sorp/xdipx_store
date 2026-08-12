import type { MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { getComparisonList } from '~/lib/sanity.server'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { Reveal } from '~/components/motion/Reveal'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { ItemListStructuredData } from '~/components/seo/ItemListStructuredData'
import { buildSocialMeta } from '~/lib/social-meta'

const ORIGIN = 'https://xdipx.com'
const TITLE = 'Compare | xdipx'
const DESCRIPTION =
  'Side-by-side comparisons to help you choose. Emma weighs the options, names who each one suits, and points you to the right fit.'

export async function loader() {
  const comparisons = await getComparisonList()
  return { comparisons }
}

export const meta: MetaFunction<typeof loader> = () => {
  const canonical = `${ORIGIN}/compare`
  return [
    { title: TITLE },
    { name: 'description', content: DESCRIPTION },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `${canonical}.md` },
    ...buildSocialMeta({ title: TITLE, description: DESCRIPTION, url: canonical, image: null }),
  ]
}

export default function CompareIndexPage() {
  const { comparisons } = useLoaderData<typeof loader>()

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Compare' },
  ]

  const listItems = comparisons.map(c => ({
    name: c.title,
    url: `${ORIGIN}/compare/${c.slug}`,
  }))

  return (
    <div className="max-w-[75rem] mx-auto px-4 md:px-6 py-6 sm:py-10">
      <BreadcrumbStructuredData
        items={[
          { name: 'Home', url: `${ORIGIN}/` },
          { name: 'Compare', url: `${ORIGIN}/compare` },
        ]}
      />
      {listItems.length > 0 && (
        <ItemListStructuredData name="xdipx comparisons" url={`${ORIGIN}/compare`} items={listItems} />
      )}

      <BreadcrumbNav items={breadcrumbs} />

      <header className="mt-6 max-w-[65ch]">
        <p className="kicker text-plum">Compare</p>
        <h1
          className="mt-2 text-ink text-3xl sm:text-4xl leading-tight"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          Which one is right for you
        </h1>
        <p className="mt-4 text-lg text-ink-3 leading-relaxed">{DESCRIPTION}</p>
      </header>

      {comparisons.length > 0 ? (
        <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {comparisons.map((c, i) => (
            <Reveal key={c._id} variant="up" index={i} as="li">
              <Link
                to={`/compare/${c.slug}`}
                className="flex flex-col h-full bg-paper-2 border border-line rounded-lg p-5 hover:border-coral transition-colors"
              >
                <h2
                  className="text-ink text-lg leading-snug"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                >
                  {c.title}
                </h2>
                {c.excerpt && (
                  <p className="mt-2 text-[15px] text-ink-3 leading-[1.55] flex-1">{c.excerpt}</p>
                )}
                <span className="link-coral text-coral text-sm font-medium mt-4">Compare →</span>
              </Link>
            </Reveal>
          ))}
        </ul>
      ) : (
        <p className="mt-10 text-ink-3">
          New comparisons are on the way. In the meantime,{' '}
          <Link to="/discover" className="link-coral text-coral">
            find your fit with Emma →
          </Link>
        </p>
      )}
    </div>
  )
}
