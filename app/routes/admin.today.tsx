import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, redirect } from 'react-router'
import { useEffect, useRef } from 'react'
import {
  getDealByShopifyId, updateProductMetafield, setDealStatus,
  activateShopifyProduct, updateVariantPricing, getVariantCost,
  pushProductToShopify,
} from '~/lib/shopify.server'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { generateCopy, generateSEOTitle } from '~/lib/claude.server'

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
  return { deal, shopifyCost, dealCategories: dbDeal.categories ?? [] }
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

// ─── Page ──────────────────────────────────────────────────────────────────

export default function AdminToday() {
  const { deal, shopifyCost, dealCategories } = useLoaderData<typeof loader>()
  const approveFetcher = useFetcher<{ ok: boolean }>()
  const liveFetcher    = useFetcher<{ ok: boolean }>()

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

      {/* Pricing */}
      <PricingFields deal={deal} shopifyCost={shopifyCost} />

      {/* Raw description + Generate All */}
      <RawDescriptionPanel deal={deal} categories={dealCategories} />

      {/* Copy fields */}
      <SaveableField label="Tagline"        fieldKey="tagline"        fieldType="single_line_text_field" defaultValue={deal.tagline}               productId={deal.shopifyProductId} rows={2} />
      <SaveableField label="Full Story"     fieldKey="full_story"     fieldType="multi_line_text_field"  defaultValue={deal.fullStory}             productId={deal.shopifyProductId} rows={10} />
      <SaveableField label="Works For Him"  fieldKey="works_for_him"  fieldType="multi_line_text_field"  defaultValue={deal.worksForHim}           productId={deal.shopifyProductId} />
      <SaveableField label="Works For Her"  fieldKey="works_for_her"  fieldType="multi_line_text_field"  defaultValue={deal.worksForHer}           productId={deal.shopifyProductId} />
      <SaveableField label="Specifications" fieldKey="specifications"  fieldType="multi_line_text_field"  defaultValue={deal.specifications ?? ''}  productId={deal.shopifyProductId} rows={6} />

      {/* What's in the box — one per line */}
      <SaveableField
        label="What's In The Box"
        hint="One item per line. Shown in the 'What's In The Box' tab."
        defaultValue={boxContentsDefault}
        productId={deal.shopifyProductId}
        rows={5}
        intent="save-box-contents"
      />

      {/* Feature bullets — one per line */}
      <SaveableField
        label="Feature Bullets"
        hint="One bullet per line. Shown in the hero panel."
        defaultValue={featureBulletsDefault}
        productId={deal.shopifyProductId}
        rows={5}
        intent="save-bullets"
      />

      {/* SEO meta */}
      <SaveableField
        label="SEO Meta Description"
        fieldKey="seo_meta_description"
        fieldType="multi_line_text_field"
        defaultValue={deal.metaDescription}
        productId={deal.shopifyProductId}
        rows={2}
      />
    </div>
  )
}
