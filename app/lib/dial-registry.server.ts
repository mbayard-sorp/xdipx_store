import { createClient } from '@sanity/client'
import type { ProductTypeDial } from '~/types'

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

const SINGLETON_ID          = 'singleton.dialRegistry'
const TAXONOMY_SINGLETON_ID = 'singleton.dialTaxonomy'

// Phase 1 rebuild — ProductTypeDial expanded from 5 to 19 values. The Sanity
// schema for dialRegistry / dialTaxonomy still has the legacy fields
// (airPulsation, vibrator, wand, lube, wear). The runtime here reads those
// legacy fields and routes them under the new top-level taxonomy:
//   airPulsation / wand → vibrator (legacy values are now subtypes)
//   vibrator / lube / wear → unchanged (legacy keys = new top-level keys)
// Once the Sanity admin migration adds entries for the other 16 top-level
// types (dildo, anal, bondage, etc.), expand TYPE_TO_FIELD accordingly.
// Until then, unknown types return empty arrays — the sensation-dial generator
// falls back to "(none — invent appropriate labels)" per its prompt.
const TYPE_TO_FIELD: Partial<Record<ProductTypeDial, string>> = {
  vibrator: 'vibrator',
  lube:     'lube',
  wear:     'wear',
}

const FALLBACK: Partial<Record<ProductTypeDial, string[]>> = {
  vibrator: ['Intensity', 'Quietness', 'Pattern variety', 'Buildup speed', 'Battery life', 'Learning curve'],
  lube:     ['Slipperiness', 'Longevity', 'Taste-safe', 'Body-safe', 'Tidy-up', 'Skin feel'],
  wear:     ['Fit', 'Softness', 'Washability', 'Discretion', 'Adjustability', 'Occasion'],
}

export type DialRegistry = Partial<Record<ProductTypeDial, string[]>>

/** Rich dimension entry — companion to the flat label list. Optional fields
 *  let editors fill in scale documentation incrementally without breaking
 *  read paths that only need the label. */
export interface DialDimensionEntry {
  label:      string
  definition?: string
  scaleLow?:  string  // value 1
  scaleMid?:  string  // value 3
  scaleHigh?: string  // value 5
}

export type DialTaxonomy = Partial<Record<ProductTypeDial, DialDimensionEntry[]>>

function client(write = false) {
  if (!projectId) return null
  const token = process.env['SANITY_API_TOKEN']
  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: !write,
    ...(token ? { token } : {}),
  })
}

export async function getDialRegistry(): Promise<DialRegistry> {
  const c = client(false)
  if (!c) return { ...FALLBACK }
  try {
    const doc = await c.fetch<Record<string, string[] | undefined>>(`*[_id == $id][0]{
      airPulsation, vibrator, wand, lube, wear
    }`, { id: SINGLETON_ID })
    // Legacy `airPulsation` and `wand` fields collapse into `vibrator` under
    // the expanded ProductTypeDial. De-dupe labels when merging.
    const vibratorLabels = [
      ...(doc?.['vibrator']     ?? []),
      ...(doc?.['airPulsation'] ?? []),
      ...(doc?.['wand']         ?? []),
    ]
    const dedupedVibrator = vibratorLabels.length > 0
      ? Array.from(new Set(vibratorLabels))
      : FALLBACK.vibrator
    const out: DialRegistry = {}
    if (dedupedVibrator?.length) out.vibrator = dedupedVibrator
    if (doc?.['lube']?.length)   out.lube     = doc['lube']
    else if (FALLBACK.lube)      out.lube     = FALLBACK.lube
    if (doc?.['wear']?.length)   out.wear     = doc['wear']
    else if (FALLBACK.wear)      out.wear     = FALLBACK.wear
    return out
  } catch (err) {
    console.error('[dial-registry] fetch failed, using fallback:', err)
    return { ...FALLBACK }
  }
}

export async function getDialLabelsForType(type: ProductTypeDial): Promise<string[]> {
  const reg = await getDialRegistry()
  return reg[type] ?? []
}

/**
 * Read the rich dial taxonomy — companion to the flat label list. Returns
 * empty arrays when the singleton hasn't been seeded yet (callers should
 * always check length and fall back to the flat label list).
 */
