import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { data } from 'react-router'
import { getBlogPosts, getBlogCategories } from '~/lib/sanity.server'
import { BlogPostCard } from '~/components/blog/BlogPostCard'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { canonicalUrl } from '~/lib/seo'
import { buildSocialMeta } from '~/lib/social-meta'
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
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  // Page > 1 is its own document — self-canonical at ?page=N. Page 1 canonicals
  // to the bare slug URL.
  const basePath = `/notebook/category/${slug}`
  const canonical =
    page > 1
      ? canonicalUrl({
          path: basePath,
          searchParams: new URLSearchParams({ page: String(page) }),
          allowedParams: ['page'],
        })
      : canonicalUrl({ path: basePath })

  return { category, posts, total, page, perPage, totalPages, canonical }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: 'Category not found — xdipx' }]
  const { category, page, totalPages, canonical } = loaderData
  const baseTitle = category.seoTitle ?? `${category.name} — The Notebook`
  const pageSuffix = page > 1 ? ` — Page ${page}` : ''
  const title = `${baseTitle}${pageSuffix} | xdipx`
  const description = category.seoDescription ?? category.description ?? `Read ${category.name.toLowerCase()} posts in the xdipx Notebook.`

  // Posts are ordered publishedAt desc — the first post on page 1 is the
  // category's most recent, used as the social share image since categories
  // have no image of their own.
  const featuredImage = loaderData.posts[0]?.heroImageUrl ?? null
  const featuredImageAlt = loaderData.posts[0]?.heroImageAlt

  const tags: ReturnType<MetaFunction> = [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `https://xdipx.com/notebook/category/${category.slug}.md` },
    ...buildSocialMeta({
      title,
      description,
      url: canonical,
      image: featuredImage,
      type: 'website',
      ...(featuredImageAlt ? { imageAlt: featuredImageAlt } : {}),
    }),
  ]

  // rel=prev/next for paginated category archives — helps Google understand
  // the sequence even with self-canonical paginated docs.
  const basePath = `https://xdipx.com/notebook/category/${category.slug}`
  if (page > 1) {
    const prevHref = page - 1 === 1 ? basePath : `${basePath}?page=${page - 1}`
    tags.push({ tagName: 'link', rel: 'prev', href: prevHref })
  }
  if (page < totalPages) {
    tags.push({ tagName: 'link', rel: 'next', href: `${basePath}?page=${page + 1}` })
  }

  return tags
}

export default function NotebookCategoryPage() {
  const { category, posts, total, page, perPage } = useLoaderData<typeof loader>()
  const totalPages = Math.ceil(total / perPage)

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Notebook', href: '/notebook' },
    { label: category.name },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Notebook', url: 'https://xdipx.com/notebook' },
    { name: category.name, url: `https://xdipx.com/notebook/category/${category.slug}` },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      <BreadcrumbNav items={breadcrumbs} />

      <div className="mt-6 mb-8 pb-6 border-b border-line">
        <p className="text-xs font-mono text-muted uppercase tracking-wider mb-2">Notebook · Category</p>
        <h1
          className="text-ink text-3xl sm:text-5xl leading-none"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
        >
          {category.name}
        </h1>
        {category.description && (
          <p className="text-ink/70 text-base mt-3 max-w-2xl">{category.description}</p>
        )}
      </div>

      {posts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
          {posts.map(post => (
            <BlogPostCard key={post._id} post={post} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-ink/50">
          <p className="text-lg">No posts in this category yet ♥</p>
          <Link to="/notebook" className="text-coral hover:underline mt-2 inline-block font-mono text-xs uppercase tracking-wider">
            ← Back to the notebook
          </Link>
        </div>
      )}

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
  const href = page > 1 ? `/notebook/category/${slug}?page=${page}` : `/notebook/category/${slug}`

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
