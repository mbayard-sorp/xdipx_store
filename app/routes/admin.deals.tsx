import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, useSearchParams, redirect } from 'react-router'
import { Fragment, useMemo, useRef, useState, type DragEvent } from 'react'
import { useCountdown } from '~/hooks/useCountdown'
import { db } from '~/lib/db.server'
import { dealHistory, pipelineSettings } from '../../db/schema'
import { eq, like, asc, min, max, count, sql, inArray, and, isNull } from 'drizzle-orm'
import {
  getAdminProductData,
  getDealByShopifyId, updateProductMetafield,
  getVariantCost, pushProductToShopify, getAccessoryProductsAdmin,
  getProductAdminImages, updateProductTags, fetchAllDealProducts,
  updateVariantPricing,
} from '~/lib/shopify.server'
import type { AdminProductImage } from '~/lib/shopify.server'
import { generateCopy, generateSEOTitle } from '~/lib/claude.server'
import { getPinnedAccessoryIds, setPinnedAccessoryIds } from '~/lib/kv.server'
import { ImageManager } from '~/components/admin/ImageManager'
import { PricingPanel } from '~/components/admin/PricingPanel'
import type { Product } from '~/types'
import { dealOrderToCSV, type DealOrderRow } from '~/lib/deal-order-csv'
import { dealOrderFromCSV } from '~/lib/deal-order-csv.server'

export const meta: MetaFunction = () => [{ title: 'Deals — xdipx Admin' }]

// ─── Loader ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 30

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const editId = url.searchParams.get('edit')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const activeStatuses = ['pending', 'live']

  // Fetch live deal separately for the card
  const [liveDealRow] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1)

  // Filtered + paginated query — exclude 'live' from table (shown in card instead)
  const tableStatuses = activeStatuses.filter(s => s !== 'live')
  const conditions = tableStatuses.length > 0
    ? [inArray(dealHistory.status, tableStatuses)]
    : [sql`1 = 0`]
  conditions.push(isNull(dealHistory.completedAt))
  const baseWhere = and(...conditions)
  const [totalResult] = await db
    .select({ cnt: count() })
    .from(dealHistory)
    .where(baseWhere)
  const totalFiltered = totalResult?.cnt ?? 0
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  const deals = await db
    .select()
    .from(dealHistory)
    .where(baseWhere)
    .orderBy(asc(dealHistory.sortOrder))
    .limit(PAGE_SIZE)
    .offset((safePage - 1) * PAGE_SIZE)

  const numericIds = deals
    .map(d => d.shopifyProductId)
    .filter((id): id is string => Boolean(id))
  if (liveDealRow?.shopifyProductId && !numericIds.includes(liveDealRow.shopifyProductId)) {
    numericIds.push(liveDealRow.shopifyProductId)
  }
  const shopifyDataMap = numericIds.length > 0
    ? await getAdminProductData(numericIds)
    : {}

  // Slide-over editor data (only loaded when editing)
  let editorData: {
    deal: Awaited<ReturnType<typeof getDealByShopifyId>>
    shopifyCost: number | null
    dealCategories: string[]
    pinnedAccessories: Product[]
    pinnedAccessoryIds: string[]
    productImages: AdminProductImage[]
    promptSettings: Record<string, string>
    dbDealId: number
    pricingConfig: {
      dealPrice: number
      msrp: number
      wholesaleCost: number
      mapPrice: number
      pctOffMsrp: number
      vaultPriceOverride: number | null
    }
  } | null = null

  if (editId) {
    const id = parseInt(editId)
    const [dbDeal] = await db.select().from(dealHistory).where(eq(dealHistory.id, id)).limit(1)

    if (dbDeal?.shopifyProductId) {
      try {
        const deal = await getDealByShopifyId(dbDeal.shopifyProductId)
        const shopifyCost = deal?.variantId ? await getVariantCost(deal.variantId) : null

        const promptRows = await db.select().from(pipelineSettings).where(like(pipelineSettings.key, 'video:%'))
        const promptSettings: Record<string, string> = {}
        for (const row of promptRows) promptSettings[row.key] = row.value

        const [productImages, pinnedAccessoryIds] = await Promise.all([
          deal ? getProductAdminImages(dbDeal.shopifyProductId) : Promise.resolve([] as AdminProductImage[]),
          getPinnedAccessoryIds(),
        ])
        const pinnedAccessories = pinnedAccessoryIds.length
          ? await getAccessoryProductsAdmin(pinnedAccessoryIds)
          : []

        editorData = {
          deal,
          shopifyCost,
          dealCategories: dbDeal.categories ?? [],
          pinnedAccessories,
          pinnedAccessoryIds,
          productImages,
          promptSettings,
          dbDealId: dbDeal.id,
          pricingConfig: {
            dealPrice:          parseFloat(dbDeal.dealPrice ?? '0') || 0,
            msrp:               parseFloat(dbDeal.msrp ?? '0') || 0,
            wholesaleCost:      parseFloat(dbDeal.wholesaleCost ?? '0') || 0,
            mapPrice:           parseFloat(dbDeal.mapPrice ?? '0') || 0,
            pctOffMsrp:         parseFloat(dbDeal.pctOffMsrp ?? '0') || 0,
            vaultPriceOverride: dbDeal.vaultPrice ? parseFloat(dbDeal.vaultPrice) : null,
          },
        }
      } catch (err) {
        console.error('[admin/deals] failed to load editor data for product', dbDeal.shopifyProductId, err)
        // editorData stays null — editor panel shows "No deal data found"
      }
    }
  }

  // Full export list — all pending/live deals (and the live row), unpaginated,
  // minimal fields only. Used by the "Export CSV" button.
  const allDealsForExport = await db
    .select({
      id: dealHistory.id,
      sku: dealHistory.sku,
      seoTitle: dealHistory.seoTitle,
      dealDate: dealHistory.dealDate,
      status: dealHistory.status,
      sortOrder: dealHistory.sortOrder,
    })
    .from(dealHistory)
    .where(and(inArray(dealHistory.status, activeStatuses), isNull(dealHistory.completedAt)))
    .orderBy(asc(dealHistory.sortOrder))

  return {
    deals, shopifyDataMap, editorData, editId, liveDealRow: liveDealRow ?? null,
    page: safePage, totalPages, totalFiltered, allDealsForExport,
  }
}

