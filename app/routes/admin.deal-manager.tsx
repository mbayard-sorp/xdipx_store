import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, useRevalidator, useSearchParams, redirect } from 'react-router'
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  getDealByShopifyId, updateProductMetafield, setDealStatus,
  activateShopifyProduct, getVariantCost,
  getAccessoryProductsAdmin, getProductAdminImages,
  updateProductTags,
} from '~/lib/shopify.server'
import type { AdminProductImage } from '~/lib/shopify.server'
import { ProductPicker, productToPickerProduct } from '~/components/admin/ProductPicker'
import { ImageManager } from '~/components/admin/ImageManager'
import { PricingPanel } from '~/components/admin/PricingPanel'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { enqueueFieldRegenJob } from '~/lib/field-regen-runner.server'
import { getPinnedAccessoryIds, setPinnedAccessoryIds } from '~/lib/kv.server'
import type { Product } from '~/types'

export const meta: MetaFunction = () => [{ title: 'Deal Manager — xdipx Admin' }]

type PricingConfig = {
  dealPrice: number
  msrp: number
  wholesaleCost: number
  mapPrice: number
  pctOffMsrp: number
  vaultPriceOverride: number | null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const dateParam = url.searchParams.get('date')
  const todayEST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const targetDate = dateParam || todayEST

  const [dbDeal] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.dealDate, targetDate))
    .limit(1)

  if (!dbDeal?.shopifyProductId) {
    return {
      deal: null, shopifyCost: null, targetDate, todayEST,
      dealCategories: [] as string[],
      pinnedAccessories: [] as Product[], pinnedAccessoryIds: [] as string[],
      productImages: [] as AdminProductImage[],
      pricingConfig: null as PricingConfig | null,
    }
  }

  const deal = await getDealByShopifyId(dbDeal.shopifyProductId)
  const shopifyCost = deal?.variantId ? await getVariantCost(deal.variantId) : null

  const pricingConfig: PricingConfig = {
    dealPrice:          parseFloat(dbDeal.dealPrice     ?? '0'),
    msrp:               parseFloat(dbDeal.msrp          ?? '0'),
    wholesaleCost:      parseFloat(dbDeal.wholesaleCost ?? '0'),
    mapPrice:           parseFloat(dbDeal.mapPrice      ?? '0'),
    pctOffMsrp:         parseFloat(dbDeal.pctOffMsrp    ?? '0'),
    vaultPriceOverride: dbDeal.vaultPrice ? parseFloat(dbDeal.vaultPrice) : null,
  }

  const [productImages, pinnedAccessoryIds] = await Promise.all([
    deal ? getProductAdminImages(dbDeal.shopifyProductId) : Promise.resolve([] as AdminProductImage[]),
    getPinnedAccessoryIds(),
  ])
  const pinnedAccessories = pinnedAccessoryIds.length
    ? await getAccessoryProductsAdmin(pinnedAccessoryIds)
    : []

  return {
    deal, shopifyCost, targetDate, todayEST,
    dealCategories: dbDeal.categories ?? [],
    pinnedAccessories, pinnedAccessoryIds, productImages,
    pricingConfig,
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
    if (key === 'specifications') {
      // Phase 2 — specifications stored as JSON string[] of "Label: Value"
      // bullets (mirrors care_instructions / box_contents). Editor types one
      // bullet per line; we serialize before writing.
      const items = value.split('\n').map(l => l.trim()).filter(Boolean)
      await updateProductMetafield(productId, key, JSON.stringify(items), type)
      return { ok: true }
    }
    await updateProductMetafield(productId, key, value, type)
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
    const productIdRaw       = form.get('productId') as string
    const productId          = productIdRaw.replace('gid://shopify/Product/', '')
    const dealPrice          = form.get('dealPrice') as string
    const msrp               = form.get('msrp') as string
    const wholesaleCost      = form.get('wholesaleCost') as string
    const mapPrice           = form.get('mapPrice') as string
    const pctOffMsrp         = form.get('pctOffMsrp') as string
    const vaultPriceOverride = form.get('vaultPriceOverride') as string | null

    const clampedPct = Math.max(0, Math.min(100, parseFloat(pctOffMsrp || '0') || 0))
    const vaultVal = vaultPriceOverride && vaultPriceOverride.trim() !== ''
      ? parseFloat(vaultPriceOverride).toFixed(2)
      : null

    await db
      .update(dealHistory)
      .set({
        dealPrice:     (parseFloat(dealPrice || '0') || 0).toFixed(2),
        msrp:          (parseFloat(msrp || '0') || 0).toFixed(2),
        wholesaleCost: (parseFloat(wholesaleCost || '0') || 0).toFixed(2),
        mapPrice:      (parseFloat(mapPrice || '0') || 0).toFixed(2),
        pctOffMsrp:    clampedPct.toFixed(2),
        vaultPrice:    vaultVal,
      })
      .where(eq(dealHistory.shopifyProductId, productId))
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
    const productId  = form.get('productId') as string
    const rawDesc    = form.get('rawDescription') as string
    const title      = form.get('title') as string
    const brand      = form.get('brand') as string
    const categories = (form.get('categories') as string).split(',').filter(Boolean)
    const dealPrice  = parseFloat((form.get('dealPrice') as string) || '0')
    const msrp       = parseFloat((form.get('msrp') as string) || '0')

    if (!rawDesc?.trim()) {
      return { ok: false, error: 'No original description — paste the raw product description and Save it first.' }
    }
    if (!productId) {
      return { ok: false, error: 'Missing productId.' }
    }

    // Look up the deal to get its SKU.
    const deal = await getDealByShopifyId(productId)
    const sku = deal?.sku ?? productId

    const { jobId } = await enqueueFieldRegenJob({
      kind:      'copy-fields',
      productId,
      sku,
      product: {
        title:       title || brand,
        brand,
        description: rawDesc,
        categories,
        dealPrice,
        msrp,
      },
      fields: ['specifications', 'tagline', 'full_story', 'both_ways', 'seo_meta', 'box_contents'],
    })

    return {
      ok:      true,
      queued:  true,
      jobId,
      message: `Copy regeneration queued. Track progress at /admin/async-jobs?jobId=${jobId}`,
    }
  }

  if (intent === 'save-pinned-accessories') {
    const ids = JSON.parse(form.get('ids') as string) as string[]
    await setPinnedAccessoryIds(ids)
    const currentDate = form.get('currentDate') as string | null
    return redirect(currentDate ? `/admin/deal-manager?date=${currentDate}` : '/admin/deal-manager')
  }

  if (intent === 'save-tags') {
    const productId = form.get('productId') as string
    const tags = JSON.parse(form.get('tags') as string) as string[]
    await updateProductTags(productId, tags)
    const currentDate = form.get('currentDate') as string | null
    return redirect(currentDate ? `/admin/deal-manager?date=${currentDate}` : '/admin/deal-manager')
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
    ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-ink/10 text-ink/40 cursor-not-allowed'
    : saved
      ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700 transition-colors'
      : 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-cream-2 text-sage hover:bg-sage/10 transition-colors'

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <h3 className="font-semibold text-ink mb-1" style={{ fontFamily: 'var(--font-display)' }}>{label}</h3>
      {hint && <p className="text-xs text-ink/40 mb-3">{hint}</p>}
      <fetcher.Form method="post" className="flex flex-col gap-2">
        <input type="hidden" name="intent"    value={intent} />
        <input type="hidden" name="productId" value={productId} />
        {fieldKey  && <input type="hidden" name="key"  value={fieldKey} />}
        {fieldType && <input type="hidden" name="type" value={fieldType} />}
        <textarea
          name="value"
          defaultValue={defaultValue}
          rows={rows}
          className="w-full border border-cream-2 rounded-xl px-4 py-3 text-sm text-ink resize-y focus:outline-none focus:ring-2 focus:ring-coral/30 font-mono"
        />
        <button type="submit" disabled={fetcher.state === 'submitting'} className={buttonClass}>
          {buttonLabel}
        </button>
      </fetcher.Form>
    </div>
  )
}


