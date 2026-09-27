/**
 * scripts/audit-product-fidelity.ts
 *
 * Ticket #11923, SPLIT 3 of 3 from #11487. The reproduction case (ROMP 2.0,
 * social_media_assets 675 vs the bare reference 97829B.jpg) shipped as a
 * one-off fix under ticket #11544 (PR #1354): `app/lib/social-product-fidelity
 * .server.ts` compares a rendered on-skin candidate against the bare product
 * reference the generator was actually given, rating silhouette/colour/finish
 * /brandMark as match/drift/not-applicable, report-only. What #11544 did not
 * add is a way to ask "how often does this happen across the catalog" —
 * nothing before this script re-ran the check in bulk. This script is that
 * audit: it re-reads the fidelity check against recent on-skin assets and
 * reports the drift rate overall and by product class, so a later session can
 * tell the owner whether the ROMP 2.0 drift was rose-specific or general.
 *
 * (This split's own body named a dependency on ticket #11921's VisionVerdict
 * `productFidelity` field, persisted via `recordVisionVerdict`. #11921 was
 * blocked as superseded: #11544 had already shipped the comparison, just as
 * a separate module recording `fidelity:*` tags rather than a VisionVerdict
 * field. This script reads from what actually exists —
 * `runProductFidelityCheck` in `social-product-fidelity.server.ts` — instead
 * of the field #11921 was never going to add.)
 *
 * Needs `ANTHROPIC_API_KEY` (the same credential `social-product-fidelity
 * .server.ts` already calls in production), `DATABASE_URL`, and Shopify
 * Storefront credentials (`getProductByHandle` resolves each asset's bare
 * product reference from `xdipx.bare_product_reference`). Not run from this
 * session — see the ticket note on why that run is separate from this row.
 *
 * Scope: on-skin assets only (`castSlugs` populated — a real presenter's body
 * in frame, the only category a product-on-body fidelity check is meaningful
 * on), most recent first, whose product handle resolves to a Shopify product
 * carrying a confirmed bare product reference. An asset whose product has no
 * bare reference is skipped and counted, not silently dropped from the
 * denominator.
 *
 * Read-only by default. `--write` additionally persists each completed
 * verdict's drift findings as `fidelity:<axis>=<match|drift|not-applicable>`
 * tags on the asset row, via `addAssetTags` — the same tag convention
 * `maybeCheckProductFidelity` already writes at generation time, so a
 * `--write` run backfills tags on assets that predate that wiring instead of
 * inventing a second persistence shape.
 *
 * Usage:
 *   npx tsx scripts/audit-product-fidelity.ts [--since 2026-09-01] [--limit 20]
 *     [--write]
 */

import './_load-env'
import { and, desc, gte, sql } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { socialMediaAssets } from '../db/schema'
import { getProductByHandle } from '../app/lib/shopify.server'
import {
  runProductFidelityCheck,
  formatFidelityTags,
  hasFidelityDrift,
  type ProductFidelityVerdict,
} from '../app/lib/social-product-fidelity.server'

const sinceArg = process.argv.indexOf('--since')
const SINCE = sinceArg >= 0 ? new Date(process.argv[sinceArg + 1]!) : null
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 20
const WRITE = process.argv.includes('--write')

export const PRODUCT_CLASSES = ['rose/air-pulse', 'wand', 'bullet', 'plug', 'lube bottle', 'other'] as const
export type ProductClass = (typeof PRODUCT_CLASSES)[number]

/**
 * Pure classifier, unit-tested against fixture rows without a database or
 * network call. Keyword-matches the handle/title first (the signal that is
 * actually present on every product regardless of enrichment state), then
 * falls back to `xdipx.product_type_dial` for the two classes it can name
 * (`air-pulsation`, `wand`) — that metafield's own vocabulary has no `bullet`,
 * `plug`, or `lube` values, so those three stay keyword-only.
 */
export function classifyProductClass(input: {
  handle: string
  title?: string | null
  productTypeDial?: string | null
}): ProductClass {
  const text = `${input.handle} ${input.title ?? ''}`.toLowerCase()
  if (/\brose\b/.test(text)) return 'rose/air-pulse'
  if (input.productTypeDial === 'air-pulsation') return 'rose/air-pulse'
  if (/\bwand\b/.test(text)) return 'wand'
  if (input.productTypeDial === 'wand') return 'wand'
  if (/\bbullet\b/.test(text)) return 'bullet'
  if (/\bplug\b/.test(text)) return 'plug'
  if (/\blube\b|\blubricant\b/.test(text)) return 'lube bottle'
  return 'other'
}

