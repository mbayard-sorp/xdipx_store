/**
 * /notebook/glossary.md — Markdown twin for the glossary: every term with its
 * plain-language definition and store links. The glossary is the Notebook's
 * most liftable answer surface, so the twin matters as much as the HTML page.
 * Cache-Control: 24h (terms change rarely).
 */

import { getGlossaryTerms } from '~/lib/sanity.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

export async function loader() {
  const body = await cached('md:notebook-glossary', 86400, async () => {
    const terms = await getGlossaryTerms().catch(err => {
      console.error('[md:notebook-glossary] getGlossaryTerms failed:', err)
      return []
    })

    const lines: string[] = [
      '# The xdipx Notebook Glossary',
      '',
      'Plain-language definitions for the words you meet while shopping for sexual wellness. What things do, how they differ, and what to look for.',
      '',
    ]

    for (const t of terms) {
      lines.push(`## ${t.term}`)
      lines.push('')
      lines.push(t.definition)
      const links: string[] = []
      if (t.collectionHandle) links.push(`[Shop the collection](${BASE_URL}/collections/${t.collectionHandle})`)
      if (t.relatedPost) links.push(`[Read: ${t.relatedPost.title}](${BASE_URL}/notebook/${t.relatedPost.slug})`)
      if (links.length) {
        lines.push('')
        lines.push(links.join(' · '))
      }
      lines.push('')
    }

    if (terms.length === 0) {
      lines.push('The first definitions are on their way.')
      lines.push('')
    }

    lines.push('---')
    lines.push('')
    lines.push(`Canonical: ${BASE_URL}/notebook/glossary`)
    lines.push('')

    return lines.join('\n')
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/notebook/glossary>; rel="canonical"`,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
