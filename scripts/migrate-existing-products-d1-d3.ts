/**
 * Phase 1 rebuild — one-shot D1/D3 data transform on existing Shopify products.
 *
 * Two passes (run together by default; gate with flags to run individually):
 *
 *   D1 reclassification — Haiku call per product. Reads the existing
 *     xdipx.product_type_dial (legacy 5-bucket value or already-new) plus
 *     product context, calls inferProductTaxonomy, writes back the new
 *     19-value top-level enum + per-parent subtype to
 *     custom.product_subtype_dial. Skips products whose existing top-level
 *     is already a valid new value AND has a subtype set.
 *
 *   D3 kebab → Title Case — deterministic, no AI. Reads existing
 *     xdipx.mood_tags / audience_tags / matters_tags, transforms each
 *     entry from kebab-case to Title Case (preserving hyphenated compounds),
 *     writes back. Skips products whose tags are already Title Case.
 *
 * Usage:
 *   npx tsx scripts/migrate-existing-products-d1-d3.ts                  # dry-run, 5 products, both passes
 *   npx tsx scripts/migrate-existing-products-d1-d3.ts --apply
 *   npx tsx scripts/migrate-existing-products-d1-d3.ts --d1-only --apply
 *   npx tsx scripts/migrate-existing-products-d1-d3.ts --d3-only --apply
 *   npx tsx scripts/migrate-existing-products-d1-d3.ts --limit=20 --sku=NX-1234
 *
 * Prerequisite migrations:
 *   - npx tsx scripts/shopify-metafield-defs.ts  # registers custom.product_subtype_dial
 *
 * Exit code: 0 on clean run, 1 if any product errored.
 */
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { dealHistory } from '../db/schema'
import { shopifyAdmin, adminGraphQL } from '../app/lib/shopify.server'
import { inferProductTaxonomy } from '../app/lib/claude.server'
import { makeLLMClient } from '../app/lib/llm-client.server'
import {
  PRODUCT_TYPE_DIALS,
  type ProductTypeDial,
  type ProductSubtypeDial,
} from '../app/types'

interface Args {
  apply:    boolean
  via:      'api' | 'claude-code'
  d1Only:   boolean
  d3Only:   boolean
  limit?:   number
  sku?:     string
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  const has = (flag: string) => args.includes(flag)
  const valOf = (prefix: string) => {
    const a = args.find(x => x.startsWith(`${prefix}=`))
    return a ? a.slice(prefix.length + 1) : undefined
  }
  const apply = has('--apply')
  const out: Args = {
    apply,
    via:    (valOf('--via') as Args['via']) ?? 'api',
    d1Only: has('--d1-only'),
    d3Only: has('--d3-only'),
  }
  const limit = valOf('--limit')
  if (limit) out.limit = Number(limit)
  if (!apply && out.limit === undefined) out.limit = 5
  const sku = valOf('--sku')
  if (sku) out.sku = sku
  if (out.via !== 'api' && out.via !== 'claude-code') {
    console.error(`Invalid --via=${out.via}. Use api or claude-code.`)
    process.exit(1)
  }
  if (out.d1Only && out.d3Only) {
    console.error('Cannot combine --d1-only with --d3-only. Drop both flags to run both passes.')
    process.exit(1)
  }
  return out
}

// ─── kebab → Title Case (matches toTitleCase in claude.server.ts) ─────────────

function kebabToTitleCase(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .map(word => word
      .split('-')
      .map(part => part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part)
      .join('-'))
    .join(' ')
    .trim()
}

function isAlreadyTitleCase(s: string): boolean {
  // Treat as Title Case if it contains a space OR if every "word" already has
  // its first letter uppercased. kebab-case slugs ("soft-touch") will have
  // no spaces and start with a lowercase letter, so they fail this check.
  if (s.includes(' ')) return true
  return /^[A-Z]/.test(s) && !s.includes('-') ? true : /^[A-Z]/.test(s)
}

// ─── Shopify metafield read/write helpers ─────────────────────────────────────

interface ShopifySnapshot {
  id:          string  // numeric
  title:       string
  vendor:      string
  description: string
  productTypeDial?:    string
  productSubtypeDial?: string
  moodTags:     string[]
  audienceTags: string[]
  mattersTags:  string[]
}

