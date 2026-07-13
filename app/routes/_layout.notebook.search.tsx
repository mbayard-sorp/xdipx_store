import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Form } from 'react-router'
import { searchBlogPosts } from '~/lib/sanity.server'
import { BlogPostCard } from '~/components/blog/BlogPostCard'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { Reveal } from '~/components/motion/Reveal'
import { canonicalUrl, robotsContent } from '~/lib/seo'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80)
  const posts = q ? await searchBlogPosts(q) : []

  return {
    q,
    posts,
    canonical: canonicalUrl({ path: '/notebook/search' }),
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.q
    ? `"${data.q}" — Search The Notebook | xdipx`
    : 'Search — The Notebook | xdipx'

  return [
    { title },
    { name: 'description', content: 'Search the xdipx Notebook.' },
    { tagName: 'link', rel: 'canonical', href: data?.canonical ?? 'https://xdipx.com/notebook/search' },
    // Search results are query-dependent views — never an indexation surface.
    { name: 'robots', content: robotsContent({ index: false, follow: true }) },
  ]
}

export default function NotebookSearchPage() {
  const { q, posts } = useLoaderData<typeof loader>()

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Notebook', href: '/notebook' },
    { label: 'Search' },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Notebook', url: 'https://xdipx.com/notebook' },
    { name: 'Search', url: 'https://xdipx.com/notebook/search' },
  ]

  return (
    <div className="max-w-[75rem] mx-auto px-4 md:px-6 xl:px-8 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      <BreadcrumbNav items={breadcrumbs} />

      <div className="mt-6 pb-8 border-b border-line-2">
        <p className="kicker mb-3">The Notebook · Search</p>
        <h1
          className="text-ink text-[2rem] md:text-[2.75rem] leading-[1.04] tracking-[-0.01em]"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
        >
          What are you looking for?
        </h1>
        <Form method="get" className="mt-6 flex flex-col sm:flex-row gap-2.5 max-w-xl">
          <label htmlFor="notebook-search" className="sr-only">Search the Notebook</label>
          <input
            id="notebook-search"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="wands, lube, how to clean…"
            maxLength={80}
            className="flex-1 px-4 py-2.5 rounded-full border border-line bg-paper text-ink placeholder-ink-4 focus:outline-none focus:ring-2 focus:ring-coral/40"
          />
          <button
            type="submit"
            className="bg-ink text-white hover:bg-ink-2 press font-medium px-6 py-2.5 rounded-full transition-colors whitespace-nowrap"
          >
            Show me
          </button>
        </Form>
      </div>

      {q && (
        <p className="kicker mt-6">
          {posts.length} {posts.length === 1 ? 'result' : 'results'} for "{q}"
        </p>
      )}

      {posts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-7 xl:gap-8 mt-6">
          {posts.map((post, i) => (
            <Reveal key={post._id} variant="up" index={i}>
              <BlogPostCard post={post} />
            </Reveal>
          ))}
        </div>
      ) : q ? (
        <div className="text-center py-16 text-ink-3">
          <p className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>
            Nothing matched that. Try a simpler word, or browse the categories.
          </p>
        </div>
      ) : null}
    </div>
  )
}
