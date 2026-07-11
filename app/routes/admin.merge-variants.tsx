import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router'
import { useFetcher } from 'react-router'
import { useRef, useState, useEffect, useCallback } from 'react'
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

  // Steps 1-4 are must-succeed; any throw returns 500 with accumulated steps.
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
        steps.push({ name: `copy-media:${sourceNumericId}`, ok: false, message: 'No variant found on source product - skipped' })
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

  // Step 5: archive + redirect - non-fatal, parallel per source
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

// ─── Bin item shape ───────────────────────────────────────────────────────────

interface BinItem {
  product: AdminProductSearchResult
  optionValue: string
}

// ─── Search column ────────────────────────────────────────────────────────────

function SearchColumn({
  bin,
  onAdd,
}: {
  bin: BinItem[]
  onAdd: (p: AdminProductSearchResult) => void
}) {
  const searchFetcher = useFetcher<typeof loader>()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [query, setQuery] = useState('')

  // Debounce search — useEffect is appropriate here: it reacts to local input
  // state and drives the fetcher.load side-effect, not initial data loading.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) return
    debounceRef.current = setTimeout(() => {
      searchFetcher.load(`/admin/merge-variants?q=${encodeURIComponent(query.trim())}`)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query]) // intentionally omitting searchFetcher - stable fetcher ref

  const binIds = new Set(bin.map(b => b.product.id))
  const results = searchFetcher.data?.results ?? []

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-4">
      <h2 className="font-display font-bold text-lg text-ink">Search products</h2>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search products by title..."
        aria-label="Search products by title"
        className="w-full px-3 py-2.5 rounded-lg border border-line bg-paper text-ink font-body text-sm placeholder:text-muted focus:outline-none focus:border-coral transition-colors"
      />
      {searchFetcher.state !== 'idle' && (
        <p className="text-muted text-sm font-body">Searching...</p>
      )}
      {results.length === 0 && query.trim() && searchFetcher.state === 'idle' && (
        <p className="text-muted text-sm font-body">No products found.</p>
      )}
      <ul className="flex flex-col gap-2">
        {results.map(product => {
          const inBin = binIds.has(product.id)
          return (
            <li
              key={product.id}
              draggable={!inBin}
              onDragStart={e => {
                e.dataTransfer.setData('application/json', JSON.stringify(product))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all',
                inBin
                  ? 'border-line bg-cream-2 opacity-50 cursor-not-allowed'
                  : 'border-line bg-paper cursor-grab hover:border-coral hover:shadow-sm active:cursor-grabbing',
              ].join(' ')}
            >
              {product.image ? (
                <img
                  src={product.image}
                  alt={product.title}
                  className="w-10 h-10 rounded object-cover shrink-0 bg-cream-2"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-cream-2 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-medium text-ink truncate">{product.title}</p>
                <p className="font-body text-xs text-muted truncate">{product.handle}</p>
                <p className="font-body text-xs text-muted">
                  {product.sku ? `SKU: ${product.sku}` : ''}
                  {product.price > 0 ? ` · $${product.price.toFixed(2)}` : ''}
                </p>
              </div>
              {inBin ? (
                <span className="text-xs text-muted font-body shrink-0">In bin</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onAdd(product)}
                  className="shrink-0 text-xs font-display font-bold text-coral hover:text-coral-deep transition-colors"
                  aria-label={`Add ${product.title} to merge bin`}
                >
                  Add
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Bin row (draggable within the bin) ───────────────────────────────────────

function BinRow({
  item,
  index,
  isMaster,
  isDropTarget,
  error,
  onOptionValueChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  item: BinItem
  index: number
  isMaster: boolean
  isDropTarget: boolean
  error: string | null
  onOptionValueChange: (index: number, value: string) => void
  onRemove: (index: number) => void
  onDragStart: (e: React.DragEvent<HTMLLIElement>, index: number) => void
  onDragOver: (e: React.DragEvent<HTMLLIElement>, index: number) => void
  onDrop: (e: React.DragEvent<HTMLLIElement>, index: number) => void
}) {
  return (
    <li
      draggable
      onDragStart={e => onDragStart(e, index)}
      onDragOver={e => onDragOver(e, index)}
      onDrop={e => onDrop(e, index)}
      className={[
        'flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors',
        isDropTarget ? 'border-coral bg-coral/5' : 'border-line bg-paper',
      ].join(' ')}
    >
      {/* Drag handle */}
      <span
        className="mt-2 shrink-0 cursor-grab active:cursor-grabbing text-muted select-none"
        aria-hidden="true"
      >
        ⠿
      </span>

      {item.product.image ? (
        <img
          src={item.product.image}
          alt={item.product.title}
          className="w-10 h-10 rounded object-cover shrink-0 bg-cream-2 mt-0.5"
        />
      ) : (
        <div className="w-10 h-10 rounded bg-cream-2 shrink-0 mt-0.5" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isMaster && (
            <span className="text-[10px] font-display font-black text-white bg-coral px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0">
              Master
            </span>
          )}
          <p className="font-body text-xs text-muted truncate">{item.product.title}</p>
        </div>

        <input
          type="text"
          value={item.optionValue}
          onChange={e => onOptionValueChange(index, e.target.value)}
          placeholder={isMaster ? 'Master title...' : 'Variant value (e.g. Red)'}
          aria-label={isMaster ? 'Master product title' : 'Variant option value'}
          className={[
            'w-full px-2.5 py-1.5 rounded border font-body text-sm text-ink bg-cream focus:outline-none transition-colors',
            error ? 'border-red-400 focus:border-red-500' : 'border-line focus:border-coral',
          ].join(' ')}
        />
        {error && (
          <p className="text-red-500 text-xs font-body mt-1">{error}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={`Remove ${item.product.title}`}
        className="mt-2 shrink-0 text-muted hover:text-ink transition-colors text-lg leading-none"
      >
        ×
      </button>
    </li>
  )
}

// ─── Merge bin column ─────────────────────────────────────────────────────────

function MergeBinColumn({
  bin,
  onBinChange,
}: {
  bin: BinItem[]
  onBinChange: (next: BinItem[]) => void
}) {
  const submitFetcher = useFetcher<typeof action>()
  const [optionName, setOptionName] = useState<MergePayload['optionName']>('Color')
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragSrcIndex = useRef<number | null>(null)

  // Per-row validation errors
  const optionValues = bin.map(b => b.optionValue.trim())
  const rowErrors = bin.map((item, i) => {
    const val = item.optionValue.trim()
    if (!val) return 'Value required'
    const dupes = optionValues.filter((v, j) => v === val && j !== i)
    if (dupes.length > 0) return 'Duplicate value'
    return null
  })
  const hasErrors = rowErrors.some(e => e !== null)

  const canSubmit =
    bin.length >= 2 &&
    !hasErrors &&
    submitFetcher.state === 'idle'

  // Drop from search column (new product)
  function handleDropFromSearch(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/json')
    if (!raw) return
    try {
      const product = JSON.parse(raw) as AdminProductSearchResult
      if (bin.some(b => b.product.id === product.id)) return
      onBinChange([...bin, { product, optionValue: product.title }])
    } catch {
      // ignore malformed drag data
    }
    setDragOverIndex(null)
  }

  // Bin-internal reorder
  function handleRowDragStart(e: React.DragEvent<HTMLLIElement>, index: number) {
    dragSrcIndex.current = index
    e.dataTransfer.effectAllowed = 'move'
    // Use a text payload so drop handlers can distinguish bin-internal vs search drags
    e.dataTransfer.setData('text/plain', String(index))
  }

  function handleRowDragOver(e: React.DragEvent<HTMLLIElement>, index: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  function handleRowDrop(e: React.DragEvent<HTMLLIElement>, targetIndex: number) {
    e.preventDefault()
    e.stopPropagation() // don't bubble to the zone's onDrop
    const srcIndex = dragSrcIndex.current
    if (srcIndex === null || srcIndex === targetIndex) {
      dragSrcIndex.current = null
      setDragOverIndex(null)
      return
    }
    const next = [...bin]
    const [moved] = next.splice(srcIndex, 1)
    next.splice(targetIndex, 0, moved!)
    onBinChange(next)
    dragSrcIndex.current = null
    setDragOverIndex(null)
  }

  function handleOptionValueChange(index: number, value: string) {
    const next = bin.map((item, i) => (i === index ? { ...item, optionValue: value } : item))
    onBinChange(next)
  }

  function handleRemove(index: number) {
    onBinChange(bin.filter((_, i) => i !== index))
  }

  function handleSubmit() {
    if (!canSubmit) return
    const master = bin[0]!
    const payload: MergePayload = {
      masterId: master.product.id,
      masterTitle: master.optionValue.trim(),
      optionName,
      variants: bin.slice(1).map(item => ({
        sourceProductId: item.product.id,
        optionValue: item.optionValue.trim(),
      })),
    }
    submitFetcher.submit(
      { intent: 'merge', payload: JSON.stringify(payload) },
      { method: 'post' },
    )
  }

  const responseData = submitFetcher.data
  const lastMergeOk = responseData && 'ok' in responseData ? responseData.ok : null

  // Clear bin on success
  useEffect(() => {
    if (lastMergeOk === true) {
      onBinChange([])
    }
  }, [lastMergeOk, onBinChange])

  // We track overall zone drag-over separately for the empty-state highlight
  const [zoneDragOver, setZoneDragOver] = useState(false)

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-4">
      <h2 className="font-display font-bold text-lg text-ink">Merge bin</h2>

      {/* Success banner */}
      {responseData && lastMergeOk === true && 'masterHandle' in responseData && (
        <div className="rounded-lg bg-sage/10 border border-sage/30 px-4 py-3 text-sm font-body text-ink">
          <p className="font-display font-bold text-ink mb-1">Merged.</p>
          <a
            href={`/products/${responseData.masterHandle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-coral underline hover:text-coral-deep"
          >
            View /products/{responseData.masterHandle}
          </a>
          {responseData.steps && responseData.steps.length > 0 && (
            <ul className="mt-3 space-y-1">
              {responseData.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                  <span>{step.ok ? '✓' : '✗'}</span>
                  <span className={step.ok ? '' : 'text-red-500'}>
                    {step.name}{step.message ? `: ${step.message}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Error banner */}
      {responseData && lastMergeOk === false && 'error' in responseData && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm font-body text-red-700">
          <p className="font-display font-bold mb-1">Merge failed.</p>
          <p>{responseData.error}</p>
          {responseData.steps && responseData.steps.length > 0 && (
            <ul className="mt-3 space-y-1">
              {responseData.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <span>{step.ok ? '✓' : '✗'}</span>
                  <span className={step.ok ? 'text-muted' : 'text-red-500'}>
                    {step.name}{step.message ? `: ${step.message}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Variant axis */}
      <div className="flex items-center gap-3">
        <label htmlFor="option-axis" className="font-body text-sm text-ink shrink-0">
          Variant axis
        </label>
        <select
          id="option-axis"
          value={optionName}
          onChange={e => setOptionName(e.target.value as MergePayload['optionName'])}
          className="px-2.5 py-1.5 rounded-lg border border-line bg-paper text-ink font-body text-sm focus:outline-none focus:border-coral transition-colors"
        >
          {ALLOWED_OPTION_NAMES.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <div
        role="region"
        aria-label="Merge bin drop zone"
        onDragOver={e => { e.preventDefault(); setZoneDragOver(true) }}
        onDragLeave={() => setZoneDragOver(false)}
        onDrop={e => { setZoneDragOver(false); handleDropFromSearch(e) }}
        className={[
          'min-h-[160px] rounded-xl border-2 border-dashed transition-colors',
          bin.length === 0
            ? zoneDragOver
              ? 'border-coral bg-coral/5'
              : 'border-line bg-cream-2 flex items-center justify-center'
            : 'border-transparent bg-transparent',
        ].join(' ')}
      >
        {bin.length === 0 ? (
          <p className="font-body text-sm text-muted text-center px-6">
            Drag products here. Top one is the master.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bin.map((item, index) => (
              <BinRow
                key={item.product.id}
                item={item}
                index={index}
                isMaster={index === 0}
                isDropTarget={dragOverIndex === index}
                error={rowErrors[index] ?? null}
                onOptionValueChange={handleOptionValueChange}
                onRemove={handleRemove}
                onDragStart={handleRowDragStart}
                onDragOver={handleRowDragOver}
                onDrop={handleRowDrop}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 pt-2 border-t border-line">
        <button
          type="button"
          onClick={() => onBinChange([])}
          className="px-4 py-2 rounded-lg border border-line bg-paper text-ink font-display font-bold text-sm hover:bg-cream-2 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={[
            'flex-1 px-4 py-2 rounded-lg font-display font-bold text-sm transition-colors',
            canSubmit
              ? 'bg-coral text-white hover:bg-coral-deep'
              : 'bg-line text-muted cursor-not-allowed',
          ].join(' ')}
        >
          {submitFetcher.state !== 'idle' ? 'Merging...' : 'Merge into master ♥'}
        </button>
      </div>

      {bin.length > 0 && bin.length < 2 && (
        <p className="text-xs text-muted font-body">Add at least one more product to enable merge.</p>
      )}
    </div>
  )
}

// ─── Route component ──────────────────────────────────────────────────────────

export default function MergeVariantsRoute() {
  const [bin, setBin] = useState<BinItem[]>([])

  // Stable callback — avoids re-render churn in children
  const handleBinChange = useCallback((next: BinItem[]) => setBin(next), [])

  function handleAddFromSearch(product: AdminProductSearchResult) {
    if (bin.some(b => b.product.id === product.id)) return
    setBin(prev => [...prev, { product, optionValue: product.title }])
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <h1 className="font-display text-2xl font-black text-ink mb-1">
        Merge variants
      </h1>
      <p className="font-body text-sm text-muted mb-8">
        Combine duplicate products into a master with variants. The top bin item becomes the master product.
      </p>

      <div className="flex flex-col gap-8 md:flex-row md:gap-10 md:items-start">
        <SearchColumn bin={bin} onAdd={handleAddFromSearch} />
        <MergeBinColumn bin={bin} onBinChange={handleBinChange} />
      </div>
    </div>
  )
}
