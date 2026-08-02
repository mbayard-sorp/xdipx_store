// Note: /search is intentionally crawl-allowed — the page emits
// `<meta name="robots" content="noindex, follow">`. Disallowing it in
// robots.txt would prevent Google from fetching the page and seeing the
// noindex directive, leaving any historically-indexed /search?q=… URLs
// stuck in SERPs as "URL blocked" stubs. Crawl + noindex is the
// recommended pattern for site-search results.

// Shared by every user-agent block below. Keep it that way: a rule added to
// one block and not the others silently applies to some crawlers only.
//
// /__manifest is React Router's route-discovery endpoint. It returns JSON
// route metadata with nothing indexable in it, and it was taking 24.42% of
// this site's crawl requests (GSC crawl stats, 2026-05-10..2026-07-29). The
// client no longer calls it (routeDiscovery is `initial` in
// react-router.config.ts), but the server still answers it and Googlebot
// still has ~1,767 of these URLs queued, so it needs the robots.txt rule too.
const DISALLOW = [
  'Disallow: /admin',
  'Disallow: /account',
  'Disallow: /api/',
  'Disallow: /cron/',
  'Disallow: /mcp/',
  'Disallow: /*.data',
  'Disallow: /__manifest',
]

const GENERIC_BLOCKS = ['User-agent: *', 'Allow: /', ...DISALLOW, '']

const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'Amazonbot',
  'MistralAI-User',
  'cohere-ai',
  'FacebookBot',
  'Meta-ExternalAgent',
  'Meta-ExternalFetcher',
]

export async function loader() {
  const aiBlocks = AI_CRAWLERS.flatMap(ua => [
    `User-agent: ${ua}`,
    'Allow: /',
    ...DISALLOW,
    '',
  ])

  const body = [
    ...GENERIC_BLOCKS,
    ...aiBlocks,
    'Sitemap: https://xdipx.com/sitemap.xml',
  ].join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
