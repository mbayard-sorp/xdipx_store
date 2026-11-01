/**
 * POST /api/revalidate/compare  { slug: string }
 *
 * Team-token endpoint the content routine calls right after publishing a
 * `comparison` doc (ticket #19398). `/api/revalidate/blog` is blogPost-only:
 * it clears `_blogCache` and `md:notebook:{slug}`, then pings `/notebook/*`
 * paths. None of that reaches a comparison doc — it reads through
 * `cached('comparison:{slug}', ...)` / `cached('comparison:list', ...)` in
 * `app/lib/sanity.server.ts` and its markdown twin caches under
 * `md:compare:{slug}` (`compare.$slug[.md].tsx`), entirely different cache
 * entries `invalidateBlogCache()` cannot touch. Calling `/api/revalidate/blog`
 * for a comparison slug is worse than not calling it: it flushes a cache
 * nothing reads and pings three `/notebook` URLs that do not exist for that
 * slug.
 *
 * Busts both `cached()` layers (in-memory L1 + KV L2 — `invalidateCache` only
 * clears L1, so each key also gets an explicit `kvDel`) for the three keys a
 * comparison publish can be stale in, then fires a best-effort IndexNow ping
 * for the comparison page, its `.md` twin, and the `/compare` index. Inert
 * unless `SEARCH_PING_ENABLED === 'true'`; never blocks the response.
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
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

  for (const key of [`comparison:${slug}`, 'comparison:list', `md:compare:${slug}`]) {
    invalidateCache(key)
    await kvDel(key)
  }

  try {
    const { pingSearchEngines } = await import('~/lib/search-ping.server')
    await pingSearchEngines([`/compare/${slug}`, `/compare/${slug}.md`, '/compare'])
  } catch (err) {
    console.error('[revalidate-compare] search ping failed (non-blocking):', err)
  }

  return Response.json({ ok: true, slug })
}
