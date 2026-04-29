import { createClient } from '@sanity/client'
import type { ProductTypeDial } from '~/types'

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

const SINGLETON_ID          = 'singleton.dialRegistry'
const TAXONOMY_SINGLETON_ID = 'singleton.dialTaxonomy'

// ProductTypeDial → Sanity field name. Field names use camelCase (Sanity
// disallows hyphens), so hyphenated types collapse: cock-ring → cockRing,
// book-media → bookMedia, sex-machine → sexMachine. Legacy fields
// `airPulsation` and `wand` are NOT in this map — they live in Sanity for
// back-compat, and the read paths below dedupe their labels into `vibrator`
// (since Phase 1 collapsed them into vibrator subtypes).
const TYPE_TO_FIELD: Record<ProductTypeDial, string> = {
  vibrator:      'vibrator',
  dildo:         'dildo',
  anal:          'anal',
  bondage:       'bondage',
  'cock-ring':   'cockRing',
  stroker:       'stroker',
  couples:       'couples',
  harness:       'harness',
  extender:      'extender',
  pump:          'pump',
  lube:          'lube',
  massage:       'massage',
  enhancer:      'enhancer',
  wear:          'wear',
  condom:        'condom',
  wellness:      'wellness',
  novelty:       'novelty',
  'book-media':  'bookMedia',
  'sex-machine': 'sexMachine',
}

// Field names to project in the GROQ fetches. Includes the legacy
// `airPulsation` / `wand` fields so the read path can collapse them into
// `vibrator` for back-compat with any seeded data.
const REGISTRY_FIELD_NAMES = [
  ...Object.values(TYPE_TO_FIELD),
  'airPulsation', 'wand',
] as const

// Fallback labels for the most common types — used when Sanity is empty or
// unreachable. Other types fall back to an empty array; the sensation-dial
// generator's prompt handles "(none — invent appropriate labels)".
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
    const projection = REGISTRY_FIELD_NAMES.join(', ')
    const doc = await c.fetch<Record<string, string[] | undefined>>(
      `*[_id == $id][0]{ ${projection} }`,
      { id: SINGLETON_ID },
    )

    const out: DialRegistry = {}
    for (const type of Object.keys(TYPE_TO_FIELD) as ProductTypeDial[]) {
      const field = TYPE_TO_FIELD[type]
      let labels = doc?.[field] ?? []

      // Legacy collapse: `vibrator` absorbs labels seeded under `airPulsation`
      // and `wand` (Phase 1 made those subtypes of vibrator). Dedupe.
      if (type === 'vibrator') {
        labels = [
          ...labels,
          ...(doc?.['airPulsation'] ?? []),
          ...(doc?.['wand']         ?? []),
        ]
        labels = Array.from(new Set(labels))
      }

      if (labels.length > 0) {
        out[type] = labels
      } else if (FALLBACK[type]) {
        out[type] = FALLBACK[type]
      }
      // Otherwise omit — the dial generator's prompt handles missing entries.
    }
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
    const projection = REGISTRY_FIELD_NAMES.join(', ')
    const doc = await c.fetch<Record<string, DialDimensionEntry[] | undefined>>(
      `*[_id == $id][0]{ ${projection} }`,
      { id: TAXONOMY_SINGLETON_ID },
    )
    if (!doc) return empty

    const out: DialTaxonomy = {}
    for (const type of Object.keys(TYPE_TO_FIELD) as ProductTypeDial[]) {
      const field = TYPE_TO_FIELD[type]
      let entries: DialDimensionEntry[] = Array.isArray(doc[field]) ? doc[field]! : []

      // Legacy collapse: `vibrator` absorbs entries seeded under `airPulsation`
      // and `wand`. Dedupe by label (case-sensitive — Sanity preserves casing).
      if (type === 'vibrator') {
        const merged = [
          ...entries,
          ...(Array.isArray(doc['airPulsation']) ? doc['airPulsation']! : []),
          ...(Array.isArray(doc['wand'])         ? doc['wand']!         : []),
        ]
        const seen = new Set<string>()
        entries = []
        for (const entry of merged) {
          if (!entry?.label || seen.has(entry.label)) continue
          seen.add(entry.label)
          entries.push(entry)
        }
      }

      if (entries.length > 0) out[type] = entries
    }
    return out
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
