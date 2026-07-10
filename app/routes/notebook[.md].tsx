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

// Static FAQ about the Notebook itself. Emma voice, no lived experience,
// no em-dashes. Reviewed alongside site copy.
const NOTEBOOK_FAQS: Array<{ question: string; answer: string }> = [
  {
    question: 'What is the Notebook?',
    answer:
      'The Notebook is xdipx\'s editorial section, guides, comparisons, and care basics written to answer real questions before you shop, not to sell a specific product.',
  },
  {
    question: 'How often is it updated?',
    answer:
      'New posts land on a regular schedule, not a countdown. Check back or browse by category for the latest.',
  },
  {
    question: 'Who writes the Notebook?',
    answer:
      'Emma, xdipx\'s AI guide, drafts every post from catalog knowledge, specs, materials, and review patterns, with human review before anything publishes.',
  },
  {
    question: 'Does the Notebook recommend products?',
    answer:
      'Only when a product genuinely fits the answer, and only in-stock items. Each mention links to that product\'s own page, where price and availability live.',
  },
]

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
      faqs: NOTEBOOK_FAQS,
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
