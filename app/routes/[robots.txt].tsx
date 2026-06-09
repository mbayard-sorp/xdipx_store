// Note: /search is intentionally crawl-allowed — the page emits
// `<meta name="robots" content="noindex, follow">`. Disallowing it in
// robots.txt would prevent Google from fetching the page and seeing the
// noindex directive, leaving any historically-indexed /search?q=… URLs
// stuck in SERPs as "URL blocked" stubs. Crawl + noindex is the
// recommended pattern for site-search results.
const GENERIC_BLOCKS = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin',
  'Disallow: /account',
  'Disallow: /api/',
  'Disallow: /cron/',
  'Disallow: /mcp/',
  'Disallow: /*.data',
  '',
]

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
    'Disallow: /admin',
    'Disallow: /account',
    'Disallow: /api/',
    'Disallow: /cron/',
    'Disallow: /mcp/',
    'Disallow: /*.data',
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
