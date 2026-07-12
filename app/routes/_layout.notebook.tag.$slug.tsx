import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { data } from 'react-router'
import { getBlogPosts } from '~/lib/sanity.server'
import { BlogPostCard } from '~/components/blog/BlogPostCard'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { Reveal } from '~/components/motion/Reveal'
import { canonicalUrl, robotsContent } from '~/lib/seo'
import { buildSocialMeta } from '~/lib/social-meta'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const perPage = 12

  const { posts, total } = await getBlogPosts({ page, perPage, tag: slug })
  if (total === 0) throw data('Tag not found', { status: 404 })

  return {
    tag: slug,
    posts,
    total,
    page,
    perPage,
    canonical: canonicalUrl({ path: `/notebook/tag/${slug}` }),
  }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: 'Tag not found — xdipx' }]
  const { tag, canonical } = loaderData
  const title = `${tag} — The Notebook | xdipx`
  const description = `Notebook posts tagged "${tag}".`

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    // Tag archives stay noindex until content depth justifies indexing —
    // the seo-curator flips this when a tag earns its own search surface.
    { name: 'robots', content: robotsContent({ index: false, follow: true }) },
    ...buildSocialMeta({ title, description, url: canonical, image: null, type: 'website' }),
  ]
}

export default function NotebookTagPage() {
  const { tag, posts, total, page, perPage } = useLoaderData<typeof loader>()
  const totalPages = Math.ceil(total / perPage)

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Notebook', href: '/notebook' },
    { label: `#${tag}` },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Notebook', url: 'https://xdipx.com/notebook' },
    { name: tag, url: `https://xdipx.com/notebook/tag/${tag}` },
  ]

  return (
    <div className="max-w-[75rem] mx-auto px-4 md:px-6 xl:px-8 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      <BreadcrumbNav items={breadcrumbs} />

      <div className="mt-6 mb-10 pb-6 border-b border-line-2">
        <p className="kicker mb-2">Notebook · Tag</p>
        <h1
          className="text-ink text-[2rem] md:text-[2.75rem] leading-[1.04]"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
        >
          {tag}
        </h1>
        <p className="text-ink-3 text-sm mt-2">
          {total} {total === 1 ? 'post' : 'posts'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-7 xl:gap-8 mb-10">
        {posts.map((post, i) => (
          <Reveal key={post._id} variant="up" index={i}>
            <BlogPostCard post={post} />
          </Reveal>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          {page > 1 && <TagPaginationLink slug={tag} page={page - 1} label="← Previous" />}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <TagPaginationLink key={p} slug={tag} page={p} label={String(p)} active={p === page} />
          ))}
          {page < totalPages && <TagPaginationLink slug={tag} page={page + 1} label="Next →" />}
        </div>
      )}
    </div>
  )
}

function TagPaginationLink({ slug, page, label, active }: { slug: string; page: number; label: string; active?: boolean }) {
  const href = page > 1 ? `/notebook/tag/${slug}?page=${page}` : `/notebook/tag/${slug}`

  return (
    <Link
      to={href}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors press ${
        active ? 'bg-ink text-white' : 'text-ink-3 hover:bg-paper-2'
      }`}
    >
      {label}
    </Link>
  )
}
