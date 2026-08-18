/**
 * app/lib/sms-v2/stages/_product-context.server.ts
 *
 * Private util for Phase 4 PRESENTATION stage.
 * Fetches product details from Shopify and shapes them into ProductContext.
 *
 * Later phases (2 CHECKOUT, 3 UPSELL, 5 DISCOVERY) may import this util.
 *
 * Phase 6d addition: exports `enrichWithMfgSpecs(productCtx)` which additively
 * populates `productCtx.manufacturerSpecs` from the Sanity mfgProductSpecs doc.
 * Callers opt in — the existing `fetchProductContext` function is unchanged.
 */
import { getProductByHandle } from '~/lib/shopify.server'
import { getMfgSpecs } from '~/lib/mfg-specs/sync.server'
import type { ProductContext } from '../types.server'

/**
 * Fetch a Shopify product by handle and map to ProductContext.
 *
 * Returns null if the handle doesn't resolve to a real product.
 * Degrades gracefully when reviews or description are absent (logs a warning
 * but does not throw — spec gap noted).
 */
export async function fetchProductContext(handle: string): Promise<ProductContext | null> {
  const product = await getProductByHandle(handle)
  if (!product) return null

  const ctx: ProductContext = {
    handle,
    title:  product.seoTitle || product.title,
    pdpUrl: `https://xdipx.com/products/${handle}`,
    // Real stock, sourced from Shopify variant availability at hydration time
    // (ticket #3542). This is the value the web adapter and research stage read
    // instead of the old hardcoded `true`.
    inStock: product.variants.some(v => v.availableForSale),
  }

  // Price — variants[0].price is a string like "49.99"
  const variantPrice = product.variants[0]?.price
  if (variantPrice != null) {
    const num = Number(variantPrice)
    if (!Number.isNaN(num)) {
      ctx.price = `$${num.toFixed(2)}`
    }
  } else if (product.price != null) {
    ctx.price = `$${(product.price).toFixed(2)}`
  }

  // Image — prefer moodImageUrl on the Deal type, else first product image
  const anyProduct = product as typeof product & { moodImageUrl?: string }
  if (anyProduct.moodImageUrl) {
    ctx.imageUrl = anyProduct.moodImageUrl
  } else if (product.images.length > 0) {
    ctx.imageUrl = product.images[0]?.url
  }

  // Description — tagline from the Deal/metafield or native description
  const anyDeal = product as typeof product & { tagline?: string; description?: string }
  if (anyDeal.tagline) {
    ctx.description = anyDeal.tagline
  } else if (anyDeal.description) {
    ctx.description = (anyDeal.description as string).replace(/<[^>]+>/g, ' ').slice(0, 300)
  }

  // Reviews — populated by Judge.me integration when available
  if (product.rating) {
    ctx.reviews = {
      rating: product.rating.value,
      count:  product.rating.count,
    }
  } else {
    // Spec gap: Judge.me integration not yet available for most products.
    // Degrades gracefully — omit reviews slot rather than fabricating.
  }

  return ctx
}

/**
 * Phase 6d — Additively enrich a ProductContext with structured manufacturer
 * specs fetched from the Sanity `mfgProductSpecs` doc by handle.
 *
 * Mutates `productCtx.manufacturerSpecs` in place. Degrades gracefully when
 * Sanity is unconfigured or no doc exists — never throws.
 *
 * Stage handlers call this after `fetchProductContext` to opt in:
 *   const ctx = await fetchProductContext(handle)
 *   if (ctx) await enrichWithMfgSpecs(ctx)
 *
 * Orchestrator wires the call site at integration time.
 */
export async function enrichWithMfgSpecs(productCtx: ProductContext): Promise<void> {
  try {
    const specs = await getMfgSpecs(productCtx.handle)
    if (specs && Object.keys(specs).length > 0) {
      productCtx.manufacturerSpecs = specs
    }
  } catch (err) {
    // Best-effort — never block the stage handler.
    console.warn('[_product-context] enrichWithMfgSpecs error:', err instanceof Error ? err.message : err)
  }
}