// ─── Raw Description + Generate All ────────────────────────────────────────

type GenerateAllData = { ok: boolean; queued?: boolean; jobId?: string; message?: string; error?: string }

function RawDescriptionPanel({ deal, categories, targetDate }: {
  deal: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['deal']>
  categories: string[]
  targetDate: string
}) {
  const saveFetcher     = useFetcher<{ ok: boolean }>()
  const generateFetcher = useFetcher<GenerateAllData>()
  const textareaRef     = useRef<HTMLTextAreaElement>(null)

  const isSaving     = saveFetcher.state === 'submitting'
  const saved        = saveFetcher.state === 'idle' && saveFetcher.data?.ok === true
  const isSubmitting = generateFetcher.state === 'submitting'
  const isQueued     = generateFetcher.state === 'idle' && generateFetcher.data?.queued === true
  const jobId        = generateFetcher.data?.jobId

  const placeholder = '(No original description stored — re-run the pipeline to import it, or paste the raw product description here and click Save)'

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Original Product Description
          <span className="ml-2 text-xs font-normal text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">custom.original_description</span>
        </h3>
        <p className="text-xs text-ink/50 mt-1">
          Raw text from Nalpac feed. Edit if needed, then click "Generate All Fields" to queue async regeneration via the Batch API.
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
          className="w-full border border-amber-200 rounded-xl px-4 py-3 text-xs text-ink resize-y bg-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40"
        />
        <button
          type="submit"
          disabled={isSaving}
          className={
            isSaving
              ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-ink/10 text-ink/40 cursor-not-allowed'
              : saved
                ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700'
                : 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors'
          }
        >
          {isSaving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Description'}
        </button>
      </saveFetcher.Form>

      {/* Generate All — enqueues a field-regen batch job, returns immediately */}
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
        <input type="hidden" name="currentDate"    value={targetDate} />
        <input type="hidden" name="rawDescription" value={deal.rawDescription ?? ''} />
        <input type="hidden" name="title"          value={deal.seoTitle} />
        <input type="hidden" name="brand"          value={deal.brand} />
        <input type="hidden" name="categories"     value={categories.join(',')} />
        <input type="hidden" name="dealPrice"      value={deal.dealPrice} />
        <input type="hidden" name="msrp"           value={deal.msrp} />
        <button
          type="submit"
          disabled={isSubmitting || isQueued}
          className={
            isSubmitting
              ? 'w-full py-3 rounded-xl text-sm font-bold bg-ink/10 text-ink/40 cursor-not-allowed'
              : isQueued
                ? 'w-full py-3 rounded-xl text-sm font-bold bg-green-100 text-green-700 cursor-default'
                : 'w-full py-3 rounded-xl text-sm font-bold bg-coral text-white hover:bg-coral-2 transition-colors'
          }
        >
          {isSubmitting
            ? 'Queuing…'
            : isQueued
              ? '✓ Regeneration queued'
              : 'Generate All Fields from Original Description'}
        </button>
        {isSubmitting && (
          <p className="text-xs text-ink/50 text-center mt-2">
            Submitting to Batch API — returns instantly, results ready in minutes.
          </p>
        )}
        {isQueued && jobId && (
          <p className="text-xs text-ink/60 text-center mt-2">
            Job queued.{' '}
            <a
              href={`/admin/async-jobs?jobId=${jobId}`}
              className="underline text-coral hover:text-coral-2"
            >
              Track progress
            </a>
            {' '}— fields apply automatically when the batch completes.
          </p>
        )}
        {generateFetcher.data?.error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
            Error: {generateFetcher.data.error}
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
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-cream-2/40 transition-colors"
      >
        <div>
          <span className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </span>
          {subtitle && (
            <span className="ml-3 text-xs text-ink/40">{subtitle}</span>
          )}
        </div>
        <span className={`text-ink/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-cream-2">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Draggable section wrapper ───────────────────────────────────────────

const SECTION_ORDER_KEY = 'dealManagerSectionOrder'
const DEFAULT_SECTION_ORDER = ['hero', 'tags', 'images', 'copy', 'pickers']

function DraggableSection({
  sectionKey,
  children,
  draggedKey,
  onDragStart,
  dragOverKey,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  sectionKey: string
  children: React.ReactNode
  draggedKey: string | null
  onDragStart: (key: string) => void
  dragOverKey: string | null
  onDragOver: (key: string) => void
  onDragLeave: () => void
  onDrop: (targetKey: string) => void
}) {
  const isDragOver = dragOverKey === sectionKey && draggedKey !== sectionKey

  return (
    <div
      onDragOver={e => { e.preventDefault(); onDragOver(sectionKey) }}
      onDragLeave={onDragLeave}
      onDrop={e => { e.preventDefault(); onDrop(sectionKey) }}
      className={`relative group transition-all duration-150 ${isDragOver ? 'ring-2 ring-coral/40 ring-offset-2 rounded-2xl' : ''}`}
    >
      {/* Drag handle */}
      <div
        draggable
        onDragStart={() => onDragStart(sectionKey)}
        className="absolute -left-8 top-3 w-6 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-ink/20 hover:text-ink/50 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Drag to reorder"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="4" r="2" /><circle cx="16" cy="4" r="2" />
          <circle cx="8" cy="12" r="2" /><circle cx="16" cy="12" r="2" />
          <circle cx="8" cy="20" r="2" /><circle cx="16" cy="20" r="2" />
        </svg>
      </div>
      {children}
    </div>
  )
}

// ─── Date Navigator ──────────────────────────────────────────────────────

function DateNavigator({ targetDate, todayEST }: { targetDate: string; todayEST: string }) {
  const [, setSearchParams] = useSearchParams()

  const goToDate = (dateStr: string) => {
    setSearchParams(dateStr === todayEST ? {} : { date: dateStr })
  }

  const shiftDay = (offset: number) => {
    const [y, m, d] = targetDate.split('-').map(Number)
    const dt = new Date(y!, m! - 1, d!)
    dt.setDate(dt.getDate() + offset)
    goToDate(dt.toISOString().split('T')[0]!)
  }

  // Arrow key navigation (left/right) — skip when focused on inputs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === 'ArrowLeft')  { e.preventDefault(); shiftDay(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); shiftDay(1) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const isToday = targetDate === todayEST
  const [y, m, d] = targetDate.split('-').map(Number)
  const displayDate = new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => shiftDay(-1)}
        className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-cream-2 text-ink/60 hover:bg-cream-2 hover:text-ink transition-colors text-lg"
        aria-label="Previous day"
      >
        &larr;
      </button>
      <input
        type="date"
        value={targetDate}
        onChange={e => goToDate(e.target.value)}
        className="border border-cream-2 rounded-xl px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30"
      />
      <span className="text-sm font-medium text-ink/70">{displayDate}</span>
      <button
        type="button"
        onClick={() => shiftDay(1)}
        className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-cream-2 text-ink/60 hover:bg-cream-2 hover:text-ink transition-colors text-lg"
        aria-label="Next day"
      >
        &rarr;
      </button>
      {!isToday && (
        <button
          type="button"
          onClick={() => goToDate(todayEST)}
          className="ml-1 text-xs font-bold px-3 py-1.5 rounded-full bg-sage/10 text-sage hover:bg-sage/20 transition-colors"
        >
          Today
        </button>
      )}
    </div>
  )
}

// ─── Pinned to Cart panel ────────────────────────────────────────────────

function PinnedToCartPanel({ pinnedAccessories, targetDate }: { pinnedAccessories: Product[]; targetDate: string }) {
  const fetcher = useFetcher<{ ok: boolean }>()

  const handleSave = (ids: string[]) => {
    const fd = new FormData()
    fd.set('intent', 'save-pinned-accessories')
    fd.set('ids', JSON.stringify(ids))
    fd.set('currentDate', targetDate)
    fetcher.submit(fd, { method: 'post' })
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Pinned to Cart
        </h3>
        <p className="text-xs text-ink/40 mt-1">
          Products shown in the cart slide-out for all deals. Up to 4 displayed.
        </p>
      </div>
      <ProductPicker
        initial={pinnedAccessories.map(productToPickerProduct)}
        onSave={handleSave}
        saving={fetcher.state === 'submitting'}
      />
    </div>
  )
}

// ─── Tags Editor ─────────────────────────────────────────────────────────

function TagsEditor({ deal, targetDate }: {
  deal: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['deal']>
  targetDate: string
}) {
  const fetcher = useFetcher<{ ok: boolean }>()
  const [tags, setTags] = useState<string[]>(deal.tags)
  const [input, setInput] = useState('')
  const saved = fetcher.state === 'idle' && fetcher.data?.ok === true

  const addTag = () => {
    const tag = input.trim()
    if (tag && !tags.includes(tag)) {
      setTags(t => [...t, tag])
    }
    setInput('')
  }

  const removeTag = (tag: string) => setTags(t => t.filter(x => x !== tag))

  const handleSave = () => {
    const fd = new FormData()
    fd.set('intent', 'save-tags')
    fd.set('productId', deal.shopifyProductId)
    fd.set('tags', JSON.stringify(tags))
    fd.set('currentDate', targetDate)
    fetcher.submit(fd, { method: 'post' })
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Product Tags
        </h3>
        <button
          type="button"
          onClick={handleSave}
          disabled={fetcher.state === 'submitting'}
          className={
            fetcher.state === 'submitting'
              ? 'text-xs font-bold px-3 py-1.5 rounded-full bg-ink/10 text-ink/40 cursor-not-allowed'
              : saved
                ? 'text-xs font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700'
                : 'text-xs font-bold px-3 py-1.5 rounded-full bg-cream-2 text-sage hover:bg-sage/10 transition-colors'
          }
        >
          {fetcher.state === 'submitting' ? 'Saving…' : saved ? '✓ Saved!' : 'Save Tags'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {tags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 bg-cream-2 text-ink text-xs font-medium px-2.5 py-1 rounded-full">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-ink/40 hover:text-red-500 transition-colors leading-none ml-0.5"
              aria-label={`Remove ${tag}`}
            >
              ✕
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span className="text-xs text-ink/40 italic">No tags</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
          placeholder="Add a tag…"
          className="flex-1 border border-cream-2 rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30"
        />
        <button
          type="button"
          onClick={addTag}
          className="text-xs font-bold px-3 py-2 rounded-xl bg-cream-2 text-sage hover:bg-sage/10 transition-colors"
        >
          + Add
        </button>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function DealManagerRoute() {
  const { targetDate } = useLoaderData<typeof loader>()
  // Key on targetDate forces full component remount (all hooks reset) on date change
  return <DealManager key={targetDate} />
}

function DealManager() {
  const {
    deal, shopifyCost, targetDate, todayEST, dealCategories,
    pinnedAccessories, productImages,
    pricingConfig,
  } = useLoaderData<typeof loader>()
  const approveFetcher  = useFetcher<{ ok: boolean }>()
  const liveFetcher     = useFetcher<{ ok: boolean }>()
  const { revalidate } = useRevalidator()
  const [variantsOpen, setVariantsOpen] = useState(true)

  // Drag-and-drop section reordering
  const [sectionOrder, setSectionOrder] = useState<string[]>(DEFAULT_SECTION_ORDER)
  const [draggedKey, setDraggedKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SECTION_ORDER_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as string[]
        // Validate: must contain exactly the expected keys
        if (parsed.length === DEFAULT_SECTION_ORDER.length && DEFAULT_SECTION_ORDER.every(k => parsed.includes(k))) {
          setSectionOrder(parsed)
        }
      }
    } catch { /* use default */ }
  }, [])

  const handleReorder = useCallback((targetKey: string) => {
    if (!draggedKey || draggedKey === targetKey) return
    setDragOverKey(null)
    setSectionOrder(prev => {
      const next = prev.filter(k => k !== draggedKey)
      const targetIdx = next.indexOf(targetKey)
      next.splice(targetIdx, 0, draggedKey)
      localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(next))
      return next
    })
    setDraggedKey(null)
  }, [draggedKey])

  if (!deal) {
    return (
      <div className="space-y-6 max-w-4xl">
        <DateNavigator targetDate={targetDate} todayEST={todayEST} />
        <div>
          <h1 className="text-2xl font-bold text-ink mb-2" style={{ fontFamily: 'var(--font-display)' }}>Deal Manager</h1>
          <p className="text-ink/50">No deal scheduled for this date. Use the Schedule or Queue to assign one.</p>
        </div>
      </div>
    )
  }

  const approveLabel = approveFetcher.state === 'submitting' ? 'Saving…' : approveFetcher.data?.ok ? '✓ Approved!' : '✓ Approve'
  const liveLabel    = liveFetcher.state === 'submitting'    ? 'Setting live…' : liveFetcher.data?.ok ? '🟢 Live!' : 'Set Live'
  const isLive = deal.dealStatus === 'live'

  const boxContentsDefault    = deal.boxContents.join('\n')

  return (
    <div className="space-y-6 max-w-4xl pl-8">
      {/* Date Navigator */}
      <DateNavigator targetDate={targetDate} todayEST={todayEST} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>Deal Manager</h1>
          <p className="text-ink/60">{deal.seoTitle} — {deal.brand}</p>
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

      {/* Draggable sections */}
      {(() => {
        const dragProps = {
          draggedKey,
          onDragStart: setDraggedKey,
          dragOverKey,
          onDragOver: setDragOverKey,
          onDragLeave: () => setDragOverKey(null),
          onDrop: handleReorder,
        }

        const sectionMap: Record<string, React.ReactNode> = {
          hero: (
            <DraggableSection key="hero" sectionKey="hero" {...dragProps}>
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="flex gap-4">
                  {deal.images[0] && (
                    <img src={deal.images[0].url} alt={deal.seoTitle} className="w-24 h-24 object-cover rounded-xl shrink-0" />
                  )}
                  <div>
                    <p className="font-bold text-ink">{deal.seoTitle}</p>
                    <p className="text-ink/60 text-sm mt-1 italic">{deal.tagline}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-coral font-black text-xl" style={{ fontFamily: 'var(--font-display)' }}>${deal.dealPrice.toFixed(2)}</span>
                      <span className="text-ink/40 line-through">${deal.msrp.toFixed(2)}</span>
                      <span className="text-xs bg-coral text-white px-2 py-0.5 rounded-full font-bold">
                        {deal.msrp > 0 ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100) : 0}% off
                      </span>
                    </div>
                    <p className="text-xs text-ink/50 mt-1">
                      Status: <strong>{deal.dealStatus}</strong> · SKU: {deal.sku} · Qty: {deal.qty}
                    </p>
                  </div>
                </div>

                {/* Pricing — three-section panel with auto-save */}
                {pricingConfig && (
                  <PricingPanel
                    productId={deal.shopifyProductId}
                    config={pricingConfig}
                    shopifyCost={shopifyCost}
                  />
                )}

                {/* Variants — merged into hero card */}
                {(deal.variants?.length ?? 0) > 1 && (
                  <div className="mt-4 border-t border-cream-2 pt-4">
                    <button
                      type="button"
                      onClick={() => setVariantsOpen(o => !o)}
                      className="flex items-center gap-2 text-sm font-semibold text-ink hover:text-ink/80 transition-colors"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      Variants ({deal.variants!.length})
                      <span className={`text-ink/40 transition-transform duration-200 text-xs ${variantsOpen ? 'rotate-180' : ''}`}>&#x25BC;</span>
                    </button>
                    {variantsOpen && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-ink/50 border-b border-cream-2">
                              <th className="py-2 pr-3">Image</th>
                              {deal.options?.map(o => <th key={o.name} className="py-2 pr-3">{o.name}</th>)}
                              <th className="py-2 pr-3">Price</th>
                              <th className="py-2 pr-3">Stock</th>
                              <th className="py-2 pr-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-cream-2/50">
                            {deal.variants!.map(v => (
                              <tr key={v.id} className={!v.availableForSale ? 'opacity-50' : ''}>
                                <td className="py-2 pr-3">
                                  {v.image ? (
                                    <img src={v.image.url} alt={v.title} className="w-10 h-10 object-cover rounded-lg" />
                                  ) : (
                                    <div className="w-10 h-10 bg-cream-2 rounded-lg flex items-center justify-center text-ink/20 text-xs">—</div>
                                  )}
                                </td>
                                {deal.options?.map(o => {
                                  const val = v.selectedOptions.find(so => so.name === o.name)?.value
                                  return <td key={o.name} className="py-2 pr-3 font-medium text-ink">{val ?? '—'}</td>
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
                    )}
                  </div>
                )}
              </div>
            </DraggableSection>
          ),

          tags: (
            <DraggableSection key="tags" sectionKey="tags" {...dragProps}>
              <TagsEditor deal={deal} targetDate={targetDate} />
            </DraggableSection>
          ),

          images: (
            <DraggableSection key="images" sectionKey="images" {...dragProps}>
              <ImageManager
                deal={deal}
                initialImages={productImages ?? []}
                onImagesChange={revalidate}
              />
            </DraggableSection>
          ),

          copy: (
            <DraggableSection key="copy" sectionKey="copy" {...dragProps}>
              <CollapsibleSection title="Copy & SEO" subtitle="Tagline · Story · Specs · Bullets · Meta">
                <RawDescriptionPanel deal={deal} categories={dealCategories} targetDate={targetDate} />
                <SaveableField label="Tagline"        fieldKey="tagline"        fieldType="single_line_text_field" defaultValue={deal.tagline}               productId={deal.shopifyProductId} rows={2} />
                <SaveableField label="Full Story"     fieldKey="full_story"     fieldType="multi_line_text_field"  defaultValue={deal.fullStory}             productId={deal.shopifyProductId} rows={10} />
                <SaveableField label="Works For Him"  fieldKey="works_for_him"  fieldType="multi_line_text_field"  defaultValue={deal.worksForHim}           productId={deal.shopifyProductId} />
                <SaveableField label="Works For Her"  fieldKey="works_for_her"  fieldType="multi_line_text_field"  defaultValue={deal.worksForHer}           productId={deal.shopifyProductId} />
                <SaveableField label="Specifications" fieldKey="specifications"  fieldType="multi_line_text_field"  defaultValue={(deal.specifications ?? []).join('\n')}  productId={deal.shopifyProductId} rows={6} hint="One bullet per line: 'Label: Value' (e.g. 'Color: Black')" />
                <SaveableField
                  label="What's In The Box"
                  hint="One item per line. Shown in the 'What's In The Box' tab."
                  defaultValue={boxContentsDefault}
                  productId={deal.shopifyProductId}
                  rows={5}
                  intent="save-box-contents"
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
            </DraggableSection>
          ),

          pickers: (
            <DraggableSection key="pickers" sectionKey="pickers" {...dragProps}>
              <div>
                <div className="border-t border-cream-2 pt-2 mb-6">
                  <h2 className="text-lg font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
                    Cart Upsells
                  </h2>
                  <p className="text-sm text-ink/50 mt-1">
                    Manage products shown in the cart slide-out.
                  </p>
                </div>
                <PinnedToCartPanel pinnedAccessories={pinnedAccessories} targetDate={targetDate} />
              </div>
            </DraggableSection>
          ),
        }

        return sectionOrder.map(key => sectionMap[key])
      })()}
    </div>
  )
}
