/**
 * Shared deal rotation logic — used by midnight cron, inventory webhook,
 * and inventory-check polling cron.
 *
 * Provides three main functions:
 *   transitionToVaultPricing — raise price + tag as vault on deal end
 *   activateDeal             — publish product + set live + notify
 *   rotateDeal               — full rotation: vault current → activate next
 */
import { db } from './db.server'
import { dealHistory, pipelineSettings, batchJobs } from '../../db/schema'
import { eq, and, isNull, asc, inArray } from 'drizzle-orm'
import {
  setDealStatus,
  activateShopifyProduct,
  updateVariantPricing,
  updateProductMetafield,
  appendProductTag,
  shopifyAdmin,
} from './shopify.server'
import { triggerDailyDealEmail } from './klaviyo.server'
import { kvSet, KV_KEYS } from './kv.server'

/** Returns YYYY-MM-DD in America/New_York. */
function estDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/** Derive `past-daily-deal-MM-YY` from a YYYY-MM-DD dealDate string. */
function pastDealTag(dealDate: string | null): string | null {
  if (!dealDate) return null
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dealDate)
  if (!m) return null
  const [, yyyy, mm] = m
  return `past-daily-deal-${mm}-${yyyy!.slice(2)}`
}

/** Read the global vault discount percentage from pipeline settings. */
async function getVaultDiscountPct(): Promise<number> {
  const [row] = await db
    .select()
    .from(pipelineSettings)
    .where(eq(pipelineSettings.key, 'vaultDiscountPct'))
    .limit(1)
  const pct = parseFloat(row?.value ?? '25')
  return isNaN(pct) ? 25 : Math.max(5, Math.min(60, pct))
}

/** Get the first variant GID for a product (for pricing updates). */
async function getFirstVariantGid(shopifyProductId: string): Promise<string | null> {
  const numericId = shopifyProductId.replace('gid://shopify/Product/', '')
  const { product } = await shopifyAdmin<{
    product: { variants: { id: number }[] } | null
  }>(`/products/${numericId}.json?fields=variants`)
  const v = product?.variants?.[0]
  return v ? `gid://shopify/ProductVariant/${v.id}` : null
}

/**
 * Transition a live deal to vault pricing.
 * Raises the Shopify variant price to the vault price, keeps compareAtPrice = MSRP,
 * sets deal-status-vault tag, and marks completedAt in the DB.
 */
export async function transitionToVaultPricing(
  deal: {
    id: number
    shopifyProductId: string | null
    msrp: string | null
    vaultPrice: string | null
    pctOffMsrp?: string | null
    dealDate: string | null
  },
): Promise<void> {
  if (!deal.shopifyProductId) return

  const msrp = parseFloat(deal.msrp ?? '0')

  // Priority: per-product vaultPrice override → per-product pctOffMsrp → global vaultDiscountPct.
  let vaultPrice = deal.vaultPrice ? parseFloat(deal.vaultPrice) : 0
  if (!vaultPrice && msrp > 0) {
    const productPct = deal.pctOffMsrp ? parseFloat(deal.pctOffMsrp) : NaN
    const pct = isFinite(productPct) && productPct > 0
      ? Math.max(0, Math.min(100, productPct))
      : await getVaultDiscountPct()
    vaultPrice = Math.round(msrp * (1 - pct / 100) * 100) / 100
  }

  // Update Shopify variant price to vault price
  if (vaultPrice > 0) {
    const variantGid = await getFirstVariantGid(deal.shopifyProductId)
    if (variantGid) {
      await updateVariantPricing(
        variantGid,
        vaultPrice.toFixed(2),
        msrp > 0 ? msrp.toFixed(2) : '',
      )
    }

    // Store vault price in metafield
    await updateProductMetafield(
      deal.shopifyProductId,
      'vault_price',
      vaultPrice.toFixed(2),
      'number_decimal',
    )
  }

  // Set status to vault in Shopify (metafield + tags)
  await setDealStatus(deal.shopifyProductId, 'vault')

  // Tag with `past-daily-deal-MM-YY` so monthly archive pages can filter by tag.
  const tag = pastDealTag(deal.dealDate)
  if (tag) await appendProductTag(deal.shopifyProductId, tag)

  // Update DB — mark completed, store calculated vault price
  await db
    .update(dealHistory)
    .set({
      status: 'queued',
      completedAt: new Date(),
      vaultPrice: vaultPrice > 0 ? vaultPrice.toFixed(2) : null,
    })
    .where(and(eq(dealHistory.id, deal.id), eq(dealHistory.status, 'live')))

  // Archive Emma-curated homepage rails for this deal — they're tied to the
  // editorial moment. PDP rails persist on the canonical product URL.
  try {
    const { archiveHomepageRailsForDeal } = await import('./sanity.server')
    const { archived } = await archiveHomepageRailsForDeal(deal.shopifyProductId)
    if (archived.length) {
      console.log('[deal-rotator] Archived homepage rails:', archived.length)
    }
  } catch (err) {
    console.error('[deal-rotator] Rail archive failed (non-blocking):', err)
  }
}

