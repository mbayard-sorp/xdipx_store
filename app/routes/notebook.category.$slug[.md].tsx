/**
 * /notebook/category/:slug.md — Markdown twin for notebook category archives.
 * Cache-Control: 1h (a category changes whenever a post publishes into it).
 */

import type { LoaderFunctionArgs } from 'react-router'
import { getBlogPosts, getBlogCategories } from '~/lib/sanity.server'
import { notebookCategoryToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'
import type { BlogCategory } from '~/types/cms'

const BASE_URL = 'https://xdipx.com'

// Same ceiling as the notebook hub twin: covers the whole archive for the
// foreseeable future; the serializer notes the total if we outgrow it.
const MAX_POSTS = 100

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params['slug']!
  const cacheKey = `md:notebook-category:${slug}`
  const TTL = 3600 // 1 hour

  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[md:notebook/category/${slug}] ${name} failed:`, err)
      return fallback
    })

  const body = await cached(cacheKey, TTL, async () => {
    const categories = await guard(getBlogCategories(), [], 'getBlogCategories')
    const category = categories.find((c: BlogCategory) => c.slug === slug)
    if (!category) return null

    const { posts, total } = await guard(
      getBlogPosts({ page: 1, perPage: MAX_POSTS, category: slug }),
      { posts: [], total: 0 },
      'getBlogPosts',
    )

    return notebookCategoryToMarkdown({
      slug: category.slug,
      name: category.name,
      description: category.description,
      posts: posts.map(p => ({
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        publishedAt: p.publishedAt,
      })),
      total,
    })
  })

  if (body === null) {
    return new Response('Category not found', { status: 404 })
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/notebook/category/${slug}>; rel="canonical"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
