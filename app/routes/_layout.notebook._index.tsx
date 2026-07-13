import type { LoaderFunctionArgs, MetaFunction, MetaDescriptor } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { getBlogPosts, getBlogCategories, getBlogHomepage, getNotebookSettings, getAllBlogSeries, isPreviewRequest } from '~/lib/sanity.server'
import { BlogPostCard } from '~/components/blog/BlogPostCard'
import { CategoryChip } from '~/components/blog/CategoryChip'
import { NotebookSubscribe } from '~/components/blog/NotebookSubscribe'
import { SeriesRail } from '~/components/blog/SeriesRail'
import { SanityImage } from '~/components/common/SanityImage'
import { Reveal } from '~/components/motion/Reveal'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { ItemListStructuredData } from '~/components/seo/ItemListStructuredData'
import { canonicalUrl, robotsContent } from '~/lib/seo'
import { buildSocialMeta, SITE_ORIGIN } from '~/lib/social-meta'
import { categoryAccent } from '~/lib/blog-style'
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

  const [{ posts, total }, categories, blogHomepage, notebookSettings, series] = await Promise.all([
    getBlogPosts(blogOpts),
    getBlogCategories(),
    getBlogHomepage(preview),
    getNotebookSettings(),
    getAllBlogSeries(),
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
    notebookSettings,
    series,
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
  const description = data.blogHomepage?.subtext ?? "Things worth knowing. Things worth trying. Things Emma dug up so you don't have to."

  const tags: MetaDescriptor[] = [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: data.canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: 'https://xdipx.com/notebook.md' },
    { tagName: 'link', rel: 'alternate', type: 'application/rss+xml', title: 'The xdipx Notebook', href: 'https://xdipx.com/notebook/rss.xml' },
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
  const { posts, featuredPost, secondaryPosts, total, page, perPage, categories, selectedCategory, blogHomepage, notebookSettings, series } = useLoaderData<typeof loader>()
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
    <div className="max-w-[75rem] mx-auto px-4 md:px-6 xl:px-8 py-6 sm:py-10">
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

      {/* Masthead — static, part of the LCP paint */}
      <div className="text-center pt-4 pb-8 md:pb-10 border-b border-line-2">
        <p className="kicker mb-3">{notebookSettings?.kicker ?? 'The xdipx Notebook'}</p>
        <h1
          className="text-ink text-[2.5rem] md:text-[3.75rem] xl:text-[5rem] leading-[0.95] tracking-[-0.02em]"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
        >
          {blogHomepage?.heading ?? 'The Notebook'}
        </h1>
        <span className="block w-10 h-0.5 bg-coral mx-auto mt-5" aria-hidden="true" />
        <p className="text-ink-3 text-sm md:text-base mt-4 max-w-xl mx-auto leading-[1.55]">
          {blogHomepage?.subtext ?? "Things worth knowing. Things worth trying. Things Emma dug up so you don't have to."}
        </p>
      </div>

      {/* Featured lockup — image is the index LCP, static, never animated */}
      {featuredPost && (
        <div className="mt-8 md:mt-12 grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6 lg:gap-10 items-start">
          <FeaturedLockup post={featuredPost} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-5">
            {secondaryPosts.map((p, i) => (
              <Reveal key={p._id} variant="up" index={i}>
                <BlogPostCard post={p} />
              </Reveal>
            ))}
          </div>
        </div>
      )}

      {/* Category rail — one fade for the whole row */}
      {categories.length > 0 && (
        <Reveal variant="fade">
          <div className="flex items-center gap-2 overflow-x-auto py-6 mt-4 scrollbar-hide">
            <CategoryPill slug={null} name="All" active={!selectedCategory} />
            {categories.map((cat: BlogCategory) => (
              <CategoryPill
                key={cat.slug}
                slug={cat.slug}
                name={cat.name}
                color={cat.color}
                active={selectedCategory === cat.slug}
              />
            ))}
            <span className="shrink-0 flex items-center gap-4 ml-auto">
              <Link to="/notebook/glossary" className="kicker hover:text-coral transition-colors">
                Glossary
              </Link>
              <Link to="/notebook/search" className="kicker hover:text-coral transition-colors">
                Search
              </Link>
              <span className="kicker hidden sm:inline">
                {total} {total === 1 ? 'post' : 'posts'}
              </span>
            </span>
          </div>
        </Reveal>
      )}

      {/* Post grid — the signature staggered entrance */}
      {posts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-7 xl:gap-8 mb-12 md:mb-16">
          {posts.map((post, i) => (
            <Reveal key={post._id} variant="up" index={i}>
              <BlogPostCard post={post} />
            </Reveal>
          ))}
        </div>
      ) : !featuredPost ? (
        <div className="text-center py-16 text-ink-3">
          <p className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>
            Nothing here yet. Emma's drafting ♥
          </p>
        </div>
      ) : null}

      {/* Series rail */}
      {!selectedCategory && series.length > 0 && (
        <div className="mb-12 md:mb-16">
          <SeriesRail series={series} />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mb-12 md:mb-16">
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

      {/* Newsletter — inline value exchange, never a popup */}
      <NotebookSubscribe variant="index" settings={notebookSettings} />
    </div>
  )
}

function FeaturedLockup({ post }: { post: BlogPostCardType }) {
  const accent = categoryAccent(post.category?.slug, post.category?.color)

  return (
    <Link to={`/notebook/${post.slug}`} className="group block">
      {post.heroImageUrl ? (
        <div className="aspect-[3/2] rounded-lg overflow-hidden">
          <SanityImage
            src={post.heroImageUrl}
            alt={post.heroImageAlt ?? post.title}
            priority
            sizes="(max-width: 1024px) 100vw, 60vw"
            widths={[640, 828, 1200, 1600]}
            fallbackWidth={1200}
            {...(post.heroWidth ? { width: post.heroWidth } : {})}
            {...(post.heroHeight ? { height: post.heroHeight } : {})}
            {...(post.heroLqip ? { lqip: post.heroLqip } : {})}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
          />
        </div>
      ) : (
        <div className="aspect-[3/2] rounded-lg bg-paper-2 flex items-center justify-center">
          <span className="text-6xl text-ink/10">♥</span>
        </div>
      )}
      <Reveal variant="fade" className="pt-5">
        <div className="flex items-center gap-3 mb-3">
          <span className={`kicker ${accent.kicker}`}>Featured</span>
          {post.category && (
            <CategoryChip
              name={post.category.name}
              slug={post.category.slug}
              color={post.category.color}
              linked={false}
            />
          )}
          {post.readingTime > 0 && <span className="kicker">{post.readingTime} min</span>}
        </div>
        <h2
          className="text-ink text-[1.875rem] md:text-[2.625rem] xl:text-[3.375rem] leading-[1.03] tracking-[-0.01em] mb-3 group-hover:text-coral transition-colors"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
        >
          {post.title}
        </h2>
        <p
          className="text-ink-3 text-base md:text-lg leading-[1.45] line-clamp-2 max-w-xl"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
        >
          {post.excerpt}
        </p>
        {post.author && (
          <p className="text-[13px] text-ink-4 mt-4">{post.author.name}</p>
        )}
      </Reveal>
    </Link>
  )
}

function CategoryPill({ slug, name, color, active }: { slug: string | null; name: string; color?: string | undefined; active: boolean }) {
  const params = new URLSearchParams()
  if (slug) params.set('category', slug)
  const accent = categoryAccent(slug ?? undefined, color)

  return (
    <Link
      to={slug ? `/notebook?${params.toString()}` : '/notebook'}
      // Faceted `?category=` views are noindex,follow and canonical to bare
      // /notebook. nofollow the filter link so Google stops queuing the param
      // URL for crawl (it kept tripping the "Excluded by noindex" validation).
      // The "All" link (bare /notebook) stays crawlable.
      rel={slug ? 'nofollow' : undefined}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors press ${
        active
          ? 'bg-ink text-white'
          : slug
            ? accent.chip
            : 'bg-paper text-ink-2 border border-line hover:border-ink-3'
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
      // Category-filtered pagination is a faceted (noindex) view — nofollow so
      // Google doesn't queue `?category=…&page=N`. Clean `?page=N` stays crawlable.
      rel={category ? 'nofollow' : undefined}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors press ${
        active ? 'bg-ink text-white' : 'text-ink-3 hover:bg-paper-2'
      }`}
    >
      {label}
    </Link>
  )
}
