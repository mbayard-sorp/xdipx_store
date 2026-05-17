/**
 * build-matters-briefs.ts
 *
 * Phase 5.5 backfill foundation. Pulls EVERY active + draft product from
 * Shopify Admin, extracts the material / spec-boolean / length signals the
 * matters rule engine needs, applies the deterministic rules inline, and
 * writes a self-contained brief file the chunker and subagent dispatch path
 * will consume.
 *
 * Zero AI spend: no Anthropic SDK use anywhere. The ambiguous-product brief
 * subset is consumed by general-purpose subagents (Max subscription).
 *
 * Output: matters-proposal-briefs.json
 *   {
 *     "generatedAt": ISO timestamp,
 *     "totals": { scanned, eligible, deterministicHits, needsClaude },
 *     "vocab": [...MATTERS_V2],
 *     "briefs": [MattersProductBrief, ...]
 *   }
 *
 * Usage:
 *   npx tsx scripts/build-matters-briefs.ts                   # all eligible
 *   npx tsx scripts/build-matters-briefs.ts --limit=50        # smoke test
 *   npx tsx scripts/build-matters-briefs.ts --status=active   # active only
 *   npx tsx scripts/build-matters-briefs.ts --out=./out.json  # custom output path
 */

import './_load-env'
import fs from 'node:fs'
import path from 'node:path'
import { applyMattersRules, type RuleInput, type RuleHit } from './_matters-rules'
import { MATTERS_V2 } from '../app/types/discovery'

const STORE   = process.env['SHOPIFY_STORE_DOMAIN']
const TOKEN   = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_TOKEN']
const VERSION = process.env['SHOPIFY_ADMIN_API_VERSION'] ?? '2024-10'

if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env')
  process.exit(1)
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

const argOf = (flag: string): string | undefined => {
  const found = process.argv.find(a => a.startsWith(`${flag}=`))
  return found ? found.split('=').slice(1).join('=') : undefined
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

const FROM_CURSOR = argOf('--from-cursor') ?? null

const OUT_PATH = (() => {
  const o = argOf('--out')
  return o ? path.resolve(process.cwd(), o) : path.join(process.cwd(), 'matters-proposal-briefs.json')
})()

// ── Shopify GraphQL client ───────────────────────────────────────────────────

const ENDPOINT = `https://${STORE}/admin/api/${VERSION}/graphql.json`

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

// ── GraphQL query ────────────────────────────────────────────────────────────

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
        collections(first: 25) { nodes { handle } }
        audienceRaw:     metafield(namespace: "xdipx",  key: "audience_tags")         { value }
        mattersRaw:      metafield(namespace: "xdipx",  key: "matters_tags")           { value }
        nalpacDescRaw:   metafield(namespace: "custom", key: "original_description")   { value }
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
  collections:     { nodes: Array<{ handle: string }> }
  audienceRaw:     { value: string | null } | null
  mattersRaw:      { value: string | null } | null
  nalpacDescRaw:   { value: string | null } | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseList(v: string | null | undefined): string[] {
  if (!v) return []
  const s = v.trim()
  if (s.startsWith('[')) {
    try {
      const j = JSON.parse(s)
      return Array.isArray(j) ? j.map(String) : []
    } catch {
      return []
    }
  }
  return s.split(',').map(t => t.trim()).filter(Boolean)
}

function normalizeKey(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ')
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800)
}

// ── Signal parsers ───────────────────────────────────────────────────────────

/**
 * Scan the combined text for material literals that the rule engine cares about.
 * Returns lowercased matches, deduped. Be conservative: false positives cascade
 * into wrong tag assignments.
 */
function parseMaterials(text: string): string[] {
  const t = text.toLowerCase()
  const candidates: Array<[string, RegExp]> = [
    ['silicone',        /\bsilicone\b/],
    ['glass',           /\bglass\b/],
    ['borosilicate',    /\bborosilicate\b/],
    ['stainless-steel', /\bstainless[- ]steel\b/],
    ['ceramic',         /\bceramic\b/],
    ['abs',             /\babs\b/],
    ['tpe',             /\btpe\b/],
    ['rubber',          /\brubber\b/],
    ['latex',           /\blatex\b/],
    ['metal',           /\bmetal\b/],
    ['pvc',             /\bpvc\b/],
  ]
  const found: string[] = []
  for (const [label, re] of candidates) {
    if (re.test(t)) found.push(label)
  }
  return found
}

