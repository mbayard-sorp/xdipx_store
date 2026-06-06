import type { LoaderFunctionArgs, MetaFunction, MetaDescriptor } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { getBlogPosts, getBlogCategories, getBlogHomepage, isPreviewRequest } from '~/lib/sanity.server'
import { BlogPostCard } from '~/components/blog/BlogPostCard'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { ItemListStructuredData } from '~/components/seo/ItemListStructuredData'
import { canonicalUrl, robotsContent } from '~/lib/seo'
import { buildSocialMeta, SITE_ORIGIN } from '~/lib/social-meta'
import type { BlogPostCard as BlogPostCardType, BlogCategory } from '~/types/cms'

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=1800',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const category = url.searchParams.get('category')
  const preview = isPreviewRequest(request)

  const blogOpts: Parameters<typeof getBlogPosts>[0] = { page, perPage: 12 }
  if (category) blogOpts.category = category

  const [{ posts, total }, categories, blogHomepage] = await Promise.all([
    getBlogPosts(blogOpts),
    getBlogCategories(),
    getBlogHomepage(preview),
  ])

  let featuredPost: BlogPostCardType | null = null
  let secondaryPosts: BlogPostCardType[] = []
  let gridPosts = posts
  if (page === 1 && !category) {
    featuredPost = posts.find(p => p.featured) ?? posts[0] ?? null
    if (featuredPost) {
      gridPosts = posts.filter(p => p._id !== featuredPost!._id)
      secondaryPosts = gridPosts.slice(0, 2)
      gridPosts = gridPosts.slice(2)
    }
  }

  // Canonical strategy:
  //  - `?category=X` is a faceted view of the dedicated /notebook/category/X
  //    route; it gets `noindex,follow` (set in meta()) and a bare canonical.
  //  - `?page=N` (no category) is its own document — self-canonical.
  //  - Page 1, no category — canonical to bare /notebook.
  const filtersApplied = !!category
  const canonical =
    !filtersApplied && page > 1
      ? canonicalUrl({
          path: '/notebook',
          searchParams: new URLSearchParams({ page: String(page) }),
          allowedParams: ['page'],
        })
      : canonicalUrl({ path: '/notebook' })

  return {
    posts: gridPosts,
    featuredPost,
    secondaryPosts,
    total,
    page,
    perPage: 12,
    categories,
    selectedCategory: category,
    blogHomepage,
    canonical,
    filtersApplied,
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'The Notebook | xdipx' }]
  const base = data.selectedCategory
    ? `${data.selectedCategory.charAt(0).toUpperCase() + data.selectedCategory.slice(1)} — The Notebook`
    : 'The Notebook'
  const pageSuffix = data.page > 1 ? ` — Page ${data.page}` : ''
  const title = `${base}${pageSuffix} | xdipx`
  const description = data.blogHomepage?.subtext ?? "Things worth knowing. Things worth trying. Things Emma couldn't stop thinking about."

  const tags: MetaDescriptor[] = [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: data.canonical },
    ...buildSocialMeta({ title, description, url: data.canonical, image: null, type: 'website' }),
  ]

  // Faceted-view of the dedicated category route — let crawlers follow but
  // don't compete with /notebook/category/{slug} for indexation.
  if (data.filtersApplied) {
    tags.push({ name: 'robots', content: robotsContent({ index: false, follow: true }) })
  }

  return tags
}