async function fetchSnapshot(numericId: string): Promise<ShopifySnapshot | null> {
  try {
    const { product } = await shopifyAdmin<{
      product: {
        id:          number
        title:       string
        vendor:      string
        body_html:   string
        metafields:  Array<{ namespace: string; key: string; value: string }>
      } | null
    }>(`/products/${numericId}.json?fields=id,title,vendor,body_html`)
    if (!product) return null

    // Pull metafields via Admin GraphQL — REST /metafields is paginated and slow.
    const mfRes = await adminGraphQL<{
      product: { metafields: { edges: Array<{ node: { namespace: string; key: string; value: string } }> } } | null
    }>(
      `query ProductMfs($id: ID!) {
         product(id: $id) {
           metafields(first: 50) {
             edges { node { namespace key value } }
           }
         }
       }`,
      { id: `gid://shopify/Product/${numericId}` },
    )
    const mfMap: Record<string, string> = {}
    for (const edge of mfRes.product?.metafields.edges ?? []) {
      mfMap[`${edge.node.namespace}.${edge.node.key}`] = edge.node.value
    }

    const parseListField = (raw: string | undefined): string[] => {
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
      } catch {
        return []
      }
    }

    return {
      id:                 String(product.id),
      title:              product.title,
      vendor:             product.vendor,
      description:        product.body_html ?? '',
      ...(mfMap['xdipx.product_type_dial']    ? { productTypeDial:    mfMap['xdipx.product_type_dial']    } : {}),
      ...(mfMap['custom.product_subtype_dial'] ? { productSubtypeDial: mfMap['custom.product_subtype_dial'] } : {}),
      moodTags:     parseListField(mfMap['xdipx.mood_tags']),
      audienceTags: parseListField(mfMap['xdipx.audience_tags']),
      mattersTags:  parseListField(mfMap['xdipx.matters_tags']),
    }
  } catch (err) {
    console.error(`[migrate-d1-d3] fetch ${numericId} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

async function writeMetafields(
  productGid: string,
  fields: Array<{ namespace: string; key: string; value: string; type: string }>,
): Promise<void> {
  const inputs = fields.map(f => ({ ...f, ownerId: productGid }))
  const res = await adminGraphQL<{
    metafieldsSet: { userErrors: Array<{ field: string[]; message: string }> }
  }>(
    `mutation MfSet($mfs: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $mfs) {
         userErrors { field message }
       }
     }`,
    { mfs: inputs },
  )
  const errs = res.metafieldsSet.userErrors
  if (errs.length > 0) {
    throw new Error(`metafieldsSet errors: ${errs.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')}`)
  }
}

// ─── D3 — kebab → Title Case (deterministic, no AI) ───────────────────────────

interface D3Result {
  changedAxes: string[]
  newMood:     string[]
  newAudience: string[]
  newMatters:  string[]
}

function transformAxis(values: string[]): { changed: boolean; next: string[] } {
  const next: string[] = []
  let changed = false
  for (const v of values) {
    const trimmed = v.trim()
    if (!trimmed) continue
    if (isAlreadyTitleCase(trimmed)) {
      next.push(trimmed)
      continue
    }
    const titled = kebabToTitleCase(trimmed)
    if (titled !== trimmed) changed = true
    next.push(titled)
  }
  return { changed, next }
}

function runD3Transform(snap: ShopifySnapshot): D3Result {
  const mood     = transformAxis(snap.moodTags)
  const audience = transformAxis(snap.audienceTags)
  const matters  = transformAxis(snap.mattersTags)
  const changedAxes: string[] = []
  if (mood.changed)     changedAxes.push('mood_tags')
  if (audience.changed) changedAxes.push('audience_tags')
  if (matters.changed)  changedAxes.push('matters_tags')
  return { changedAxes, newMood: mood.next, newAudience: audience.next, newMatters: matters.next }
}

// ─── D1 — Haiku reclassification of legacy 5-bucket → 19-value enum ───────────

const NEW_TOP_VALUES: ReadonlySet<string> = new Set(PRODUCT_TYPE_DIALS as readonly string[])

interface D1Result {
  changed:     boolean
  newType:     ProductTypeDial
  newSubtype:  ProductSubtypeDial | null
  reason:      string
}

async function runD1Reclassify(
  snap: ShopifySnapshot,
  llmClient: ReturnType<typeof makeLLMClient>,
): Promise<D1Result> {
  // Skip when already on the new enum AND has a subtype recorded.
  const currentTopIsNew = !!snap.productTypeDial && NEW_TOP_VALUES.has(snap.productTypeDial)
  if (currentTopIsNew && snap.productSubtypeDial) {
    return {
      changed:    false,
      newType:    snap.productTypeDial as ProductTypeDial,
      newSubtype: (snap.productSubtypeDial as ProductSubtypeDial) ?? null,
      reason:     'already on new enum + subtype set',
    }
  }

  const taxonomy = await inferProductTaxonomy({
    title:       snap.title,
    brand:       snap.vendor,
    description: snap.description.replace(/<[^>]+>/g, ' ').slice(0, 1500),
    categories:  [],
    llmClient,
  })

  const reason = currentTopIsNew
    ? `top unchanged (${taxonomy.type}); subtype filled (${taxonomy.subtype ?? 'null'})`
    : `${snap.productTypeDial ?? '(unset)'} → ${taxonomy.type} / ${taxonomy.subtype ?? 'null'}`

  return {
    changed:    snap.productTypeDial !== taxonomy.type
                || snap.productSubtypeDial !== (taxonomy.subtype ?? undefined),
    newType:    taxonomy.type,
    newSubtype: taxonomy.subtype,
    reason,
  }
}