interface CandidateRow {
  id: number
  url: string
  productHandle: string | null
  castSlugs: string[] | null
  createdAt: Date
}

interface AuditFinding {
  id: number
  url: string
  productHandle: string
  productClass: ProductClass
  referenceUrl: string
  verdict: ProductFidelityVerdict
}

/** Report logic, unit-tested separately from the live DB/model calls above. */
export function summarizeFindings(findings: AuditFinding[], skipped: number): {
  checked: number
  skippedNoReference: number
  driftCount: number
  driftRate: number
  byClass: Record<ProductClass, { checked: number; drift: number; driftRate: number }>
} {
  const byClass = Object.fromEntries(
    PRODUCT_CLASSES.map((c) => [c, { checked: 0, drift: 0, driftRate: 0 }]),
  ) as Record<ProductClass, { checked: number; drift: number; driftRate: number }>

  let driftCount = 0
  for (const f of findings) {
    const bucket = byClass[f.productClass]
    bucket.checked++
    if (hasFidelityDrift(f.verdict)) {
      driftCount++
      bucket.drift++
    }
  }
  for (const c of PRODUCT_CLASSES) {
    const bucket = byClass[c]
    bucket.driftRate = bucket.checked > 0 ? Number((bucket.drift / bucket.checked).toFixed(4)) : 0
  }

  return {
    checked: findings.length,
    skippedNoReference: skipped,
    driftCount,
    driftRate: findings.length > 0 ? Number((driftCount / findings.length).toFixed(4)) : 0,
    byClass,
  }
}

async function main() {
  const conditions = [
    sql`jsonb_array_length(coalesce(${socialMediaAssets.castSlugs}, '[]'::jsonb)) > 0`,
    ...(SINCE ? [gte(socialMediaAssets.createdAt, SINCE)] : []),
  ]

  const rows = await db
    .select({
      id: socialMediaAssets.id,
      url: socialMediaAssets.url,
      productHandle: socialMediaAssets.productHandle,
      castSlugs: socialMediaAssets.castSlugs,
      createdAt: socialMediaAssets.createdAt,
    })
    .from(socialMediaAssets)
    .where(and(...conditions))
    .orderBy(desc(socialMediaAssets.createdAt))
    .limit(LIMIT)

  const candidates = rows as CandidateRow[]
  console.log(`[audit-product-fidelity] ${candidates.length} on-skin asset(s), most recent first`)

  const findings: AuditFinding[] = []
  let skippedNoReference = 0

  for (const row of candidates) {
    if (!row.productHandle) {
      skippedNoReference++
      console.error(`[audit-product-fidelity] asset ${row.id} has no productHandle; skipping`)
      continue
    }
    const product = await getProductByHandle(row.productHandle)
    const referenceUrl = product?.bareProductReference?.url ?? null
    if (!referenceUrl) {
      skippedNoReference++
      console.error(`[audit-product-fidelity] asset ${row.id} (${row.productHandle}) has no confirmed bare product reference; skipping`)
      continue
    }

    const verdict = await runProductFidelityCheck(row.url, referenceUrl)
    const productClass = classifyProductClass({
      handle: row.productHandle,
      title: product?.title ?? null,
      productTypeDial: product?.productTypeDial ?? null,
    })
    findings.push({ id: row.id, url: row.url, productHandle: row.productHandle, productClass, referenceUrl, verdict })

    if (hasFidelityDrift(verdict)) {
      console.error(`[audit-product-fidelity] DRIFT asset ${row.id} (${row.productHandle}, ${productClass}): ${verdict.notes}`)
    }

    if (WRITE) {
      const { addAssetTags } = await import('../app/lib/social-studio.server')
      for (const tag of formatFidelityTags(verdict)) {
        await addAssetTags([row.id], tag)
      }
    }
  }

  const summary = summarizeFindings(findings, skippedNoReference)
  console.log(JSON.stringify({
    ...summary,
    findings: findings.map((f) => ({
      id: f.id,
      url: f.url,
      productHandle: f.productHandle,
      productClass: f.productClass,
      referenceUrl: f.referenceUrl,
      verdict: f.verdict,
    })),
  }, null, 2))
}

// Guarded so `main` never runs as a side effect of importing the pure
// `classifyProductClass`/`summarizeFindings` functions from the test file.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[audit-product-fidelity] fatal:', err)
      process.exit(1)
    })
}