// ─── Action ──────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')

  if (intent === 'reorder') {
    const orderedIds = JSON.parse(form.get('orderedIds') as string) as number[]
    await Promise.all(
      orderedIds.map((id, index) =>
        db.update(dealHistory)
          .set({ sortOrder: index + 1 })
          .where(eq(dealHistory.id, id))
      )
    )
    return { ok: true }
  }

  if (intent === 'move-to-top') {
    const id = parseInt(form.get('id') as string)
    const result = await db.select({ minSort: min(dealHistory.sortOrder) }).from(dealHistory)
    const minSort = result[0]?.minSort ?? 0
    await db.update(dealHistory).set({ sortOrder: minSort - 1 }).where(eq(dealHistory.id, id))
    return { ok: true }
  }

  if (intent === 'move-to-bottom') {
    const id = parseInt(form.get('id') as string)
    const result = await db.select({ maxSort: max(dealHistory.sortOrder) }).from(dealHistory)
    const maxSort = result[0]?.maxSort ?? 0
    await db.update(dealHistory).set({ sortOrder: maxSort + 1 }).where(eq(dealHistory.id, id))
    return { ok: true }
  }

  if (intent === 'import-deal-order') {
    const csv = form.get('csv') as string
    if (!csv) return { importErrors: ['Missing CSV data'], importCount: 0 }

    const { orders, errors } = dealOrderFromCSV(csv)
    if (errors.length > 0) {
      return { importErrors: errors, importCount: 0 }
    }

    const ids = orders.map(o => o.id)
    const existing = await db
      .select({ id: dealHistory.id, status: dealHistory.status })
      .from(dealHistory)
      .where(inArray(dealHistory.id, ids))
    const eligibleIds = new Set(
      existing.filter(r => r.status === 'pending' || r.status === 'live').map(r => r.id)
    )

    const missing = ids.filter(id => !eligibleIds.has(id))
    if (missing.length > 0) {
      return {
        importErrors: [
          `Unknown or non-editable deal_id(s): ${missing.join(', ')} (only pending/live deals can be reordered)`,
        ],
        importCount: 0,
      }
    }

    await Promise.all(
      orders.map((o, index) =>
        db.update(dealHistory)
          .set({ sortOrder: index + 1 })
          .where(eq(dealHistory.id, o.id))
      )
    )
    return { importCount: orders.length }
  }

  if (intent === 'sort-by-date') {
    const result = await db.execute(sql`
      UPDATE deal_history SET sort_order = sub.rn
      FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY deal_date ASC, id ASC) AS rn FROM deal_history) sub
      WHERE deal_history.id = sub.id
    `)
    return { ok: true, sorted: true, rowCount: result.rowCount }
  }

  if (intent === 'delete') {
    const id = parseInt(form.get('id') as string)
    await db.delete(dealHistory).where(eq(dealHistory.id, id))
    return { ok: true }
  }

  if (intent === 'force-live') {
    const id = parseInt(form.get('id') as string)

    // Vault whatever is currently live
    const [liveNow] = await db.select().from(dealHistory).where(eq(dealHistory.status, 'live')).limit(1)
    if (liveNow && liveNow.id !== id && liveNow.shopifyProductId) {
      const { transitionToVaultPricing } = await import('~/lib/deal-rotator.server')
      await transitionToVaultPricing(liveNow)
    }

    // Route through activateDeal so configured dealPrice is pushed to variant.
    const [target] = await db.select().from(dealHistory).where(eq(dealHistory.id, id)).limit(1)
    if (target) {
      const { activateDeal } = await import('~/lib/deal-rotator.server')
      await activateDeal(target)
    }
    return { ok: true }
  }

  if (intent === 'force-rotate') {
    const { rotateDeal } = await import('~/lib/deal-rotator.server')
    const result = await rotateDeal()
    return { ok: true, rotated: result }
  }

  if (intent === 'backfill-from-shopify') {
    const { products: shopifyProducts, totalScanned } = await fetchAllDealProducts()

    // Get existing shopifyProductIds to skip duplicates
    const existingRows = await db.select({ pid: dealHistory.shopifyProductId }).from(dealHistory)
    const existingIds = new Set(existingRows.map(r => r.pid).filter(Boolean))

    const newProducts = shopifyProducts.filter(p => !existingIds.has(p.shopifyProductId))
    if (newProducts.length === 0) {
      return { ok: true, imported: 0, found: shopifyProducts.length, alreadyInDb: existingIds.size, totalScanned }
    }

    // Get current max sortOrder
    const maxResult = await db.select({ maxSort: max(dealHistory.sortOrder) }).from(dealHistory)
    const startOrder = (maxResult[0]?.maxSort ?? 0) + 1

    // Sort by dealDate ascending so earlier deals get lower sortOrder
    newProducts.sort((a, b) => (a.dealDate ?? '2099-12-31').localeCompare(b.dealDate ?? '2099-12-31'))

    const rows = newProducts.map((p, i) => ({
      sku:              p.nalpacSku ?? p.sku,
      seoTitle:         p.title,
      brand:            p.vendor,
      categories:       p.category ? [p.category] : [],
      dealDate:         p.dealDate ?? '2099-12-31',
      wholesaleCost:    p.wholesaleCost?.toFixed(2) ?? null,
      dealPrice:        p.dealPrice?.toFixed(2) ?? null,
      msrp:             p.msrp?.toFixed(2) ?? null,
      mapPrice:         p.mapPrice?.toFixed(2) ?? null,
      unitsAvailable:   p.inventoryQuantity,
      dealScore:        p.dealScore?.toFixed(3) ?? null,
      status:           'queued' as const,
      sortOrder:        startOrder + i,
      shopifyProductId: p.shopifyProductId,
    }))

    await db.insert(dealHistory).values(rows)
    return { ok: true, imported: rows.length }
  }

  // ─── Editor actions (from slide-over) ───────────────────────────────────

  if (intent === 'save-setting') {
    const key   = form.get('key')   as string
    const value = form.get('value') as string
    if (!key || value === null) return { ok: false, error: 'Missing key or value' }
    await db
      .insert(pipelineSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: pipelineSettings.key, set: { value, updatedAt: new Date() } })
    return { ok: true }
  }

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
    const raw       = (form.get('value') as string | null) ?? ''
    const bullets   = raw.split('\n').map(l => l.trim()).filter(Boolean)
    await updateProductMetafield(productId, 'feature_bullets', JSON.stringify(bullets), 'json')
    return { ok: true }
  }

  if (intent === 'save-box-contents') {
    const productId = form.get('productId') as string
    const raw       = (form.get('value') as string | null) ?? ''
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

    await db.update(dealHistory).set({
      dealPrice:     (parseFloat(dealPrice     || '0') || 0).toFixed(2),
      msrp:          (parseFloat(msrp          || '0') || 0).toFixed(2),
      wholesaleCost: (parseFloat(wholesaleCost || '0') || 0).toFixed(2),
      mapPrice:      (parseFloat(mapPrice      || '0') || 0).toFixed(2),
      pctOffMsrp:    clampedPct.toFixed(2),
      vaultPrice:    vaultVal,
    }).where(eq(dealHistory.shopifyProductId, productId))

    return { ok: true }
  }

  if (intent === 'save-variant-pricing') {
    const variantGid     = form.get('variantGid') as string
    const price          = form.get('price') as string
    const compareAtPrice = ((form.get('compareAtPrice') as string | null) ?? '').trim()
    await updateVariantPricing(variantGid, price, compareAtPrice)
    return { ok: true }
  }

  if (intent === 'sync-all-variants-pricing') {
    const variantGidsJson = form.get('variantGids') as string
    const price           = form.get('price') as string
    const compareAtPrice  = ((form.get('compareAtPrice') as string | null) ?? '').trim()
    const variantGids     = JSON.parse(variantGidsJson) as string[]
    await Promise.all(
      variantGids.map(gid => updateVariantPricing(gid, price, compareAtPrice)),
    )
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
      const categories = ((form.get('categories') as string | null) ?? '').split(',').filter(Boolean)
      const dealPrice  = parseFloat((form.get('dealPrice') as string) || '0')
      const msrp       = parseFloat((form.get('msrp') as string) || '0')
      const editId     = form.get('editId') as string | null

      if (!rawDesc?.trim()) return { ok: false, error: 'No original description — paste the raw product description and Save it first.' }

      const seoTitle = await generateSEOTitle(title, brand)
      const productContext = { title: seoTitle, brand, description: rawDesc, categories, dealPrice, msrp }

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

      const tagline     = Array.isArray(taglineResult.content) ? (taglineResult.content[0] ?? '') : taglineResult.content as string
      const fullStory   = storyResult.content as string
      const bothWays    = bothWaysResult.content as { forHim: string; forHer: string }
      const bullets     = bulletsResult.content as string[]
      const seoMeta     = seoMetaResult.content as string
      const specs       = specsResult.content as string
      const boxContents = boxContentsResult.content as string[]

      const numericId = productId.replace('gid://shopify/Product/', '')
      await pushProductToShopify({
        shopifyProductId: numericId,
        tagline, fullStory, description: fullStory,
        worksForHim: bothWays.forHim, worksForHer: bothWays.forHer,
        featureBullets: bullets, seoMetaDescription: seoMeta,
        specifications: specs, boxContents,
      })

      return redirect(editId ? `/admin/deals?edit=${editId}` : '/admin/deals')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[generate-all] failed:', message)
      return { ok: false, error: message }
    }
  }

  if (intent === 'save-pinned-accessories') {
    const ids = JSON.parse(form.get('ids') as string) as string[]
    await setPinnedAccessoryIds(ids)
    const editId = form.get('editId') as string | null
    return redirect(editId ? `/admin/deals?edit=${editId}` : '/admin/deals')
  }

  if (intent === 'save-tags') {
    const productId = form.get('productId') as string
    const tags = JSON.parse(form.get('tags') as string) as string[]
    await updateProductTags(productId, tags)
    const editId = form.get('editId') as string | null
    return redirect(editId ? `/admin/deals?edit=${editId}` : '/admin/deals')
  }

  return null
}