// ─── Driver ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv)

  console.log('migrate-d1-d3 starting:', JSON.stringify({
    apply:  args.apply,
    via:    args.via,
    passes: args.d1Only ? 'D1' : args.d3Only ? 'D3' : 'D1+D3',
    limit:  args.limit,
    sku:    args.sku,
  }))

  // Pull product list from dealHistory (skip archived)
  let query = db
    .select({
      sku:              dealHistory.sku,
      shopifyProductId: dealHistory.shopifyProductId,
      status:           dealHistory.status,
    })
    .from(dealHistory)
    .where(sql`${dealHistory.status} != 'archived'`)
    .orderBy(dealHistory.sku)
  if (args.sku) {
    query = db
      .select({
        sku:              dealHistory.sku,
        shopifyProductId: dealHistory.shopifyProductId,
        status:           dealHistory.status,
      })
      .from(dealHistory)
      .where(sql`${dealHistory.sku} = ${args.sku}`)
  }
  let rows = await query
  if (args.limit !== undefined && args.limit > 0) rows = rows.slice(0, args.limit)
  console.log(`migrate-d1-d3: ${rows.length} products in scope`)

  const summary = {
    total:         rows.length,
    d1Changed:     0,
    d1Skipped:     0,
    d3Changed:     0,
    d3Skipped:     0,
    errors:        [] as Array<{ sku: string; message: string }>,
  }

  const llmClient = makeLLMClient(args.via)

  for (const row of rows) {
    if (!row.shopifyProductId) {
      summary.errors.push({ sku: row.sku, message: 'no shopifyProductId on dealHistory row' })
      continue
    }
    const snap = await fetchSnapshot(row.shopifyProductId)
    if (!snap) {
      summary.errors.push({ sku: row.sku, message: 'snapshot fetch returned null' })
      continue
    }

    try {
      const writes: Array<{ namespace: string; key: string; value: string; type: string }> = []
      const log: Record<string, unknown> = { sku: row.sku, shopifyProductId: row.shopifyProductId }

      // D3 — deterministic kebab → Title Case
      if (!args.d1Only) {
        const d3 = runD3Transform(snap)
        log['d3'] = { changedAxes: d3.changedAxes, mood: d3.newMood, audience: d3.newAudience, matters: d3.newMatters }
        if (d3.changedAxes.includes('mood_tags'))     writes.push({ namespace: 'xdipx', key: 'mood_tags',     value: JSON.stringify(d3.newMood),     type: 'list.single_line_text_field' })
        if (d3.changedAxes.includes('audience_tags')) writes.push({ namespace: 'xdipx', key: 'audience_tags', value: JSON.stringify(d3.newAudience), type: 'list.single_line_text_field' })
        if (d3.changedAxes.includes('matters_tags'))  writes.push({ namespace: 'xdipx', key: 'matters_tags',  value: JSON.stringify(d3.newMatters),  type: 'list.single_line_text_field' })
        if (d3.changedAxes.length > 0) summary.d3Changed++
        else                            summary.d3Skipped++
      }

      // D1 — Haiku reclassification
      if (!args.d3Only) {
        const d1 = await runD1Reclassify(snap, llmClient)
        log['d1'] = { changed: d1.changed, newType: d1.newType, newSubtype: d1.newSubtype, reason: d1.reason }
        if (d1.changed) {
          writes.push({ namespace: 'xdipx',  key: 'product_type_dial',    value: d1.newType,           type: 'single_line_text_field' })
          if (d1.newSubtype) writes.push({ namespace: 'custom', key: 'product_subtype_dial', value: d1.newSubtype, type: 'single_line_text_field' })
          summary.d1Changed++
        } else {
          summary.d1Skipped++
        }
      }

      log['willWrite']  = writes.length
      log['dryRun']     = !args.apply
      console.log(JSON.stringify(log))

      if (args.apply && writes.length > 0) {
        await writeMetafields(`gid://shopify/Product/${row.shopifyProductId}`, writes)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[migrate-d1-d3] ${row.sku} failed:`, msg)
      summary.errors.push({ sku: row.sku, message: msg })
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(summary, null, 2))
  if (summary.errors.length > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
