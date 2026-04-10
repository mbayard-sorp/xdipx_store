import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { getBlogPosts, getBlogCategories, getBlogHomepage, isPreviewRequest } from '~/lib/sanity.server'
import { BlogPostCard } from '~/components/blog/BlogPostCard'
import type { BlogPostCard as BlogPostCardType, BlogCategory } from '~/types/cms'

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

  // Pull featured post for hero (first featured on page 1, or first post)
  let featuredPost: BlogPostCardType | null = null
  let gridPosts = posts
  if (page === 1 && !category) {
    featuredPost = posts.find(p => p.featured) ?? posts[0] ?? null
    if (featuredPost) gridPosts = posts.filter(p => p._id !== featuredPost!._id)
  }

  return { posts: gridPosts, featuredPost, total, page, perPage: 12, categories, selectedCategory: category, blogHomepage }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const base = data?.selectedCategory
    ? `${data.selectedCategory.charAt(0).toUpperCase() + data.selectedCategory.slice(1)} Articles`
    : 'Blog'
  const description = data?.blogHomepage?.subtext ?? 'Guides, tips, and stories about intimate wellness. Playful, honest, judgment-free.'
  return [
    { title: `${base} — xdipx` },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/blog' },
    { property: 'og:title', content: `${base} — xdipx` },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: 'https://xdipx.com/blog' },
  ]
}

export default function BlogIndex() {
  const { posts, featuredPost, total, page, perPage, categories, selectedCategory, blogHomepage } = useLoaderData<typeof loader>()
  const totalPages = Math.ceil(total / perPage)
  const heading = blogHomepage?.heading || 'The xdipx Blog'

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:py-12">
      {/* CMS hero section */}
      {blogHomepage?.heroImageUrl ? (
        <div className="relative rounded-2xl overflow-hidden mb-10">
          <img
            src={blogHomepage.heroImageUrl}
            alt={blogHomepage.heroImageAlt ?? heading}
            className="w-full aspect-[21/9] sm:aspect-[3/1] object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-charcoal/80 via-brand-charcoal/20 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8">
            <h1 className="font-display font-bold text-3xl sm:text-4xl text-white mb-2">
              {heading}
            </h1>
            {blogHomepage.subtext && (
              <p className="text-white/80 text-sm sm:text-base max-w-xl">{blogHomepage.subtext}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-8">
          <h1 className="font-display font-bold text-3xl sm:text-4xl text-brand-charcoal">
            {heading}
          </h1>
          {blogHomepage?.subtext && (
            <p className="text-brand-charcoal/60 mt-2 max-w-xl">{blogHomepage.subtext}</p>
          )}
        </div>
      )}

      {/* Featured post hero */}
      {featuredPost && <FeaturedHero post={featuredPost} />}

      {/* Category filter pills */}
      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-8 scrollbar-hide">
          <CategoryPill slug={null} name="All" active={!selectedCategory} />
          {categories.map((cat: BlogCategory) => (
            <CategoryPill
              key={cat.slug}
              slug={cat.slug}
              name={cat.name}
              active={selectedCategory === cat.slug}
            />
          ))}
        </div>
      )}

      {/* Post grid */}
      {posts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
          {posts.map(post => (
            <BlogPostCard key={post._id} post={post} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-brand-charcoal/50">
          <p className="text-lg">No posts yet — check back soon ♥</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          {page > 1 && (
            <PaginationLink
              page={page - 1}
              category={selectedCategory}
              label="← Previous"
            />
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
            <PaginationLink
              page={page + 1}
              category={selectedCategory}
              label="Next →"
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────

function FeaturedHero({ post }: { post: BlogPostCardType }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group block relative rounded-2xl overflow-hidden mb-10"
    >
      {post.heroImageUrl ? (
        <img
          src={post.heroImageUrl}
          alt={post.heroImageAlt ?? post.title}
          className="w-full aspect-[21/9] sm:aspect-[3/1] object-cover group-hover:scale-[1.02] transition-transform duration-500"
        />
      ) : (
        <div className="w-full aspect-[21/9] sm:aspect-[3/1] bg-brand-mist" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-brand-charcoal/80 via-brand-charcoal/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8">
        {post.category && (
          <span className="inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full bg-brand-purple text-white mb-2">
            {post.category.name}
          </span>
        )}
        <h2 className="font-display font-bold text-xl sm:text-3xl text-white mb-2 line-clamp-2">
          {post.title}
        </h2>
        <p className="text-white/70 text-sm line-clamp-2 max-w-xl">{post.excerpt}</p>
      </div>
    </Link>
  )
}

function CategoryPill({ slug, name, active }: { slug: string | null; name: string; active: boolean }) {
  const params = new URLSearchParams()
  if (slug) params.set('category', slug)

  return (
    <Link
      to={slug ? `/blog?${params.toString()}` : '/blog'}
      className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active
          ? 'bg-brand-purple text-white'
          : 'bg-brand-mist text-brand-charcoal/70 hover:bg-brand-purple/10'
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
      to={search ? `/blog?${search}` : '/blog'}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-brand-purple text-white'
          : 'text-brand-charcoal/60 hover:bg-brand-mist'
      }`}
    >
      {label}
    </Link>
  )
}