// ─── SaveableField ─────────────────────────────────────────────────────────

function SaveableField({
  label, fieldKey, fieldType, defaultValue, productId, rows = 3, intent = 'save-field',
  hint,
}: {
  label: string; fieldKey?: string; fieldType?: string; defaultValue: string
  productId: string; rows?: number; intent?: string; hint?: string
}) {
  const fetcher = useFetcher<{ ok: boolean }>()
  const saved = fetcher.state === 'idle' && fetcher.data?.ok === true

  const buttonLabel = fetcher.state === 'submitting' ? 'Saving...' : saved ? 'Saved!' : 'Save'
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

// ─── RawDescriptionPanel ─────────────────────────────────────────────────

function RawDescriptionPanel({ deal, categories, editId }: {
  deal: NonNullable<Awaited<ReturnType<typeof getDealByShopifyId>>>
  categories: string[]
  editId: string
}) {
  const saveFetcher     = useFetcher<{ ok: boolean }>()
  const generateFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const textareaRef     = useRef<HTMLTextAreaElement>(null)
  const hasSaved        = saveFetcher.state === 'idle' && saveFetcher.data?.ok === true
  const genError        = generateFetcher.data && 'error' in generateFetcher.data ? (generateFetcher.data as { error: string }).error : null

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        Raw Description
      </h3>
      <saveFetcher.Form method="post" className="flex flex-col gap-2">
        <input type="hidden" name="intent"    value="save-raw-description" />
        <input type="hidden" name="productId" value={deal.shopifyProductId} />
        <textarea
          ref={textareaRef}
          name="value"
          defaultValue={deal.rawDescription ?? ''}
          rows={8}
          className="w-full border border-cream-2 rounded-xl px-4 py-3 text-sm text-ink resize-y focus:outline-none focus:ring-2 focus:ring-coral/30 font-mono"
        />
        <button
          type="submit"
          className="self-end text-xs font-bold px-3 py-1.5 rounded-full bg-cream-2 text-sage hover:bg-sage/10 transition-colors"
        >
          {saveFetcher.state === 'submitting' ? 'Saving...' : hasSaved ? 'Saved!' : 'Save Description'}
        </button>
      </saveFetcher.Form>

      <generateFetcher.Form method="post" className="pt-2 border-t border-cream-2">
        <input type="hidden" name="intent"         value="generate-all" />
        <input type="hidden" name="productId"       value={deal.shopifyProductId} />
        <input type="hidden" name="rawDescription"  value={deal.rawDescription ?? ''} />
        <input type="hidden" name="title"           value={deal.seoTitle} />
        <input type="hidden" name="brand"           value={deal.brand} />
        <input type="hidden" name="categories"      value={categories.join(',')} />
        <input type="hidden" name="dealPrice"       value={deal.dealPrice} />
        <input type="hidden" name="msrp"            value={deal.msrp} />
        <input type="hidden" name="editId"          value={editId} />
        <button
          type="submit"
          disabled={generateFetcher.state !== 'idle' || !deal.rawDescription}
          className={
            generateFetcher.state !== 'idle' || !deal.rawDescription
              ? 'w-full py-2.5 rounded-xl text-sm font-bold bg-ink/10 text-ink/40 cursor-not-allowed'
              : 'w-full py-2.5 rounded-xl text-sm font-bold bg-coral text-white hover:opacity-90 transition-opacity'
          }
        >
          {generateFetcher.state !== 'idle' ? 'Generating... (~30s)' : 'Generate All Fields'}
        </button>
        {!deal.rawDescription && (
          <p className="text-xs text-ink/40 mt-2 text-center">Save a raw description first</p>
        )}
      </generateFetcher.Form>

      {genError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {genError}
        </div>
      )}
    </div>
  )
}

