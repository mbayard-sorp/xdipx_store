/**
 * apply-audience-to-shopify.ts
 *
 * Writes the v2.2 audience proposal to Shopify product metafields:
 *   - xdipx.audience_tags     (list.single_line_text_field) — final tags array
 *   - custom.audience_rationale (multi_line_text_field)     — one-sentence rationale
 *     (multi-line so stacked deterministic rule hits aren't truncated)
 *
 * Reads:
 *   - audience-proposal-briefs.json  (current Shopify state + deterministic rules)
 *   - audience-proposals.json        (subagent output, optional — merged in if present)
 *
 * Diff semantics:
 *   - Final tags = deterministic ∪ Claude relationship/lifeEvent/lgbtq, dedupe + sort
 *   - audience_tags written only if final differs from current (set-equality)
 *   - audience_rationale written for every product with non-empty rationale
 *
 * Applies to BOTH active AND draft products (the briefs file already includes
 * both per the build script default).
 *
 * Apply-immediately (no dry-run by default). To preview without writing:
 *   npx tsx scripts/apply-audience-to-shopify.ts --dry-run
 *
 * Batches of 25 per metafieldsSet call (Shopify limit). Logs progress + errors.
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

const DRY_RUN = process.argv.includes('--dry-run')
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

const SET_MUTATION = /* GraphQL */ `
  mutation ApplyAudience($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors { field message }
    }
  }
`

interface Brief {
  id:              string
  handle:          string
  currentAudience: string[]
  deterministic:   { finalAudience: string[]; hits: Array<{ id: string; note: string }> }
}

interface ClaudeProposal {
  id:               string
  relationshipTags: string[]
  lifeEventTags?:   string[]
  lgbtqTags?:       string[]
  rationale:        string
}

const cwd = process.cwd()
const briefsPath    = path.join(cwd, 'audience-proposal-briefs.json')
const proposalsPath = path.join(cwd, 'audience-proposals.json')

if (!fs.existsSync(briefsPath)) {
  console.error(`ERROR: ${briefsPath} not found. Run build-audience-briefs.ts first.`)
  process.exit(1)
}

const briefs = (JSON.parse(fs.readFileSync(briefsPath, 'utf8')) as { briefs: Brief[] }).briefs
const claudeMap = new Map<string, ClaudeProposal>()
if (fs.existsSync(proposalsPath)) {
  const data = JSON.parse(fs.readFileSync(proposalsPath, 'utf8')) as { proposals: ClaudeProposal[] }
  for (const p of data.proposals) claudeMap.set(p.id, p)
  console.log(`Loaded ${data.proposals.length} Claude proposals from ${path.basename(proposalsPath)}`)
} else {
  console.log(`No ${path.basename(proposalsPath)} found — applying deterministic-only.`)
}

function dedupe(xs: string[]): string[] { return [...new Set(xs)].sort() }
function arraysEqualSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a), sb = new Set(b)
  if (sa.size !== sb.size) return false
  for (const v of sa) if (!sb.has(v)) return false
  return true
}

interface PendingMetafield {
  ownerId:   string
  namespace: string
  key:       string
  type:      string
  value:     string
  handle:    string
}

async function main() {
  console.log(`Applying audience taxonomy v2.2 to ${STORE}`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY'}`)
  console.log()

  const tagWrites: PendingMetafield[] = []
  const rationaleWrites: PendingMetafield[] = []
  let unchanged = 0
  let claudeMissing = 0

  for (const b of briefs) {
    const det = b.deterministic.finalAudience
    const claude = claudeMap.get(b.id)
    const claudeTags = claude
      ? [
          ...(claude.relationshipTags ?? []),
          ...(claude.lifeEventTags    ?? []),
          ...(claude.lgbtqTags        ?? []),
        ].map(t => t.replace(/^for:/, ''))
      : []

    if (!claude && b.deterministic.hits.length === 0) {
      claudeMissing += 1
      continue
    }

    const final = dedupe([...det, ...claudeTags])

    // Write tags only on diff
    if (!arraysEqualSet(final, b.currentAudience)) {
      tagWrites.push({
        ownerId:   b.id,
        namespace: 'xdipx',
        key:       'audience_tags',
        type:      'list.single_line_text_field',
        value:     JSON.stringify(final),
        handle:    b.handle,
      })
    } else {
      unchanged += 1
    }

    // Rationale — always write when we have one
    const rationale = claude?.rationale
      ?? b.deterministic.hits.map(h => `[${h.id}] ${h.note}`).join(' · ')
    if (rationale && rationale.trim()) {
      rationaleWrites.push({
        ownerId:   b.id,
        namespace: 'custom',
        key:       'audience_rationale',
        type:      'multi_line_text_field',
        value:     rationale,
        handle:    b.handle,
      })
    }
  }

  console.log(`audience_tags writes pending:        ${tagWrites.length}`)
  console.log(`  (${unchanged} unchanged, skipped)`)
  console.log(`audience_rationale writes pending:   ${rationaleWrites.length}`)
  console.log(`Briefs without any tag source:       ${claudeMissing}  (need Claude pass)`)
  console.log()

  console.log('Sample audience_tags writes (first 5):')
  for (const w of tagWrites.slice(0, 5)) {
    console.log(`  ${w.handle.padEnd(50)} → ${w.value}`)
  }
  console.log()
  console.log('Sample rationale writes (first 3):')
  for (const w of rationaleWrites.slice(0, 3)) {
    console.log(`  ${w.handle.padEnd(50)} → "${w.value.slice(0, 80)}..."`)
  }
  console.log()

  if (DRY_RUN) {
    console.log('DRY RUN — exiting before writes.')
    return
  }

  const allWrites = [...tagWrites, ...rationaleWrites]
  const CHUNK = 25
  let written = 0
  let errored = 0
  const t0 = Date.now()

  for (let i = 0; i < allWrites.length; i += CHUNK) {
    const batch = allWrites.slice(i, i + CHUNK)
    const result = await gql<{
      metafieldsSet: {
        metafields: Array<{ id: string }> | null
        userErrors: Array<{ field: string[]; message: string }>
      }
    }>(SET_MUTATION, {
      metafields: batch.map(w => ({
        ownerId:   w.ownerId,
        namespace: w.namespace,
        key:       w.key,
        type:      w.type,
        value:     w.value,
      })),
    })
    const errs = result.metafieldsSet.userErrors
    if (errs.length > 0) {
      errored += errs.length
      for (const e of errs) console.error(`  ERROR: ${e.field?.join('.') ?? '?'}: ${e.message}`)
    }
    const wrote = result.metafieldsSet.metafields?.length ?? 0
    written += wrote
    if ((i / CHUNK + 1) % 5 === 0 || i + CHUNK >= allWrites.length) {
      const rate = (i + CHUNK) / ((Date.now() - t0) / 1000)
      const eta = Math.max(0, (allWrites.length - i - CHUNK) / Math.max(rate, 0.1))
      process.stderr.write(`  batch ${Math.floor(i / CHUNK) + 1}/${Math.ceil(allWrites.length / CHUNK)}: ${written} written, ${errored} errors, eta ${Math.round(eta)}s\n`)
    }
  }

  console.log()
  console.log(`Done. Wrote ${written}/${allWrites.length} metafields. ${errored} errors.`)
  console.log()
  console.log(`Next: visit /admin/discovery and click "Refresh now" to bust the KV cache.`)
}

main().catch(err => { console.error(err); process.exit(1) })