/**
 * Waterproof: true if affirmative pattern matches.
 *   false if explicit-not-waterproof pattern matches and no affirmative.
 *   null otherwise.
 *
 * Conservative: prefer null over false guesses to avoid suppressing the chip.
 */
function parseWaterproof(text: string): boolean | null {
  const affirm = /waterproof|ipx[67]|submersible|bath[- ]safe/i
  const deny   = /splash[- ]resistant|not waterproof|water[- ]resistant only/i
  if (affirm.test(text)) return true
  if (deny.test(text))   return false
  return null
}

/**
 * Rechargeable: true if USB/rechargeable language is present.
 *   false if battery-only language is present with no rechargeable signal.
 *   null otherwise.
 */
function parseRechargeable(text: string): boolean | null {
  const affirm = /rechargeable|usb|magnetic charging/i
  const deny   = /battery operated|requires (AAA|AA|N) batteries/i
  if (affirm.test(text)) return true
  if (deny.test(text))   return false
  return null
}

/**
 * Detachable parts: true if explicit detachable language is present.
 * Returns null rather than false — rarely stated in the negative.
 */
function parseDetachable(text: string): boolean | null {
  const affirm = /detachable|removable (sleeve|cap|head)|takes apart/i
  return affirm.test(text) ? true : null
}

/**
 * Length in inches: first match from spec text patterns.
 * Prefers nalpacDescription; falls back to bodyExcerpt.
 * Returns null when no match.
 *
 * Conservative: only matches explicit "in" / "inch" / inch-mark patterns.
 * Do NOT match bare numbers (could be anything).
 */
function parseLengthIn(primary: string, fallback: string): number | null {
  const re = /length:?\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")/i
  const m1 = re.exec(primary)
  if (m1) return parseFloat(m1[1])
  const m2 = re.exec(fallback)
  if (m2) return parseFloat(m2[1])
  return null
}

// ── Brief shape ──────────────────────────────────────────────────────────────

export interface MattersProductBrief {
  shopifyProductId:  string
  handle:            string
  title:             string
  productType:       string | null
  vendor:            string
  tags:              string[]
  bodyExcerpt:       string   // stripHtml(descriptionHtml), first ~800 chars
  nalpacDescription: string   // custom.original_description, raw
  currentMatters:    string[] // existing xdipx.matters_tags values
  currentAudience:   string[] // existing xdipx.audience_tags values
  // Parsed signal (what this script extracted from the above)
  parsedMaterials:   string[]
  specBooleans: {
    waterproof:      boolean | null
    rechargeable:    boolean | null
    detachableParts: boolean | null
    nonElectric:     boolean | null // always null here; rule registry derives from productType
  }
  lengthIn:          number | null
  // Rule output
  deterministic: {
    finalMatters: string[]
    hits:         RuleHit[]
    needsClaude:  boolean
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stderr.write(`Querying Shopify Admin with: ${STATUS_FILTER}\n`)
  process.stderr.write(`Endpoint: ${ENDPOINT}\n`)
  if (LIMIT !== Infinity) process.stderr.write(`Limit: ${LIMIT} products\n`)
  if (FROM_CURSOR) process.stderr.write(`Resuming from cursor: ${FROM_CURSOR}\n`)
  process.stderr.write('\n')

  const briefs: MattersProductBrief[] = []
  let cursor: string | null = FROM_CURSOR
  let scanned = 0
  let pages = 0
  let deterministicHits = 0
  let needClaudeCount = 0

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

      const currentMatters  = parseList(p.mattersRaw?.value).map(normalizeKey)
      const currentAudience = parseList(p.audienceRaw?.value).map(normalizeKey)

      const bodyExcerpt       = stripHtml(p.descriptionHtml)
      const nalpacDescription = (p.nalpacDescRaw?.value ?? '').trim()

      // Combined text for parsing — nalpac spec is the primary signal
      const combinedText = `${bodyExcerpt} ${nalpacDescription}`

      const parsedMaterials  = parseMaterials(combinedText)
      const waterproof       = parseWaterproof(combinedText)
      const rechargeable     = parseRechargeable(combinedText)
      const detachableParts  = parseDetachable(combinedText)
      const lengthIn         = parseLengthIn(nalpacDescription, bodyExcerpt)

      const ruleInput: RuleInput = {
        productType:       p.productType,
        tags:              p.tags ?? [],
        title:             p.title.toLowerCase(),
        bodyExcerpt:       bodyExcerpt.toLowerCase(),
        nalpacDescription: nalpacDescription.toLowerCase(),
        vendor:            p.vendor ?? '',
        collections:       p.collections.nodes.map(n => n.handle.toLowerCase()),
        materials:         parsedMaterials,
        waterproof,
        rechargeable,
        detachableParts,
        nonElectric:       null, // conservative: let rule registry derive from productType
        lengthIn,
        currentMatters,
        currentAudience,
      }

      const ruleResult = applyMattersRules(ruleInput)

      if (ruleResult.hits.length > 0) deterministicHits += 1
      if (ruleResult.needsClaude) needClaudeCount += 1

      const numericId = p.id.split('/').pop() ?? p.id
      briefs.push({
        shopifyProductId:  numericId,
        handle:            p.handle,
        title:             p.title,
        productType:       p.productType,
        vendor:            p.vendor ?? '',
        tags:              p.tags ?? [],
        bodyExcerpt,
        nalpacDescription,
        currentMatters,
        currentAudience,
        parsedMaterials,
        specBooleans: {
          waterproof,
          rechargeable,
          detachableParts,
          nonElectric: null,
        },
        lengthIn,
        deterministic: {
          finalMatters: ruleResult.finalMatters,
          hits:         ruleResult.hits,
          needsClaude:  ruleResult.needsClaude,
        },
      })
    }

