import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, useSearchParams, redirect } from 'react-router'
import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useCountdown } from '~/hooks/useCountdown'
import { db } from '~/lib/db.server'
import { dealHistory, pipelineSettings } from '../../db/schema'
import { eq, like, asc, min, max, count, sql, inArray, and, isNull } from 'drizzle-orm'
import {
  getAdminProductData,
  getDealByShopifyId, getDealByHandle, updateProductMetafield,
  getVariantCost, pushProductToShopify, getAccessoryProductsAdmin,
  getProductAdminImages, updateProductTags, fetchAllDealProducts,
  updateVariantPricing, getProductVariantGids,
} from '~/lib/shopify.server'
import type { AdminProductImage } from '~/lib/shopify.server'
import { generateCopy, generateSEOTitle } from '~/lib/claude.server'
import { getRailDraftsForDeal } from '~/lib/sanity.server'
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
    railDrafts: Awaited<ReturnType<typeof getRailDraftsForDeal>>
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

        const [productImages, pinnedAccessoryIds, railDrafts] = await Promise.all([
          deal ? getProductAdminImages(dbDeal.shopifyProductId) : Promise.resolve([] as AdminProductImage[]),
          getPinnedAccessoryIds(),
          deal ? getRailDraftsForDeal(deal.id).catch(() => []) : Promise.resolve([] as Awaited<ReturnType<typeof getRailDraftsForDeal>>),
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
          railDrafts,
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

  // Homepage template toggle + free-shipping flag (global; stored in pipelineSettings).
  const templateSettingRows = await db
    .select()
    .from(pipelineSettings)
    .where(inArray(pipelineSettings.key, [
      'homepage_template',
      'homepage_show_free_shipping',
      'homepage_pair_product_handle',
      'homepage_pair_discount_pct',
    ]))
  const pairHandle = (templateSettingRows.find(r => r.key === 'homepage_pair_product_handle')?.value ?? '').trim()
  const pairDiscountPct = parseInt(templateSettingRows.find(r => r.key === 'homepage_pair_discount_pct')?.value ?? '10', 10) || 10

  // Resolve paired product (lightweight — for toolbar slot display)
  let pairProduct: { title: string; brand: string; handle: string; dealPrice: number; image: string | null } | null = null
  if (pairHandle) {
    try {
      const deal = await getDealByHandle(pairHandle)
      if (deal) {
        pairProduct = {
          title: deal.seoTitle,
          brand: deal.brand,
          handle: deal.handle,
          dealPrice: deal.dealPrice,
          image: deal.images[0]?.url ?? null,
        }
      }
    } catch { /* ignore */ }
  }

  const homepageSettings = {
    template: (templateSettingRows.find(r => r.key === 'homepage_template')?.value ?? 'default') as 'default' | 'quiet_endorsement' | 'pair_bundle' | 'pair_bundle_fullbleed',
    showFreeShipping: (templateSettingRows.find(r => r.key === 'homepage_show_free_shipping')?.value ?? 'true') === 'true',
    pairProductHandle: pairHandle,
    pairDiscountPct,
    pairProduct,
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
    page: safePage, totalPages, totalFiltered, allDealsForExport, homepageSettings,
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

  if (intent === 'save-pair-product') {
    // Accepts either a dealId (from drag-drop) → resolves to Shopify handle, or
    // an empty string to clear. Writes pipelineSettings.homepage_pair_product_handle.
    const dealIdRaw = (form.get('dealId') as string | null)?.trim() ?? ''
    let handle = ''
    if (dealIdRaw) {
      const id = parseInt(dealIdRaw, 10)
      if (Number.isFinite(id)) {
        const row = await db.select().from(dealHistory).where(eq(dealHistory.id, id)).limit(1)
        const productId = row[0]?.shopifyProductId
        if (productId) {
          const numericId = productId.replace('gid://shopify/Product/', '')
          try {
            const deal = await getDealByShopifyId(numericId)
            if (deal?.handle) handle = deal.handle
          } catch { /* ignore */ }
        }
      }
    }
    await db
      .insert(pipelineSettings)
      .values({ key: 'homepage_pair_product_handle', value: handle, updatedAt: new Date() })
      .onConflictDoUpdate({ target: pipelineSettings.key, set: { value: handle, updatedAt: new Date() } })
    return { ok: true, handle }
  }

  if (intent === 'save-field') {
    const productId = form.get('productId') as string
    const key       = form.get('key') as string
    const value     = form.get('value') as string
    const type      = (form.get('type') as string) || 'single_line_text_field'
    if (key === 'specifications') {
      // Phase 2 — specifications stored as JSON string[] of "Label: Value"
      // bullets. Editor types one bullet per line; serialize before writing.
      const items = value.split('\n').map(l => l.trim()).filter(Boolean)
      await updateProductMetafield(productId, key, JSON.stringify(items), type)
      return { ok: true }
    }
    await updateProductMetafield(productId, key, value, type)
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

    const dealPriceNum = parseFloat(dealPrice || '0') || 0
    const msrpNum      = parseFloat(msrp      || '0') || 0

    await db.update(dealHistory).set({
      dealPrice:     dealPriceNum.toFixed(2),
      msrp:          msrpNum.toFixed(2),
      wholesaleCost: (parseFloat(wholesaleCost || '0') || 0).toFixed(2),
      mapPrice:      (parseFloat(mapPrice      || '0') || 0).toFixed(2),
      pctOffMsrp:    clampedPct.toFixed(2),
      vaultPrice:    vaultVal,
    }).where(eq(dealHistory.shopifyProductId, productId))

    // Push pricing to every Shopify variant so the storefront reflects the
    // change immediately. Previously this only staged the config in Drizzle
    // and deferred the push to activateDeal() — mismatch with editorial UX.
    if (dealPriceNum > 0) {
      try {
        const variantGids = await getProductVariantGids(productIdRaw)
        const compareAt = msrpNum > 0 ? msrpNum.toFixed(2) : ''
        await Promise.all(
          variantGids.map(gid =>
            updateVariantPricing(gid, dealPriceNum.toFixed(2), compareAt),
          ),
        )
      } catch (err) {
        console.error('[admin/deals] save-pricing variant push failed:', err)
        return { ok: false, error: err instanceof Error ? err.message : 'Shopify push failed' }
      }
    }

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
      const [taglineResult, storyResult, bothWaysResult, seoMetaResult, boxContentsResult] =
        await Promise.all([
          generateCopy({ type: 'tagline',      product: productContext }),
          generateCopy({ type: 'full_story',   product: productContext }),
          generateCopy({ type: 'both_ways',    product: productContext }),
          generateCopy({ type: 'seo_meta',     product: productContext }),
          generateCopy({ type: 'box_contents', product: productContext }),
        ])

      const tagline     = Array.isArray(taglineResult.content) ? (taglineResult.content[0] ?? '') : taglineResult.content as string
      const fullStory   = storyResult.content as string
      const bothWays    = bothWaysResult.content as { forHim: string; forHer: string }
      const seoMeta     = seoMetaResult.content as string
      const specs       = (Array.isArray(specsResult.content) ? specsResult.content : []) as string[]
      const boxContents = boxContentsResult.content as string[]

      const numericId = productId.replace('gid://shopify/Product/', '')
      await pushProductToShopify({
        shopifyProductId: numericId,
        tagline, fullStory, description: fullStory,
        worksForHim: bothWays.forHim, worksForHer: bothWays.forHer,
        seoMetaDescription: seoMeta,
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

// ─── RailGenerationPanel ─────────────────────────────────────────────────
// Two-step Emma rail generation: ♥ Generate rails → review/edit drafts → publish.
// POSTs to /api/generate-rails and /api/publish-rails (both admin-auth-gated).

interface RailDraftView {
  _id: string
  status?: 'draft' | 'approved' | 'live' | 'archived'
  active?: boolean
  order?: number
  heading: string
  eyebrow?: string
  emmaAside?: string
  target: 'homepage' | 'pdp'
  productHandles?: string[]
  layout?: 'carousel' | 'grid' | 'grid-3'
  bgStyle?: 'white' | 'cream' | 'mist' | 'charcoal' | 'purple'
  ctaLink?: string
  ctaLabel?: string
  rationale?: string
  generatedAt?: string
}

function RailGenerationPanel({
  productId,
  hasCopy,
  initialDrafts,
}: {
  productId: string
  hasCopy: boolean
  initialDrafts: RailDraftView[]
}) {
  const [drafts, setDrafts]   = useState<RailDraftView[]>(initialDrafts)
  const [genState, setGen]    = useState<'idle' | 'generating' | 'error'>('idle')
  const [genError, setGenErr] = useState<string | null>(null)
  const [pubState, setPub]    = useState<'idle' | 'publishing' | 'success' | 'error'>('idle')
  const [pubError, setPubErr] = useState<string | null>(null)
  const [meta, setMeta]       = useState<{ pool?: number; turns?: number } | null>(null)

  async function handleGenerate() {
    setGen('generating')
    setGenErr(null)
    try {
      const res = await fetch('/api/generate-rails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dealId: productId }),
      })
      const data = await res.json() as { drafts?: RailDraftView[]; error?: string; candidatePoolSize?: number; turns?: number }
      if (!res.ok) {
        setGen('error')
        setGenErr(data.error ?? `HTTP ${res.status}`)
        return
      }
      setDrafts(data.drafts ?? [])
      setMeta({ pool: data.candidatePoolSize ?? 0, turns: data.turns ?? 0 })
      setGen('idle')
    } catch (err) {
      setGen('error')
      setGenErr(err instanceof Error ? err.message : 'Generation failed')
    }
  }

  function patchDraft(id: string, patch: Partial<RailDraftView>) {
    setDrafts(prev => prev.map(d => d._id === id ? { ...d, ...patch } : d))
  }

  async function handlePublishAll() {
    const toPublish = drafts.filter(d => d.status === 'draft')
    if (toPublish.length === 0) return
    setPub('publishing')
    setPubErr(null)
    try {
      const res = await fetch('/api/publish-rails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dealId: productId,
          rails: toPublish.map(d => ({
            _id: d._id,
            target: d.target,
            heading: d.heading,
            eyebrow: d.eyebrow,
            emmaAside: d.emmaAside,
            productHandles: d.productHandles,
            layout: d.layout,
            bgStyle: d.bgStyle,
            ctaLabel: d.ctaLabel,
            ctaLink: d.ctaLink,
            order: d.order,
          })),
        }),
      })
      const data = await res.json() as { published?: unknown[]; errors?: { error: string }[]; drafts?: RailDraftView[] }
      if (!res.ok) {
        setPub('error')
        setPubErr((data as { error?: string }).error ?? `HTTP ${res.status}`)
        return
      }
      if (data.errors?.length) {
        setPub('error')
        setPubErr(data.errors.map(e => e.error).join('; '))
        if (data.drafts) setDrafts(data.drafts)
        return
      }
      setDrafts(data.drafts ?? [])
      setPub('success')
      setTimeout(() => setPub('idle'), 2500)
    } catch (err) {
      setPub('error')
      setPubErr(err instanceof Error ? err.message : 'Publish failed')
    }
  }

  const pendingDrafts = drafts.filter(d => d.status === 'draft')
  const liveRails     = drafts.filter(d => d.status === 'live')

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          ♥ Emma Rails
        </h3>
        {meta && (
          <span className="text-[11px] text-ink/40">
            pool {meta.pool} · {meta.turns} turns
          </span>
        )}
      </div>

      {!hasCopy ? (
        <p className="text-sm text-ink/50">Generate deal copy first — rails draw on the deal's tags and audience.</p>
      ) : (
        <>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={genState === 'generating'}
            className={
              genState === 'generating'
                ? 'w-full py-2.5 rounded-xl text-sm font-bold bg-ink/10 text-ink/40 cursor-not-allowed'
                : 'w-full py-2.5 rounded-xl text-sm font-bold bg-coral text-white hover:opacity-90 transition-opacity'
            }
          >
            {genState === 'generating' ? 'Emma is curating... (~30s)' : drafts.length ? '♥ Regenerate Rails' : '♥ Generate Rails'}
          </button>

          {genError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{genError}</div>
          )}

          {pendingDrafts.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-cream-2">
              <p className="text-xs font-semibold text-ink/60 uppercase tracking-wide">Pending review · {pendingDrafts.length}</p>
              {pendingDrafts.map(draft => (
                <RailDraftCard key={draft._id} draft={draft} onPatch={patch => patchDraft(draft._id, patch)} />
              ))}

              <button
                type="button"
                onClick={handlePublishAll}
                disabled={pubState === 'publishing'}
                className={
                  pubState === 'publishing'
                    ? 'w-full py-2 rounded-xl text-sm font-bold bg-ink/10 text-ink/40 cursor-not-allowed'
                    : pubState === 'success'
                    ? 'w-full py-2 rounded-xl text-sm font-bold bg-sage text-white'
                    : 'w-full py-2 rounded-xl text-sm font-bold bg-ink text-white hover:opacity-90 transition-opacity'
                }
              >
                {pubState === 'publishing' ? 'Publishing...' : pubState === 'success' ? '✓ Published' : 'Publish all rails'}
              </button>

              {pubError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">{pubError}</div>
              )}
            </div>
          )}

          {liveRails.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-cream-2">
              <p className="text-xs font-semibold text-ink/60 uppercase tracking-wide">Live · {liveRails.length}</p>
              {liveRails.map(d => (
                <div key={d._id} className="text-xs text-ink/60 flex justify-between">
                  <span>{d.target === 'homepage' ? '🏠' : '📦'} {d.heading}</span>
                  <span className="text-sage font-semibold">live</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function RailDraftCard({
  draft,
  onPatch,
}: {
  draft: RailDraftView
  onPatch: (patch: Partial<RailDraftView>) => void
}) {
  const handles = draft.productHandles ?? []
  function removeHandle(idx: number) {
    onPatch({ productHandles: handles.filter((_, i) => i !== idx) })
  }
  return (
    <div className="border border-cream-2 rounded-xl p-3 space-y-2 bg-cream/20">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink/50">
          {draft.target === 'homepage' ? '🏠 Homepage' : '📦 PDP'}
        </span>
        <select
          value={draft.target}
          onChange={e => onPatch({ target: e.target.value as 'homepage' | 'pdp' })}
          className="text-[11px] border border-cream-2 rounded px-2 py-0.5"
        >
          <option value="homepage">Homepage</option>
          <option value="pdp">PDP</option>
        </select>
      </div>

      <input
        type="text"
        value={draft.heading}
        onChange={e => onPatch({ heading: e.target.value })}
        placeholder="Heading"
        className="w-full text-sm font-semibold border border-cream-2 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-coral/40"
      />

      <input
        type="text"
        value={draft.eyebrow ?? ''}
        onChange={e => onPatch({ eyebrow: e.target.value })}
        placeholder="Eyebrow (optional)"
        className="w-full text-xs border border-cream-2 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-coral/40"
      />

      <textarea
        value={draft.emmaAside ?? ''}
        onChange={e => onPatch({ emmaAside: e.target.value })}
        placeholder="Emma aside"
        rows={2}
        className="w-full text-xs italic text-ink/70 border border-cream-2 rounded-lg px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-coral/40"
      />

      <div className="flex flex-wrap gap-1.5">
        {handles.map((h, i) => (
          <span key={`${h}-${i}`} className="inline-flex items-center gap-1 text-[11px] bg-paper border border-cream-2 rounded-full px-2 py-0.5">
            {h}
            <button
              type="button"
              onClick={() => removeHandle(i)}
              className="text-ink/40 hover:text-coral"
              aria-label={`Remove ${h}`}
            >×</button>
          </span>
        ))}
        {handles.length === 0 && <span className="text-[11px] text-red-600">No products — rail won't publish</span>}
      </div>

      {draft.rationale && (
        <p className="text-[11px] text-ink/40 italic">Why: {draft.rationale}</p>
      )}
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

// ─── Homepage Template Toggle ───────────────────────────────────────────

type HomepageSettings = {
  template:          'default' | 'quiet_endorsement' | 'pair_bundle' | 'pair_bundle_fullbleed'
  showFreeShipping:  boolean
  pairProductHandle: string
  pairDiscountPct:   number
  pairProduct:       { title: string; brand: string; handle: string; dealPrice: number; image: string | null } | null
}

function HomepageTemplateToggle({ settings }: { settings: HomepageSettings }) {
  const fetcher = useFetcher<{ ok: boolean }>()
  const saving  = fetcher.state !== 'idle'
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const save = (key: string, value: string) => {
    const fd = new FormData()
    fd.set('intent', 'save-setting')
    fd.set('key',    key)
    fd.set('value',  value)
    fetcher.submit(fd, { method: 'post' })
  }

  const label = settings.template === 'quiet_endorsement'
    ? 'Quiet endorsement'
    : settings.template === 'pair_bundle'
      ? 'Pair bundle'
      : settings.template === 'pair_bundle_fullbleed'
        ? 'Pair bundle · Full Bleed'
        : 'Default'

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-ink bg-white border border-cream-2 rounded-xl hover:border-sage/40 hover:text-sage transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3"  width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        Homepage: {label}
        {saving && <span className="text-ink/30">…</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white border border-cream-2 rounded-xl shadow-lg p-4 z-20 space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide font-bold text-ink/50 mb-1">
              Template
            </label>
            <select
              value={settings.template}
              onChange={e => save('homepage_template', e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-cream-2 rounded-lg bg-white text-ink focus:outline-none focus:ring-2 focus:ring-coral/30"
            >
              <option value="default">Default (Emma hero)</option>
              <option value="quiet_endorsement">Quiet endorsement</option>
              <option value="pair_bundle">Pair bundle</option>
              <option value="pair_bundle_fullbleed">Pair bundle · Full Bleed</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showFreeShipping}
              onChange={e => save('homepage_show_free_shipping', e.target.checked ? 'true' : 'false')}
              className="accent-coral"
            />
            Show <span className="italic">· free shipping</span> on banner
          </label>
          {(settings.template === 'pair_bundle' || settings.template === 'pair_bundle_fullbleed') && (
            <div>
              <label className="block text-[11px] uppercase tracking-wide font-bold text-ink/50 mb-1">
                Pair discount %
              </label>
              <input
                type="number"
                min={0}
                max={50}
                defaultValue={settings.pairDiscountPct}
                onBlur={e => save('homepage_pair_discount_pct', String(parseInt(e.target.value, 10) || 0))}
                className="w-24 px-2 py-1.5 text-sm border border-cream-2 rounded-lg bg-white text-ink focus:outline-none focus:ring-2 focus:ring-coral/30"
              />
              <p className="text-[11px] text-ink/40 mt-1">Match this to your Shopify Automatic Discount rule on cart attribute <code>pair_bundle=live</code>.</p>
            </div>
          )}
          <p className="text-[11px] text-ink/40 leading-relaxed">
            Applies to whichever deal is currently live. Bundle hero always wins.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Quiet Endorsement Editor Panel ─────────────────────────────────────

function QuietEndorsementPanel({ deal }: {
  deal: NonNullable<Awaited<ReturnType<typeof getDealByShopifyId>>>
}) {
  const genFetcher  = useFetcher<{ result?: { type: string; content: { eyebrow: string; subhead: string; body: string; bannerHeadline: string } }; error?: string }>()
  const saveFetcher = useFetcher<{ ok: boolean }>()

  const initial = deal.quietEndorsementCopy ?? null
  const [copy, setCopy] = useState<{ eyebrow: string; subhead: string; body: string; bannerHeadline: string } | null>(initial)

  const generated = genFetcher.data?.result?.content
  useEffect(() => {
    if (generated) setCopy(generated)
  }, [generated])

  const generating = genFetcher.state !== 'idle'
  const saving     = saveFetcher.state !== 'idle'
  const saved      = saveFetcher.state === 'idle' && saveFetcher.data?.ok === true

  const handleGenerate = () => {
    const fd = new FormData()
    fd.set('type', 'quiet_endorsement')
    fd.set('product', JSON.stringify({
      title:         deal.seoTitle ?? deal.sku,
      brand:         deal.brand,
      description:   deal.fullStory ?? deal.metaDescription ?? '',
      categories:    [deal.category],
      dealPrice:     deal.dealPrice,
      msrp:          deal.msrp,
      mapRestricted: deal.mapRestricted ?? false,
    }))
    genFetcher.submit(fd, { method: 'post', action: '/api/generate-copy' })
  }

  const handleSave = () => {
    if (!copy) return
    const fd = new FormData()
    fd.set('intent',    'save-field')
    fd.set('productId', deal.shopifyProductId)
    fd.set('key',       'quiet_endorsement_copy')
    fd.set('type',      'json')
    fd.set('value',     JSON.stringify(copy))
    saveFetcher.submit(fd, { method: 'post' })
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Quiet endorsement copy
        </h3>
        <span className="text-[11px] text-ink/40">homepage alt template</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className={
            generating
              ? 'flex-1 py-2 rounded-xl text-xs font-semibold bg-ink/10 text-ink/40 cursor-not-allowed'
              : 'flex-1 py-2 rounded-xl text-xs font-semibold bg-cream-2 text-sage hover:bg-sage/10 transition-colors'
          }
        >
          {generating ? 'Generating…' : '♥ Generate quiet-endorsement copy'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!copy || saving}
          className={
            !copy || saving
              ? 'px-4 py-2 rounded-xl text-xs font-bold bg-ink/10 text-ink/40 cursor-not-allowed'
              : saved
                ? 'px-4 py-2 rounded-xl text-xs font-bold bg-green-100 text-green-700'
                : 'px-4 py-2 rounded-xl text-xs font-bold bg-coral text-white hover:opacity-90 transition-opacity'
          }
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Use this ♥'}
        </button>
      </div>
      {genFetcher.data?.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ⚠ {genFetcher.data.error}
        </p>
      )}
      {copy && (
        <div className="text-xs bg-cream-2/50 border border-line rounded-lg px-3 py-2 space-y-1.5">
          <p className="uppercase tracking-wide text-ink/50 font-semibold">{copy.eyebrow}</p>
          <p className="text-ink/60 italic">{copy.subhead}</p>
          <p className="text-ink">{copy.body}</p>
          <p className="text-ink/70 font-mono">banner: {copy.bannerHeadline}</p>
        </div>
      )}
      {!copy && (
        <p className="text-xs text-ink/40 italic">
          No copy yet — generate above, then save to make it visible on the quiet-endorsement homepage.
        </p>
      )}
    </div>
  )
}

// ─── Pair Bundle Editor Panel ───────────────────────────────────────────

function PairBundlePanel({ deal, pairSettings }: {
  deal: NonNullable<Awaited<ReturnType<typeof getDealByShopifyId>>>
  pairSettings: { handle: string; product: HomepageSettings['pairProduct'] }
}) {
  const genFetcher  = useFetcher<{ result?: { type: string; content: import('~/types').PairBundleCopy }; error?: string }>()
  const saveFetcher = useFetcher<{ ok: boolean }>()

  const initial = deal.pairBundleCopy ?? null
  const [copy, setCopy] = useState<import('~/types').PairBundleCopy | null>(initial)

  const generated = genFetcher.data?.result?.content
  useEffect(() => {
    if (generated) {
      setCopy({ ...generated, pairedHandle: pairSettings.handle || generated.pairedHandle || '' })
    }
  }, [generated, pairSettings.handle])

  const hasPair     = Boolean(pairSettings.handle && pairSettings.product)
  const generating  = genFetcher.state !== 'idle'
  const saving      = saveFetcher.state !== 'idle'
  const saved       = saveFetcher.state === 'idle' && saveFetcher.data?.ok === true
  const pairChanged = copy?.pairedHandle && pairSettings.handle && copy.pairedHandle !== pairSettings.handle

  const handleGenerate = () => {
    if (!hasPair) return
    const fd = new FormData()
    fd.set('type', 'pair_bundle')
    fd.set('product', JSON.stringify({
      title:       deal.seoTitle ?? deal.sku,
      brand:       deal.brand,
      description: deal.fullStory ?? deal.metaDescription ?? '',
      categories:  [deal.category],
      dealPrice:   deal.dealPrice,
      msrp:        deal.msrp,
      partner: {
        title:       pairSettings.product!.title,
        brand:       pairSettings.product!.brand,
        description: '',
        categories:  [],
        dealPrice:   pairSettings.product!.dealPrice,
      },
    }))
    genFetcher.submit(fd, { method: 'post', action: '/api/generate-copy' })
  }

  const handleSave = () => {
    if (!copy) return
    const toSave: import('~/types').PairBundleCopy = {
      ...copy,
      pairedHandle: pairSettings.handle,
      generatedAt:  copy.generatedAt || new Date().toISOString(),
    }
    const fd = new FormData()
    fd.set('intent',    'save-field')
    fd.set('productId', deal.shopifyProductId)
    fd.set('key',       'pair_bundle_copy')
    fd.set('type',      'json')
    fd.set('value',     JSON.stringify(toSave))
    saveFetcher.submit(fd, { method: 'post' })
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Pair bundle copy
        </h3>
        <span className="text-[11px] text-ink/40">homepage alt template</span>
      </div>
      {!hasPair && (
        <p className="text-xs text-ink/50 bg-cream-2/60 border border-line rounded-lg px-3 py-2">
          Set a pair in the toolbar first — drag a deal into the pair slot to nominate a partner.
        </p>
      )}
      {hasPair && (
        <p className="text-xs text-ink/60">
          Pairing with <strong className="text-ink">{pairSettings.product!.title}</strong>
        </p>
      )}
      {pairChanged && (
        <p className="text-xs text-coral bg-coral/5 border border-coral/20 rounded-lg px-3 py-2">
          Pair changed since last save — regenerate to refresh the story.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!hasPair || generating}
          className={
            !hasPair || generating
              ? 'flex-1 py-2 rounded-xl text-xs font-semibold bg-ink/10 text-ink/40 cursor-not-allowed'
              : 'flex-1 py-2 rounded-xl text-xs font-semibold bg-cream-2 text-sage hover:bg-sage/10 transition-colors'
          }
        >
          {generating ? 'Generating…' : '♥ Generate pair-bundle copy'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!copy || !hasPair || saving}
          className={
            !copy || !hasPair || saving
              ? 'px-4 py-2 rounded-xl text-xs font-bold bg-ink/10 text-ink/40 cursor-not-allowed'
              : saved
                ? 'px-4 py-2 rounded-xl text-xs font-bold bg-green-100 text-green-700'
                : 'px-4 py-2 rounded-xl text-xs font-bold bg-coral text-white hover:opacity-90 transition-opacity'
          }
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Use this ♥'}
        </button>
      </div>
      {genFetcher.data?.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ⚠ {genFetcher.data.error}
        </p>
      )}
      {copy && (
        <div className="text-xs bg-cream-2/50 border border-line rounded-lg px-3 py-2 space-y-2">
          <div className="space-y-1">
            <p className="uppercase tracking-wide text-ink/50 font-semibold">{copy.eyebrow}</p>
            <p className="text-ink/60 italic">{copy.subhead}</p>
            <p className="text-ink font-semibold">{copy.headline}</p>
            <p className="text-ink">{copy.body}</p>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 border-t border-line/60">
            <dt className="text-ink/50 uppercase tracking-wide text-[10px]">Primary tag</dt>
            <dd className="text-ink" style={{ fontFamily: 'var(--font-script)' }}>{copy.primaryTag}</dd>
            <dt className="text-ink/50 uppercase tracking-wide text-[10px]">Partner tag</dt>
            <dd className="text-ink" style={{ fontFamily: 'var(--font-script)' }}>{copy.partnerTag}</dd>
            <dt className="text-ink/50 uppercase tracking-wide text-[10px]">Knot caption</dt>
            <dd className="text-ink" style={{ fontFamily: 'var(--font-script)' }}>{copy.knotCaption}</dd>
          </dl>

          {copy.whyCards?.length > 0 && (
            <div className="pt-2 border-t border-line/60 space-y-1.5">
              <p className="text-ink/50 uppercase tracking-wide text-[10px] font-semibold">Why cards</p>
              <ol className="space-y-1.5 list-none">
                {copy.whyCards.map((card, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-coral font-bold italic shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <p className="text-ink font-semibold">{card.head}</p>
                      <p className="text-ink/70">{card.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {copy.emmaQuote && (
            <div className="pt-2 border-t border-line/60 space-y-1">
              <p className="text-ink/50 uppercase tracking-wide text-[10px] font-semibold">Emma quote</p>
              <p className="text-ink italic leading-relaxed">“{copy.emmaQuote}”</p>
            </div>
          )}

          {copy.moments?.length > 0 && (
            <div className="pt-2 border-t border-line/60 space-y-1.5">
              <p className="text-ink/50 uppercase tracking-wide text-[10px] font-semibold">
                Moments{copy.momentTitle ? ` — ${copy.momentTitle}` : ''}
              </p>
              <ol className="space-y-1.5 list-none">
                {copy.moments.map((m, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-coral font-bold shrink-0">{i + 1}.</span>
                    <div>
                      <p className="text-ink font-semibold">{m.lead}</p>
                      <p className="text-ink/70">{m.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="text-ink/70 italic pt-2 border-t border-line/60">{copy.bannerLine}</p>
        </div>
      )}
      {!copy && (
        <p className="text-xs text-ink/40 italic">
          No copy yet — generate above, then save to make it visible on the pair-bundle homepage.
        </p>
      )}
    </div>
  )
}

// ─── Emma Hero Regen ────────────────────────────────────────────────────

function EmmaHeroRegen({ productId }: { productId: string }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string; copy?: { eyebrow: string; headline: string; body: string; aside: string; pullQuote?: string } }>()
  const busy = fetcher.state !== 'idle'
  const copy = fetcher.data?.ok ? fetcher.data.copy : null
  return (
    <fetcher.Form method="post" action="/api/admin/emma-hero/regenerate" className="space-y-2">
      <input type="hidden" name="productId" value={productId} />
      <button
        type="submit"
        disabled={busy}
        className={
          busy
            ? 'w-full py-2.5 rounded-xl text-sm font-semibold bg-ink/10 text-ink/40 cursor-not-allowed'
            : 'w-full py-2.5 rounded-xl text-sm font-semibold bg-cream-2 text-sage hover:bg-sage/10 transition-colors'
        }
      >
        {busy ? 'Regenerating Emma hero…' : '♥ Regenerate Emma hero'}
      </button>
      {fetcher.data?.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ⚠ {fetcher.data.error}
        </p>
      )}
      {copy && (
        <div className="text-xs bg-cream-2/50 border border-line rounded-lg px-3 py-2 space-y-1">
          <p className="uppercase tracking-wide text-ink/50 font-semibold">{copy.eyebrow}</p>
          <p className="font-bold text-ink">{copy.headline}</p>
          <p className="text-ink/75">{copy.body}</p>
          {copy.pullQuote && <p className="italic text-ink/80">“{copy.pullQuote}”</p>}
          <p className="text-muted font-mono">{copy.aside}</p>
        </div>
      )}
    </fetcher.Form>
  )
}

// ─── PDP v2 — Emma's take · Care · Sensation dial ──────────────────────

type DialItem = { label: string; value: number; proposed?: boolean }

function PdpReviseEmmaContent({
  productId, productTypeDial,
}: { productId: string; productTypeDial: string | null }) {
  const takeFetcher  = useFetcher<{ ok: boolean; html?: string; error?: string; written?: boolean }>()
  const careFetcher  = useFetcher<{ ok: boolean; bullets?: string[]; error?: string; written?: boolean }>()
  const dialFetcher  = useFetcher<{
    ok: boolean
    error?: string
    written?: boolean
    dial?: { items: DialItem[] }
    proposed?: string[]
    preferredLabels?: string[]
  }>()
  const acceptFetcher = useFetcher<{ ok: boolean; error?: string; registry?: string[] }>()
  const renameFetcher = useFetcher<{ ok: boolean; error?: string; dial?: { items: DialItem[] } }>()

  const proposed = dialFetcher.data?.ok ? (dialFetcher.data.proposed ?? []) : []
  const preferred = dialFetcher.data?.ok ? (dialFetcher.data.preferredLabels ?? []) : []

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          PDP v2 · Emma's take · Care · Dial
        </h3>
        <p className="text-xs text-muted mt-1">
          Dry-run previews the copy without writing to Shopify. Save writes the metafield (or product description for the take).
        </p>
      </div>

      {/* Emma's take */}
      <div className="border border-line rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-bold text-sm text-ink">Emma's take</h4>
          <div className="flex gap-2">
            <takeFetcher.Form method="post" action="/api/admin/emma-take/regenerate">
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="dryRun" value="1" />
              <button
                type="submit"
                disabled={takeFetcher.state !== 'idle'}
                className="text-xs px-3 py-1.5 rounded-lg bg-cream-2 text-ink hover:bg-line/40 disabled:opacity-50"
              >
                {takeFetcher.state !== 'idle' ? 'Generating…' : 'Preview'}
              </button>
            </takeFetcher.Form>
            <takeFetcher.Form method="post" action="/api/admin/emma-take/regenerate">
              <input type="hidden" name="productId" value={productId} />
              <button
                type="submit"
                disabled={takeFetcher.state !== 'idle'}
                className="text-xs px-3 py-1.5 rounded-lg bg-coral text-white hover:bg-coral-deep disabled:opacity-50"
              >
                Generate &amp; save
              </button>
            </takeFetcher.Form>
          </div>
        </div>
        {takeFetcher.data?.error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠ {takeFetcher.data.error}</p>
        )}
        {takeFetcher.data?.ok && takeFetcher.data.html && (
          <div
            className="text-xs prose prose-sm max-w-none text-ink/80 bg-cream-2/50 border border-line rounded-lg px-3 py-2"
            dangerouslySetInnerHTML={{ __html: takeFetcher.data.html }}
          />
        )}
        {takeFetcher.data?.ok && takeFetcher.data.written && (
          <p className="text-[11px] text-sage">Written to Shopify product description.</p>
        )}
      </div>

      {/* Care instructions */}
      <div className="border border-line rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-bold text-sm text-ink">Care instructions</h4>
          <div className="flex gap-2">
            <careFetcher.Form method="post" action="/api/admin/care-instructions/regenerate">
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="dryRun" value="1" />
              <button
                type="submit"
                disabled={careFetcher.state !== 'idle'}
                className="text-xs px-3 py-1.5 rounded-lg bg-cream-2 text-ink hover:bg-line/40 disabled:opacity-50"
              >
                {careFetcher.state !== 'idle' ? 'Generating…' : 'Preview'}
              </button>
            </careFetcher.Form>
            <careFetcher.Form method="post" action="/api/admin/care-instructions/regenerate">
              <input type="hidden" name="productId" value={productId} />
              <button
                type="submit"
                disabled={careFetcher.state !== 'idle'}
                className="text-xs px-3 py-1.5 rounded-lg bg-coral text-white hover:bg-coral-deep disabled:opacity-50"
              >
                Generate &amp; save
              </button>
            </careFetcher.Form>
          </div>
        </div>
        {careFetcher.data?.error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠ {careFetcher.data.error}</p>
        )}
        {careFetcher.data?.ok && careFetcher.data.bullets && (
          <ul className="text-xs space-y-1 bg-cream-2/50 border border-line rounded-lg px-3 py-2">
            {careFetcher.data.bullets.map((b, i) => (
              <li key={i} className="flex gap-2"><span className="text-sage">·</span>{b}</li>
            ))}
          </ul>
        )}
        {careFetcher.data?.ok && careFetcher.data.written && (
          <p className="text-[11px] text-sage">Written to xdipx.care_instructions.</p>
        )}
      </div>

      {/* Sensation dial v2 */}
      <div className="border border-line rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="font-bold text-sm text-ink">Sensation dial v2</h4>
            <p className="text-[11px] text-muted">
              {productTypeDial ? `Type: ${productTypeDial}` : 'No xdipx.product_type_dial set — required.'}
            </p>
          </div>
          <div className="flex gap-2">
            <dialFetcher.Form method="post" action="/api/admin/sensation-dial/regenerate">
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="dryRun" value="1" />
              <button
                type="submit"
                disabled={!productTypeDial || dialFetcher.state !== 'idle'}
                className="text-xs px-3 py-1.5 rounded-lg bg-cream-2 text-ink hover:bg-line/40 disabled:opacity-50"
              >
                {dialFetcher.state !== 'idle' ? 'Generating…' : 'Preview'}
              </button>
            </dialFetcher.Form>
            <dialFetcher.Form method="post" action="/api/admin/sensation-dial/regenerate">
              <input type="hidden" name="productId" value={productId} />
              <button
                type="submit"
                disabled={!productTypeDial || dialFetcher.state !== 'idle'}
                className="text-xs px-3 py-1.5 rounded-lg bg-coral text-white hover:bg-coral-deep disabled:opacity-50"
              >
                Generate &amp; save
              </button>
            </dialFetcher.Form>
          </div>
        </div>
        {dialFetcher.data?.error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠ {dialFetcher.data.error}</p>
        )}
        {dialFetcher.data?.ok && dialFetcher.data.dial && (
          <ul className="text-xs space-y-1 bg-cream-2/50 border border-line rounded-lg px-3 py-2">
            {dialFetcher.data.dial.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {it.label}
                  {it.proposed && <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-sun/30 text-ink-2">new</span>}
                </span>
                <span className="font-mono text-ink/60">{it.value}/5</span>
              </li>
            ))}
          </ul>
        )}

        {/* Triage proposed labels */}
        {productTypeDial && proposed.length > 0 && (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] text-muted uppercase tracking-wider">Proposed labels — accept or rename</p>
            {proposed.map(label => (
              <div key={label} className="flex flex-wrap items-center gap-2 bg-sun/10 border border-sun/30 rounded-lg px-3 py-2">
                <span className="text-xs font-bold text-ink">{label}</span>
                <acceptFetcher.Form method="post" action="/api/admin/dial-registry/append" className="contents">
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="productTypeDial" value={productTypeDial} />
                  <input type="hidden" name="label" value={label} />
                  <button
                    type="submit"
                    disabled={acceptFetcher.state !== 'idle'}
                    className="text-[11px] px-2 py-1 rounded bg-sage text-white hover:bg-sage/80 disabled:opacity-50"
                  >
                    Accept → registry
                  </button>
                </acceptFetcher.Form>
                <renameFetcher.Form method="post" action="/api/admin/sensation-dial/rename-label" className="contents">
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="fromLabel" value={label} />
                  <select name="toLabel" className="text-[11px] px-2 py-1 rounded border border-line bg-white" required>
                    <option value="">Rename to…</option>
                    {preferred.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <button
                    type="submit"
                    disabled={renameFetcher.state !== 'idle'}
                    className="text-[11px] px-2 py-1 rounded bg-cream-2 text-ink hover:bg-line/40 disabled:opacity-50"
                  >
                    Rename
                  </button>
                </renameFetcher.Form>
              </div>
            ))}
          </div>
        )}
        {acceptFetcher.data?.ok && (
          <p className="text-[11px] text-sage">Registry updated · {acceptFetcher.data.registry?.length ?? 0} labels.</p>
        )}
        {renameFetcher.data?.ok && (
          <p className="text-[11px] text-sage">Label renamed on this product.</p>
        )}
        {dialFetcher.data?.ok && dialFetcher.data.written && (
          <p className="text-[11px] text-sage">Written to xdipx.sensation_dial_v2.</p>
        )}
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

// ─── Pair Slot Card ─────────────────────────────────────────────────────

function PairSlotCard({ pairProduct, onDrop, onClear }: {
  pairProduct: HomepageSettings['pairProduct']
  onDrop:  (dealId: number) => void
  onClear: () => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const handlers = {
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

  if (!pairProduct) {
    return (
      <div
        className={`mb-5 border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
          dragOver ? 'border-coral ring-2 ring-coral bg-coral/5' : 'border-ink/20'
        }`}
        {...handlers}
      >
        <p className="text-xs uppercase tracking-wide font-bold text-ink/50">Pair slot</p>
        <p className="text-sm font-medium text-ink/50 mt-1">Drop a deal here to pair with the live deal</p>
      </div>
    )
  }

  return (
    <div
      className={`mb-5 rounded-2xl p-4 bg-white border flex items-center gap-4 transition-all ${
        dragOver ? 'border-coral ring-2 ring-coral' : 'border-cream-2'
      }`}
      {...handlers}
    >
      <div className="w-16 h-16 rounded-xl overflow-hidden bg-cream-2 shrink-0">
        {pairProduct.image
          ? <img src={pairProduct.image} alt={pairProduct.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wide font-bold text-ink/50">Paired with</p>
        <p className="text-sm font-semibold text-ink truncate" style={{ fontFamily: 'var(--font-display)' }}>{pairProduct.title}</p>
        <p className="text-xs text-ink/60">{pairProduct.brand} · ${pairProduct.dealPrice}</p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="text-xs font-bold px-3 py-1.5 rounded-full text-ink/50 hover:text-red-500 hover:bg-red-50 transition-colors"
        title="Clear pair"
      >
        ✕ clear
      </button>
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
    page, totalPages, totalFiltered, allDealsForExport, homepageSettings,
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

  function handlePairDrop(dealId: number) {
    moveFetcher.submit(
      { intent: 'save-pair-product', dealId: String(dealId) },
      { method: 'post' },
    )
  }

  function handlePairClear() {
    moveFetcher.submit(
      { intent: 'save-pair-product', dealId: '' },
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

      {/* Pair Slot Card — shown when either pair_bundle template is active */}
      {(homepageSettings.template === 'pair_bundle' || homepageSettings.template === 'pair_bundle_fullbleed') && (
        <PairSlotCard
          pairProduct={homepageSettings.pairProduct}
          onDrop={handlePairDrop}
          onClear={handlePairClear}
        />
      )}

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
        <HomepageTemplateToggle settings={homepageSettings} />
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

                  {/* Emma hero (Claude-generated voice copy) */}
                  <EmmaHeroRegen productId={editorData.deal.shopifyProductId} />

                  {/* PDP v2 — Emma's take, Care, Sensation dial */}
                  <PdpReviseEmmaContent
                    productId={editorData.deal.shopifyProductId}
                    productTypeDial={editorData.deal.productTypeDial ?? null}
                  />

                  {/* Quiet endorsement copy (alt homepage template) */}
                  <QuietEndorsementPanel deal={editorData.deal} />

                  {/* Pair bundle copy (alt homepage template) */}
                  <PairBundlePanel
                    deal={editorData.deal}
                    pairSettings={{ handle: homepageSettings.pairProductHandle, product: homepageSettings.pairProduct }}
                  />

                  {/* Emma-curated rails (agent-generated cross-sell) */}
                  <RailGenerationPanel
                    productId={editorData.deal.shopifyProductId}
                    hasCopy={Boolean(editorData.deal.tagline)}
                    initialDrafts={editorData.railDrafts}
                  />

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
                        <SaveableField label="Specifications" fieldKey="specifications" fieldType="multi_line_text_field" defaultValue={(editorData.deal.specifications ?? []).join('\n')} productId={editorData.deal.shopifyProductId} rows={5} hint="One bullet per line: 'Label: Value'" />
                        <SaveableField label="What's In The Box" intent="save-box-contents" defaultValue={(editorData.deal.boxContents ?? []).join('\n')} productId={editorData.deal.shopifyProductId} rows={4} hint="One item per line" />
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
