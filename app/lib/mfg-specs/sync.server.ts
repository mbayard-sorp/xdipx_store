/**
 * app/lib/mfg-specs/sync.server.ts
 *
 * Phase 6d — Manufacturer-specs sync hook.
 *
 * Called by the orchestrator after a new product is imported so the
 * mfgProductSpecs Sanity doc stays up to date automatically. Fire-and-forget
 * safe: errors are logged but not thrown so callers don't need a try/catch.
 *
 * DO NOT modify bulk-import.server.ts to call this — the orchestrator wires
 * the call site at integration time.
 */

import { createClient } from '@sanity/client'
import { extractSpecsFromProduct, clearNalpacIndexCache } from './extractor.server'
import { getProductByHandle } from '~/lib/shopify.server'

// ─── Sanity write client ───────────────────────────────────────────────────

function getSanityWriteClient() {
  const projectId = process.env['SANITY_PROJECT_ID']
  const token     = process.env['SANITY_API_TOKEN']
  if (!projectId || !token) return null
  return createClient({
    projectId,
    dataset:    process.env['SANITY_DATASET'] ?? 'production',
    apiVersion: '2024-10-01',
    token,
    useCdn:     false,
  })
}

// ─── Upsert helper ─────────────────────────────────────────────────────────

/** Build the Sanity doc from a MfgSpecsRow. Undefined fields are omitted. */
function buildDoc(specs: Awaited<ReturnType<typeof extractSpecsFromProduct>>): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    _id:            `mfgProductSpecs-${specs.productHandle}`,
    _type:          'mfgProductSpecs',
    productHandle:  specs.productHandle,
    lastSyncedAt:   specs.lastSyncedAt,
    sourceVersion:  specs.sourceVersion,
  }

  if (specs.productGid !== undefined)        doc.productGid         = specs.productGid
  if (specs.dimensions !== undefined)        doc.dimensions         = specs.dimensions
  if (specs.weightG !== undefined)           doc.weightG            = specs.weightG
  if (specs.material !== undefined)          doc.material           = specs.material
  if (specs.batteryLifeMinutes !== undefined) doc.batteryLifeMinutes = specs.batteryLifeMinutes
  if (specs.chargingPort !== undefined)      doc.chargingPort       = specs.chargingPort
  if (specs.waterproofRating !== undefined)  doc.waterproofRating   = specs.waterproofRating
  if (specs.noiseLevelDb !== undefined)      doc.noiseLevelDb       = specs.noiseLevelDb
  if (specs.connectivity !== undefined)      doc.connectivity       = specs.connectivity
  if (specs.compatibleLubes !== undefined)   doc.compatibleLubes    = specs.compatibleLubes
  if (specs.careInstructions !== undefined)  doc.careInstructions   = specs.careInstructions
  if (specs.manufacturerNotes !== undefined) doc.manufacturerNotes  = specs.manufacturerNotes

  return doc
}

/**
 * Upsert one mfgProductSpecs doc into Sanity. Idempotent — safe to re-run.
 * Uses createOrReplace so the full doc is always written with current data.
 */
