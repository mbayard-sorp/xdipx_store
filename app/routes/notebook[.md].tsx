/**
 * /notebook.md — Markdown twin for the notebook hub: all posts with links,
 * plus the category list. Individual posts have their own twins at
 * /notebook/{slug}.md.
 * Cache-Control: 1h (the hub changes whenever a post publishes).
 */

import { getBlogPosts, getBlogCategories } from '~/lib/sanity.server'
import { notebookHubToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

// High enough to cover the whole archive for the foreseeable future; the
// serializer notes the total and links the paginated hub if we outgrow it.
const MAX_POSTS = 100

export async function loader() {
  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[md:notebook] ${name} failed:`, err)
      return fallback
    })

  const body = await cached('md:notebook-hub', 3600, async () => {
    const [{ posts, total }, categories] = await Promise.all([
      guard(getBlogPosts({ page: 1, perPage: MAX_POSTS }), { posts: [], total: 0 }, 'getBlogPosts'),
      guard(getBlogCategories(), [], 'getBlogCategories'),
    ])

    return notebookHubToMarkdown({
      posts: posts.map(p => ({
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        publishedAt: p.publishedAt,
        category: p.category ? { name: p.category.name } : undefined,
      })),
      total,
      categories: categories.map(c => ({
        slug: c.slug,
        name: c.name,
        description: c.description,
      })),
    })
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/notebook>; rel="canonical"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
