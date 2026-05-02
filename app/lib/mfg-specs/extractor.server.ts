/**
 * app/lib/mfg-specs/extractor.server.ts
 *
 * Phase 6d — Manufacturer-specs extraction.
 *
 * Extracts structured technical specs from two sources (in preference order):
 *   1. Nalpac CSV feed — has structured Material, Size, and Fluid Oz columns.
 *   2. Shopify product description — regex-parsed as a conservative fallback.
 *
 * Always calls cleanDescription() from feed-processor.server.ts on every text
 * value (fixes apostrophe/quote encoding bugs in the Nalpac feed).
 *
 * Conservative policy: leave a field null rather than guess. Downstream
 * slot-fillers (PRESENTATION, OBJECTION, RESEARCH stages) can degrade
 * gracefully when a field is absent.
 */

import { cleanDescription, fetchNalpacFeed } from '~/lib/feed-processor.server'
import type { NalpacProduct } from '~/types'

// ─── Output shape ──────────────────────────────────────────────────────────

export interface MfgSpecsRow {
  /** Shopify product handle — primary join key. */
  productHandle: string
  /** Shopify GID (gid://shopify/Product/…) if known. */
  productGid: string | undefined
  /** ISO timestamp of extraction. */
  lastSyncedAt: string
  /** Which extraction path populated this row. */
  sourceVersion: 'nalpac-csv-v1' | 'description-parse-v1'

  // ── Structured specs (all optional) ──────────────────────────────────────
  dimensions:          string | undefined
  weightG:             number | undefined
  material:            string | undefined
  batteryLifeMinutes:  number | undefined
  chargingPort:        string | undefined
  waterproofRating:    string | undefined
  noiseLevelDb:        number | undefined
  connectivity:        string | undefined
  compatibleLubes:     string[] | undefined
  careInstructions:    string | undefined
  manufacturerNotes:   string | undefined
}

// ─── Nalpac column extractors ───────────────────────────────────────────────

/**
 * Build a lookup of SKU -> NalpacProduct from the live feed.
 * Cached internally via fetchNalpacFeed's KV cache.
 */
let _nalpacIndex: Map<string, NalpacProduct> | null = null

async function getNalpacIndex(): Promise<Map<string, NalpacProduct>> {
  if (_nalpacIndex) return _nalpacIndex
  try {
    const rows = await fetchNalpacFeed()
    const idx = new Map<string, NalpacProduct>()
    for (const row of rows) {
      if (row.SKU) idx.set(row.SKU.trim(), row)
    }
    _nalpacIndex = idx
    return idx
  } catch {
    return new Map()
  }
}

/**
 * Clear the in-process Nalpac index cache. Useful for long-running scripts
 * that want a fresh fetch without restarting.
 */
export function clearNalpacIndexCache(): void {
  _nalpacIndex = null
}

/** Map a Nalpac Material column value to a clean, canonical string. */
function normalizeMaterial(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const clean = cleanDescription(raw).trim()
  if (!clean || clean === '-' || clean === 'N/A') return undefined
  return clean
}

/** Parse the Nalpac Size column: '7.5" x 1.5"' | '7.5 x 1.5 inches' */
function parseSizeToDimensions(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const clean = cleanDescription(raw).trim()
  if (!clean || clean === '-' || clean === 'N/A') return undefined
  // Normalize "7.5 inches x 1.5 inches" -> "7.5" x 1.5""
  const normalized = clean
    .replace(/(\d+(\.\d+)?)\s*in(ches?)?/gi, (_, n) => `${n}"`)
    .trim()
  if (!normalized) return undefined
  return normalized
}

/** Convert Fluid Oz to an approximate weight in grams (1 fl oz ≈ 28.35 g). */
function fluidOzToGrams(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const val = parseFloat(raw)
  if (Number.isNaN(val) || val <= 0) return undefined
  // Only make this inference for small/medium values (0.1 – 32 fl oz).
  // Larger values are likely a product unit count or data error.
  if (val > 32) return undefined
  return Math.round(val * 28.35)
}

/**
 * Extract specs from the Nalpac feed row for a given SKU.
 * Returns a partial MfgSpecsRow or null if no matching SKU.
 */
