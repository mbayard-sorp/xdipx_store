import type { LoaderFunctionArgs } from 'react-router'
import { buildSitemapSegments } from '~/lib/sitemap.server'
import { SITEMAP_CACHE_CONTROL, renderUrlset } from '~/lib/sitemap-xml'

/**
 * One sitemap segment, e.g. /sitemaps/products-1.xml. The `.xml` suffix is
 * part of the dynamic param (React Router only allows a dynamic segment to
 * span a whole path segment), so we strip it before matching a segment name.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const name = (params['file'] ?? '').replace(/\.xml$/, '')
  const segments = await buildSitemapSegments()
  const segment = segments.find(s => s.name === name)

  // A 404 here is correct and self-correcting: the index only ever links
  // segments that exist, so a miss means a stale crawler URL, not a bug.
  if (!segment) return new Response('Not found', { status: 404 })

  return new Response(renderUrlset(segment.urls), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': SITEMAP_CACHE_CONTROL,
    },
  })
}
