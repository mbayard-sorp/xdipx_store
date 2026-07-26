import { buildSitemapSegments } from '~/lib/sitemap.server'
import { renderSitemapIndex } from '~/lib/sitemap-xml'

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
      // 10 min so a midnight deal rotation's new `lastmod` surfaces to crawlers
      // promptly (was 1h, which could delay discovery of the rotated deal).
      'Cache-Control': 'public, max-age=600',
    },
  })
}
