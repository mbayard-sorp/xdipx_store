import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { data } from 'react-router'
import { getBlogPosts, getBlogCategories } from '~/lib/sanity.server'
import { BlogPostCard } from '~/components/blog/BlogPostCard'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import type { BlogCategory } from '~/types/cms'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const perPage = 12

  const categories = await getBlogCategories()
  const category = categories.find((c: BlogCategory) => c.slug === slug)
  if (!category) throw data('Category not found', { status: 404 })

  const { posts, total } = await getBlogPosts({ page, perPage, category: slug })

  return { category, posts, total, page, perPage }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Category not found — xdipx' }]
  const { category } = data
  const title = (category.seoTitle ?? `${category.name} Articles`) + ' — xdipx Blog'
  const description = category.seoDescription ?? category.description ?? `Read ${category.name.toLowerCase()} articles on the xdipx blog.`
  const canonical = `https://xdipx.com/blog/category/${category.slug}`

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { property: 'og:title', content: title },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: canonical },
  ]
}

export default function BlogCategoryPage() {
  const { category, posts, total, page, perPage } = useLoaderData<typeof loader>()
  const totalPages = Math.ceil(total / perPage)

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Blog', href: '/blog' },
    { label: category.name },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Blog', url: 'https://xdipx.com/blog' },
    { name: category.name, url: `https://xdipx.com/blog/category/${category.slug}` },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:py-12">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      <BreadcrumbNav items={breadcrumbs} />

      <div className="mt-6 mb-10">
        <h1 className="font-display font-bold text-3xl sm:text-4xl text-brand-charcoal mb-2">
          {category.name}
        </h1>
        {category.description && (
          <p className="text-brand-charcoal/60 max-w-2xl">{category.description}</p>
        )}
      </div>

      {posts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
          {posts.map(post => (
            <BlogPostCard key={post._id} post={post} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-brand-charcoal/50">
          <p className="text-lg">No posts in this category yet ♥</p>
          <Link to="/blog" className="text-brand-purple hover:underline mt-2 inline-block">
            ← Back to all posts
          </Link>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          {page > 1 && (
            <PaginationLink slug={category.slug} page={page - 1} label="← Previous" />
          )}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <PaginationLink key={p} slug={category.slug} page={p} label={String(p)} active={p === page} />
          ))}
          {page < totalPages && (
            <PaginationLink slug={category.slug} page={page + 1} label="Next →" />
          )}
        </div>
      )}
    </div>
  )
}

function PaginationLink({ slug, page, label, active }: { slug: string; page: number; label: string; active?: boolean }) {
  const href = page > 1
    ? `/blog/category/${slug}?page=${page}`
    : `/blog/category/${slug}`

  return (
    <Link
      to={href}
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