/**
 * Activate a deal — publish product, set live status, update KV, trigger email.
 *
 * Spec E1 gates:
 *  1. If a batch_job with status in ('queued','submitted','processing','applying')
 *     gates this deal, defer activation (cron/poller retries). This lets the
 *     enrichment job finish before the deal goes live with partial copy.
 *  2. Double-activation guard: if deal_status is already 'live', return early
 *     to prevent duplicate Klaviyo emails when both the midnight cron and the
 *     poller's maybeActivateGatedDeal race to activate.
 */
export async function activateDeal(
  deal: {
    id: number
    shopifyProductId: string | null
    sku: string
    seoTitle: string | null
    dealPrice: string | null
    msrp: string | null
    wholesaleCost?: string | null
  },
): Promise<void> {
  if (!deal.shopifyProductId) return

  // E1 — gate check: defer if a batch job is still running for this deal.
  const blockingJobs = await db
    .select({ id: batchJobs.id })
    .from(batchJobs)
    .where(and(
      eq(batchJobs.gatesDealId, deal.id),
      inArray(batchJobs.status, ['queued', 'submitted', 'processing', 'applying']),
    ))
  if (blockingJobs.length > 0) {
    console.log(`[deal-rotator] enrichment in flight for deal ${deal.id} — deferring activation (${blockingJobs.length} blocking job(s))`)
    return
  }

  // Log if there's a failed gating job (degraded-enrichment path — proceed anyway).
  const failedJobs = await db
    .select({ id: batchJobs.id })
    .from(batchJobs)
    .where(and(eq(batchJobs.gatesDealId, deal.id), eq(batchJobs.status, 'failed')))
  if (failedJobs.length > 0) {
    console.warn(`[deal-rotator] WARN gated enrichment failed for deal ${deal.id}; activating with stale/partial copy (degraded-enrichment path)`)
  }

  // E1 — double-activation guard: atomic claim via UPDATE...WHERE deal_status <> 'live'.
  // If this returns 0 rows, another path already activated — return without firing Klaviyo.
  const claimed = await db
    .update(dealHistory)
    .set({ status: 'live' })
    .where(and(eq(dealHistory.id, deal.id), inArray(dealHistory.status, ['queued', 'pending_approval'])))
    .returning({ id: dealHistory.id })
  if (claimed.length === 0) {
    console.log(`[deal-rotator] deal ${deal.id} already live — skipping duplicate activation`)
    return
  }

  // E1 — check if a gated full-enrichment job exists (even completed/failed).
  //  When one exists, skip the inline Emma hero generation to avoid overwriting
  //  orchestrator-written metafields.
  const anyGatingJob = await db
    .select({ id: batchJobs.id, status: batchJobs.status })
    .from(batchJobs)
    .where(eq(batchJobs.gatesDealId, deal.id))
    .limit(1)
  const skipInlineHero = anyGatingJob.length > 0

  // Ensure product is published (not draft)
  const numericId = deal.shopifyProductId.replace('gid://shopify/Product/', '')
  await activateShopifyProduct(numericId)

  // Push configured deal price → variant.price (compareAtPrice = MSRP)
  // Admin edits pricing config without mutating live price; we flip it here.
  const dealPrice = parseFloat(deal.dealPrice ?? '0')
  const msrp      = parseFloat(deal.msrp ?? '0')
  if (dealPrice > 0) {
    const variantGid = await getFirstVariantGid(deal.shopifyProductId)
    if (variantGid) {
      await updateVariantPricing(
        variantGid,
        dealPrice.toFixed(2),
        msrp > 0 ? msrp.toFixed(2) : '',
        deal.wholesaleCost ?? undefined,
      )
    }
  }

  // Set live status in Shopify
  await setDealStatus(deal.shopifyProductId, 'live')

  // Recycled-deal path: if this product was a previous deal, restore any
  // archived homepage rails instead of regenerating. Saves tokens, preserves
  // editorial history for repeat picks.
  try {
    const { unarchiveHomepageRailsForDeal } = await import('./sanity.server')
    const { unarchived } = await unarchiveHomepageRailsForDeal(deal.shopifyProductId)
    if (unarchived.length) {
      console.log('[deal-rotator] Un-archived homepage rails:', unarchived.length)
    }
  } catch (err) {
    console.error('[deal-rotator] Rail un-archive failed (non-blocking):', err)
  }

  // Emma hero copy — generated from pipelineSettings.brandVoice (non-blocking).
  // E1: skip if a gated full-enrichment job exists (it already wrote emmaHero via
  // applyFullEnrichmentWrites — regenerating would overwrite orchestrator copy).
  if (!skipInlineHero) {
    try {
      const { getDailyDeal } = await import('./shopify.server')
      const { generateEmmaHero } = await import('./claude.server')
      const fullDeal = await getDailyDeal().catch(() => null)
      const seedDeal = fullDeal ?? {
        seoTitle: deal.seoTitle ?? '',
        tagline: '',
        fullStory: '',
        brand: '',
        category: ['for-him', 'for-her'] as const,
        dealPrice,
        msrp,
        mapRestricted: false,
      }
      const variant = seedDeal.mapRestricted ? 'quote' : 'loving'
      const copy = await generateEmmaHero({ deal: seedDeal, variant })
      await updateProductMetafield(
        deal.shopifyProductId,
        'emma_hero',
        JSON.stringify(copy),
        'json',
      )
      // Mirror the Emma signature into xdipx.tagline so any surface that still
      // reads the tagline metafield picks up Emma's voice on activation.
      if (copy.aside) {
        await updateProductMetafield(
          deal.shopifyProductId,
          'tagline',
          copy.aside,
          'single_line_text_field',
        )
      }

      // Index the pick into Sanity so Emma gets smarter as deals flow.
      // Non-blocking inside the same try — we've already written the source of
      // truth (Shopify metafield); Sanity is the searchable replica.
      if (fullDeal?.handle) {
        try {
          const { upsertEmmaPick } = await import('./sanity.server')
          await upsertEmmaPick({
            productId:     deal.shopifyProductId,
            productHandle: fullDeal.handle,
            productTitle:  fullDeal.seoTitle ?? deal.seoTitle ?? undefined,
            brand:         fullDeal.brand ?? undefined,
            category:      (fullDeal.category && fullDeal.category.length > 0) ? fullDeal.category[0] : undefined,
            dealDate:      estDate(0),
            variant:       copy.variant,
            eyebrow:       copy.eyebrow,
            headline:      copy.headline,
            body:          copy.body,
            aside:         copy.aside,
            pullQuote:     copy.pullQuote,
            voiceHash:     copy.voiceHash,
            generatedAt:   copy.generatedAt,
          })
        } catch (sanityErr) {
          console.error('[deal-rotator] Emma pick Sanity index failed (non-blocking):', sanityErr)
        }
      }
    } catch (err) {
      console.error('[deal-rotator] Emma hero generation failed (non-blocking):', err)
    }
  } else {
    console.log(`[deal-rotator] Skipping inline Emma hero for deal ${deal.id} — gated enrichment job already wrote copy`)
  }

  // Update DB: set activatedAt and dealDate (status was already set to 'live' in the
  // atomic claim above; this second update keeps activatedAt + dealDate current).
  await db
    .update(dealHistory)
    .set({
      activatedAt: new Date(),
      dealDate: estDate(0),
    })
    .where(eq(dealHistory.id, deal.id))

  // Cache for fast KV reads
  await kvSet(KV_KEYS.dealOfDay, {
    sku: deal.sku,
    title: deal.seoTitle,
    date: estDate(0),
  }, 86400)

  // Trigger Klaviyo email
  await triggerDailyDealEmail({
    title: deal.seoTitle ?? '',
    tagline: '',
    dealPrice: parseFloat(deal.dealPrice ?? '0'),
    msrp: parseFloat(deal.msrp ?? '0'),
    handle: deal.sku,
    imageUrl: '',
    subjectLine: `New deal just dropped — ${deal.seoTitle ?? 'check it out'} ♥`,
  })

  // Auto-post to X (non-blocking — never fails the deal activation)
  if (process.env['X_AUTO_POST_ENABLED'] === 'true') {
    try {
      const { postDealTweet } = await import('./twitter.server')
      const result = await postDealTweet({
        dealHistoryId: deal.id,
        seoTitle: deal.seoTitle ?? '',
        tagline: '',
        dealPrice: parseFloat(deal.dealPrice ?? '0'),
        msrp: parseFloat(deal.msrp ?? '0'),
        brand: '',
        category: 'both',
        handle: deal.sku,
        imageUrl: '',
        shopifyProductId: deal.shopifyProductId ?? undefined,
      })
      console.log('[deal-rotator] Auto-tweet:', result.ok ? result.tweetId : result.error)
    } catch (err) {
      console.error('[deal-rotator] Auto-tweet failed (non-blocking):', err)
    }
  }
}

