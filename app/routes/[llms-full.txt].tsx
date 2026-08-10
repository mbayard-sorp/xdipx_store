/**
 * /llms-full.txt, the full-content companion to the curated /llms.txt.
 *
 * Where /llms.txt is a curated navigational index (H2 link lists of markdown
 * twins), llms-full.txt inlines the actual answer-layer content in one file so
 * an LLM can ingest the whole editorial corpus in a single fetch: the FAQ, the
 * About page, and every published Notebook post, each serialized by the same
 * markdown functions that back their .md twins. The catalog (products,
 * collections) stays a complete link index. Inlining every PDP body would
 * balloon the file, and each product's full text already lives at
 * /products/{handle}.md, linked here.
 *
 * All sources are guarded individually so one upstream failure omits its
 * section rather than 500-ing the whole file. Bounded: at most MAX_INLINE
 * Notebook posts are inlined, with a note when more exist, so the file cannot
 * grow without limit as the corpus does.
 *
 * Cache-Control: 1h (matches /llms.txt).
 */

import {
  getBlogPosts,
  getBlogPost,
  getPage,
  getProductHandlesForSitemap,
} from '~/lib/sanity.server'
import { getCollectionsForSitemap } from '~/lib/shopify.server'
import {
  blogPostToMarkdown,
  pageToMarkdown,
  faqToMarkdown,
} from '~/lib/markdown-page.server'
import { FAQ_SECTIONS } from '~/lib/faq-content'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

// Upper bound on inlined long-form documents, so the file stays a reasonable
// size as the corpus grows. When exceeded, the newest are inlined and a note
// points to /notebook.md for the complete link index.
const MAX_INLINE = 50

// Handles that duplicate clean-URL routes or back a retired gendered route.
const COLLECTION_DENYLIST = new Set(['frontpage', 'vault', 'for-him', 'for-her'])

function humanizeHandle(handle: string): string {
  return handle
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export async function loader() {
  const body = await cached('llms-full-txt', 3600, async () => {
    const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
      p.catch(err => {
        console.error(`[llms-full.txt] ${name} failed:`, err)
        return fallback
      })

    const [postList, aboutPage, products, collections] = await Promise.all([
      guard(getBlogPosts({ perPage: MAX_INLINE }), { posts: [], total: 0 }, 'getBlogPosts'),
      guard(getPage('about'), null, 'getPage(about)'),
      guard(getProductHandlesForSitemap(), [], 'getProductHandlesForSitemap'),
      guard(getCollectionsForSitemap(), [], 'getCollectionsForSitemap'),
    ])

    // Fetch the full body for each inlined post in parallel.
    const posts = (
      await Promise.all(
        postList.posts.map(p => guard(getBlogPost(p.slug), null, `getBlogPost(${p.slug})`)),
      )
    ).filter((p): p is NonNullable<typeof p> => Boolean(p))

    const lines: string[] = []

    // ── Header ────────────────────────────────────────────────────────────────
    lines.push('# xdipx.com (full content)')
    lines.push('')
    lines.push(
      '> xdipx is an editorially curated storefront for adult wellness and intimacy products. ' +
      'Emma, our guide, features hand-picked products and advises on how each one works and who it suits. ' +
      'Discreet shipping and billing throughout the United States.',
    )
    lines.push('')
    lines.push(
      'This is the full-content companion to https://xdipx.com/llms.txt. ' +
      'It inlines the complete text of the FAQ, the About page, and every published Notebook post, ' +
      'followed by a complete link index of the product catalog and collections. ' +
      'For a shorter curated index of links only, use /llms.txt.',
    )
    lines.push('')
    lines.push(
      'Pronounced "ex-dip-ex" (three syllables). Credit-card billing descriptor: XDIPX. ' +
      'Support: hello@xdipx.com. Emma is an AI guide who advises from catalog knowledge; ' +
      'she never claims to have used or owned a product.',
    )
    lines.push('')
    lines.push('---')
    lines.push('')

    // ── FAQ (inline) ──────────────────────────────────────────────────────────
    lines.push(faqToMarkdown(FAQ_SECTIONS))
    lines.push('')

    // ── About (inline) ────────────────────────────────────────────────────────
    if (aboutPage) {
      lines.push(
        pageToMarkdown({
          slug: 'about',
          title: aboutPage.title,
          sections: aboutPage.sections ?? undefined,
          description: aboutPage.seoDescription ?? undefined,
          canonicalPath: '/about',
        }),
      )
      lines.push('')
    }

    // ── Notebook posts (inline, full body) ────────────────────────────────────
    if (posts.length > 0) {
      lines.push('# Notebook')
      lines.push('')
      for (const post of posts) {
        lines.push(
          blogPostToMarkdown({
            slug: post.slug,
            title: post.title,
            excerpt: post.excerpt ?? undefined,
            body: post.body ?? undefined,
            publishedAt: post.publishedAt ?? undefined,
            author: post.author ? { name: post.author.name ?? null } : undefined,
            category: post.category ? { name: post.category.name ?? null } : undefined,
          }),
        )
        lines.push('')
      }
      if (postList.total > posts.length) {
        lines.push(
          `Showing the ${posts.length} most recent of ${postList.total} Notebook posts. ` +
          `Full index of all posts: ${BASE_URL}/notebook.md`,
        )
        lines.push('')
      }
    }

    // ── Product catalog (complete link index) ─────────────────────────────────
    // The catalog is linked, not inlined: each product's full text is one fetch
    // away at /products/{handle}.md, and inlining every PDP would bloat the file.
    if (products.length > 0) {
      lines.push('# Product catalog')
      lines.push('')
      lines.push(
        'Every product below links to its full markdown page. ' +
        'Canonical product URLs follow ' + `${BASE_URL}/products/{handle}.`,
      )
      lines.push('')
      for (const p of products) {
        const name = (p.title ?? humanizeHandle(p.handle)).replace(/[[\]]/g, '')
        lines.push(`- [${name}](${BASE_URL}/products/${p.handle}.md)`)
      }
      lines.push('')
    }

    // ── Collections (link index) ──────────────────────────────────────────────
    const filteredCollections = collections.filter(c => !COLLECTION_DENYLIST.has(c.handle))
    if (filteredCollections.length > 0) {
      lines.push('# Collections')
      lines.push('')
      lines.push(`- [Collections index](${BASE_URL}/collections.md): all collections`)
      for (const c of filteredCollections) {
        lines.push(`- [${humanizeHandle(c.handle)}](${BASE_URL}/collections/${c.handle}.md)`)
      }
      lines.push('')
    }

    lines.push('---')
    lines.push(
      'xdipx.com is an editorially curated sexual wellness storefront. ' +
      'Support: hello@xdipx.com. Billing descriptor: XDIPX.',
    )
    lines.push('')

    return lines.join('\n')
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
