import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, useRevalidator, redirect } from 'react-router'
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  getDealByShopifyId, updateProductMetafield, setDealStatus,
  activateShopifyProduct, updateVariantPricing, getVariantCost,
  pushProductToShopify, getAccessoryProducts, getProductAdminImages,
} from '~/lib/shopify.server'
import type { AdminProductSearchResult, AdminProductImage } from '~/lib/shopify.server'
import { ImageManager } from '~/components/admin/ImageManager'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { generateCopy, generateSEOTitle } from '~/lib/claude.server'
import { kvGet, kvSet, KV_KEYS } from '~/lib/kv.server'
import type { Product } from '~/types'

export const meta: MetaFunction = () => [{ title: "Today's Deal — xdipx Admin" }]

export async function loader(_: LoaderFunctionArgs) {
  const [liveDeal] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1)

  const [approvedDeal] = !liveDeal
    ? await db
        .select()
        .from(dealHistory)
        .where(eq(dealHistory.status, 'approved'))
        .orderBy(dealHistory.dealDate)
        .limit(1)
    : []

  const dbDeal = liveDeal ?? approvedDeal
  if (!dbDeal?.shopifyProductId) return { deal: null, shopifyCost: null }

  const deal = await getDealByShopifyId(dbDeal.shopifyProductId)
  const shopifyCost = deal?.variantId ? await getVariantCost(deal.variantId) : null

  const [currentAccessories, checkoutUpsellIds, productImages] = await Promise.all([
    deal ? getAccessoryProducts(deal.accessoryProductIds) : Promise.resolve([] as Product[]),
    kvGet<string[]>(KV_KEYS.checkoutUpsellIds).then(v => v ?? []),
    deal ? getProductAdminImages(dbDeal.shopifyProductId) : Promise.resolve([] as AdminProductImage[]),
  ])
  const checkoutUpsells = checkoutUpsellIds.length
    ? await getAccessoryProducts(checkoutUpsellIds)
    : []

  return {
    deal, shopifyCost, dealCategories: dbDeal.categories ?? [],
    currentAccessories, checkoutUpsells, checkoutUpsellIds, productImages,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')

  if (intent === 'save-field') {
    const productId = form.get('productId') as string
    const key       = form.get('key') as string
    const value     = form.get('value') as string
    const type      = (form.get('type') as string) || 'single_line_text_field'
    await updateProductMetafield(productId, key, value, type)
    return { ok: true }
  }

  if (intent === 'save-bullets') {
    const productId = form.get('productId') as string
    const raw       = form.get('value') as string
    const bullets   = raw.split('\n').map(l => l.trim()).filter(Boolean)
    await updateProductMetafield(productId, 'feature_bullets', JSON.stringify(bullets), 'json')
    return { ok: true }
  }

  if (intent === 'save-box-contents') {
    const productId = form.get('productId') as string
    const raw       = form.get('value') as string
    const items     = raw.split('\n').map(l => l.trim()).filter(Boolean)
    await updateProductMetafield(productId, 'box_contents', JSON.stringify(items), 'json')
    return { ok: true }
  }

  if (intent === 'save-pricing') {
    const productId     = form.get('productId') as string
    const variantId     = form.get('variantId') as string
    const dealPrice     = form.get('dealPrice') as string
    const msrp          = form.get('msrp') as string
    const wholesaleCost = form.get('wholesaleCost') as string
    const mapPrice      = form.get('mapPrice') as string
    await Promise.all([
      updateVariantPricing(variantId, dealPrice, msrp, wholesaleCost),
      updateProductMetafield(productId, 'original_price',  msrp,          'number_decimal'),
      updateProductMetafield(productId, 'wholesale_cost',  wholesaleCost,  'number_decimal'),
      updateProductMetafield(productId, 'map_price',       mapPrice,       'number_decimal'),
    ])
    return { ok: true }
  }

  if (intent === 'approve') {
    const productId = form.get('productId') as string
    await activateShopifyProduct(productId)
    await setDealStatus(productId, 'approved')
    return { ok: true }
  }

  if (intent === 'set-live') {
    const productId = form.get('productId') as string
    await setDealStatus(productId, 'live')
    return { ok: true }
  }

  if (intent === 'save-raw-description') {
    const productId = form.get('productId') as string
    const value     = form.get('value') as string
    await updateProductMetafield(productId, 'original_description', value, 'multi_line_text_field', 'custom')
    return { ok: true }
  }

  if (intent === 'generate-all') {
    try {
      const productId  = form.get('productId') as string
      const rawDesc    = form.get('rawDescription') as string
      const title      = form.get('title') as string
      const brand      = form.get('brand') as string
      // categories from DB (real Nalpac category names, not the slugified single value)
      const categories = (form.get('categories') as string).split(',').filter(Boolean)
      const dealPrice  = parseFloat((form.get('dealPrice') as string) || '0')
      const msrp       = parseFloat((form.get('msrp') as string) || '0')

      if (!rawDesc?.trim()) return { ok: false, error: 'No original description — paste the raw product description and Save it first.' }

      const seoTitle = await generateSEOTitle(title, brand)

      const productContext = { title: seoTitle, brand, description: rawDesc, categories, dealPrice, msrp }

      // Extract specs first (sequential) so full_story can omit them
      const specsResult = await generateCopy({ type: 'specifications', product: productContext })

      const [taglineResult, storyResult, bothWaysResult, bulletsResult, seoMetaResult, boxContentsResult] =
        await Promise.all([
          generateCopy({ type: 'tagline',      product: productContext }),
          generateCopy({ type: 'full_story',   product: productContext }),
          generateCopy({ type: 'both_ways',    product: productContext }),
          generateCopy({ type: 'bullets',      product: productContext }),
          generateCopy({ type: 'seo_meta',     product: productContext }),
          generateCopy({ type: 'box_contents', product: productContext }),
        ])

      const tagline     = Array.isArray(taglineResult.content)
        ? (taglineResult.content[0] ?? '')
        : taglineResult.content as string
      const fullStory   = storyResult.content as string
      const bothWays    = bothWaysResult.content as { forHim: string; forHer: string }
      const bullets     = bulletsResult.content as string[]
      const seoMeta     = seoMetaResult.content as string
      const specs       = specsResult.content as string
      const boxContents = boxContentsResult.content as string[]

      const numericId = productId.replace('gid://shopify/Product/', '')
      await pushProductToShopify({
        shopifyProductId: numericId,
        tagline,
        fullStory,
        description:    fullStory,
        worksForHim:    bothWays.forHim,
        worksForHer:    bothWays.forHer,
        featureBullets: bullets,
        seoMetaDescription: seoMeta,
        specifications: specs,
        boxContents,
      })

      return redirect('/admin/today')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[generate-all] failed:', message)
      return { ok: false, error: message }
    }
  }

  if (intent === 'save-accessories') {
    const productId = form.get('productId') as string
    const ids = JSON.parse(form.get('ids') as string) as string[]
    await updateProductMetafield(productId, 'accessory_product_ids', JSON.stringify(ids), 'json')
    return redirect('/admin/today')
  }

  if (intent === 'save-checkout-upsells') {
    const ids = JSON.parse(form.get('ids') as string) as string[]
    await kvSet(KV_KEYS.checkoutUpsellIds, ids)
    return redirect('/admin/today')
  }

  return null
}

