import type { MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { getGlossaryTerms, getNotebookSettings } from '~/lib/sanity.server'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { NotebookSubscribe } from '~/components/blog/NotebookSubscribe'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { Reveal } from '~/components/motion/Reveal'
import { canonicalUrl } from '~/lib/seo'
import { buildSocialMeta } from '~/lib/social-meta'
import type { GlossaryTerm } from '~/types/cms'

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=1800',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
  }
}

export async function loader() {
  const [terms, notebookSettings] = await Promise.all([
    getGlossaryTerms(),
    getNotebookSettings(),
  ])
  return {
    terms,
    notebookSettings,
    canonical: canonicalUrl({ path: '/notebook/glossary' }),
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Glossary | The Notebook | xdipx' }]
  const title = 'The Glossary | The Notebook | xdipx'
  const description =
    'Plain-language definitions for the words you meet while shopping for sexual wellness. What things do, how they differ, and what to look for.'

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: data.canonical },
    ...buildSocialMeta({ title, description, url: data.canonical, image: null, type: 'website' }),
  ]
}

function groupByLetter(terms: GlossaryTerm[]): [string, GlossaryTerm[]][] {
  const groups = new Map<string, GlossaryTerm[]>()
  for (const t of terms) {
    const letter = (t.term[0] ?? '#').toUpperCase()
    const list = groups.get(letter) ?? []
    list.push(t)
    groups.set(letter, list)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export default function NotebookGlossaryPage() {
  const { terms, notebookSettings } = useLoaderData<typeof loader>()
  const groups = groupByLetter(terms)

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Notebook', href: '/notebook' },
    { label: 'Glossary' },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Notebook', url: 'https://xdipx.com/notebook' },
    { name: 'Glossary', url: 'https://xdipx.com/notebook/glossary' },
  ]

  // DefinedTermSet — the machine-readable half of the glossary. Answer engines
  // lift these definitions with a citation back to the term anchor.
  const definedTermSet = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    '@id': 'https://xdipx.com/notebook/glossary',
    name: 'The xdipx Notebook Glossary',
    url: 'https://xdipx.com/notebook/glossary',
    hasDefinedTerm: terms.map(t => ({
      '@type': 'DefinedTerm',
      '@id': `https://xdipx.com/notebook/glossary#${t.slug}`,
      name: t.term,
      description: t.definition,
      url: `https://xdipx.com/notebook/glossary#${t.slug}`,
    })),
  }

  return (
    <div className="max-w-[75rem] mx-auto px-4 md:px-6 xl:px-8 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      {terms.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(definedTermSet) }}
        />
      )}
      <BreadcrumbNav items={breadcrumbs} />

      {/* Masthead — static, LCP text */}
      <div className="mt-6 pt-2 pb-8 md:pb-10 border-b border-line-2">
        <p className="kicker mb-3">The Notebook · Reference</p>
        <h1
          className="text-ink text-[2.5rem] md:text-[3.75rem] leading-[0.95] tracking-[-0.02em]"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
        >
          The Glossary
        </h1>
        <span className="block w-10 h-0.5 bg-coral mt-5" aria-hidden="true" />
        <p className="text-ink-3 text-sm md:text-base mt-4 max-w-xl leading-[1.55]">
          The words you meet while you shop, defined plainly. What things do, how they differ,
          and what to look for. This page grows as questions come in.
        </p>
      </div>

      {terms.length === 0 ? (
        <div className="text-center py-16 text-ink-3">
          <p className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>
            The first definitions are on their way. Check back soon.
          </p>
        </div>
      ) : (
        <>
          {/* Letter index */}
          <Reveal variant="fade">
            <nav aria-label="Glossary index" className="flex flex-wrap gap-1.5 py-6">
              {groups.map(([letter]) => (
                <a
                  key={letter}
                  href={`#letter-${letter}`}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium text-ink-2 border border-line hover:border-coral hover:text-coral transition-colors press"
                >
                  {letter}
                </a>
              ))}
            </nav>
          </Reveal>

          {/* Terms A to Z */}
          <div className="max-w-[46rem]">
            {groups.map(([letter, letterTerms]) => (
              <section key={letter} id={`letter-${letter}`} className="scroll-mt-24">
                <h2
                  className={`text-coral text-2xl md:text-3xl pt-8 pb-3 border-b border-line`}
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                >
                  {letter}
                </h2>
                {letterTerms.map((t, i) => (
                  <Reveal
                    key={t.slug}
                    variant="up"
                    index={Math.min(i, 3)}
                    as="article"
                    className="py-6 border-b border-line last:border-b-0 scroll-mt-24"
                  >
                    <div id={t.slug} className="scroll-mt-24">
                      <h3
                        className="text-ink text-xl md:text-2xl leading-[1.2]"
                        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                      >
                        {t.term}
                      </h3>
                      <p
                        className="text-ink-2 text-[1.0625rem] md:text-lg leading-[1.7] mt-2.5"
                        style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
                      >
                        {t.definition}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3.5">
                        {t.collectionHandle && (
                          <Link
                            to={`/collections/${t.collectionHandle}`}
                            className="link-coral text-coral text-sm font-medium"
                          >
                            Find your fit →
                          </Link>
                        )}
                        {t.relatedPost && (
                          <Link
                            to={`/notebook/${t.relatedPost.slug}`}
                            className="text-sm text-ink-3 hover:text-coral transition-colors"
                          >
                            Read: {t.relatedPost.title}
                          </Link>
                        )}
                        {(t.seeAlso ?? []).length > 0 && (
                          <span className="text-sm text-ink-4">
                            See also:{' '}
                            {(t.seeAlso ?? []).map((s, j) => (
                              <span key={s.slug}>
                                {j > 0 && ', '}
                                <a href={`#${s.slug}`} className="text-ink-3 hover:text-coral transition-colors underline decoration-1 underline-offset-2">
                                  {s.term}
                                </a>
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  </Reveal>
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      <div className="mt-12 md:mt-16">
        <NotebookSubscribe variant="index" settings={notebookSettings} />
      </div>
    </div>
  )
}
