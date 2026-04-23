import { createClient } from '@sanity/client'
import type { ProductTypeDial } from '~/types'

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

const SINGLETON_ID = 'singleton.dialRegistry'

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
