import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { data } from 'react-router'
import { getBlogAuthor, getBlogPosts } from '~/lib/sanity.server'
import { BlogPostCard } from '~/components/blog/BlogPostCard'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const perPage = 12

  const author = await getBlogAuthor(slug)
  if (!author) throw data('Author not found', { status: 404 })

  const { posts, total } = await getBlogPosts({ page, perPage, authorSlug: slug })

  return { author, posts, total, page, perPage }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: 'Writer not found — xdipx' }]
  const { author } = loaderData
  const title = `${author.name} — The Notebook | xdipx`
  const description = author.bio ?? `Posts by ${author.name} in the xdipx Notebook.`
  const canonical = `https://xdipx.com/notebook/by/${author.slug}`

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { property: 'og:title', content: title },
    { property: 'og:type', content: 'profile' },
    { property: 'og:url', content: canonical },
  ]
}

function formatJoinedDate(iso?: string) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function NotebookAuthorPage() {
  const { author, posts, total, page, perPage } = useLoaderData<typeof loader>()
  const totalPages = Math.ceil(total / perPage)
  const joined = formatJoinedDate(author.joinedAt)

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Notebook', href: '/notebook' },
    { label: 'Writers' },
    { label: author.name },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Notebook', url: 'https://xdipx.com/notebook' },
    { name: author.name, url: `https://xdipx.com/notebook/by/${author.slug}` },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      <BreadcrumbNav items={breadcrumbs} />

      {/* Hero */}
      <div className="mt-6 flex flex-col sm:flex-row gap-6 items-start pb-8 border-b-2 border-ink">
        {author.avatarUrl ? (
          <img
            src={author.avatarUrl}
            alt={author.name}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border-2 border-ink shrink-0"
          />
        ) : (
          <div
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-coral text-white flex items-center justify-center border-2 border-ink shrink-0 text-4xl"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
          >
            {author.name.charAt(0)}
          </div>
        )}
        <div className="flex-1">
          {author.role && (
            <p className="text-xs font-mono text-coral uppercase tracking-wider">{author.role}</p>
          )}
          <h1
            className="text-ink text-4xl sm:text-6xl leading-none mt-1"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
          >
            {author.name}
          </h1>
          {author.bio && (
            <p className="text-ink/70 text-sm sm:text-base mt-3 max-w-xl leading-snug">{author.bio}</p>
          )}
          <div className="mt-4 flex gap-3">
            <Link
              to="/contact"
              className="px-4 py-2 rounded-full bg-coral hover:bg-coral-deep text-white text-xs font-bold transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Ask {author.name.split(' ')[0]} →
            </Link>
          </div>
        </div>
        <div className="hidden sm:flex flex-col items-end text-xs font-mono text-muted space-y-1 shrink-0">
          <span>{author.postCount ?? total} {(author.postCount ?? total) === 1 ? 'post' : 'posts'}</span>
          {joined && <span>joined {joined}</span>}
        </div>
      </div>

      {/* Post list */}
      <div className="mt-8">
        {posts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map(post => (
              <BlogPostCard key={post._id} post={post} />
            ))}
          </div>
        ) : (
          <p className="text-center text-ink/50 py-16">No posts from {author.name} yet ♥</p>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-10">
          {page > 1 && (
            <PaginationLink slug={author.slug} page={page - 1} label="← Previous" />
          )}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <PaginationLink key={p} slug={author.slug} page={p} label={String(p)} active={p === page} />
          ))}
          {page < totalPages && (
            <PaginationLink slug={author.slug} page={page + 1} label="Next →" />
          )}
        </div>
      )}
    </div>
  )
}

function PaginationLink({ slug, page, label, active }: { slug: string; page: number; label: string; active?: boolean }) {
  const href = page > 1 ? `/notebook/by/${slug}?page=${page}` : `/notebook/by/${slug}`

  return (
    <Link
      to={href}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-coral text-white' : 'text-ink/60 hover:bg-cream-2'
      }`}
    >
      {label}
    </Link>
  )
}