async function extractFromNalpac(
  nalpacSku: string | undefined,
  description: string,
): Promise<Partial<MfgSpecsRow> | null> {
  if (!nalpacSku) return null
  const idx = await getNalpacIndex()
  const row = idx.get(nalpacSku.trim())
  if (!row) return null

  const specs: Partial<MfgSpecsRow> = {
    sourceVersion: 'nalpac-csv-v1',
  }

  specs.material   = normalizeMaterial(row.Material)
  specs.dimensions = parseSizeToDimensions(row.Size)
  specs.weightG    = fluidOzToGrams(row['Fluid Oz'])

  // Description-based fields even for nalpac-csv-v1: the feed doesn't have
  // structured columns for battery, charging, waterproof, or noise.
  const descSpecs = extractFromDescription(description)
  if (descSpecs.chargingPort)       specs.chargingPort       = descSpecs.chargingPort
  if (descSpecs.waterproofRating)   specs.waterproofRating   = descSpecs.waterproofRating
  if (descSpecs.batteryLifeMinutes) specs.batteryLifeMinutes = descSpecs.batteryLifeMinutes
  if (descSpecs.connectivity)       specs.connectivity       = descSpecs.connectivity
  if (descSpecs.compatibleLubes)    specs.compatibleLubes    = descSpecs.compatibleLubes
  if (descSpecs.noiseLevelDb)       specs.noiseLevelDb       = descSpecs.noiseLevelDb

  // Capture manufacturer notes from cleaned description.
  const cleanedDesc = cleanDescription(row['Product Description'] ?? '').slice(0, 600)
  if (cleanedDesc) specs.manufacturerNotes = cleanedDesc

  return specs
}

// ─── Description regex extractors ──────────────────────────────────────────

/** Reasonable conservative patterns — only match when confident. */
interface DescriptionSpecs {
  dimensions?:          string
  batteryLifeMinutes?:  number
  chargingPort?:        string
  waterproofRating?:    string
  noiseLevelDb?:        number
  connectivity?:        string
  compatibleLubes?:     string[]
}

