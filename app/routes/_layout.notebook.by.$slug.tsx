import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { data } from 'react-router'
import { getBlogAuthor, getBlogPosts } from '~/lib/sanity.server'
import { BlogPostCard } from '~/components/blog/BlogPostCard'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { SanityImage } from '~/components/common/SanityImage'
import { Reveal } from '~/components/motion/Reveal'
import { canonicalUrl } from '~/lib/seo'
import { buildSocialMeta } from '~/lib/social-meta'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const perPage = 12

  const author = await getBlogAuthor(slug)
  if (!author) throw data('Author not found', { status: 404 })

  const { posts, total } = await getBlogPosts({ page, perPage, authorSlug: slug })
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const basePath = `/notebook/by/${slug}`
  const canonical =
    page > 1
      ? canonicalUrl({
          path: basePath,
          searchParams: new URLSearchParams({ page: String(page) }),
          allowedParams: ['page'],
        })
      : canonicalUrl({ path: basePath })

  return { author, posts, total, page, perPage, totalPages, canonical }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: 'Writer not found — xdipx' }]
  const { author, page, totalPages, canonical } = loaderData
  const pageSuffix = page > 1 ? ` — Page ${page}` : ''
  const title = `${author.name}${pageSuffix} — The Notebook | xdipx`
  const description = author.bio ?? `Posts by ${author.name} in the xdipx Notebook.`
  const image = author.avatarUrl ?? null

  const tags: ReturnType<MetaFunction> = [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    ...buildSocialMeta({ title, description, url: canonical, image, type: 'profile' }),
  ]

  const basePath = `https://xdipx.com/notebook/by/${author.slug}`
  if (page > 1) {
    const prevHref = page - 1 === 1 ? basePath : `${basePath}?page=${page - 1}`
    tags.push({ tagName: 'link', rel: 'prev', href: prevHref })
  }
  if (page < totalPages) {
    tags.push({ tagName: 'link', rel: 'next', href: `${basePath}?page=${page + 1}` })
  }

  return tags
}

function formatJoinedDate(iso?: string) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function NotebookAuthorPage() {
  const { author, posts, total, page, perPage } = useLoaderData<typeof loader>()
  const totalPages = Math.ceil(total / perPage)
  const joined = formatJoinedDate(author.joinedAt)
  const isEmma = author.name.toLowerCase().includes('emma')

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

  // Person JSON-LD — distinct @id from /about#emma so Emma's editor identity
  // and notebook author identities don't collide. The notebook author page is
  // the canonical "@id" anchor for Person references in BlogPosting schema.
  const personSchema = {
    '@context': 'https://schema.org',
    '@type':    'Person',
    '@id':      `https://xdipx.com/notebook/by/${author.slug}#person`,
    name:       author.name,
    url:        `https://xdipx.com/notebook/by/${author.slug}`,
    ...(author.avatarUrl ? { image: author.avatarUrl } : {}),
    ...(author.bio ? { description: author.bio } : {}),
    ...(author.role ? { jobTitle: author.role } : {}),
    worksFor: {
      '@type': 'Organization',
      '@id':   'https://xdipx.com/#organization',
      name:    'xdipx',
      url:     'https://xdipx.com',
    },
    ...(author.socialLinks && author.socialLinks.length > 0
      ? { sameAs: author.socialLinks.map(s => s.url).filter(Boolean) }
      : {}),
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
      />
      <BreadcrumbNav items={breadcrumbs} />

      {/* Hero */}
      <div className="mt-6 flex flex-col sm:flex-row gap-6 items-start pb-8 border-b border-line-2">
        {author.avatarUrl ? (
          <SanityImage
            src={author.avatarUrl}
            alt={author.name}
            priority
            widths={[224, 336]}
            fallbackWidth={224}
            width={112}
            height={112}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover bg-paper-3 shrink-0"
          />
        ) : (
          <div
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-paper-3 text-ink flex items-center justify-center shrink-0 text-4xl"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            {author.name.charAt(0)}
          </div>
        )}
        <div className="flex-1">
          {author.role && <p className="kicker text-coral">{author.role}</p>}
          <h1
            className="text-ink text-4xl sm:text-6xl leading-none mt-1 tracking-[-0.01em]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            {author.name}
          </h1>
          {author.bio && (
            <p className="text-ink-3 text-sm sm:text-base mt-3 max-w-xl leading-[1.55]">{author.bio}</p>
          )}
          {isEmma && (
            <p className="text-[13px] text-ink-4 mt-2 max-w-xl leading-[1.5]">
              Emma is the xdipx AI guide. She works from specs, materials, and what reviewers
              report, never personal use.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link to="/contact" className="link-coral text-coral text-sm font-medium">
              Ask {author.name.split(' ')[0]} →
            </Link>
            {(author.socialLinks ?? []).map(s =>
              s.url ? (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-ink-3 hover:text-coral transition-colors capitalize"
                >
                  {s.platform === 'x' ? 'X' : s.platform}
                </a>
              ) : null,
            )}
          </div>
        </div>
        <div className="hidden sm:flex flex-col items-end space-y-1 shrink-0">
          <span className="kicker">{author.postCount ?? total} {(author.postCount ?? total) === 1 ? 'post' : 'posts'}</span>
          {joined && <span className="kicker">joined {joined}</span>}
        </div>
      </div>

      {/* Post list */}
      <div className="mt-8">
        {posts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-7 xl:gap-8">
            {posts.map((post, i) => (
              <Reveal key={post._id} variant="up" index={i}>
                <BlogPostCard post={post} />
              </Reveal>
            ))}
          </div>
        ) : (
          <p className="text-center text-ink-3 py-16">No posts from {author.name} yet. Check back soon.</p>
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
        active ? 'bg-ink text-white' : 'text-ink-3 hover:bg-paper-2'
      }`}
    >
      {label}
    </Link>
  )
}