    if (briefs.length >= LIMIT) break
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null

    // Be nice to Shopify rate limits: 1 s sleep every 2 pages
    if (pages % 2 === 0 && cursor) await new Promise(r => setTimeout(r, 1000))
  } while (cursor)

  const out = {
    generatedAt: new Date().toISOString(),
    totals: {
      scanned,
      eligible:          briefs.length,
      deterministicHits,
      needsClaude:       needClaudeCount,
      fullyCovered:      briefs.length - needClaudeCount,
    },
    vocab: [...MATTERS_V2],
    briefs,
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))

  // ── Summary ──────────────────────────────────────────────────────────────
  process.stderr.write(`\n────────────────────────────────────────────────────\n`)
  process.stderr.write(`  Brief build complete\n`)
  process.stderr.write(`────────────────────────────────────────────────────\n`)
  process.stderr.write(`  Scanned products:         ${scanned}\n`)
  process.stderr.write(`  Briefs written:           ${briefs.length}\n`)
  process.stderr.write(`  Status filter:            ${STATUS_FILTER}\n`)
  process.stderr.write(`  Deterministic rule hits:  ${deterministicHits}\n`)
  process.stderr.write(`  Needs Claude pass:        ${needClaudeCount}\n`)
  process.stderr.write(`  Fully covered by rules:   ${briefs.length - needClaudeCount}\n`)
  process.stderr.write(`  Output:                   ${OUT_PATH}\n\n`)

  // Distribution: count per chip in the rule-final output
  const dist: Record<string, number> = {}
  for (const chip of MATTERS_V2) {
    dist[chip] = 0
  }
  for (const b of briefs) {
    for (const chip of b.deterministic.finalMatters) {
      dist[chip] = (dist[chip] ?? 0) + 1
    }
  }

  process.stderr.write(`  Chip distribution (deterministic, pre-Claude):\n`)
  const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1])
  for (const [chip, count] of sorted) {
    const pct = briefs.length > 0 ? ((count / briefs.length) * 100).toFixed(1) : '0.0'
    process.stderr.write(`    ${chip.padEnd(22)} ${String(count).padStart(5)}  ${pct}%\n`)
  }
  process.stderr.write('\n')
}

main().catch(err => { console.error(err); process.exit(1) })
