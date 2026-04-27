import { createClient } from '@sanity/client'
import type { ProductTypeDial } from '~/types'

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

const SINGLETON_ID          = 'singleton.dialRegistry'
const TAXONOMY_SINGLETON_ID = 'singleton.dialTaxonomy'

const TYPE_TO_FIELD: Record<ProductTypeDial, string> = {
  'air-pulsation': 'airPulsation',
  vibrator:        'vibrator',
  wand:            'wand',
  lube:            'lube',
  wear:            'wear',
}

const FALLBACK: Record<ProductTypeDial, string[]> = {
  'air-pulsation': ['Intensity', 'Quietness', 'Softness', 'Suction strength', 'Buildup speed', 'Learning curve'],
  vibrator:        ['Intensity', 'Quietness', 'Pattern variety', 'Buildup speed', 'Battery life', 'Learning curve'],
  wand:            ['Intensity', 'Quietness', 'Reach', 'Grip comfort', 'Battery life', 'Cord/cordless'],
  lube:            ['Slipperiness', 'Longevity', 'Taste-safe', 'Body-safe', 'Tidy-up', 'Skin feel'],
  wear:            ['Fit', 'Softness', 'Washability', 'Discretion', 'Adjustability', 'Occasion'],
}

export type DialRegistry = Record<ProductTypeDial, string[]>

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

export type DialTaxonomy = Record<ProductTypeDial, DialDimensionEntry[]>

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
    return {
      'air-pulsation': doc?.['airPulsation']?.length ? doc['airPulsation'] : FALLBACK['air-pulsation'],
      vibrator:        doc?.['vibrator']?.length     ? doc['vibrator']     : FALLBACK.vibrator,
      wand:            doc?.['wand']?.length         ? doc['wand']         : FALLBACK.wand,
      lube:            doc?.['lube']?.length         ? doc['lube']         : FALLBACK.lube,
      wear:            doc?.['wear']?.length         ? doc['wear']         : FALLBACK.wear,
    }
  } catch (err) {
    console.error('[dial-registry] fetch failed, using fallback:', err)
    return { ...FALLBACK }
  }
}

export async function getDialLabelsForType(type: ProductTypeDial): Promise<string[]> {
  const reg = await getDialRegistry()
  return reg[type]
}

/**
 * Read the rich dial taxonomy — companion to the flat label list. Returns
 * empty arrays when the singleton hasn't been seeded yet (callers should
 * always check length and fall back to the flat label list).
 */
export async function getDialTaxonomy(): Promise<DialTaxonomy> {
  const empty: DialTaxonomy = {
    'air-pulsation': [],
    vibrator:        [],
    wand:            [],
    lube:            [],
    wear:            [],
  }
  const c = client(false)
  if (!c) return empty
  try {
    const doc = await c.fetch<Record<string, DialDimensionEntry[] | undefined>>(`*[_id == $id][0]{
      airPulsation, vibrator, wand, lube, wear
    }`, { id: TAXONOMY_SINGLETON_ID })
    if (!doc) return empty
    return {
      'air-pulsation': Array.isArray(doc['airPulsation']) ? doc['airPulsation'] : [],
      vibrator:        Array.isArray(doc['vibrator'])     ? doc['vibrator']     : [],
      wand:            Array.isArray(doc['wand'])         ? doc['wand']         : [],
      lube:            Array.isArray(doc['lube'])         ? doc['lube']         : [],
      wear:            Array.isArray(doc['wear'])         ? doc['wear']         : [],
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
  const next  = [...current, trimmed]

  await c.patch(SINGLETON_ID).set({ [field]: next }).commit()
  return next
}
