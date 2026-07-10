/**
 * POST /api/revalidate/blog  { slug: string }
 *
 * Team-token endpoint the content routine calls right after publishing a
 * blogPost so the new post is readable without waiting out the caches:
 * clears the in-memory blog cache (60s TTL, app/lib/sanity.server.ts) and
 * the post's markdown-twin cache entry (24h TTL, `md:notebook:{slug}`).
 * CDN s-maxage on the hub bounds any remaining lag at ~5 minutes.
 *
 * Also fires a best-effort IndexNow ping (app/lib/search-ping.server.ts) for
 * the post, its .md twin, and the /notebook hub, since this endpoint is the
 * one reliable signal every automated blog publish already calls through.
 * Inert unless SEARCH_PING_ENABLED === 'true'; never blocks the response.
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { invalidateBlogCache } from '~/lib/sanity.server'
import { invalidateCache, kvDel } from '~/lib/kv.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let slug = ''
  try {
    const body = (await request.json()) as { slug?: unknown }
    if (typeof body.slug === 'string') slug = body.slug.trim()
  } catch {
    // fall through to the validation error below
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return Response.json({ ok: false, error: 'bad slug' }, { status: 400 })
  }

  invalidateBlogCache()
  const mdKey = `md:notebook:${slug}`
  invalidateCache(mdKey)
  await kvDel(mdKey)

  try {
    const { pingSearchEngines } = await import('~/lib/search-ping.server')
    await pingSearchEngines([`/notebook/${slug}`, `/notebook/${slug}.md`, '/notebook'])
  } catch (err) {
    console.error('[revalidate-blog] search ping failed (non-blocking):', err)
  }

  return Response.json({ ok: true, slug })
}
