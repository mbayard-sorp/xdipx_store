import { buildSitemapSegments } from '~/lib/sitemap.server'
import { SITEMAP_CACHE_CONTROL, renderSitemapIndex } from '~/lib/sitemap-xml'

/**
 * Sitemap index. The URL sets themselves live at /sitemaps/{name}.xml — see
 * app/lib/sitemap.server.ts for why this is split and what corrections are
 * applied to the URL set.
 */
export async function loader() {
  const segments = await buildSitemapSegments()

  return new Response(renderSitemapIndex(segments), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': SITEMAP_CACHE_CONTROL,
    },
  })
}
