/**
 * /notebook/:slug.md — Markdown twin for blog posts.
 * Cache-Control: 24h (blog posts rarely change after publish).
 */

import type { LoaderFunctionArgs } from 'react-router'
import { getBlogPost } from '~/lib/sanity.server'
import { blogPostToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params['slug']!
  const cacheKey = `md:notebook:${slug}`
  const TTL = 86400 // 24 hours

  const body = await cached(cacheKey, TTL, async () => {
    let post: Awaited<ReturnType<typeof getBlogPost>> = null
    try {
      post = await getBlogPost(slug)
    } catch (err) {
      console.error(`[md:notebook/${slug}] getBlogPost failed:`, err)
      return null
    }

    if (!post) return null

    return blogPostToMarkdown({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt ?? undefined,
      body: post.body ?? undefined,
      publishedAt: post.publishedAt ?? undefined,
      author: post.author ? { name: post.author.name ?? null } : undefined,
      category: post.category ? { name: post.category.name ?? null } : undefined,
    })
  })

  if (body === null) {
    return new Response('Post not found', { status: 404 })
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/notebook/${slug}>; rel="canonical"`,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
