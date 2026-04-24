import { createClient } from '@sanity/client'

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

const SINGLETON_ID = 'singleton.askEmmaVocabulary'

export type AskEmmaAxis = 'mood' | 'audience' | 'matters'

export type AskEmmaVocabulary = Record<AskEmmaAxis, string[]>

const FALLBACK: AskEmmaVocabulary = {
  mood:     ['slow-and-intimate', 'playful', 'adventurous', 'unhurried-solo'],
  audience: ['me', 'us', 'gift'],
  matters:  ['quiet', 'soft-touch', 'travel-size', 'first-time', 'waterproof', 'rechargeable', 'hands-free'],
}

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

export async function getAskEmmaVocabulary(): Promise<AskEmmaVocabulary> {
  const c = client(false)
  if (!c) return { ...FALLBACK }
  try {
    const doc = await c.fetch<Record<string, string[] | undefined>>(`*[_id == $id][0]{
      mood, audience, matters
    }`, { id: SINGLETON_ID })
    return {
      mood:     doc?.['mood']?.length     ? doc['mood']     : FALLBACK.mood,
      audience: doc?.['audience']?.length ? doc['audience'] : FALLBACK.audience,
      matters:  doc?.['matters']?.length  ? doc['matters']  : FALLBACK.matters,
    }
  } catch (err) {
    console.error('[ask-emma-vocab] fetch failed, using fallback:', err)
    return { ...FALLBACK }
  }
}

export async function getLabelsForAxis(axis: AskEmmaAxis): Promise<string[]> {
  const v = await getAskEmmaVocabulary()
  return v[axis]
}

/**
 * Append a slug to the vocabulary for an axis. Idempotent — no-op if the slug
 * (case-insensitive) already exists. Slug is lowercased + kebab-cased before
 * comparison/append.
 */
export async function appendLabel(axis: AskEmmaAxis, slug: string): Promise<string[]> {
  const normalized = slugify(slug)
  if (!normalized) throw new Error('label cannot be empty')

  const c = client(true)
  if (!c) throw new Error('Sanity client unavailable — set SANITY_PROJECT_ID and SANITY_API_TOKEN')

  const current = await getLabelsForAxis(axis)
  const exists = current.some(x => x.toLowerCase() === normalized)
  if (exists) return current

  const next = [...current, normalized]
  await c.patch(SINGLETON_ID).set({ [axis]: next }).commit()
  return next
}

export function slugify(input: string): string {
  return input.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