export async function upsertMfgSpecs(
  specs: Awaited<ReturnType<typeof extractSpecsFromProduct>>,
): Promise<{ upserted: boolean }> {
  const client = getSanityWriteClient()
  if (!client) {
    console.warn('[mfg-specs/sync] Sanity not configured — skipping upsert')
    return { upserted: false }
  }

  const doc = buildDoc(specs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.createOrReplace(doc as any)
  return { upserted: true }
}

/**
 * Fetch mfgProductSpecs from Sanity by product handle.
 * Returns null if not found or Sanity is not configured.
 */
export async function getMfgSpecs(handle: string): Promise<Record<string, string> | null> {
  const projectId = process.env['SANITY_PROJECT_ID']
  const token     = process.env['SANITY_API_TOKEN']
  if (!projectId || !token) return null

  const client = createClient({
    projectId,
    dataset:    process.env['SANITY_DATASET'] ?? 'production',
    apiVersion: '2024-10-01',
    token,
    useCdn:     true,
  })

  try {
    const doc = await client.fetch<Record<string, unknown> | null>(
      `*[_type == "mfgProductSpecs" && productHandle == $handle][0]`,
      { handle },
    )
    if (!doc) return null

    // Flatten to Record<string, string> for ProductContext.manufacturerSpecs
    const result: Record<string, string> = {}
    const specFields: Array<keyof typeof doc> = [
      'dimensions', 'material', 'chargingPort', 'waterproofRating',
      'connectivity', 'careInstructions', 'manufacturerNotes',
    ]
    for (const field of specFields) {
      const val = doc[field]
      if (typeof val === 'string' && val.trim()) {
        result[field as string] = val.trim()
      }
    }
    if (typeof doc.weightG === 'number')            result.weightG            = `${doc.weightG}g`
    if (typeof doc.batteryLifeMinutes === 'number') result.batteryLifeMinutes = `${doc.batteryLifeMinutes} min`
    if (typeof doc.noiseLevelDb === 'number')       result.noiseLevelDb       = `${doc.noiseLevelDb} dB`
    if (Array.isArray(doc.compatibleLubes) && doc.compatibleLubes.length > 0) {
      result.compatibleLubes = (doc.compatibleLubes as string[]).join(', ')
    }

    return Object.keys(result).length > 0 ? result : null
  } catch (err) {
    console.warn('[mfg-specs/sync] getMfgSpecs error:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Pure decision: does this mfgProductSpecs doc shape back a first-party
 * material claim? Only the Nalpac feed's structured Material column
 * (`sourceVersion: 'nalpac-csv-v1'` in extractor.server.ts) counts. The
 * `description-parse-v1` fallback never populates `material` at all (see
 * extractFromDescription), so that sourceVersion, a missing doc, or an empty
 * material string all mean "no first-party support". Exported separately
 * from hasFirstPartyMaterial so this logic is unit-testable without mocking
 * the Sanity client.
 */
export function isFirstPartyMaterialDoc(doc: { sourceVersion?: string; material?: string } | null): boolean {
  return doc?.sourceVersion === 'nalpac-csv-v1' && typeof doc.material === 'string' && doc.material.trim().length > 0
}

/**
 * Whether a product's manufacturer material is first-party backed. Used as a
 * write gate for the AI-generated `writes.material` claim before it reaches
 * `applyMaterial` (ticket #19981, split from #19950 / the sku-78048
 * "Body-safe silicone" overclaim with no first-party source). No Sanity
 * credentials, no doc, or a fetch error all fail closed to false rather than
 * guess.
 */
export async function hasFirstPartyMaterial(handle: string): Promise<boolean> {
  const projectId = process.env['SANITY_PROJECT_ID']
  const token     = process.env['SANITY_API_TOKEN']
  if (!projectId || !token) return false

  const client = createClient({
    projectId,
    dataset:    process.env['SANITY_DATASET'] ?? 'production',
    apiVersion: '2024-10-01',
    token,
    useCdn:     true,
  })

  try {
    const doc = await client.fetch<{ sourceVersion?: string; material?: string } | null>(
      `*[_type == "mfgProductSpecs" && productHandle == $handle][0]{sourceVersion, material}`,
      { handle },
    )
    return isFirstPartyMaterialDoc(doc)
  } catch (err) {
    console.warn('[mfg-specs/sync] hasFirstPartyMaterial error:', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Fire-and-forget sync hook.
 *
 * Fetches the product from Shopify, extracts specs, and upserts into Sanity.
 * Errors are caught and logged — never throws.
 *
 * Usage: after importing a product, call without awaiting.
 *   syncSpecsForProduct(handle).catch(console.warn)
 */
export async function syncSpecsForProduct(handle: string): Promise<void> {
  try {
    // Clear the in-process Nalpac index so we get a fresh view of the feed.
    clearNalpacIndexCache()

    const product = await getProductByHandle(handle)
    if (!product) {
      console.warn(`[mfg-specs/sync] product not found: ${handle}`)
      return
    }

    // Extract Nalpac SKU from product tags (format: nalpac-sku-XXXXX).
    const nalpacTag = product.tags.find(t => t.startsWith('nalpac-sku-'))
    const nalpacSku = nalpacTag ? nalpacTag.replace('nalpac-sku-', '') : undefined

    const descriptionRaw = (product as unknown as { description?: string }).description ?? ''

    const specs = await extractSpecsFromProduct({
      handle,
      gid:       product.id,
      description: descriptionRaw,
      nalpacSku,
    })

    await upsertMfgSpecs(specs)
    console.info(`[mfg-specs/sync] synced: ${handle} (source: ${specs.sourceVersion})`)
  } catch (err) {
    console.warn('[mfg-specs/sync] syncSpecsForProduct error:', handle, err instanceof Error ? err.message : err)
  }
}
