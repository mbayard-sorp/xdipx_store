const GENERIC_BLOCKS = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin',
  'Disallow: /account',
  'Disallow: /api/',
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