export default function NotebookIndex() {
  const { posts, featuredPost, secondaryPosts, total, page, perPage, categories, selectedCategory } = useLoaderData<typeof loader>()
  const totalPages = Math.ceil(total / perPage)

  const breadcrumbSchema = [
    { name: 'Home', url: `${SITE_ORIGIN}/` },
    { name: 'Notebook', url: `${SITE_ORIGIN}/notebook` },
  ]

  // ItemList of the visible posts (display order) strengthens the hub as an
  // AEO surface. Skip on faceted category views — those are noindex,follow and
  // duplicate the dedicated /notebook/category/{slug} route.
  const listPosts = [featuredPost, ...secondaryPosts, ...posts].filter(
    (p): p is BlogPostCardType => Boolean(p),
  )

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      {!selectedCategory && listPosts.length > 0 && (
        <ItemListStructuredData
          name="The Notebook"
          url={`${SITE_ORIGIN}/notebook`}
          items={listPosts.map(p => ({
            name:  p.title,
            url:   `${SITE_ORIGIN}/notebook/${p.slug}`,
            image: p.heroImageUrl ?? null,
          }))}
        />
      )}
      {/* Masthead */}
      <div className="text-center py-6 border-b-2 border-ink">
        <h1
          className="text-ink text-4xl sm:text-6xl leading-none"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
        >
          The Notebook
        </h1>
        <p className="text-muted text-xs sm:text-sm font-mono uppercase tracking-wider mt-3">
          things worth knowing · things worth trying · things Emma couldn't stop thinking about
        </p>
      </div>

      {/* Category rail */}
      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto py-5 scrollbar-hide">
          <CategoryPill slug={null} name="All" active={!selectedCategory} />
          {categories.map((cat: BlogCategory) => (
            <CategoryPill
              key={cat.slug}
              slug={cat.slug}
              name={cat.name}
              active={selectedCategory === cat.slug}
            />
          ))}
          <span className="shrink-0 text-xs font-mono text-muted ml-auto self-center">
            {total} {total === 1 ? 'post' : 'posts'}
          </span>
        </div>
      )}

      {/* Hero post + secondary posts */}
      {featuredPost && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 mb-10">
          <FeaturedHero post={featuredPost} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
            {secondaryPosts.map(p => (
              <BlogPostCard key={p._id} post={p} />
            ))}
          </div>
        </div>
      )}

      {/* Post grid */}
      {posts.length > 0 ? (
        <>
          <h2
            className="text-ink text-xl mb-4"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
          >
            More from the notebook
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            {posts.map(post => (
              <BlogPostCard key={post._id} post={post} />
            ))}
          </div>
        </>
      ) : !featuredPost ? (
        <div className="text-center py-16 text-ink/50">
          <p className="text-lg">Nothing here yet — Emma's drafting ♥</p>
        </div>
      ) : null}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mb-12">
          {page > 1 && (
            <PaginationLink page={page - 1} category={selectedCategory} label="← Previous" />
          )}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <PaginationLink
              key={p}
              page={p}
              category={selectedCategory}
              label={String(p)}
              active={p === page}
            />
          ))}
          {page < totalPages && (
            <PaginationLink page={page + 1} category={selectedCategory} label="Next →" />
          )}
        </div>
      )}

      {/* Newsletter */}
      <div className="bg-coral/10 border border-coral/30 rounded-2xl px-6 py-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <div className="flex-1">
          <h3
            className="text-ink text-lg"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
          >
            Get the notebook in your inbox
          </h3>
          <p className="text-xs font-mono text-muted mt-1">
            One email, once-ish a week. Only the ones worth reading.
          </p>
        </div>
        <Link
          to="/#newsletter"
          className="px-5 py-2.5 rounded-full bg-coral hover:bg-coral-deep text-white text-sm font-bold transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Keep me posted
        </Link>
      </div>
    </div>
  )
}

function FeaturedHero({ post }: { post: BlogPostCardType }) {
  return (
    <Link
      to={`/notebook/${post.slug}`}
      className="group block bg-paper border border-line overflow-hidden hover:border-coral transition-colors"
    >
      {post.heroImageUrl ? (
        <div className="aspect-[16/9] overflow-hidden border-b-2 border-ink">
          <img
            src={post.heroImageUrl}
            alt={post.heroImageAlt ?? post.title}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
          />
        </div>
      ) : (
        <div className="aspect-[16/9] bg-cream-2 border-b-2 border-ink flex items-center justify-center">
          <span className="text-6xl text-ink/10">♥</span>
        </div>
      )}
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          {post.category && (
            <span className="text-[10px] font-mono uppercase tracking-wider bg-coral text-white px-2 py-0.5 rounded-full">
              {post.category.name}
            </span>
          )}
          <span className="text-[11px] font-mono text-muted">
            {post.readingTime} min read
          </span>
        </div>
        <h2
          className="text-ink text-2xl sm:text-3xl leading-[1.05] mb-2 group-hover:text-coral transition-colors"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
        >
          {post.title}
        </h2>
        <p className="text-sm text-ink/70 line-clamp-2 max-w-xl">{post.excerpt}</p>
        {post.author && (
          <div className="flex items-center gap-2 mt-4">
            {post.author.avatarUrl ? (
              <img src={post.author.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
            ) : (
              <div
                className="w-6 h-6 rounded-full bg-coral text-white text-[11px] flex items-center justify-center font-bold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {post.author.name.charAt(0)}
              </div>
            )}
            <span className="text-[11px] font-mono text-muted">{post.author.name}</span>
          </div>
        )}
      </div>
    </Link>
  )
}

function CategoryPill({ slug, name, active }: { slug: string | null; name: string; active: boolean }) {
  const params = new URLSearchParams()
  if (slug) params.set('category', slug)

  return (
    <Link
      to={slug ? `/notebook?${params.toString()}` : '/notebook'}
      className={`shrink-0 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider transition-colors border ${
        active
          ? 'bg-coral text-white border-coral'
          : 'bg-paper text-ink/70 border-line hover:border-coral hover:text-coral'
      }`}
    >
      {name}
    </Link>
  )
}

function PaginationLink({
  page,
  category,
  label,
  active,
}: {
  page: number
  category: string | null
  label: string
  active?: boolean
}) {
  const params = new URLSearchParams()
  if (page > 1) params.set('page', String(page))
  if (category) params.set('category', category)
  const search = params.toString()

  return (
    <Link
      to={search ? `/notebook?${search}` : '/notebook'}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-coral text-white' : 'text-ink/60 hover:bg-cream-2'
      }`}
    >
      {label}
    </Link>
  )
}