export async function getDialTaxonomy(): Promise<DialTaxonomy> {
  const empty: DialTaxonomy = {}
  const c = client(false)
  if (!c) return empty
  try {
    const doc = await c.fetch<Record<string, DialDimensionEntry[] | undefined>>(`*[_id == $id][0]{
      airPulsation, vibrator, wand, lube, wear
    }`, { id: TAXONOMY_SINGLETON_ID })
    if (!doc) return empty
    // Same legacy collapsing as getDialRegistry — airPulsation/wand fold into
    // vibrator under the expanded ProductTypeDial. Dedupe by label.
    const vibratorEntries = [
      ...(Array.isArray(doc['vibrator'])     ? doc['vibrator']     : []),
      ...(Array.isArray(doc['airPulsation']) ? doc['airPulsation'] : []),
      ...(Array.isArray(doc['wand'])         ? doc['wand']         : []),
    ]
    const seenLabels = new Set<string>()
    const dedupedVibrator: DialDimensionEntry[] = []
    for (const entry of vibratorEntries) {
      if (!entry?.label || seenLabels.has(entry.label)) continue
      seenLabels.add(entry.label)
      dedupedVibrator.push(entry)
    }
    return {
      vibrator: dedupedVibrator,
      lube:     Array.isArray(doc['lube']) ? doc['lube'] : [],
      wear:     Array.isArray(doc['wear']) ? doc['wear'] : [],
    }
  } catch (err) {
    console.error('[dial-registry] taxonomy fetch failed, returning empty:', err)
    return empty
  }
}

/**
 * Write the rich taxonomy for a product type. Used by the seed script.
 * Replaces the existing array — caller is responsible for merging if needed.
 * Also mirrors the labels into the flat dialRegistry so back-compat readers
 * keep working without a separate write.
 */
export async function writeDialTaxonomyForType(
  type: ProductTypeDial,
  entries: DialDimensionEntry[],
): Promise<void> {
  const c = client(true)
  if (!c) throw new Error('Sanity client unavailable — set SANITY_PROJECT_ID and SANITY_API_TOKEN')

  const field = TYPE_TO_FIELD[type]
  if (!field) {
    // Phase 1 transitional state — Sanity dialTaxonomy/dialRegistry singletons
    // only have fields for the legacy {vibrator, lube, wear} subset of the
    // expanded ProductTypeDial. Writing a new top-level type (dildo, anal, etc.)
    // requires the Sanity admin schema migration first.
    throw new Error(`No Sanity dialTaxonomy field mapped for product type "${type}". Run the Sanity dialRegistry migration before writing this type.`)
  }

  // Ensure singletons exist before patching.
  await c.createIfNotExists({ _id: TAXONOMY_SINGLETON_ID, _type: 'dialTaxonomy' })
  await c.createIfNotExists({ _id: SINGLETON_ID,          _type: 'dialRegistry' })

  // Patch rich taxonomy. Store as plain objects with `_type: 'dialDimension'`
  // so Studio can render the editor for each entry.
  const docified = entries.map(e => {
    const obj: Record<string, unknown> = {
      _type: 'dialDimension',
      _key:  randomKey(),
      label: e.label.trim(),
    }
    if (e.definition?.trim()) obj['definition'] = e.definition.trim()
    if (e.scaleLow?.trim())   obj['scaleLow']   = e.scaleLow.trim()
    if (e.scaleMid?.trim())   obj['scaleMid']   = e.scaleMid.trim()
    if (e.scaleHigh?.trim())  obj['scaleHigh']  = e.scaleHigh.trim()
    return obj
  })
  await c.patch(TAXONOMY_SINGLETON_ID).set({ [field]: docified }).commit()

  // Mirror flat labels into the back-compat singleton.
  const labels = entries.map(e => e.label.trim()).filter(Boolean)
  await c.patch(SINGLETON_ID).set({ [field]: labels }).commit()
}

function randomKey(): string {
  return Math.random().toString(36).slice(2, 14)
}

/**
 * Append a label to the registry for a product type. Idempotent — no-op if the
 * label (case-insensitive) already exists. Returns the updated list.
 */
export async function appendDialLabel(
  type: ProductTypeDial,
  label: string,
): Promise<string[]> {
  const trimmed = label.trim()
  if (!trimmed) throw new Error('label cannot be empty')

  const c = client(true)
  if (!c) throw new Error('Sanity client unavailable — set SANITY_PROJECT_ID and SANITY_API_TOKEN')

  const current = await getDialLabelsForType(type)
  const exists = current.some(x => x.toLowerCase() === trimmed.toLowerCase())
  if (exists) return current

  const field = TYPE_TO_FIELD[type]
  if (!field) {
    throw new Error(`No Sanity dialRegistry field mapped for product type "${type}". Run the Sanity dialRegistry migration before appending labels for this type.`)
  }
  const next  = [...current, trimmed]

  await c.patch(SINGLETON_ID).set({ [field]: next }).commit()
  return next
}
