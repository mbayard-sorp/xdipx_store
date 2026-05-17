/**
 * build-audience-briefs.ts
 *
 * Phase 7b foundation. Pulls EVERY active + draft product from Shopify Admin,
 * applies the v2.2 deterministic rules (R1–R7, L1–L7, Q1–Q8, C1–C6 cleanup
 * detection) inline, and writes a self-contained brief file the chunker
 * and the subagent dispatch path consume.
 *
 * Zero AI spend: no Anthropic SDK use anywhere. The ambiguous-product brief
 * subset is consumed by general-purpose subagents (Max subscription).
 *
 * Includes BOTH active AND draft products per TAXONOMY_SPEC v2.2 §4.1
 * (re-tag scope = Active + Draft so drafts are launch-ready when promoted).
 *
 * Output: audience-proposal-briefs.json
 *   {
 *     "generatedAt": ISO timestamp,
 *     "totals": { scanned, eligible, deterministicHits, needsClaude },
 *     "vocab": { relationship: [...], lifeEvent: [...] },
 *     "briefs": [Brief, ...]
 *   }
 *
 * Usage:
 *   npx tsx scripts/build-audience-briefs.ts                # all eligible
 *   npx tsx scripts/build-audience-briefs.ts --limit=50     # smoke test
 *   npx tsx scripts/build-audience-briefs.ts --status=active # active only
 */

import './_load-env'
import fs from 'node:fs'
import path from 'node:path'
import { applyAudienceRules, SPEC_RELATIONSHIP_TAGS, SPEC_LIFE_EVENT_TAGS, type RuleHit } from './_audience-rules'

const STORE   = process.env['SHOPIFY_STORE_DOMAIN']
const TOKEN   = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_TOKEN']
const VERSION = process.env['SHOPIFY_ADMIN_API_VERSION'] ?? '2024-10'

if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env')
  process.exit(1)
}

const argOf = (flag: string): string | undefined => {
  const found = process.argv.find(a => a.startsWith(`${flag}=`))
  return found ? found.split('=')[1] : undefined
}

const LIMIT = (() => {
  const f = argOf('--limit')
  if (!f) return Infinity
  const n = Number(f)
  return Number.isFinite(n) && n > 0 ? n : Infinity
})()

const STATUS_FILTER = (() => {
  const s = argOf('--status') ?? 'active+draft'
  switch (s) {
    case 'active':       return 'status:active'
    case 'draft':        return 'status:draft'
    case 'active+draft': return 'status:active OR status:draft'
    default:
      console.error(`ERROR: --status must be one of: active, draft, active+draft. Got: ${s}`)
      process.exit(1)
  }
})()

const ENDPOINT = `https://${STORE}/admin/api/${VERSION}/graphql.json`
const OUT_PATH = path.join(process.cwd(), 'audience-proposal-briefs.json')

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN! },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
  const body = await res.json() as { data: T; errors?: Array<{ message: string }> }
  if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map(e => e.message).join('; ')}`)
  return body.data
}

const QUERY = /* GraphQL */ `
  query Products($cursor: String, $q: String!) {
    products(first: 100, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        status
        productType
        vendor
        tags
        descriptionHtml
        priceRangeV2 { maxVariantPrice { amount } }
        collections(first: 25) { nodes { handle } }
        audienceRaw:    metafield(namespace: "xdipx",  key: "audience_tags")             { value }
        mattersRaw:     metafield(namespace: "xdipx",  key: "matters_tags")              { value }
        queerOverride:  metafield(namespace: "xdipx",  key: "queer_friendly_override")   { value }
      }
    }
  }
