/**
 * app/lib/sms-v2/context-builder.server.ts
 *
 * Builds the EmmaContext object for a v2 pipeline turn.
 *
 * Phase 1 returns a minimally-populated context:
 *   - conversation fields (from the DB row)
 *   - customer (if known from the DB row)
 *   - todaysPick (from Shopify, with a short cache)
 *
 * Later phases will populate:
 *   pitchedProduct, upsellProduct, cart, shippingEta, kb
 *
 * The Shopify call uses getDailyDeal() which carries its own KV cache in
 * shopify.server.ts.
 */
import { getDailyDeal } from '~/lib/shopify.server'
import type { EmmaContext, ProductContext, CustomerContext } from './types.server'
import type { ConversationRow } from './conversation.server'
import type { Stage } from './types.server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToConversationContext(row: ConversationRow): EmmaContext['conversation'] {
  return {
    phone: row.phone,
    conversationId: row.conversationId,
    stage: row.stage as Stage,
    currentPitchHandle: row.currentPitchHandle,
    currentUpsellHandle: row.currentUpsellHandle,
    lastQuoteUrl: row.lastQuoteUrl,
  }
}

function rowToCustomerContext(row: ConversationRow): CustomerContext | undefined {
  if (!row.customerGid && !row.customerFirstName && !row.customerDefaultZip) return undefined
  const ctx: CustomerContext = {}
  if (row.customerGid)       ctx.gid       = row.customerGid
  if (row.customerFirstName) ctx.firstName  = row.customerFirstName
  if (row.customerDefaultZip) ctx.defaultZip = row.customerDefaultZip
  return ctx
}

async function fetchTodaysPick(): Promise<ProductContext | undefined> {
  try {
    const deal = await getDailyDeal()
    if (!deal) return undefined

    // Deal type has strongly-typed fields — access directly.
    const handle = deal.handle
    if (!handle) return undefined

    const ctx: ProductContext = {
      handle,
      title: deal.seoTitle || deal.tagline || 'Emma\'s Pick',
      pdpUrl: `https://xdipx.com/products/${handle}`,
    }

    // dealPrice is a number — format as currency string
    if (deal.dealPrice) {
      ctx.price = `$${(deal.dealPrice / 100).toFixed(2)}`
    }

    // Mood image or first product image
    if (deal.moodImageUrl) {
      ctx.imageUrl = deal.moodImageUrl
    } else if (deal.images.length > 0) {
      ctx.imageUrl = deal.images[0]?.url
    }

    // tagline as description
    if (deal.tagline) {
      ctx.description = deal.tagline
    }

    // Rating if available
    if (deal.rating) {
      ctx.reviews = { rating: deal.rating.value, count: deal.rating.count }
    }

    return ctx
  } catch (err) {
    console.warn('[context-builder] fetchTodaysPick failed', err)
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the EmmaContext for a single v2 turn.
 *
 * Phase 1 populates: conversation + customer + todaysPick.
 * Later phases extend this with pitchedProduct, upsellProduct, cart, etc.
 */
export async function buildEmmaContext(conversation: ConversationRow): Promise<EmmaContext> {
  const todaysPick = await fetchTodaysPick()

  const ctx: EmmaContext = {
    conversation: rowToConversationContext(conversation),
  }

  const customer = rowToCustomerContext(conversation)
  if (customer) ctx.customer = customer
  if (todaysPick) ctx.todaysPick = todaysPick

  return ctx
}