// ─── Readiness Checklist ─────────────────────────────────────────────────

function ReadinessChecklist({ deal }: {
  deal: NonNullable<Awaited<ReturnType<typeof getDealByShopifyId>>>
}) {
  const checks = [
    { label: 'Has images',    ok: deal.images.length > 0 },
    { label: 'Has copy',      ok: Boolean(deal.fullStory) },
    { label: 'Has tagline',   ok: Boolean(deal.tagline) },
    { label: 'Has pricing',   ok: deal.dealPrice > 0 },
  ]
  const missing = checks.filter(c => !c.ok)

  if (missing.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Ready to go
      </span>
    )
  }

  return (
    <div className="rounded-2xl p-4 shadow-sm bg-yellow-50 border border-yellow-200">
      <h3 className="font-semibold text-sm text-yellow-700 mb-2" style={{ fontFamily: 'var(--font-display)' }}>Missing</h3>
      <div className="space-y-1">
        {missing.map(c => (
          <div key={c.label} className="flex items-center gap-2 text-xs text-yellow-700">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            {c.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tags Editor ────────────────────────────────────────────────────────

function TagsEditor({ deal, editId }: {
  deal: NonNullable<Awaited<ReturnType<typeof getDealByShopifyId>>>
  editId: string
}) {
  const fetcher = useFetcher<{ ok: boolean }>()
  const [tags, setTags] = useState<string[]>(deal.tags)
  const [input, setInput] = useState('')
  const saved = fetcher.state === 'idle' && fetcher.data?.ok === true

  const addTag = () => {
    const tag = input.trim()
    if (tag && !tags.includes(tag)) setTags(t => [...t, tag])
    setInput('')
  }

  const removeTag = (tag: string) => setTags(t => t.filter(x => x !== tag))

  const handleSave = () => {
    const fd = new FormData()
    fd.set('intent', 'save-tags')
    fd.set('productId', deal.shopifyProductId)
    fd.set('tags', JSON.stringify(tags))
    fd.set('editId', editId)
    fetcher.submit(fd, { method: 'post' })
  }

  const tagColor = (tag: string) =>
    tag.startsWith('brand:') ? 'bg-purple-100 text-purple-700'
    : tag.startsWith('deal-status-') ? 'bg-blue-100 text-blue-700'
    : tag.startsWith('nalpac-sku-') ? 'bg-gray-100 text-gray-600'
    : 'bg-cream-2 text-ink/70'

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Tags
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
          <span key={tag} className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${tagColor(tag)}`}>
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-current opacity-40 hover:opacity-100 hover:text-red-500 transition-colors leading-none ml-0.5"
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

// ─── Live Deal Card ─────────────────────────────────────────────────────

function LiveDealCard({ liveDealRow, shopifyData, onDrop, onClick, onBumpToBottom }: {
  liveDealRow: { id: number; seoTitle: string | null; sku: string; brand: string | null; shopifyProductId: string | null; unitsAvailable: number | null; dealPrice: string | null; msrp: string | null; wholesaleCost: string | null } | null
  shopifyData: { price?: number | null; images?: string[] } | null
  onDrop: (dealId: number) => void
  onClick: () => void
  onBumpToBottom: (dealId: number) => void
}) {
  const { timeLeft, mounted, isUrgent } = useCountdown()
  const [dragOver, setDragOver] = useState(false)
  const [bumpDragOver, setBumpDragOver] = useState(false)
  const pad = (n: number) => String(n).padStart(2, '0')

  const dropHandlers = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) },
    onDragEnter: () => setDragOver(true),
    onDragLeave: () => setDragOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const id = parseInt(e.dataTransfer.getData('text/plain'))
      if (!isNaN(id)) onDrop(id)
    },
  }

  const bumpDropHandlers = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setBumpDragOver(true) },
    onDragEnter: (e: DragEvent) => { e.stopPropagation(); setBumpDragOver(true) },
    onDragLeave: () => setBumpDragOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setBumpDragOver(false)
      const id = parseInt(e.dataTransfer.getData('text/plain'))
      if (!isNaN(id)) onBumpToBottom(id)
    },
  }

  if (!liveDealRow) {
    return (
      <div
        className={`mb-5 border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
          dragOver ? 'border-sage ring-2 ring-sage bg-sage/5' : 'border-ink/20'
        }`}
        {...dropHandlers}
      >
        <p className="text-sm font-medium text-ink/40">No deal is currently live</p>
        <p className="text-xs text-ink/30 mt-1">Drag a deal here to go live</p>
      </div>
    )
  }

  const dealPrice = shopifyData?.price ?? (liveDealRow.dealPrice ? parseFloat(liveDealRow.dealPrice) : null)
  const msrp = liveDealRow.msrp ? parseFloat(liveDealRow.msrp) : null
  const wholesale = liveDealRow.wholesaleCost ? parseFloat(liveDealRow.wholesaleCost) : null
  const margin = dealPrice && wholesale ? (dealPrice - wholesale) / dealPrice : null
  const thumbUrl = shopifyData?.images?.[0] ?? null

  return (
    <div className="mb-5 flex gap-3">
      {/* Live deal info — clickable to open editor */}
      <div
        className={`flex-1 bg-white rounded-2xl shadow-sm p-5 transition-all cursor-pointer hover:shadow-md ${dragOver ? 'ring-2 ring-sage' : ''}`}
        onClick={onClick}
        {...dropHandlers}
      >
        <p className="text-[10px] font-bold uppercase tracking-wide text-coral mb-3">Live Now</p>
        <div className="flex items-center gap-4">
          {thumbUrl ? (
            <img src={thumbUrl} alt="" className="w-20 h-20 object-cover rounded-xl shrink-0" />
          ) : (
            <div className="w-20 h-20 rounded-xl bg-cream-2 flex items-center justify-center shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink/20">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-ink truncate">{liveDealRow.seoTitle ?? liveDealRow.sku}</p>
            <p className="text-xs text-ink/50 truncate">{liveDealRow.brand} · {liveDealRow.sku}</p>
            <div className="flex items-center gap-3 mt-1.5 text-xs">
              {dealPrice != null && <span className="font-bold text-coral tabular-nums">${dealPrice.toFixed(2)}</span>}
              {msrp != null && <span className="line-through text-ink/40 tabular-nums">${msrp.toFixed(2)}</span>}
              {margin !== null && (
                <span className={`font-semibold tabular-nums ${margin >= 0.4 ? 'text-green-600' : margin >= 0.25 ? 'text-yellow-600' : 'text-red-500'}`}>
                  {Math.round(margin * 100)}%
                </span>
              )}
              <span className="text-ink/60 tabular-nums">{liveDealRow.unitsAvailable ?? 0} units</span>
            </div>
          </div>
          {mounted && (
            <div className={`text-right shrink-0 ${isUrgent ? 'text-coral' : 'text-ink'}`}>
              <p className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)' }}>
                {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
              </p>
              <p className="text-[10px] text-ink/40 uppercase tracking-wide">remaining</p>
            </div>
          )}
        </div>
      </div>

      {/* Bump to bottom dropzone */}
      <div
        className={`shrink-0 w-24 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1 text-center transition-all ${
          bumpDragOver ? 'border-sage ring-2 ring-sage bg-sage/5' : 'border-ink/15'
        }`}
        {...bumpDropHandlers}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${bumpDragOver ? 'text-sage' : 'text-ink/30'}`}>
          <polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" />
        </svg>
        <span className={`text-[10px] font-semibold leading-tight ${bumpDragOver ? 'text-sage' : 'text-ink/30'}`}>
          Bump to bottom
        </span>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────

export default function AdminDealsPage() {
  const {
    deals, shopifyDataMap, editorData, editId, liveDealRow,
    page, totalPages, totalFiltered, allDealsForExport,
  } = useLoaderData<typeof loader>()
  const reorderFetcher  = useFetcher()
  const moveFetcher     = useFetcher()
  const importFetcher   = useFetcher<{ importCount?: number; importErrors?: string[] }>()
  const fileInputRef    = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<{ csv: string; rowCount: number } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingConfirm, setPendingConfirm] = useState<{
    intent: string; id?: number; shopifyProductId?: string; label: string; message: string
  } | null>(null)
  const confirmFetcher  = useFetcher()
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [contentOpen, setContentOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [moveToTopDragOver, setMoveToTopDragOver] = useState(false)
  const dragRef = useRef(false)

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams)
    if (p <= 1) params.delete('page')
    else params.set('page', String(p))
    setSearchParams(params, { replace: true })
  }

  const filteredDeals = useMemo(() => {
    if (!search.trim()) return deals
    const q = search.toLowerCase()
    return deals.filter(d =>
      d.seoTitle?.toLowerCase().includes(q) ||
      d.sku.toLowerCase().includes(q) ||
      d.brand?.toLowerCase().includes(q)
    )
  }, [deals, search])

  const backfillData = confirmFetcher.data && 'imported' in confirmFetcher.data
    ? confirmFetcher.data as { imported: number; found?: number; alreadyInDb?: number; totalScanned?: number }
    : null
  const sortResult = confirmFetcher.data && 'sorted' in confirmFetcher.data
    ? confirmFetcher.data as { sorted: boolean; rowCount?: number }
    : null

  function handleLiveCardDrop(dealId: number) {
    const deal = deals.find(d => d.id === dealId)
    if (!deal?.shopifyProductId) return
    setPendingConfirm({
      intent: 'force-live',
      id: deal.id,
      shopifyProductId: deal.shopifyProductId,
      label: 'Force Live',
      message: `Force "${deal.seoTitle ?? deal.sku}" live now? The current live deal moves to vault pricing.`,
    })
  }

  function handleBumpToBottom(dealId: number) {
    moveFetcher.submit(
      { intent: 'move-to-bottom', id: String(dealId) },
      { method: 'post' },
    )
  }

  function handleMoveToTop(dealId: number) {
    moveFetcher.submit(
      { intent: 'move-to-top', id: String(dealId) },
      { method: 'post' },
    )
  }

  function handleExportOrder() {
    const rows: DealOrderRow[] = allDealsForExport.map(d => ({
      dealId: d.id,
      sku: d.sku,
      seoTitle: d.seoTitle ?? '',
      dealDate: d.dealDate ?? '',
      status: d.status,
      sortOrder: d.sortOrder ?? 0,
    }))
    const csv = dealOrderToCSV(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deal-order-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleImportFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const csv = String(reader.result ?? '')
      const rowCount = Math.max(0, (csv.match(/\n/g)?.length ?? 1) - 1)
      setPendingImport({ csv, rowCount })
    }
    reader.readAsText(file)
  }

  function confirmImportOrder() {
    if (!pendingImport) return
    const formData = new FormData()
    formData.set('intent', 'import-deal-order')
    formData.set('csv', pendingImport.csv)
    importFetcher.submit(formData, { method: 'post' })
    setPendingImport(null)
  }

  const importResult = importFetcher.data

  function openEditor(dealId: number) {
    const params = new URLSearchParams(searchParams)
    params.set('edit', String(dealId))
    setSearchParams(params, { replace: true })
  }

  function closeEditor() {
    const params = new URLSearchParams(searchParams)
    params.delete('edit')
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="relative">
      {/* Sort result banner */}
      {sortResult && (
        <div className="mb-4 rounded-2xl px-5 py-3 text-sm bg-green-50 border border-green-200 text-green-700">
          Sorted <strong>{sortResult.rowCount ?? '?'}</strong> deals by deal_date ascending. Reload to see the new order.
        </div>
      )}

      {/* Backfill result banner */}
      {backfillData && (
        <div className={`mb-4 rounded-2xl px-5 py-3 text-sm ${backfillData.imported > 0 ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-yellow-50 border border-yellow-200 text-yellow-700'}`}>
          {backfillData.imported > 0
            ? <>Imported <strong>{backfillData.imported}</strong> deal{backfillData.imported !== 1 ? 's' : ''} into the queue.</>
            : <>No new deals to import. Scanned <strong>{backfillData.totalScanned ?? '?'}</strong> Shopify products, found <strong>{backfillData.found ?? 0}</strong> with deal_date metafield, <strong>{backfillData.alreadyInDb ?? 0}</strong> already in DB.</>}
        </div>
      )}

      {/* Import result banner */}
      {importResult && (
        importResult.importErrors && importResult.importErrors.length > 0 ? (
          <div className="mb-4 rounded-2xl px-5 py-3 text-sm bg-red-50 border border-red-200 text-red-700">
            <p className="font-semibold mb-1">CSV import failed</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {importResult.importErrors.slice(0, 10).map((err, i) => <li key={i}>{err}</li>)}
              {importResult.importErrors.length > 10 && (
                <li>…and {importResult.importErrors.length - 10} more</li>
              )}
            </ul>
          </div>
        ) : importResult.importCount ? (
          <div className="mb-4 rounded-2xl px-5 py-3 text-sm bg-green-50 border border-green-200 text-green-700">
            Imported order for <strong>{importResult.importCount}</strong> deal{importResult.importCount !== 1 ? 's' : ''}. Reload to see the new order.
          </div>
        ) : null
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Deals
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportOrder}
            className="px-4 py-2 text-sm font-semibold text-ink bg-white border border-cream-2 rounded-full hover:border-sage/40 hover:text-sage transition-colors"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm font-semibold text-ink bg-white border border-cream-2 rounded-full hover:border-sage/40 hover:text-sage transition-colors"
          >
            Import CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleImportFilePick}
            className="hidden"
          />
        </div>
      </div>

      {pendingImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              Replace deal order?
            </h2>
            <p className="text-sm text-ink/70">
              Importing will replace the sort order of all pending/live deals with the CSV contents
              (~{pendingImport.rowCount} row{pendingImport.rowCount !== 1 ? 's' : ''}).
              The server will validate deal IDs and report errors before applying.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                className="px-4 py-2 text-sm font-semibold text-ink/70 hover:text-ink transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmImportOrder}
                className="px-4 py-2 bg-coral text-white text-sm font-bold rounded-full hover:opacity-90 transition-opacity"
              >
                Replace &amp; save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Deal Card */}
      <LiveDealCard
        liveDealRow={liveDealRow}
        shopifyData={liveDealRow?.shopifyProductId ? shopifyDataMap[liveDealRow.shopifyProductId] ?? null : null}
        onDrop={handleLiveCardDrop}
        onClick={() => { if (liveDealRow) openEditor(liveDealRow.id) }}
        onBumpToBottom={handleBumpToBottom}
      />

      {/* Search bar + Move to top dropzone */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, SKU, or brand..."
            className="w-full pl-9 pr-8 py-2 text-sm border border-cream-2 rounded-xl bg-white text-ink focus:outline-none focus:ring-2 focus:ring-coral/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/30 hover:text-ink/60"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div
          className={`shrink-0 px-4 py-2 rounded-xl border-2 border-dashed flex items-center gap-1.5 text-xs font-semibold transition-all ${
            moveToTopDragOver ? 'border-sage ring-2 ring-sage bg-sage/5 text-sage' : 'border-ink/15 text-ink/30'
          }`}
          onDragOver={(e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setMoveToTopDragOver(true) }}
          onDragEnter={() => setMoveToTopDragOver(true)}
          onDragLeave={() => setMoveToTopDragOver(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault()
            setMoveToTopDragOver(false)
            const id = parseInt(e.dataTransfer.getData('text/plain'))
            if (!isNaN(id)) handleMoveToTop(id)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 11 12 6 7 11" /><polyline points="17 18 12 13 7 18" />
          </svg>
          Move to top
        </div>
      </div>

      {/* Pipeline Table */}
      <div className="rounded-2xl overflow-visible shadow-sm">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: '0 3px' }}>
          <colgroup>
            <col style={{ width: '220px' }} />
            <col />
            <col style={{ width: '90px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '70px' }} />
            <col style={{ width: '85px' }} />
            <col style={{ width: '85px' }} />
            <col style={{ width: '80px' }} />
          </colgroup>
          <thead>
            <tr className="bg-cream-2 text-ink/60 text-xs uppercase tracking-wide">
              <th className="px-3 py-3 text-left rounded-l-xl">Product</th>
              <th className="px-3 py-3 text-left">Images</th>
              <th className="px-3 py-3 text-right">Deal Price</th>
              <th className="px-3 py-3 text-right">Wholesale</th>
              <th className="px-3 py-3 text-right">Margin</th>
              <th className="px-3 py-3 text-right">MSRP</th>
              <th className="px-3 py-3 text-right">MAP</th>
              <th className="px-3 py-3 text-right rounded-r-xl">Inventory</th>
            </tr>
          </thead>
          <tbody>
            {filteredDeals.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink/40 text-sm">
                  {search ? 'No deals match your search.' : 'No deals in the queue.'}
                </td>
              </tr>
            )}
            {filteredDeals.map(deal => {
              const shopifyData = deal.shopifyProductId ? shopifyDataMap[deal.shopifyProductId] : null
              const msrp      = deal.msrp          ? parseFloat(deal.msrp)          : null
              const wholesale = deal.wholesaleCost  ? parseFloat(deal.wholesaleCost) : null
              const mapPrice  = deal.mapPrice       ? parseFloat(deal.mapPrice)      : null
              const dealPrice = shopifyData?.price ?? (deal.dealPrice ? parseFloat(deal.dealPrice) : null)
              const margin    = dealPrice && wholesale ? (dealPrice - wholesale) / dealPrice : null
              const isCompleted = Boolean(deal.completedAt)
              const isDraggable = deal.status === 'pending' && !isCompleted
              const isBeingDragged = draggedId === deal.id
              const isDragTarget = dragOverId === deal.id && draggedId !== deal.id

              return (
                <Fragment key={deal.id}>
                  {/* Drag indicator spacer */}
                  {isDragTarget && (
                    <tr>
                      <td colSpan={8} className="p-0">
                        <div className="h-1 bg-sage rounded-full mx-2 animate-expand-in" />
                      </td>
                    </tr>
                  )}
                  <tr
                    draggable={isDraggable}
                    onDragStart={isDraggable ? (e) => {
                      setDraggedId(deal.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(deal.id))
                      setTimeout(() => { dragRef.current = true }, 0)
                    } : undefined}
                    onDragEnd={() => { setDraggedId(null); setDragOverId(null); setTimeout(() => { dragRef.current = false }, 0) }}
                    className={[
                      'transition-colors select-none',
                      isDraggable ? (isBeingDragged ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer',
                      editId === String(deal.id) ? '' : '',
                      isCompleted ? 'opacity-60' : '',
                      isBeingDragged ? 'opacity-50' : '',
                    ].join(' ')}
                    onClick={e => {
                      if ((e.target as HTMLElement).closest('button, input, a, select')) return
                      if (dragRef.current) { dragRef.current = false; return }
                      openEditor(deal.id)
                    }}
                    onDragOver={isDraggable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
                    onDragEnter={isDraggable ? () => setDragOverId(deal.id) : undefined}
                    onDrop={isDraggable ? (e) => {
                      e.preventDefault()
                      setDragOverId(null)
                      if (draggedId === null || draggedId === deal.id) return
                      const queuedDeals = filteredDeals.filter(d => d.status === 'pending' && !d.completedAt)
                      const ids = queuedDeals.map(d => d.id)
                      const fromIdx = ids.indexOf(draggedId)
                      const toIdx = ids.indexOf(deal.id)
                      if (fromIdx === -1 || toIdx === -1) return
                      ids.splice(fromIdx, 1)
                      ids.splice(toIdx, 0, draggedId)
                      reorderFetcher.submit(
                        { intent: 'reorder', orderedIds: JSON.stringify(ids) },
                        { method: 'post' },
                      )
                      setDraggedId(null)
                    } : undefined}
                  >
                    {/* Product info */}
                    <td className={`px-3 py-3 min-w-0 bg-white rounded-l-xl ${editId === String(deal.id) ? 'ring-2 ring-inset ring-sage/20' : ''}`}>
                      <p className="font-medium text-ink truncate">{deal.seoTitle ?? deal.sku}</p>
                      <p className="text-xs text-ink/50 truncate">{deal.brand} · {deal.sku}</p>
                    </td>

                    {/* Images — flexes to fill remaining space; clips when tight */}
                    <td className={`px-3 py-3 bg-white overflow-hidden ${editId === String(deal.id) ? 'ring-2 ring-inset ring-sage/20' : ''}`}>
                      {shopifyData?.images?.length ? (
                        <div className="flex gap-1 items-center overflow-hidden w-full">
                          {shopifyData.images.slice(0, 3).map((url, i) => (
                            <img key={i} src={url} alt="" className="w-9 h-9 object-cover rounded-lg shrink-0 transition-transform duration-150 hover:scale-[2] hover:z-10 hover:relative hover:shadow-lg hover:rounded-xl" />
                          ))}
                          {shopifyData.images.length > 3 && (
                            <span className="text-[10px] font-semibold text-ink/50 shrink-0 pl-0.5">
                              +{shopifyData.images.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-cream-2 flex items-center justify-center shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink/20">
                            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                          </svg>
                        </div>
                      )}
                    </td>

                    {/* Deal Price */}
                    <td className={`px-3 py-3 text-right font-semibold text-ink text-xs tabular-nums bg-white ${editId === String(deal.id) ? 'ring-2 ring-inset ring-sage/20' : ''}`}>
                      {dealPrice != null ? `$${dealPrice.toFixed(2)}` : '\u2014'}
                    </td>
                    {/* Wholesale Cost */}
                    <td className={`px-3 py-3 text-right text-ink/70 text-xs tabular-nums bg-white ${editId === String(deal.id) ? 'ring-2 ring-inset ring-sage/20' : ''}`}>
                      {wholesale != null ? `$${wholesale.toFixed(2)}` : '\u2014'}
                    </td>
                    {/* Margin */}
                    <td className={`px-3 py-3 text-right font-semibold text-xs tabular-nums bg-white ${editId === String(deal.id) ? 'ring-2 ring-inset ring-sage/20' : ''}`}>
                      {margin !== null
                        ? <span className={margin >= 0.4 ? 'text-green-600' : margin >= 0.25 ? 'text-yellow-600' : 'text-red-500'}>
                            {Math.round(margin * 100)}%
                          </span>
                        : '\u2014'}
                    </td>
                    {/* MSRP */}
                    <td className={`px-3 py-3 text-right text-ink/60 text-xs tabular-nums bg-white ${editId === String(deal.id) ? 'ring-2 ring-inset ring-sage/20' : ''}`}>
                      {msrp ? `$${msrp.toFixed(2)}` : '\u2014'}
                    </td>
                    {/* MAP */}
                    <td className={`px-3 py-3 text-right text-ink/60 text-xs tabular-nums bg-white ${editId === String(deal.id) ? 'ring-2 ring-inset ring-sage/20' : ''}`}>
                      {mapPrice && mapPrice > 0 ? `$${mapPrice.toFixed(2)}` : ''}
                    </td>
                    {/* Inventory */}
                    <td className={`px-3 py-3 text-right text-ink/70 text-xs tabular-nums bg-white rounded-r-xl ${editId === String(deal.id) ? 'ring-2 ring-inset ring-sage/20' : ''}`}>
                      {deal.unitsAvailable ?? '\u2014'}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
        <div className="bg-white rounded-2xl mt-1 px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-ink/40">
            {totalFiltered > 0
              ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalFiltered)} of ${totalFiltered} deal${totalFiltered !== 1 ? 's' : ''}`
              : 'No deals'}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cream-2 transition-colors text-ink/60"
              >
                Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce<(number | 'gap')[]>((acc, p) => {
                  const last = acc[acc.length - 1]
                  if (typeof last === 'number' && p - last > 1) acc.push('gap')
                  acc.push(p)
                  return acc
                }, [])
                .map((item, i) =>
                  item === 'gap' ? (
                    <span key={`gap-${i}`} className="text-xs text-ink/30 px-1">…</span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => goToPage(item)}
                      className={`text-xs font-semibold w-7 h-7 rounded-lg transition-colors ${
                        item === page
                          ? 'bg-ink text-white'
                          : 'text-ink/60 hover:bg-cream-2'
                      }`}
                    >
                      {item}
                    </button>
                  ),
                )}
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cream-2 transition-colors text-ink/60"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      {pendingConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setPendingConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <p className="text-sm font-medium text-ink mb-1">{pendingConfirm.label}</p>
            <p className="text-sm text-ink/60 mb-5">{pendingConfirm.message}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setPendingConfirm(null)} className="px-4 py-2 text-sm font-semibold text-ink/60 hover:text-ink rounded-xl transition-colors">
                Cancel
              </button>
              <confirmFetcher.Form method="post" onSubmit={() => setPendingConfirm(null)} className="inline">
                <input type="hidden" name="intent" value={pendingConfirm.intent} />
                {pendingConfirm.id != null && <input type="hidden" name="id" value={pendingConfirm.id} />}
                {pendingConfirm.shopifyProductId && <input type="hidden" name="shopifyProductId" value={pendingConfirm.shopifyProductId} />}
                <button
                  type="submit"
                  className={`px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                    pendingConfirm.intent === 'delete'
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-coral text-white hover:opacity-90'
                  }`}
                >
                  {pendingConfirm.label}
                </button>
              </confirmFetcher.Form>
            </div>
          </div>
        </div>
      )}

      {/* Slide-over Editor */}
      {editId && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={closeEditor}
          />

          {/* Panel */}
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-cream shadow-2xl overflow-y-auto">
            {/* Close bar */}
            <div className="sticky top-0 z-10 bg-cream/95 backdrop-blur-sm border-b border-cream-2 px-6 py-3 flex items-center gap-3">
              {editorData?.deal ? (
                <>
                  {editorData.productImages[0] ? (
                    <img
                      src={editorData.productImages[0].src}
                      alt={editorData.productImages[0].alt ?? ''}
                      className="w-12 h-12 rounded-xl object-cover border border-cream-2 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-cream-2 shrink-0 flex items-center justify-center text-ink/30 text-xs">
                      No img
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink truncate leading-tight"
                       style={{ fontFamily: 'var(--font-display)' }}>
                      {editorData.deal.seoTitle ?? editorData.deal.sku}
                    </p>
                    <div className="mt-1">
                      <ReadinessChecklist deal={editorData.deal} />
                    </div>
                  </div>
                </>
              ) : (
                <span className="flex-1" />
              )}
              <button
                onClick={closeEditor}
                className="p-2 hover:bg-cream-2 rounded-xl transition-colors shrink-0"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {editorData?.deal ? (
                <>
                  {/* Pricing */}
                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
                      Pricing
                    </h3>
                    <PricingPanel
                      productId={editorData.deal.shopifyProductId}
                      config={editorData.pricingConfig}
                      shopifyCost={editorData.shopifyCost}
                      variants={editorData.deal.variants}
                    />
                  </div>

                  {/* Images */}
                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <h3 className="font-semibold text-ink mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                      Images
                    </h3>
                    <ImageManager
                      deal={editorData.deal}
                      initialImages={editorData.productImages}
                    />
                  </div>

                  {/* Tags (editable) */}
                  <TagsEditor deal={editorData.deal} editId={editId!} />

                  {/* Copy & Content (collapsible) */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setContentOpen(!contentOpen)}
                      aria-expanded={contentOpen}
                      className="flex items-center gap-2 w-full text-left py-2 text-sm font-semibold text-ink hover:text-ink/80 transition-colors"
                    >
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className={`shrink-0 transition-transform duration-200 ${contentOpen ? 'rotate-180' : ''}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      Copy & Content
                      {!contentOpen && <span className="text-xs font-normal text-ink/40 ml-1">9 fields</span>}
                    </button>
                    {contentOpen && (
                      <div className="space-y-5 pt-2">
                        <RawDescriptionPanel
                          deal={editorData.deal}
                          categories={editorData.dealCategories}
                          editId={editId!}
                        />
                        <SaveableField label="Tagline" fieldKey="tagline" defaultValue={editorData.deal.tagline} productId={editorData.deal.shopifyProductId} rows={2} />
                        <SaveableField label="Full Story" fieldKey="full_story" fieldType="multi_line_text_field" defaultValue={editorData.deal.fullStory} productId={editorData.deal.shopifyProductId} rows={8} />
                        <SaveableField label="Works For Him" fieldKey="works_for_him" fieldType="multi_line_text_field" defaultValue={editorData.deal.worksForHim} productId={editorData.deal.shopifyProductId} rows={3} />
                        <SaveableField label="Works For Her" fieldKey="works_for_her" fieldType="multi_line_text_field" defaultValue={editorData.deal.worksForHer} productId={editorData.deal.shopifyProductId} rows={3} />
                        <SaveableField label="Specifications" fieldKey="specifications" fieldType="multi_line_text_field" defaultValue={editorData.deal.specifications ?? ''} productId={editorData.deal.shopifyProductId} rows={5} />
                        <SaveableField label="What's In The Box" intent="save-box-contents" defaultValue={(editorData.deal.boxContents ?? []).join('\n')} productId={editorData.deal.shopifyProductId} rows={4} hint="One item per line" />
                        <SaveableField label="Feature Bullets" intent="save-bullets" defaultValue={(editorData.deal.featureBullets ?? []).join('\n')} productId={editorData.deal.shopifyProductId} rows={4} hint="One bullet per line" />
                        <SaveableField label="SEO Meta Description" fieldKey="seo_meta_description" fieldType="multi_line_text_field" defaultValue={editorData.deal.metaDescription} productId={editorData.deal.shopifyProductId} rows={2} />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-20 text-ink/40">
                  <p className="text-sm">No deal data found for this entry.</p>
                  <p className="text-xs mt-1">The Shopify product may not exist yet.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
