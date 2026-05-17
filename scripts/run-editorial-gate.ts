/**
 * run-editorial-gate.ts
 *
 * Phase 1 publish gate per TAXONOMY_SPEC v2.2 §8. Runs five deterministic
 * checks against every product (active + draft), writes pass/fail metadata,
 * and optionally promotes passing drafts → active / demotes failing actives
 * → draft.
 *
 * Gate criteria (all must pass):
 *   1. Non-empty xdipx.tagline
 *   2. At least one Emma aside in xdipx.full_story or descriptionHtml
 *      (heuristic: presence of first-person aside markers — easily refined)
 *   3. Description has no Nalpac encoding bugs (`ft.` / `in.` artifacts)
 *      Exception: `in.` immediately following a digit is allowed (inches)
 *   4. At least 2 product images
 *   5. Non-empty xdipx.seo_meta_description
 *
 * Writes:
 *   - custom.editorial_gate_failures (JSON list of failed check IDs)
 *   - custom.editorial_gate_run_at   (ISO date string)
 *
 * Optional flags:
 *   --promote        : promote draft → active for products that PASS
 *   --demote         : demote active → draft for products that FAIL
 *   --dry-run        : report only, no writes
 *   --status=active  : run against active only (default: active + draft)
 *
 * Override: per §8, products can opt out of check 2 (Emma aside) by setting
 * custom.editorial_gate_override = true. Logged for audit.
 *
 * Output: scripts/output/editorial-gate-report-{ISO}.csv
 *
 * Idempotent. Safe to schedule nightly.
 */

import './_load-env'
import fs from 'node:fs'
import path from 'node:path'

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

const DRY_RUN = process.argv.includes('--dry-run')
const PROMOTE = process.argv.includes('--promote')
const DEMOTE  = process.argv.includes('--demote')
const STATUS_FILTER = (() => {
  const s = argOf('--status') ?? 'active+draft'
  switch (s) {
    case 'active':       return 'status:active'
    case 'draft':        return 'status:draft'
    case 'active+draft': return 'status:active OR status:draft'
    default:
      console.error(`ERROR: --status must be one of: active, draft, active+draft`)
      process.exit(1)
  }
})()

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

const QUERY = /* GraphQL */ `
  query GateProducts($cursor: String, $q: String!) {
    products(first: 50, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        status
        descriptionHtml
        images(first: 5) { nodes { id } }
        tagline:        metafield(namespace: "xdipx", key: "tagline")              { value }
        fullStory:      metafield(namespace: "xdipx", key: "full_story")           { value }
        seoMetaDesc:    metafield(namespace: "xdipx", key: "seo_meta_description") { value }
        gateOverride:   metafield(namespace: "custom", key: "editorial_gate_override") { value }
      }
    }
  }
`

const SET_MUTATION = /* GraphQL */ `
  mutation GateSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors { field message }
    }
  }
`

const UPDATE_STATUS_MUTATION = /* GraphQL */ `
  mutation StatusUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id status }
      userErrors { field message }
    }
  }
`

interface Node {
  id:              string
  handle:          string
  title:           string
  status:          string
  descriptionHtml: string | null
  images:          { nodes: Array<{ id: string }> }
  tagline:         { value: string | null } | null
  fullStory:       { value: string | null } | null
  seoMetaDesc:     { value: string | null } | null
  gateOverride:    { value: string | null } | null
}

// Heuristic first-person aside markers — refined over time as needed.
const EMMA_ASIDE_MARKERS = [
  /\bi\s+(?:tested|tried|kept|swear|love|love this|recommend|use|reach for|wear|keep|brought|put)/i,
  /\bbeen\s+(?:living|sleeping|wearing|using|recommending|telling)/i,
  /\bthe one i\b/i,
  /\bmy\s+(?:go-to|new favorite|favorite|pick|secret|partner|girlfriend|boyfriend)/i,
  /\bi'?ve been\b/i,
  /\bi'?m (?:obsessed|telling|recommending|reaching|keeping)/i,
  /\bwe (?:tested|tried|kept|use)\b/i,
  /\btested (?:this|it) for\b/i,
]

function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
}

/** §8 check 3: detects Nalpac feed apostrophe (`ft.`) and quote (`in.`)
 *  encoding bugs. `in.` after a digit is allowed (inches in dimensions). */
function hasEncodingBug(text: string): boolean {
  if (/\bft\./i.test(text) && !/\d\s*ft\./i.test(text)) return true
  if (/\bin\./i.test(text) && !/\d\s*in\./i.test(text)) return true
  return false
}

interface GateResult {
  id:        string
  handle:    string
  title:     string
  status:    string
  failures:  string[]
  override:  boolean
  willPromote: boolean
  willDemote:  boolean
}