// ─── Reusable saveable textarea ────────────────────────────────────────────

function SaveableField({
  label, fieldKey, fieldType, defaultValue, productId, rows = 3, intent = 'save-field',
  hint,
}: {
  label: string
  fieldKey?: string
  fieldType?: string
  defaultValue: string
  productId: string
  rows?: number
  intent?: string
  hint?: string
}) {
  const fetcher = useFetcher<{ ok: boolean }>()
  const saved = fetcher.state === 'idle' && fetcher.data?.ok === true
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (saved) { timerRef.current = setTimeout(() => {}, 2500) }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [saved])

  const buttonLabel = fetcher.state === 'submitting' ? 'Saving…' : saved ? '✓ Saved!' : 'Save'
  const buttonClass = fetcher.state === 'submitting'
    ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed'
    : saved
      ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700 transition-colors'
      : 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-brand-mist text-brand-purple hover:bg-brand-purple/10 transition-colors'

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <h3 className="font-semibold text-brand-charcoal mb-1" style={{ fontFamily: 'var(--font-display)' }}>{label}</h3>
      {hint && <p className="text-xs text-brand-charcoal/40 mb-3">{hint}</p>}
      <fetcher.Form method="post" className="flex flex-col gap-2">
        <input type="hidden" name="intent"    value={intent} />
        <input type="hidden" name="productId" value={productId} />
        {fieldKey  && <input type="hidden" name="key"  value={fieldKey} />}
        {fieldType && <input type="hidden" name="type" value={fieldType} />}
        <textarea
          name="value"
          defaultValue={defaultValue}
          rows={rows}
          className="w-full border border-brand-mist rounded-xl px-4 py-3 text-sm text-brand-charcoal resize-y focus:outline-none focus:ring-2 focus:ring-brand-coral/30 font-mono"
        />
        <button type="submit" disabled={fetcher.state === 'submitting'} className={buttonClass}>
          {buttonLabel}
        </button>
      </fetcher.Form>
    </div>
  )
}