`

interface ShopifyNode {
  id:              string
  handle:          string
  title:           string
  status:          string
  productType:     string | null
  vendor:          string | null
  tags:            string[]
  descriptionHtml: string | null
  priceRangeV2:    { maxVariantPrice: { amount: string } } | null
  collections:     { nodes: Array<{ handle: string }> }
  audienceRaw:     { value: string | null } | null
  mattersRaw:      { value: string | null } | null
  queerOverride:   { value: string | null } | null
}

function parseList(v: string | null | undefined): string[] {
  if (!v) return []
  if (v.trim().startsWith('[')) {
    try { const j = JSON.parse(v); return Array.isArray(j) ? j.map(String) : [] }
    catch { return [] }
  }
  return v.split(',').map(s => s.trim()).filter(Boolean)
}

function normalizeKey(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ')
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200)
}

export interface Brief {
  id:               string
  handle:           string
  adminUrl:         string
  title:            string
  status:           string
  productType:      string | null
  vendor:           string | null
  tags:             string[]
  collections:      string[]
  maxPrice:         number
  description:      string
  currentAudience:  string[]
  currentMatters:   string[]
  /** Deterministic rule output (R1–R7, L1–L7, Q1–Q8). Empty if nothing fired. */
  deterministic: {
    finalAudience: string[]
    hits:          RuleHit[]
    cleanupHits:   RuleHit[]
    needsClaude:   boolean
  }
}

async function main() {
  process.stderr.write(`Querying Shopify Admin with: ${STATUS_FILTER}\n`)
  process.stderr.write(`Endpoint: ${ENDPOINT}\n\n`)

  const briefs: Brief[] = []
  let cursor: string | null = null
  let scanned = 0
  let pages = 0
  let detHits = 0
  let needClaude = 0
  let stripCount = 0

  do {
    const data = await gql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes:    ShopifyNode[]
      }
    }>(QUERY, { cursor, q: STATUS_FILTER })

    pages += 1
    for (const p of data.products.nodes) {
      scanned += 1
      if (briefs.length >= LIMIT) break

      const currentAudience = parseList(p.audienceRaw?.value).map(normalizeKey)
      const currentMatters  = parseList(p.mattersRaw?.value).map(normalizeKey)
      const collections     = p.collections.nodes.map(n => n.handle.toLowerCase())
      const maxPrice        = Number(p.priceRangeV2?.maxVariantPrice.amount ?? '0')
      const queerOverride   = (p.queerOverride?.value ?? '').trim().toLowerCase() === 'true'

      const ruleResult = applyAudienceRules({
        productType:     p.productType,
        tags:            p.tags ?? [],
        title:           p.title,
        bodyExcerpt:     stripHtml(p.descriptionHtml),
        vendor:          p.vendor ?? '',
        collections,
        maxPrice,
        currentAudience,
        currentMatters,
        queerOverride,
      })

      if (ruleResult.hits.length > 0) detHits += 1
      if (ruleResult.needsClaude) needClaude += 1
      if (ruleResult.cleanupHits.length > 0) stripCount += 1

      const adminId = p.id.split('/').pop()
      briefs.push({
        id:              p.id,
        handle:          p.handle,
        adminUrl:        `https://${STORE}/admin/products/${adminId}`,
        title:           p.title,
        status:          p.status,
        productType:     p.productType,
        vendor:          p.vendor,
        tags:            p.tags ?? [],
        collections,
        maxPrice,
        description:     stripHtml(p.descriptionHtml),
        currentAudience,
        currentMatters,
        deterministic: {
          finalAudience: ruleResult.finalAudience,
          hits:          ruleResult.hits,
          cleanupHits:   ruleResult.cleanupHits,
          needsClaude:   ruleResult.needsClaude,
        },
      })
    }

    if (briefs.length >= LIMIT) break
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null

    // Be nice to Shopify rate limits per CLAUDE.md pattern (see discovery.server)
    if (pages % 2 === 0 && cursor) await new Promise(r => setTimeout(r, 1000))
  } while (cursor)

  const out = {
    generatedAt: new Date().toISOString(),
    totals: {
      scanned,
      eligible:           briefs.length,
      deterministicHits:  detHits,
      needsClaude:        needClaude,
      cleanupCandidates:  stripCount,
    },
    vocab: {
      relationship: [...SPEC_RELATIONSHIP_TAGS].sort(),
      lifeEvent:    [...SPEC_LIFE_EVENT_TAGS].sort(),
    },
    briefs,
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))

  process.stderr.write(`\n────────────────────────────────────────────────────\n`)
  process.stderr.write(`  Brief build complete\n`)
  process.stderr.write(`────────────────────────────────────────────────────\n`)
  process.stderr.write(`  Scanned products:         ${scanned}\n`)
  process.stderr.write(`  Briefs written:           ${briefs.length}\n`)
  process.stderr.write(`  Status filter:            ${STATUS_FILTER}\n`)
  process.stderr.write(`  Deterministic rule hits:  ${detHits}\n`)
  process.stderr.write(`  Needs Claude pass:        ${needClaude}\n`)
  process.stderr.write(`  Cleanup candidates:       ${stripCount}  (C1–C6 will fire on apply)\n`)
  process.stderr.write(`  Output:                   ${OUT_PATH}\n\n`)

  // Distribution of deterministic relationship hits so we can see whether
  // the rules are doing useful work before any Claude call.
  const distRel: Record<string, number> = {}
  const distLife: Record<string, number> = {}
  const distLgbtq: Record<string, number> = {}
  for (const b of briefs) {
    for (const t of b.deterministic.finalAudience) {
      if (SPEC_RELATIONSHIP_TAGS.has(t) && !['queer-friendly','gay-couples','sapphic','non-binary'].includes(t)) distRel[t] = (distRel[t] ?? 0) + 1
      else if (SPEC_LIFE_EVENT_TAGS.has(t)) distLife[t] = (distLife[t] ?? 0) + 1
      else if (['queer-friendly','gay-couples','sapphic','non-binary'].includes(t)) distLgbtq[t] = (distLgbtq[t] ?? 0) + 1
    }
  }
  const printDist = (label: string, d: Record<string, number>) => {
    process.stderr.write(`  ${label}:\n`)
    for (const [k, v] of Object.entries(d).sort((a, b) => b[1] - a[1])) {
      const pct = ((v / briefs.length) * 100).toFixed(1)
      process.stderr.write(`    ${k.padEnd(20)} ${String(v).padStart(5)}  ${pct}%\n`)
    }
    if (Object.keys(d).length === 0) process.stderr.write(`    (none)\n`)
  }
  printDist('Deterministic relationship (pre-Claude)', distRel)
  printDist('Deterministic life-event (pre-Claude)', distLife)
  printDist('Deterministic LGBTQ (pre-Claude, affirmative-signal only)', distLgbtq)
}

main().catch(err => { console.error(err); process.exit(1) })
