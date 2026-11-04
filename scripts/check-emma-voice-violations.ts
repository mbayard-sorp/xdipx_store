/**
 * READ-ONLY. Walks the full Shopify catalog via Admin GraphQL (paginated)
 * and reports every xdipx-namespace COPY metafield that carries one of the
 * four Emma-voice violation classes in app/lib/emma-voice-violations.ts:
 * a lived-experience claim, a self-narration trust assertion, an em-dash, or
 * the "— Emma ·" tagline byline.
 *
 * Split off #19949 (code-only slice) as ticket #19980. #8102 (the Tantus
 * P-spot full_story) and #11147 (362/5,314 taglines with an em-dash, 21 with
 * an Emma byline, 13 lived-experience) sat at `approved` for weeks because
 * neither row's kind had an executor that could run this check. This makes
 * it mechanical, and `applyFieldResult` (field-regen-runner.server.ts)
 * rejects the same four classes before a regenerated field reaches Shopify,
 * so a NEW violation of this shape cannot ship through that path again.
 * This script covers the wider, pre-existing surface across the whole
 * catalog, including fields field-regen doesn't currently generate
 * (feature_bullets).
 *
 * Scans the six xdipx-namespace COPY metafields named in #19949's DONE WHEN:
 * tagline, full_story, works_for_him, works_for_her, feature_bullets,
 * seo_meta_description.
 *
 * Usage:
 *   npx tsx scripts/check-emma-voice-violations.ts
 *   npx tsx scripts/check-emma-voice-violations.ts --json out.json
 *
 * Exit codes:
 *   0 — no violations found
 *   1 — one or more violations found, or a Shopify API error
 */
import { writeFileSync } from 'node:fs'
import { adminGraphQL } from '~/lib/shopify.server'
import { scanEmmaVoiceFields, type EmmaVoiceViolationHit } from '~/lib/emma-voice-violations'

const SCAN_KEYS = ['tagline', 'full_story', 'works_for_him', 'works_for_her', 'feature_bullets', 'seo_meta_description'] as const

interface Hit extends EmmaVoiceViolationHit {
  handle: string
  title:  string
  status: string
}

/** feature_bullets is stored as a JSON array; every other scanned key is plain text. */
function fieldValueToText(key: string, raw: string): string {
  if (key !== 'feature_bullets') return raw
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string').join(' ')
  } catch { /* not JSON — scan the raw string as-is */ }
  return raw
}

interface GqlProduct {
  handle: string
  title:  string
  status: string
  metafields: { nodes: { key: string; value: string }[] }
}

const QUERY = `
  query EmmaVoiceCheck($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle
        title
        status
        metafields(namespace: "xdipx", first: 30) { nodes { key value } }
      }
    }
  }`

async function main() {
  const hits: Hit[] = []
  let scanned = 0
  let cursor: string | null = null
  let hasNext = true

  while (hasNext) {
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlProduct[] }
    } = await adminGraphQL(QUERY, cursor ? { cursor } : {})

    for (const p of data.products.nodes) {
      scanned++
      const fields: Record<string, string> = {}
      for (const m of p.metafields.nodes) {
        if ((SCAN_KEYS as readonly string[]).includes(m.key)) {
          fields[m.key] = fieldValueToText(m.key, m.value)
        }
      }
      for (const hit of scanEmmaVoiceFields(fields)) {
        hits.push({ handle: p.handle, title: p.title, status: p.status, ...hit })
      }
    }

    hasNext = data.products.pageInfo.hasNextPage
    cursor  = data.products.pageInfo.endCursor
    console.log(`…scanned ${scanned}`)
  }

  console.log(`\nscanned ${scanned} product(s), ${hits.length} violation(s) across ${new Set(hits.map(h => h.handle)).size} product(s)\n`)
  for (const h of hits) {
    console.log(`- [${h.status}] ${h.title} (${h.handle}) ${h.field} [${h.category}/${h.name}]`)
    console.log(`    …${h.excerpt}…`)
  }

  const jsonFlag = process.argv.indexOf('--json')
  if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
    writeFileSync(process.argv[jsonFlag + 1]!, JSON.stringify(hits, null, 2))
    console.log(`\nwrote ${process.argv[jsonFlag + 1]}`)
  }

  process.exit(hits.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('[check-emma-voice-violations] error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