// ─── Pricing form ──────────────────────────────────────────────────────────

function PricingFields({ deal, shopifyCost }: {
  deal: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['deal']>
  shopifyCost: number | null
}) {
  const fetcher = useFetcher<{ ok: boolean }>()
  const saved   = fetcher.state === 'idle' && fetcher.data?.ok === true

  const profit = deal.dealPrice - deal.wholesaleCost
  const margin = deal.dealPrice > 0 ? (profit / deal.dealPrice) * 100 : 0

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <h3 className="font-semibold text-brand-charcoal mb-4" style={{ fontFamily: 'var(--font-display)' }}>Pricing</h3>
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent"    value="save-pricing" />
        <input type="hidden" name="productId" value={deal.shopifyProductId} />
        <input type="hidden" name="variantId" value={deal.variantId} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { label: 'Deal Price',      name: 'dealPrice',     value: deal.dealPrice.toFixed(2) },
            { label: 'MSRP',            name: 'msrp',          value: deal.msrp.toFixed(2) },
            { label: 'Wholesale Cost',  name: 'wholesaleCost', value: deal.wholesaleCost.toFixed(2) },
            { label: 'MAP Price',       name: 'mapPrice',      value: deal.mapPrice.toFixed(2) },
          ] as const).map(({ label, name, value }) => (
            <div key={name}>
              <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">{label}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-brand-charcoal/40">$</span>
                <input
                  type="number"
                  name={name}
                  defaultValue={value}
                  step="0.01"
                  min="0"
                  className="w-full border border-brand-mist rounded-xl pl-6 pr-3 py-2 text-sm text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
                />
              </div>
            </div>
          ))}
        </div>
        {shopifyCost !== null && (
          <div className="flex items-center gap-2 text-xs text-brand-charcoal/50">
            <span>Shopify cost on file:</span>
            <span className="font-semibold text-brand-charcoal">${shopifyCost.toFixed(2)}</span>
            {shopifyCost !== deal.wholesaleCost && (
              <span className="text-amber-600 font-medium">⚠ differs from wholesale cost above</span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-xs text-brand-charcoal/50">
            Profit/unit: <strong className="text-green-600">${profit.toFixed(2)}</strong>
            &nbsp;·&nbsp;Margin: <strong className="text-green-600">{margin.toFixed(1)}%</strong>
          </p>
          <button
            type="submit"
            disabled={fetcher.state === 'submitting'}
            className={
              fetcher.state === 'submitting'
                ? 'text-xs font-bold px-3 py-1.5 rounded-full bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed'
                : saved
                  ? 'text-xs font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700'
                  : 'text-xs font-bold px-3 py-1.5 rounded-full bg-brand-mist text-brand-purple hover:bg-brand-purple/10 transition-colors'
            }
          >
            {fetcher.state === 'submitting' ? 'Saving…' : saved ? '✓ Saved!' : 'Save Pricing'}
          </button>
        </div>
      </fetcher.Form>
    </div>
  )
}

// ─── Raw Description + Generate All ────────────────────────────────────────

function RawDescriptionPanel({ deal, categories }: {
  deal: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['deal']>
  categories: string[]
}) {
  const saveFetcher     = useFetcher<{ ok: boolean }>()
  const generateFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const textareaRef     = useRef<HTMLTextAreaElement>(null)

  const isSaving     = saveFetcher.state === 'submitting'
  const saved        = saveFetcher.state === 'idle' && saveFetcher.data?.ok === true
  const isGenerating = generateFetcher.state === 'submitting'

  const placeholder = '(No original description stored — re-run the pipeline to import it, or paste the raw product description here and click Save)'

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
          Original Product Description
          <span className="ml-2 text-xs font-normal text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">custom.original_description</span>
        </h3>
        <p className="text-xs text-brand-charcoal/50 mt-1">
          Raw text from Nalpac feed. Edit if needed, then click "Generate All Fields" to regenerate all copy from this source.
        </p>
      </div>

      {/* Editable description */}
      <saveFetcher.Form method="post" className="flex flex-col gap-2">
        <input type="hidden" name="intent"    value="save-raw-description" />
        <input type="hidden" name="productId" value={deal.shopifyProductId} />
        <textarea
          ref={textareaRef}
          name="value"
          defaultValue={deal.rawDescription ?? ''}
          placeholder={placeholder}
          rows={8}
          className="w-full border border-amber-200 rounded-xl px-4 py-3 text-xs text-brand-charcoal resize-y bg-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40"
        />
        <button
          type="submit"
          disabled={isSaving}
          className={
            isSaving
              ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed'
              : saved
                ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700'
                : 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors'
          }
        >
          {isSaving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Description'}
        </button>
      </saveFetcher.Form>

      {/* Generate All button — reads from the textarea at submit time */}
      <generateFetcher.Form
        method="post"
        onSubmit={e => {
          // Sync textarea value into the hidden input before submit
          const hidden = (e.currentTarget as HTMLFormElement).elements.namedItem('rawDescription') as HTMLInputElement
          if (textareaRef.current) hidden.value = textareaRef.current.value
        }}
      >
        <input type="hidden" name="intent"         value="generate-all" />
        <input type="hidden" name="productId"      value={deal.shopifyProductId} />
        <input type="hidden" name="rawDescription" value={deal.rawDescription ?? ''} />
        <input type="hidden" name="title"          value={deal.seoTitle} />
        <input type="hidden" name="brand"          value={deal.brand} />
        <input type="hidden" name="categories"     value={categories.join(',')} />
        <input type="hidden" name="dealPrice"      value={deal.dealPrice} />
        <input type="hidden" name="msrp"           value={deal.msrp} />
        <button
          type="submit"
          disabled={isGenerating}
          className={
            isGenerating
              ? 'w-full py-3 rounded-xl text-sm font-bold bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed'
              : 'w-full py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-brand-coral to-brand-orange text-white hover:opacity-90 transition-opacity'
          }
        >
          {isGenerating
            ? '✨ Generating all fields… (~30 seconds)'
            : '✨ Generate All Fields from Original Description'}
        </button>
        {isGenerating && (
          <p className="text-xs text-brand-charcoal/50 text-center mt-2">
            Tagline · Full Story · Works For Him · Works For Her · Specs · Box Contents · Bullets · SEO Meta
          </p>
        )}
        {generateFetcher.data?.error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
            ⚠ {generateFetcher.data.error}
          </p>
        )}
      </generateFetcher.Form>
    </div>
  )
}

// ─── Collapsible section ─────────────────────────────────────────────────

function CollapsibleSection({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-brand-mist/40 transition-colors"
      >
        <div>
          <span className="font-semibold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </span>
          {subtitle && (
            <span className="ml-3 text-xs text-brand-charcoal/40">{subtitle}</span>
          )}
        </div>
        <span className={`text-brand-charcoal/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-brand-mist">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Shared product picker type ───────────────────────────────────────────

interface PickerProduct {
  id: string
  title: string
  image: string | null
  price?: number
  compareAtPrice?: number
  inventoryQuantity?: number
  wholesaleCost?: number
  mapPrice?: number
  sku?: string
}

function productToPickerProduct(p: Product): PickerProduct {
  return {
    id:    p.id,
    title: p.title,
    image: p.images[0]?.url ?? null,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
  }
}

function searchResultToPickerProduct(p: AdminProductSearchResult): PickerProduct {
  return {
    id:                p.id,
    title:             p.title,
    image:             p.image,
    price:             p.price,
    compareAtPrice:    p.compareAtPrice ?? undefined,
    inventoryQuantity: p.inventoryQuantity,
    wholesaleCost:     p.wholesaleCost ?? undefined,
    mapPrice:          p.mapPrice ?? undefined,
    sku:               p.sku,
  }
}

// ─── Product Picker component ─────────────────────────────────────────────

function ProductPicker({
  initial,
  onSave,
  saving,
}: {
  initial: PickerProduct[]
  onSave: (ids: string[]) => void
  saving: boolean
}) {
  const [selected, setSelected]   = useState<PickerProduct[]>(initial)
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<AdminProductSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (q.length < 2) { setResults([]); setSearchError(null); return }
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const res  = await fetch(`/api/product-search?q=${encodeURIComponent(q)}`)
        const data = await res.json() as { products: AdminProductSearchResult[]; error?: string }
        if (data.error) setSearchError(data.error)
        setResults(data.products ?? [])
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Search failed')
      } finally {
        setSearching(false)
      }
    }, 350)
  }, [])

  useEffect(() => { search(query) }, [query, search])

  const isSelected = (id: string) => selected.some(p => p.id === id)

  const add = (p: AdminProductSearchResult) => {
    if (!isSelected(p.id)) setSelected(s => [...s, searchResultToPickerProduct(p)])
  }

  const remove = (id: string) => setSelected(s => s.filter(p => p.id !== id))

  return (
    <div className="space-y-4">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="space-y-2">
          {selected.map(p => (
            <div key={p.id} className="flex items-center gap-3 bg-brand-mist rounded-xl px-3 py-2">
              {p.image && (
                <img src={p.image} alt={p.title} className="w-10 h-10 object-cover rounded-lg shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-charcoal truncate">{p.title}</p>
                <p className="text-xs text-brand-charcoal/50">
                  {p.price != null && `$${p.price.toFixed(2)}`}
                  {p.inventoryQuantity != null && ` · ${p.inventoryQuantity} in stock`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="shrink-0 text-brand-charcoal/40 hover:text-red-500 transition-colors text-lg leading-none"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {selected.length === 0 && (
        <p className="text-sm text-brand-charcoal/40 italic">No products selected.</p>
      )}

      {/* Search input */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-charcoal/30 text-sm">🔍</span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search products by name…"
          className="w-full border border-brand-mist rounded-xl pl-8 pr-4 py-2.5 text-sm text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-brand-charcoal/40">Searching…</span>
        )}
      </div>

      {searchError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ⚠ Search error: {searchError}
        </p>
      )}

      {/* Search results */}
      {results.length > 0 && (
        <div className="border border-brand-mist rounded-xl overflow-hidden divide-y divide-brand-mist">
          {results.map(p => {
            const already = isSelected(p.id)
            return (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-brand-mist/40 transition-colors">
                {p.image && (
                  <img src={p.image} alt={p.title} className="w-10 h-10 object-cover rounded-lg shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-charcoal truncate">{p.title}</p>
                  <div className="flex flex-wrap gap-x-3 text-xs text-brand-charcoal/50 mt-0.5">
                    <span>Price: <strong className="text-brand-charcoal">${p.price.toFixed(2)}</strong></span>
                    {p.compareAtPrice && <span>MSRP: ${p.compareAtPrice.toFixed(2)}</span>}
                    {p.wholesaleCost != null && <span>Cost: <strong className="text-green-600">${p.wholesaleCost.toFixed(2)}</strong></span>}
                    {p.mapPrice != null && <span>MAP: ${p.mapPrice.toFixed(2)}</span>}
                    <span>Stock: <strong className={p.inventoryQuantity < 5 ? 'text-red-500' : 'text-brand-charcoal'}>{p.inventoryQuantity}</strong></span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => add(p)}
                  disabled={already}
                  className={
                    already
                      ? 'shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700 cursor-default'
                      : 'shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-brand-purple/10 text-brand-purple hover:bg-brand-purple/20 transition-colors'
                  }
                >
                  {already ? '✓ Added' : '+ Add'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Save button */}
      <button
        type="button"
        onClick={() => onSave(selected.map(p => p.id))}
        disabled={saving}
        className={
          saving
            ? 'w-full py-2.5 rounded-xl text-sm font-bold bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed'
            : 'w-full py-2.5 rounded-xl text-sm font-bold bg-brand-gradient text-white hover:opacity-90 transition-opacity'
        }
      >
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  )
}

// ─── Make It Better panel ─────────────────────────────────────────────────

function MakeItBetterPanel({
  deal,
  currentAccessories,
}: {
  deal: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['deal']>
  currentAccessories: Product[]
}) {
  const fetcher = useFetcher<{ ok: boolean }>()

  const handleSave = (ids: string[]) => {
    const fd = new FormData()
    fd.set('intent',    'save-accessories')
    fd.set('productId', deal.shopifyProductId)
    fd.set('ids',       JSON.stringify(ids))
    fetcher.submit(fd, { method: 'post' })
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
          Make It Better ♥
        </h3>
        <p className="text-xs text-brand-charcoal/40 mt-1">
          Up to 4 products shown below today's deal on the homepage and product page.
        </p>
      </div>
      <ProductPicker
        initial={currentAccessories.map(productToPickerProduct)}
        onSave={handleSave}
        saving={fetcher.state === 'submitting'}
      />
    </div>
  )
}

// ─── Checkout Extras Upsells panel ────────────────────────────────────────

function CheckoutExtrasPanel({ checkoutUpsells }: { checkoutUpsells: Product[] }) {
  const fetcher = useFetcher<{ ok: boolean }>()

  const handleSave = (ids: string[]) => {
    const fd = new FormData()
    fd.set('intent', 'save-checkout-upsells')
    fd.set('ids',    JSON.stringify(ids))
    fetcher.submit(fd, { method: 'post' })
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
          Checkout Extras — Upsell Products
        </h3>
        <p className="text-xs text-brand-charcoal/40 mt-1">
          Products shown on the /checkout-extras page. Up to 4 are displayed.
          These are site-wide (not per-deal).
        </p>
      </div>
      <ProductPicker
        initial={checkoutUpsells.map(productToPickerProduct)}
        onSave={handleSave}
        saving={fetcher.state === 'submitting'}
      />
    </div>
  )
}

// ─── Checkout Content Blocks panel ────────────────────────────────────────

// ─── Page ──────────────────────────────────────────────────────────────────

export default function AdminToday() {
  const {
    deal, shopifyCost, dealCategories,
    currentAccessories, checkoutUpsells, productImages,
  } = useLoaderData<typeof loader>()
  const approveFetcher = useFetcher<{ ok: boolean }>()
  const liveFetcher    = useFetcher<{ ok: boolean }>()
  const { revalidate } = useRevalidator()

  if (!deal) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-brand-charcoal mb-4" style={{ fontFamily: 'var(--font-display)' }}>Today's Deal</h1>
        <p className="text-brand-charcoal/50">No live deal found. Use the Queue to schedule one.</p>
      </div>
    )
  }

  const approveLabel = approveFetcher.state === 'submitting' ? 'Saving…' : approveFetcher.data?.ok ? '✓ Approved!' : '✓ Approve'
  const liveLabel    = liveFetcher.state === 'submitting'    ? 'Setting live…' : liveFetcher.data?.ok ? '🟢 Live!' : 'Set Live'
  const isLive = deal.dealStatus === 'live'

  const featureBulletsDefault = deal.featureBullets.join('\n')
  const boxContentsDefault    = deal.boxContents.join('\n')

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>Today's Deal</h1>
          <p className="text-brand-charcoal/60">{deal.seoTitle} — {deal.brand}</p>
        </div>
        <div className="flex gap-3">
          <approveFetcher.Form method="post">
            <input type="hidden" name="intent"    value="approve" />
            <input type="hidden" name="productId" value={deal.shopifyProductId} />
            <button
              type="submit"
              disabled={approveFetcher.state === 'submitting' || isLive}
              className={
                approveFetcher.data?.ok || isLive
                  ? 'bg-green-700 text-white font-bold px-5 py-2 rounded-full text-sm opacity-60 cursor-default'
                  : 'bg-green-500 text-white font-bold px-5 py-2 rounded-full hover:bg-green-600 transition-colors text-sm'
              }
            >
              {isLive ? '✓ Approved' : approveLabel}
            </button>
          </approveFetcher.Form>
          <liveFetcher.Form method="post">
            <input type="hidden" name="intent"    value="set-live" />
            <input type="hidden" name="productId" value={deal.shopifyProductId} />
            <button
              type="submit"
              disabled={liveFetcher.state === 'submitting' || isLive}
              className={
                liveFetcher.data?.ok || isLive
                  ? 'bg-blue-700 text-white font-bold px-5 py-2 rounded-full text-sm opacity-60 cursor-default'
                  : 'bg-blue-500 text-white font-bold px-5 py-2 rounded-full hover:bg-blue-600 transition-colors text-sm'
              }
            >
              {liveLabel}
            </button>
          </liveFetcher.Form>
        </div>
      </div>

      {/* Hero preview */}
      <div className="bg-white rounded-2xl p-6 shadow-sm flex gap-4">
        {deal.images[0] && (
          <img src={deal.images[0].url} alt={deal.seoTitle} className="w-24 h-24 object-cover rounded-xl shrink-0" />
        )}
        <div>
          <p className="font-bold text-brand-charcoal">{deal.seoTitle}</p>
          <p className="text-brand-charcoal/60 text-sm mt-1 italic">{deal.tagline}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-brand-gradient font-black text-xl" style={{ fontFamily: 'var(--font-display)' }}>${deal.dealPrice.toFixed(2)}</span>
            <span className="text-brand-charcoal/40 line-through">${deal.msrp.toFixed(2)}</span>
            <span className="text-xs bg-brand-gradient text-white px-2 py-0.5 rounded-full font-bold">
              {deal.msrp > 0 ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100) : 0}% off
            </span>
          </div>
          <p className="text-xs text-brand-charcoal/50 mt-1">
            Status: <strong>{deal.dealStatus}</strong> · SKU: {deal.sku} · Qty: {deal.qty}
          </p>
        </div>
      </div>

      {/* Variants panel — only shown for multi-variant products */}
      {(deal.variants?.length ?? 0) > 1 && (
        <CollapsibleSection
          title="Variants"
          subtitle={`${deal.variants!.length} variants · ${deal.options?.map(o => o.name).join(' × ')}`}
          defaultOpen
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-brand-charcoal/50 border-b border-brand-mist">
                  <th className="py-2 pr-3">Image</th>
                  {deal.options?.map(o => <th key={o.name} className="py-2 pr-3">{o.name}</th>)}
                  <th className="py-2 pr-3">Price</th>
                  <th className="py-2 pr-3">Stock</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-mist/50">
                {deal.variants!.map(v => (
                  <tr key={v.id} className={!v.availableForSale ? 'opacity-50' : ''}>
                    <td className="py-2 pr-3">
                      {v.image ? (
                        <img src={v.image.url} alt={v.title} className="w-10 h-10 object-cover rounded-lg" />
                      ) : (
                        <div className="w-10 h-10 bg-brand-mist rounded-lg flex items-center justify-center text-brand-charcoal/20 text-xs">—</div>
                      )}
                    </td>
                    {deal.options?.map(o => {
                      const val = v.selectedOptions.find(so => so.name === o.name)?.value
                      return <td key={o.name} className="py-2 pr-3 font-medium text-brand-charcoal">{val ?? '—'}</td>
                    })}
                    <td className="py-2 pr-3 tabular-nums">${parseFloat(v.price).toFixed(2)}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      <span className={v.quantityAvailable < 5 ? 'text-red-600 font-semibold' : ''}>
                        {v.quantityAvailable}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {v.availableForSale ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">In Stock</span>
                      ) : (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Out of Stock</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      )}

      {/* Image Manager */}
      <ImageManager
        deal={deal}
        initialImages={productImages ?? []}
        onImagesChange={revalidate}
      />

      {/* Pricing */}
      <PricingFields deal={deal} shopifyCost={shopifyCost} />

      {/* Copy & SEO — collapsible */}
      <CollapsibleSection title="Copy & SEO" subtitle="Tagline · Story · Specs · Bullets · Meta">
        <RawDescriptionPanel deal={deal} categories={dealCategories} />
        <SaveableField label="Tagline"        fieldKey="tagline"        fieldType="single_line_text_field" defaultValue={deal.tagline}               productId={deal.shopifyProductId} rows={2} />
        <SaveableField label="Full Story"     fieldKey="full_story"     fieldType="multi_line_text_field"  defaultValue={deal.fullStory}             productId={deal.shopifyProductId} rows={10} />
        <SaveableField label="Works For Him"  fieldKey="works_for_him"  fieldType="multi_line_text_field"  defaultValue={deal.worksForHim}           productId={deal.shopifyProductId} />
        <SaveableField label="Works For Her"  fieldKey="works_for_her"  fieldType="multi_line_text_field"  defaultValue={deal.worksForHer}           productId={deal.shopifyProductId} />
        <SaveableField label="Specifications" fieldKey="specifications"  fieldType="multi_line_text_field"  defaultValue={deal.specifications ?? ''}  productId={deal.shopifyProductId} rows={6} />
        <SaveableField
          label="What's In The Box"
          hint="One item per line. Shown in the 'What's In The Box' tab."
          defaultValue={boxContentsDefault}
          productId={deal.shopifyProductId}
          rows={5}
          intent="save-box-contents"
        />
        <SaveableField
          label="Feature Bullets"
          hint="One bullet per line. Shown in the hero panel."
          defaultValue={featureBulletsDefault}
          productId={deal.shopifyProductId}
          rows={5}
          intent="save-bullets"
        />
        <SaveableField
          label="SEO Meta Description"
          fieldKey="seo_meta_description"
          fieldType="multi_line_text_field"
          defaultValue={deal.metaDescription}
          productId={deal.shopifyProductId}
          rows={2}
        />
      </CollapsibleSection>

      {/* Divider */}
      <div className="border-t border-brand-mist pt-2">
        <h2 className="text-lg font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
          Product Pickers
        </h2>
        <p className="text-sm text-brand-charcoal/50 mt-1">
          Control which products appear in the "Make It Better" and "Checkout Extras" sections.
        </p>
      </div>

      <MakeItBetterPanel deal={deal} currentAccessories={currentAccessories} />
      <CheckoutExtrasPanel checkoutUpsells={checkoutUpsells} />
    </div>
  )
}