async function main() {
  console.log(`Editorial gate run — ${new Date().toISOString()}`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}  ·  promote=${PROMOTE} demote=${DEMOTE}`)
  console.log(`Status filter: ${STATUS_FILTER}\n`)

  const results: GateResult[] = []
  let cursor: string | null = null
  let scanned = 0
  let pages = 0

  do {
    const data = await gql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes:    Node[]
      }
    }>(QUERY, { cursor, q: STATUS_FILTER })

    pages += 1
    for (const p of data.products.nodes) {
      scanned += 1
      const tagline   = (p.tagline?.value ?? '').trim()
      const fullStory = (p.fullStory?.value ?? '').trim()
      const seoMeta   = (p.seoMetaDesc?.value ?? '').trim()
      const bodyText  = stripHtml(p.descriptionHtml)
      const fullText  = `${fullStory} ${bodyText}`
      const override  = (p.gateOverride?.value ?? '').trim().toLowerCase() === 'true'

      const failures: string[] = []

      if (tagline.length === 0) failures.push('1_tagline_empty')

      const hasAside = EMMA_ASIDE_MARKERS.some(re => re.test(fullText))
      if (!hasAside && !override) failures.push('2_no_emma_aside')

      if (hasEncodingBug(`${p.title} ${bodyText}`)) failures.push('3_encoding_bug')

      if ((p.images.nodes?.length ?? 0) < 2) failures.push('4_less_than_2_images')

      if (seoMeta.length === 0) failures.push('5_seo_meta_empty')

      const passed = failures.length === 0
      results.push({
        id:        p.id,
        handle:    p.handle,
        title:     p.title,
        status:    p.status,
        failures,
        override,
        willPromote: PROMOTE && passed && p.status === 'DRAFT',
        willDemote:  DEMOTE  && !passed && p.status === 'ACTIVE',
      })
    }

    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null
    if (pages % 2 === 0 && cursor) await new Promise(r => setTimeout(r, 1000))
  } while (cursor)

  // ── Summary ──
  const passed = results.filter(r => r.failures.length === 0)
  const failed = results.filter(r => r.failures.length > 0)
  const promotions = results.filter(r => r.willPromote)
  const demotions  = results.filter(r => r.willDemote)

  console.log(`────────────────────────────────────────────────────`)
  console.log(`  Gate run complete`)
  console.log(`────────────────────────────────────────────────────`)
  console.log(`  Scanned:         ${scanned}`)
  console.log(`  Passed (${passed.length / scanned * 100 | 0}%): ${passed.length}`)
  console.log(`  Failed (${failed.length / scanned * 100 | 0}%): ${failed.length}`)
  console.log(`  Promotions queued (draft → active): ${promotions.length}`)
  console.log(`  Demotions queued  (active → draft): ${demotions.length}\n`)

  // Failure-mode distribution
  const failureCounts: Record<string, number> = {}
  for (const r of failed) for (const f of r.failures) failureCounts[f] = (failureCounts[f] ?? 0) + 1
  console.log(`  Failure-mode distribution:`)
  for (const [k, v] of Object.entries(failureCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(24)} ${String(v).padStart(5)}  ${(v / scanned * 100).toFixed(1)}%`)
  }
  console.log()

  // ── CSV report ──
  const outDir = path.join(process.cwd(), 'scripts', 'output')
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const csvPath = path.join(outDir, `editorial-gate-report-${stamp}.csv`)
  const header = ['handle','title','status','failures','override','will_promote','will_demote'].join(',')
  const rows = results.map(r => [
    r.handle,
    `"${r.title.replace(/"/g, '""')}"`,
    r.status,
    r.failures.join('|'),
    String(r.override),
    String(r.willPromote),
    String(r.willDemote),
  ].join(','))
  fs.writeFileSync(csvPath, [header, ...rows].join('\n') + '\n')
  console.log(`  Report: ${csvPath}\n`)

  if (DRY_RUN) {
    console.log('DRY RUN — exiting before writes.')
    return
  }

  // ── Write gate failure metafields ──
  const gateWrites = results.map(r => ([
    {
      ownerId:   r.id,
      namespace: 'custom',
      key:       'editorial_gate_failures',
      type:      'json',
      value:     JSON.stringify(r.failures),
    },
    {
      ownerId:   r.id,
      namespace: 'custom',
      key:       'editorial_gate_run_at',
      type:      'date_time',
      value:     new Date().toISOString(),
    },
  ])).flat()

  const CHUNK = 25
  console.log(`Writing ${gateWrites.length} gate metafields in batches of ${CHUNK}...`)
  for (let i = 0; i < gateWrites.length; i += CHUNK) {
    const batch = gateWrites.slice(i, i + CHUNK)
    const result = await gql<{
      metafieldsSet: { userErrors: Array<{ field: string[]; message: string }> }
    }>(SET_MUTATION, { metafields: batch })
    for (const e of result.metafieldsSet.userErrors) {
      console.error(`  ERROR: ${e.field?.join('.') ?? '?'}: ${e.message}`)
    }
  }
  console.log('Gate metafields written.\n')

  // ── Status promotions / demotions ──
  const statusChanges = [...promotions.map(r => ({ id: r.id, status: 'ACTIVE', handle: r.handle })),
                        ...demotions.map(r =>  ({ id: r.id, status: 'DRAFT',  handle: r.handle }))]
  if (statusChanges.length > 0) {
    console.log(`Applying ${statusChanges.length} status changes...`)
    for (const c of statusChanges) {
      const result = await gql<{
        productUpdate: { userErrors: Array<{ field: string[]; message: string }> }
      }>(UPDATE_STATUS_MUTATION, { input: { id: c.id, status: c.status } })
      for (const e of result.productUpdate.userErrors) {
        console.error(`  ${c.handle}: ${e.message}`)
      }
    }
    console.log('Status changes applied.')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
