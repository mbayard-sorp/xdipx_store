import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router'
import { useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  searchAdminProducts,
  getProductsForMerge,
  updateProductTitle,
  copyMediaToProduct,
  addVariantsToProduct,
  createUrlRedirect,
  archiveProduct,
} from '~/lib/shopify.server'
import type { AdminProductSearchResult } from '~/lib/shopify.server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MergePayload {
  masterId: string
  masterTitle: string
  optionName: 'Color' | 'Size' | 'Style' | 'Scent' | 'Material'
  variants: Array<{
    sourceProductId: string
    optionValue: string
  }>
}

const ALLOWED_OPTION_NAMES = ['Color', 'Size', 'Style', 'Scent', 'Material'] as const

interface MergeStep {
  name: string
  ok: boolean
  message?: string
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs): Promise<{
  q: string
  results: AdminProductSearchResult[]
}> {
  await requireAdmin(request)
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  if (!q) return { q: '', results: [] }
  const results = await searchAdminProducts(q, 25)
  return { q, results }
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs): Promise<
  | { ok: true; masterHandle: string; steps: MergeStep[] }
  | { ok: false; error: string; steps?: MergeStep[] }
> {
  await requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')
  if (intent !== 'merge') {
    return new Response(JSON.stringify({ ok: false, error: 'Unknown intent' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }) as never
  }

  const rawPayload = formData.get('payload')
  if (typeof rawPayload !== 'string') {
    return { ok: false, error: 'Missing payload field' }
  }

  let payload: MergePayload
  try {
    payload = JSON.parse(rawPayload) as MergePayload
  } catch {
    return { ok: false, error: 'payload is not valid JSON' }
  }

  // Validate
  const { masterId, masterTitle, optionName, variants } = payload

  if (!masterId?.trim()) {
    return { ok: false, error: 'masterId is required' }
  }
  if (!(ALLOWED_OPTION_NAMES as readonly string[]).includes(optionName)) {
    return { ok: false, error: `optionName must be one of: ${ALLOWED_OPTION_NAMES.join(', ')}` }
  }
  if (!variants || variants.length < 1) {
    return { ok: false, error: 'At least one variant source is required' }
  }
  const emptyValue = variants.find(v => !v.optionValue?.trim())
  if (emptyValue) {
    return { ok: false, error: 'All variant optionValue fields must be non-empty' }
  }
  const values = variants.map(v => v.optionValue.trim().toLowerCase())
  if (new Set(values).size !== values.length) {
    return { ok: false, error: 'Variant optionValue entries must be unique' }
  }
  const masterNumeric = masterId.replace('gid://shopify/Product/', '')
  const selfRef = variants.find(v => {
    const sourceNumeric = v.sourceProductId.replace('gid://shopify/Product/', '')
    return sourceNumeric === masterNumeric
  })
  if (selfRef) {
    return { ok: false, error: 'A source variant cannot reference the master product' }
  }

  const steps: MergeStep[] = []

  // Steps 1–4 are must-succeed; any throw returns 500 with accumulated steps.
  let masterHandle: string
  type MergeProductMap = Awaited<ReturnType<typeof getProductsForMerge>>
  let productDataMap: MergeProductMap = {}

  try {
    // Step 1: load master + all sources via new helper (keyed by numeric id)
    const sourceIds = variants.map(v => v.sourceProductId.replace('gid://shopify/Product/', ''))
    productDataMap = await getProductsForMerge([masterNumeric, ...sourceIds])

    const master = productDataMap[masterNumeric]
    if (!master) {
      throw new Error(`Could not load master product ${masterNumeric} from Shopify`)
    }
    masterHandle = master.handle

    steps.push({ name: 'load-products', ok: true })

    // Step 2: update title if changed
    if (masterTitle.trim() && masterTitle.trim() !== master.title) {
      await updateProductTitle(master.id, masterTitle.trim())
      steps.push({ name: 'update-title', ok: true })
    }

    // Step 3: per-source: copy media then build variantsInput
    const variantsInput: Array<{
      optionValue: string
      price: string
      compareAtPrice?: string | null
      sku?: string | null
      barcode?: string | null
      inventoryQuantity?: number
      mediaId?: string | null
    }> = []

    for (const v of variants) {
      const sourceNumericId = v.sourceProductId.replace('gid://shopify/Product/', '')
      const source = productDataMap[sourceNumericId]
      if (!source) {
        throw new Error(`Could not load source product ${sourceNumericId}`)
      }

      if (!source.firstVariant) {
        steps.push({ name: `copy-media:${sourceNumericId}`, ok: false, message: 'No variant found on source product — skipped' })
        continue
      }

      // Copy source images to master; pick first returned mediaId for the variant
      let firstMediaId: string | null = null
      if (source.images.length > 0) {
        const mediaSources = source.images.map(img => ({ originalSrc: img.url, ...(img.altText ? { alt: img.altText } : {}) }))
        const copied = await copyMediaToProduct(master.id, mediaSources)
        firstMediaId = copied[0]?.mediaId ?? null
      }

      variantsInput.push({
        optionValue: v.optionValue.trim(),
        price: source.firstVariant.price,
        compareAtPrice: source.firstVariant.compareAtPrice,
        sku: source.firstVariant.sku,
        barcode: source.firstVariant.barcode,
        inventoryQuantity: source.firstVariant.inventoryQuantity,
        mediaId: firstMediaId,
      })

      steps.push({ name: `copy-media:${sourceNumericId}`, ok: true })
    }

    // Step 4: add all variants in one call
    await addVariantsToProduct(master.id, optionName, variantsInput)
    steps.push({ name: 'add-variants', ok: true })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    steps.push({ name: 'merge-core', ok: false, message })
    return new Response(JSON.stringify({ ok: false, error: message, steps }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }) as never
  }

  // Step 5: archive + redirect — non-fatal, parallel per source
  const archiveResults = await Promise.allSettled(
    variants.map(async v => {
      const sourceNumericId = v.sourceProductId.replace('gid://shopify/Product/', '')
      const source = productDataMap[sourceNumericId]
      if (source) {
        await createUrlRedirect(`/products/${source.handle}`, `/products/${masterHandle}`)
      }
      const sourceGid = v.sourceProductId.startsWith('gid://')
        ? v.sourceProductId
        : `gid://shopify/Product/${sourceNumericId}`
      await archiveProduct(sourceGid)
      return sourceNumericId
    }),
  )

  for (let i = 0; i < archiveResults.length; i++) {
    const result = archiveResults[i]!
    const sourceId = variants[i]!.sourceProductId.replace('gid://shopify/Product/', '')
    if (result.status === 'fulfilled') {
      steps.push({ name: `archive-redirect:${sourceId}`, ok: true })
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      steps.push({ name: `archive-redirect:${sourceId}`, ok: false, message })
    }
  }

  return { ok: true, masterHandle, steps }
}

// ─── Component (placeholder — UI lands in Phase 3) ────────────────────────────

export default function MergeVariantsRoute() {
  const { q, results } = useLoaderData<typeof loader>()
  return (
    <div className="p-6">
      <h1 className="font-display text-2xl">Merge variants</h1>
      <p className="text-muted mt-2">
        UI lands in Phase 3. Loader returns {results.length} results for &ldquo;{q}&rdquo;.
      </p>
    </div>
  )
}
