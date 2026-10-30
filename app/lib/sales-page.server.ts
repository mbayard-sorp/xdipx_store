/**
 * Sanity read for `salesPage` documents (app/lib/sales-page.ts has the types
 * and the normalizer). Published documents only, unless the request carries
 * the Sanity preview cookie. A page also needs `live: true` to render to the
 * public; preview shows it either way.
 *
 * Also imported by server/index.ts (compiled `.js` specifier) for the bridge
 * host gate, so it stays free of React imports.
 */

import { cached } from '~/lib/kv.server'
import { getClient } from '~/lib/sanity.server'
import { isValidSalesSlug, normalizeSalesPage, type SalesPage } from '~/lib/sales-page'

const IMG = `{ "url": asset->url, alt }`

const SALES_GROQ = `*[_type == "salesPage" && slug.current == $slug] | order(_updatedAt desc)[0]{
  "slug": slug.current,
  productHandle, live, buttonLabel, announcement, seoTitle,
  kicker, headline, subhead, heroPoints,
  "heroImage": heroImage${IMG},
  sections[]{
    _type, _key, kicker, heading, tone, paragraphs, items, steps, usLabel, themLabel, rows, body, caption,
    reviews[]{ quote, name },
    "image": image${IMG}
  },
  closer, closerLine
}`

/**
 * Fetch one sales page. `preview` reads the drafts perspective and skips the
 * cache; the public path caches for a minute (empties for 15 seconds so a
 * just-published page does not sit behind a stale 404).
 */
export async function getSalesPage(slug: string, preview = false): Promise<SalesPage | null> {
  if (!isValidSalesSlug(slug)) return null
  const run = async (): Promise<SalesPage | null> => {
    try {
      const client = getClient(false, preview)
      if (!client) return null
      return normalizeSalesPage(await client.fetch<Record<string, unknown> | null>(SALES_GROQ, { slug }))
    } catch (err) {
      console.error('[sales-page] getSalesPage error:', err)
      return null
    }
  }
  if (preview) return run()
  return cached(`sanity:sales-page:${slug}`, 60, run, 15)
}
