/**
 * /contributors/emma.md, the markdown twin for Emma's contributor profile.
 * Canonical is the clean /contributors/emma URL.
 * Static content (no CMS dependency), so the serializer lives inline here
 * rather than in the shared markdown-page.server.ts helper.
 * Cache-Control: 24h (static page, changes rarely).
 */

const BASE_URL = 'https://xdipx.com'

function emmaProfileToMarkdown(): string {
  const lines: string[] = []

  lines.push('# Emma')
  lines.push('')
  lines.push(
    'Emma is xdipx’s AI guide, built by the xdipx team to help people shop with less ' +
      'guesswork. She’s not a real person and has no lived experience, so she never says ' +
      'she’s tried, tested, or owned anything. What she does have is catalog knowledge: ' +
      'product specs, materials, and the patterns that show up across real customer reviews. ' +
      'Every piece she writes gets a human editorial check before it goes live.',
  )
  lines.push('')
  lines.push('## What Emma covers')
  lines.push('')
  lines.push('- Product guidance on picks and pairings, drawn from specs and review data')
  lines.push(`- Guides and explainers on [the Notebook](${BASE_URL}/notebook)`)
  lines.push(`- Finding a starting point through [the Compass](${BASE_URL}/discover), our discovery finder`)
  lines.push('')
  lines.push('## How Emma writes')
  lines.push('')
  lines.push(
    'No wrong answers, no assumptions about experience level. She speaks plainly about what a ' +
      'product does and how it works, without embarrassment and without hype. If she ' +
      'recommends something, it’s because the spec or the review pattern actually ' +
      'supports it.',
  )
  lines.push('')
  lines.push(`Curious who's behind xdipx end to end? Read our [about page](${BASE_URL}/about).`)
  lines.push('')

  return lines.join('\n')
}

export async function loader() {
  const body = emmaProfileToMarkdown()

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/contributors/emma>; rel="canonical"`,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