/**
 * Full rotation: transition current live deal to vault pricing,
 * then activate the next scheduled deal.
 *
 * Returns what happened for logging.
 * Uses optimistic locking to prevent double-rotation.
 */
export async function rotateDeal(): Promise<{
  vaulted: string | null
  activated: string | null
}> {
  // 1. Find current live deal
  const [liveDeal] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1)

  // 2. Vault the current deal (if any)
  if (liveDeal) {
    await transitionToVaultPricing(liveDeal)
  }

  // 3. Find next scheduled deal (earliest date, not yet completed)
  const [nextDeal] = await db
    .select()
    .from(dealHistory)
    .where(
      and(
        eq(dealHistory.status, 'queued'),
        isNull(dealHistory.completedAt),
      ),
    )
    .orderBy(asc(dealHistory.sortOrder))
    .limit(1)

  // 4. Activate next deal
  if (nextDeal) {
    await activateDeal(nextDeal)

    // 5. Precompute Emma context rails for all active rails against the
    //    newly-live deal. Non-blocking — a failure here must not leave the
    //    site without a live deal. Lazy-on-miss in the homepage loader is
    //    the safety net if this call fails.
    let liveHandle: string | null = null
    try {
      const { getDailyDeal } = await import('./shopify.server')
      const live = await getDailyDeal().catch(() => null)
      liveHandle = live?.handle ?? null
      if (liveHandle) {
        const { regenerateActiveRails } = await import('./emma-rails.server')
        const res = await regenerateActiveRails(liveHandle, 'midnight')
        console.log('[deal-rotator] emma rails precomputed:', res)
      }
    } catch (err) {
      console.error('[deal-rotator] emma rails precompute failed (non-blocking):', err)
    }

    // 6. Ping search engines for the new homepage + product URL. Inert unless
    //    SEARCH_PING_ENABLED. Non-blocking — discovery pings must never fail
    //    the rotation.
    try {
      const { pingSearchEngines } = await import('./search-ping.server')
      await pingSearchEngines(['/', ...(liveHandle ? [`/products/${liveHandle}`] : [])])
    } catch (err) {
      console.error('[deal-rotator] search ping failed (non-blocking):', err)
    }

    // 7. Precompute the full Variant A homepage payload so the indexable path
    //    never fans out at request time. Runs after regenerateActiveRails so
    //    the curated rails exist before the payload is built. force=true since
    //    the deal/content genuinely changed. Non-blocking — a failure must not
    //    leave the site without a live deal (the loader's live-assembly path is
    //    the safety net).
    try {
      const { warmHomepagePayloadA } = await import('./homepage-payload.server')
      const p = await warmHomepagePayloadA({ force: true })
      console.log(`[deal-rotator] homepage payload precomputed (rails=${p.rails.length}, sections=${p.sections.length}, degraded=${p.degraded})`)
    } catch (err) {
      console.error('[deal-rotator] homepage precompute failed (non-blocking):', err)
    }
  }

  return {
    vaulted: liveDeal?.sku ?? null,
    activated: nextDeal?.sku ?? null,
  }
}

/**
 * Check if the current live deal is sold out (all variants at 0 inventory).
 * Returns true if sold out, false otherwise.
 */
export async function isLiveDealSoldOut(): Promise<{
  soldOut: boolean
  dealId: number | null
}> {
  const [liveDeal] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1)

  if (!liveDeal?.shopifyProductId) return { soldOut: false, dealId: null }

  const numericId = liveDeal.shopifyProductId.replace('gid://shopify/Product/', '')
  const { product } = await shopifyAdmin<{
    product: { variants: { inventory_quantity: number }[] } | null
  }>(`/products/${numericId}.json?fields=variants`)

  if (!product) return { soldOut: false, dealId: liveDeal.id }

  const totalInventory = product.variants.reduce(
    (sum, v) => sum + (v.inventory_quantity ?? 0),
    0,
  )

  return { soldOut: totalInventory <= 0, dealId: liveDeal.id }
}
