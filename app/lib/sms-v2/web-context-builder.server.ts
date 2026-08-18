/**
 * app/lib/sms-v2/web-context-builder.server.ts
 *
 * Sibling to context-builder.server.ts for the web chat pipeline.
 *
 * Delegates to the existing buildEmmaContext() for the base context
 * (todaysPick, customer) then layers in web-specific fields:
 *   - pageContext from the request (handle + route)
 *   - cart from the cartId cookie if present
 *
 * We do NOT modify context-builder.server.ts (it is a locked file).
 * EmmaContext.conversation.phone is required by the type — we use a sentinel
 * value 'web:<sessionId>' so turn-logger and stage handlers can distinguish
 * web turns from SMS turns without touching locked types.server.ts.
 */
import { buildEmmaContext } from './context-builder.server'
import type { EmmaContext, CartContext } from './types.server'
import type { WebConversationRow } from './web-conversation.server'
import type { ConversationRow } from './conversation.server'

// ---------------------------------------------------------------------------
// Adapt a WebConversationRow into the ConversationRow shape that
// buildEmmaContext expects (duck-typing — same fields, different PK).
// ---------------------------------------------------------------------------

function webRowToConversationRow(webRow: WebConversationRow): ConversationRow {
  return {
    // Use a sentinel phone so the existing context-builder.server.ts works
    // without modification. Web turn-logger uses sessionId as the real key.
    phone: `web:${webRow.sessionId}`,
    conversationId: webRow.conversationId,
    stage: webRow.stage,
    currentPitchHandle: webRow.currentPitchHandle,
    currentUpsellHandle: webRow.currentUpsellHandle,
    lastQuoteUrl: webRow.lastQuoteUrl,
    lastQuoteItems: webRow.lastQuoteItems,
    lastQuoteCreatedAt: webRow.lastQuoteCreatedAt,
    customerGid: webRow.customerGid,
    customerFirstName: webRow.customerFirstName,
    customerDefaultZip: webRow.customerDefaultZip,
    stageSetAt: webRow.stageSetAt,
    lastActiveAt: webRow.lastActiveAt,
    // Pass through discovery gate fields so context-builder populates them.
    discoveryState: webRow.discoveryState ?? null,
    discoveredSlots: webRow.discoveredSlots ?? {},
    // Voice-only field — web doesn't currently set it but the type requires
    // it. Default null is harmless on web; the voice adapter is the only
    // caller that reads or writes pendingPdpUrl today.
    pendingPdpUrl: webRow.pendingPdpUrl ?? null,
    // Migration 032: memory primitive fields — present on web_conversations
    // after migration 032. Default null before the first summarizer run.
    conversationSummary: webRow.conversationSummary ?? null,
    pitchedHandlesLog: webRow.pitchedHandlesLog ?? null,
  }
}

// ---------------------------------------------------------------------------
// Web-specific input fields
// ---------------------------------------------------------------------------

export interface WebContextExtras {
  pageContext?: { handle?: string; collection?: string; route?: string }
  cartId?: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an EmmaContext for a web chat turn.
 *
 * Delegates to buildEmmaContext() for the base fields (todaysPick, customer),
 * then layers in pageContext and cart from the web request inputs.
 *
 * The returned context has conversation.phone = 'web:<sessionId>' as a
 * sentinel — stage handlers must not use this as a real phone number.
 */
export async function buildWebEmmaContext(
  webConv: WebConversationRow,
  extras: WebContextExtras,
): Promise<EmmaContext> {
  // Build the base context via the locked builder.
  const baseRow = webRowToConversationRow(webConv)
  const ctx = await buildEmmaContext(baseRow)
  ctx.channel = 'web'

  // Thread pageHandle into conversation context so the agent can surface the
  // page-context line in <known_about_customer> even on a cold PDP visit where
  // currentPitchHandle has not been set yet (C-01h fix).
  // Prefer the live request's pageContext.handle over the stored DB value so
  // navigating to a new PDP mid-session is reflected immediately.
  const resolvedPageHandle = extras.pageContext?.handle ?? webConv.pageHandle ?? null
  if (resolvedPageHandle) {
    ctx.conversation.pageHandle = resolvedPageHandle
  }

  // Layer in page context: if we have a page handle, set it as the pitch
  // product context hint so RESEARCH/DISCOVERY can use it.
  if (extras.pageContext?.handle && !ctx.pitchedProduct) {
    // We don't fetch full product details here — the stage handler can do that
    // if it needs specs. We just surface the handle so the handler knows the
    // page the user is on.
    ctx.pitchedProduct = {
      handle: extras.pageContext.handle,
      title: extras.pageContext.handle,  // Stage handler will enrich if needed.
      pdpUrl: `https://xdipx.com/products/${extras.pageContext.handle}`,
      // Page-context hint only: product details are not fetched here, so stock is
      // unverified. Conservatively false — the stage handler re-hydrates via
      // fetchProductContext (real inStock) before presenting (ticket #3542).
      inStock: false,
    }
  }

  // Layer in cart context if a cartId is available.
  if (extras.cartId) {
    const cartCtx: CartContext = {
      cartId: extras.cartId,
      items: [],  // Stage handler can fetch full cart if needed.
    }
    ctx.cart = cartCtx
  }

  return ctx
}
