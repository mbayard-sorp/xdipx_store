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
import { dealHistory, pipelineSettings } from '../../db/schema'
import { eq, and, isNull, asc } from 'drizzle-orm'
import {
  setDealStatus,
  activateShopifyProduct,
  updateVariantPricing,
  updateProductMetafield,
  shopifyAdmin,
} from './shopify.server'
import { triggerDailyDealEmail } from './klaviyo.server'
import { kvSet, KV_KEYS } from './kv.server'

/** Returns YYYY-MM-DD in America/New_York. */
function estDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
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
  },
): Promise<void> {
  if (!deal.shopifyProductId) return

  const pct = await getVaultDiscountPct()
  const msrp = parseFloat(deal.msrp ?? '0')

  // Use manually set vault price, or calculate from MSRP * (1 - pct/100)
  let vaultPrice = deal.vaultPrice ? parseFloat(deal.vaultPrice) : 0
  if (!vaultPrice && msrp > 0) {
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

  // Update DB — mark completed, store calculated vault price
  await db
    .update(dealHistory)
    .set({
      status: 'queued',
      completedAt: new Date(),
      vaultPrice: vaultPrice > 0 ? vaultPrice.toFixed(2) : null,
    })
    .where(and(eq(dealHistory.id, deal.id), eq(dealHistory.status, 'live')))
}

/**
 * Activate a deal — publish product, set live status, update KV, trigger email.
 */
export async function activateDeal(
  deal: {
    id: number
    shopifyProductId: string | null
    sku: string
    seoTitle: string | null
    dealPrice: string | null
    msrp: string | null
  },
): Promise<void> {
  if (!deal.shopifyProductId) return

  // Ensure product is published (not draft)
  const numericId = deal.shopifyProductId.replace('gid://shopify/Product/', '')
  await activateShopifyProduct(numericId)

  // Set live status in Shopify
  await setDealStatus(deal.shopifyProductId, 'live')

  // Update DB
  await db
    .update(dealHistory)
    .set({
      status: 'live',
      activatedAt: new Date(),
      dealDate: estDate(0),
    })
    .where(eq(dealHistory.id, deal.id))

  // Cache for fast KV reads
  await kvSet(KV_KEYS.dealOfDay, {
    sku: deal.sku,
    title: deal.seoTitle,
    date: estDate(0),
  })

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
