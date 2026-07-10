/**
 * search-ping.server.ts
 *
 * Best-effort, non-blocking search-engine discovery pings fired after the deal
 * rotation publishes new URLs, so Bing / Yandex (via IndexNow) re-crawl the
 * homepage and the freshly-activated product fast.
 *
 * Google is intentionally NOT pinged: its standalone sitemap-ping endpoint was
 * deprecated in 2023. Google discovery is driven by the updated `lastmod` we
 * already emit in [sitemap.xml].tsx plus normal crawl scheduling.
 *
 * Inert unless SEARCH_PING_ENABLED === 'true'. Never throws — discovery pings
 * must never be able to fail a deal rotation.
 */
const SITE_ORIGIN = 'https://xdipx.com'

export async function pingSearchEngines(paths: string[]): Promise<void> {
  if (process.env['SEARCH_PING_ENABLED'] !== 'true') return

  const urlList = [...new Set(paths)]
    .filter(Boolean)
    .map(p => (p.startsWith('http') ? p : `${SITE_ORIGIN}${p.startsWith('/') ? p : `/${p}`}`))
  if (urlList.length === 0) return

  const key = process.env['INDEXNOW_API_KEY']
  if (!key) {
    console.warn('[search-ping] SEARCH_PING_ENABLED set but INDEXNOW_API_KEY missing — skipping')
    return
  }

  try {
    const host = new URL(SITE_ORIGIN).host
    const res = await fetch('https://api.indexnow.org/IndexNow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${SITE_ORIGIN}/indexnow.txt`,
        urlList,
      }),
    })
    console.log(`[search-ping] IndexNow ${res.status} for ${urlList.length} url(s)`)
  } catch (err) {
    console.error('[search-ping] IndexNow ping failed (non-blocking):', err)
  }
}
