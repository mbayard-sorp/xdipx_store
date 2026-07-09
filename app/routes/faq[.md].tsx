/**
 * /faq.md — Markdown twin for the FAQ page.
 * Content is the same static FAQ_SECTIONS the HTML page renders, so no
 * upstream fetch or KV cache is needed.
 */

import { FAQ_SECTIONS } from '~/lib/faq-content'
import { faqToMarkdown } from '~/lib/markdown-page.server'

const BASE_URL = 'https://xdipx.com'

export async function loader() {
  return new Response(faqToMarkdown(FAQ_SECTIONS), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/faq>; rel="canonical"`,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
