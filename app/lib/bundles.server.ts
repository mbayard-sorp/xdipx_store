import { createClient } from '@sanity/client'
import type { Bundle, BundleComponent, Product } from '~/types'
import { getProductsByHandles } from '~/lib/shopify.server'
import { cached } from '~/lib/kv.server'

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

function getClient() {
  if (!projectId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({ projectId, dataset, apiVersion, useCdn: true, token: process.env['SANITY_API_TOKEN'], perspective: 'published' } as any)
}

interface BundleDoc {
  shopifyHandle: string
  title?: string
  tagline?: string
  moodImageUrl?: string
  bundleDiscountPct?: number
  components?: { quantity?: number; handle?: string }[]
}

const BUNDLE_BY_HANDLE_GROQ = `
  *[_type == "productPage" && isBundle == true && shopifyHandle == $handle][0]{
    shopifyHandle,
    title,
    tagline,
    moodImageUrl,
    bundleDiscountPct,
    "components": bundleComponents[]{
      quantity,
      "handle": product->shopifyHandle
    }
  }
`

const COMPANION_BUNDLES_GROQ = `
  *[_type == "productPage" && isBundle == true && $handle in bundleComponents[].product->shopifyHandle]{
    shopifyHandle,
    title,
    tagline,
    moodImageUrl,
    bundleDiscountPct,
    "components": bundleComponents[]{
      quantity,
      "handle": product->shopifyHandle
    }
  }
`

function bundleTagFor(handle: string): string {
  return `bundle-${handle}`
}

function buildBundle(doc: BundleDoc, components: BundleComponent[]): Bundle {
  // Ticket #3448: the discount ceiling is a trap. Simulated 40,000 bundles
  // (one $35-$120 anchor + two $9-$25 consumables) on real catalog wholesale
  // cost: contribution margin vs. selling the anchor alone is +$8.29 at 0%
  // discount, +$3.64 at 5%, MINUS $1.04 at 10%, and gets worse from there —
  // break-even is ~8.5%. The added consumables carry ~33.3% median margin
  // against the toys' ~44.4%, so a bundle discount comes off the whole
  // basket while only a third of it is high-margin. A cap of 90% here let
  // anyone authoring a bundle in Sanity set 25% and quietly destroy margin
  // with no gate. Authoring guidance: ship bundles at 0-5%. A bundle's value
  // proposition here is Emma's curation, not a price cut — that is also
  // on-brand (curation and discretion over discounting).
  const discountPct = Math.max(0, Math.min(5, doc.bundleDiscountPct ?? 0))
  const originalTotal = components.reduce(
    (sum, c) => sum + (c.product.compareAtPrice ?? c.product.price) * c.quantity,
    0,
  )
  const bundlePrice = +(originalTotal * (1 - discountPct / 100)).toFixed(2)

  // Parent bundle "images" = first image of each component (collage fodder)
  const images = components
    .map(c => c.product.images[0])
    .filter((img): img is { url: string; altText: string } => !!img)

  const bundle: Bundle = {
    handle: doc.shopifyHandle,
    title: doc.title ?? 'Bundle',
    images,
    components,
    discountPct,
    originalTotal: +originalTotal.toFixed(2),
    bundlePrice,
    bundleTag: bundleTagFor(doc.shopifyHandle),
  }
  if (doc.tagline) bundle.tagline = doc.tagline
  if (doc.moodImageUrl) bundle.moodImageUrl = doc.moodImageUrl
  return bundle
}

async function hydrateComponents(
  refs: { quantity?: number; handle?: string }[] | undefined,
): Promise<BundleComponent[]> {
  if (!refs?.length) return []
  const handles = refs.map(r => r.handle).filter((h): h is string => !!h)
  if (handles.length === 0) return []
  const products = await getProductsByHandles(handles)
  const byHandle = new Map<string, Product>(products.map(p => [p.handle, p]))

  const out: BundleComponent[] = []
  for (const ref of refs) {
    if (!ref.handle) continue
    const product = byHandle.get(ref.handle)
    if (!product) continue
    out.push({ product, quantity: Math.max(1, ref.quantity ?? 1) })
  }
  return out
}

export async function getBundleByHandle(handle: string): Promise<Bundle | null> {
  return cached(`bundle:by-handle:${handle}`, 60, async () => {
    const client = getClient()
    if (!client) return null
    try {
      const doc = await client.fetch<BundleDoc | null>(BUNDLE_BY_HANDLE_GROQ, { handle })
      if (!doc) return null
      const components = await hydrateComponents(doc.components)
      if (components.length === 0) return null
      return buildBundle(doc, components)
    } catch (err) {
      console.error('[bundles] getBundleByHandle error:', err)
      return null
    }
  })
}

export async function getBundleCompanionFor(handle: string): Promise<Bundle | null> {
  const client = getClient()
  if (!client) return null
  try {
    const docs = await client.fetch<BundleDoc[]>(COMPANION_BUNDLES_GROQ, { handle })
    if (!docs?.length) return null
    // Prefer the bundle with the deepest discount — most compelling cross-sell
    docs.sort((a, b) => (b.bundleDiscountPct ?? 0) - (a.bundleDiscountPct ?? 0))
    const doc = docs[0]!
    const components = await hydrateComponents(doc.components)
    if (components.length === 0) return null
    return buildBundle(doc, components)
  } catch (err) {
    console.error('[bundles] getBundleCompanionFor error:', err)
    return null
  }
}

/** Extracts the default-purchase variant GID for each bundle component. */
export function bundleCartLines(bundle: Bundle): { variantId: string; quantity: number }[] {
  return bundle.components
    .map(c => {
      const variantId = c.product.variants[0]?.id
      if (!variantId) return null
      return { variantId, quantity: c.quantity }
    })
    .filter((l): l is { variantId: string; quantity: number } => l !== null)
}
