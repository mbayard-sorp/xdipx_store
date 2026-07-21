/**
 * Sweep all products' Emma-voice fields for lived-experience phrasing that
 * violates the Emma-is-AI rule in docs/emma-voice.md (Emma never claims to
 * have tried, tested, owned, or kept a product).
 *
 * Scans body_html (Emma's take) plus the xdipx metafields: tagline,
 * full_story, seo_meta_description, emma_hero, pairing_why, feature_bullets.
 *
 * Usage: npx tsx scripts/sweep-lived-experience.ts [--json out.json]
 */
import { writeFileSync } from 'node:fs'
import { adminGraphQL } from '~/lib/shopify.server'

const SCAN_KEYS = ['tagline', 'full_story', 'seo_meta_description', 'emma_hero', 'pairing_why', 'feature_bullets'] as const

// Lived-experience claims. Case-insensitive. Kept intentionally specific so
// hypotheticals ("I'd pair this with") and catalog knowledge ("known for")
// never match.
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ive-been-verbing',  re: /\bI['’]ve been (?:testing|using|wearing|living|keeping|carrying|reaching)\b/i },
  { name: 'i-keep-mine',       re: /\bI keep (?:mine|one|it|this)\b/i },
  { name: 'i-own',             re: /\bI own\b/i },
  { name: 'i-tried-tested',    re: /\bI (?:tried|tested)\b/i },
  { name: 'i-use-it',          re: /\bI use[d]? (?:it|this|mine|one)\b/i },
  { name: 'my-place-things',   re: /\bmy (?:nightstand|night stand|drawer|desk|shelf|bag|purse|bedside|routine|rotation|collection|partner)\b/i },
  { name: 'when-i-use',        re: /\bwhen I (?:use|used|wear|wore|tried|tested)\b/i },
  { name: 'i-reach-grab-for',  re: /\bI (?:reach|grab|go) for\b/i },
  { name: 'mine-has',          re: /\bmine (?:has|is|does|lives|stays)\b/i },
  { name: 'ive-had-mine',      re: /\bI['’]ve (?:had|owned|worn|used|kept)\b/i },
  { name: 'living-on-my',      re: /\b(?:living|lives|sits|stays) (?:on|in|by) my\b/i },
  { name: 'i-was-verbing-it',  re: /\bI (?:was|am) (?:using|wearing|testing) \b/i },
]

interface Hit {
  productId: number
  handle: string
  title: string
  status: string
  field: string
  pattern: string
  excerpt: string
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function scan(text: string): Array<{ pattern: string; excerpt: string }> {
  const out: Array<{ pattern: string; excerpt: string }> = []
  const plain = stripHtml(text)
  for (const { name, re } of PATTERNS) {
    const m = plain.match(re)
    if (m && m.index != null) {
      const start = Math.max(0, m.index - 60)
      out.push({ pattern: name, excerpt: plain.slice(start, m.index + m[0].length + 60) })
    }
  }
  return out
}

const hits: Hit[] = []
let scanned = 0

interface GqlProduct {
  legacyResourceId: string
  title: string
  handle: string
  status: string
  descriptionHtml: string | null
  metafields: { nodes: { key: string; value: string }[] }
}

const QUERY = `
  query Sweep($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        legacyResourceId
        title
        handle
        status
        descriptionHtml
        metafields(namespace: "xdipx", first: 30) { nodes { key value } }
      }
    }
  }`

let cursor: string | null = null
let hasNext = true
while (hasNext) {
  const data: {
    products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlProduct[] }
  } = await adminGraphQL(QUERY, cursor ? { cursor } : {})
  for (const p of data.products.nodes) {
    scanned++
    const productId = Number(p.legacyResourceId)
    if (p.descriptionHtml) {
      for (const h of scan(p.descriptionHtml)) {
        hits.push({ productId, handle: p.handle, title: p.title, status: p.status, field: 'body_html', ...h })
      }
    }
    for (const m of p.metafields.nodes) {
      if (!(SCAN_KEYS as readonly string[]).includes(m.key)) continue
      for (const h of scan(m.value)) {
        hits.push({ productId, handle: p.handle, title: p.title, status: p.status, field: m.key, ...h })
      }
    }
  }
  hasNext = data.products.pageInfo.hasNextPage
  cursor = data.products.pageInfo.endCursor
  console.log(`…scanned ${scanned}`)
}

console.log(`\nscanned ${scanned} products, ${hits.length} hit(s) across ${new Set(hits.map(h => h.productId)).size} product(s)\n`)
for (const h of hits) {
  console.log(`- [${h.status}] ${h.title} (${h.productId}, ${h.handle}) ${h.field} [${h.pattern}]`)
  console.log(`    …${h.excerpt}…`)
}

const jsonFlag = process.argv.indexOf('--json')
if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
  writeFileSync(process.argv[jsonFlag + 1]!, JSON.stringify(hits, null, 2))
  console.log(`\nwrote ${process.argv[jsonFlag + 1]}`)
}
process.exit(0)