export function extractFromDescription(raw: string): DescriptionSpecs {
  if (!raw) return {}
  const text = cleanDescription(raw)
  const lower = text.toLowerCase()
  const specs: DescriptionSpecs = {}

  // ── Dimensions ─────────────────────────────────────────────────────────
  // Match patterns like: 7.5" x 1.5", 6 inches long, 5.5" insertable
  const dimMatch = text.match(
    /(\d+\.?\d*)\s*[""']\s*[xX×]\s*(\d+\.?\d*)\s*[""']/,
  )
  if (dimMatch) {
    specs.dimensions = `${dimMatch[1]}" x ${dimMatch[2]}"`
  } else {
    // Single measurement with "insertable" label
    const insertMatch = text.match(
      /(\d+\.?\d*)\s*(inches?|[""'])\s+insertable/i,
    )
    if (insertMatch) {
      const n = insertMatch[1]
      specs.dimensions = `${n}" insertable`
    }
  }

  // ── Battery life ───────────────────────────────────────────────────────
  // "up to 2 hours", "60 minutes run time", "1 hour battery"
  const hourMatch = text.match(
    /(?:up\s+to\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:of\s+)?(?:run\s*time|battery|play|use|runtime)?/i,
  )
  if (hourMatch?.[1]) {
    const hrs = parseFloat(hourMatch[1])
    if (hrs > 0 && hrs <= 24) {
      specs.batteryLifeMinutes = Math.round(hrs * 60)
    }
  } else {
    const minMatch = text.match(
      /(?:up\s+to\s+)?(\d+)\s*(?:minutes?|mins?)\s*(?:of\s+)?(?:run\s*time|battery|play|use|runtime)?/i,
    )
    if (minMatch?.[1]) {
      const mins = parseInt(minMatch[1])
      if (mins > 5 && mins <= 1440) {
        specs.batteryLifeMinutes = mins
      }
    }
  }

  // ── Charging port ──────────────────────────────────────────────────────
  if (lower.includes('usb-c') || lower.includes('usb c') || lower.includes('type-c')) {
    specs.chargingPort = 'USB-C'
  } else if (lower.includes('micro-usb') || lower.includes('micro usb')) {
    specs.chargingPort = 'micro-USB'
  } else if (lower.includes('magnetic') && (lower.includes('charge') || lower.includes('charging'))) {
    specs.chargingPort = 'magnetic'
  } else if (/replaceable?\s*(?:aa|aaa|batteries?)/i.test(text)) {
    specs.chargingPort = 'replaceable AA'
  }

  // ── Waterproof rating ──────────────────────────────────────────────────
  const ipxMatch = text.match(/IPX\s*([1-9])/i)
  if (ipxMatch?.[1]) {
    specs.waterproofRating = `IPX${ipxMatch[1]}`
  } else if (lower.includes('fully submersible') || lower.includes('100% waterproof')) {
    specs.waterproofRating = 'fully submersible'
  } else if (lower.includes('waterproof')) {
    specs.waterproofRating = 'waterproof'
  } else if (lower.includes('splashproof') || lower.includes('splash proof') || lower.includes('splash-proof')) {
    specs.waterproofRating = 'splashproof'
  } else if (lower.includes('not waterproof') || lower.includes('not submersible')) {
    specs.waterproofRating = 'not waterproof'
  }

  // ── Noise level ────────────────────────────────────────────────────────
  const dbMatch = text.match(/(\d{2,3})\s*dB/i)
  if (dbMatch?.[1]) {
    const db = parseInt(dbMatch[1])
    if (db >= 20 && db <= 100) {
      specs.noiseLevelDb = db
    }
  }

  // ── Connectivity ───────────────────────────────────────────────────────
  const hasApp = lower.includes('app-controlled') || lower.includes('app controlled') ||
    (lower.includes('app') && lower.includes('bluetooth'))
  const hasBluetooth = lower.includes('bluetooth')
  const hasRemote = lower.includes('remote control') || lower.includes('wireless remote')

  if (hasApp || (hasBluetooth && lower.includes('app'))) {
    specs.connectivity = 'app-controlled (Bluetooth)'
  } else if (hasRemote) {
    specs.connectivity = 'remote'
  } else if (hasBluetooth) {
    specs.connectivity = 'app-controlled (Bluetooth)'
  }

  // ── Compatible lubes ───────────────────────────────────────────────────
  const lubes: string[] = []
  if (lower.includes('water-based') || lower.includes('water based')) lubes.push('water-based')
  if (lower.includes('silicone-based') || lower.includes('silicone based')) lubes.push('silicone-based')
  if (lower.includes('oil-based') || lower.includes('oil based')) lubes.push('oil-based')
  if (lubes.length > 0) specs.compatibleLubes = lubes

  return specs
}

// ─── Main extractor ─────────────────────────────────────────────────────────

export interface ProductInput {
  handle: string
  gid?: string | undefined
  /** Shopify product description HTML — stripped by caller to plain text before passing. */
  description?: string | undefined
  /** Nalpac SKU from Shopify xdipx.nalpac_sku metafield. */
  nalpacSku?: string | undefined
}

/**
 * Extract structured manufacturer specs for a product.
 *
 * Sources in order of preference:
 *   1. Nalpac CSV (Material, Size, Fluid Oz columns — structured).
 *   2. Description regex parse (battery, charging port, waterproof, etc.).
 *
 * Returns a MfgSpecsRow with at least the identity fields populated.
 * Spec fields may be undefined when data is absent or ambiguous.
 */
export async function extractSpecsFromProduct(product: ProductInput): Promise<MfgSpecsRow> {
  const now = new Date().toISOString()

  // Strip HTML from description for regex matching.
  const rawDescription = (product.description ?? '').replace(/<[^>]+>/g, ' ')
  const cleanedDescription = cleanDescription(rawDescription)

  // 1. Try Nalpac feed first.
  const nalpacSpecs = await extractFromNalpac(product.nalpacSku, cleanedDescription)

  if (nalpacSpecs) {
    return {
      productHandle:      product.handle,
      productGid:         product.gid,
      lastSyncedAt:       now,
      sourceVersion:      'nalpac-csv-v1',
      dimensions:         nalpacSpecs.dimensions,
      weightG:            nalpacSpecs.weightG,
      material:           nalpacSpecs.material,
      batteryLifeMinutes: nalpacSpecs.batteryLifeMinutes,
      chargingPort:       nalpacSpecs.chargingPort,
      waterproofRating:   nalpacSpecs.waterproofRating,
      noiseLevelDb:       nalpacSpecs.noiseLevelDb,
      connectivity:       nalpacSpecs.connectivity,
      compatibleLubes:    nalpacSpecs.compatibleLubes,
      careInstructions:   undefined,
      manufacturerNotes:  nalpacSpecs.manufacturerNotes,
    }
  }

  // 2. Description parse fallback.
  const descSpecs = extractFromDescription(cleanedDescription)

  return {
    productHandle:      product.handle,
    productGid:         product.gid,
    lastSyncedAt:       now,
    sourceVersion:      'description-parse-v1',
    dimensions:         descSpecs.dimensions,
    weightG:            undefined,
    material:           undefined,
    batteryLifeMinutes: descSpecs.batteryLifeMinutes,
    chargingPort:       descSpecs.chargingPort,
    waterproofRating:   descSpecs.waterproofRating,
    noiseLevelDb:       descSpecs.noiseLevelDb,
    connectivity:       descSpecs.connectivity,
    compatibleLubes:    descSpecs.compatibleLubes,
    careInstructions:   undefined,
    manufacturerNotes:  cleanedDescription.slice(0, 600) || undefined,
  }
}
