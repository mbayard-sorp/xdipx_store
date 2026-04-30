/**
 * app/lib/sms-v2/stages/checkout.server.ts
 *
 * Phase 2 — CHECKOUT stage handler.
 *
 * Deterministic, no LLM. Builds a Shopify cart from the handles stored in
 * the conversation context, composes a templated reply with the checkout URL,
 * and transitions to POST_CHECKOUT.
 *
 * Behavior matrix:
 *
 *   UPSELL_ACCEPT   → cart: pitch + upsell handles  → POST_CHECKOUT
 *   UPSELL_DECLINE  → cart: pitch handle only        → POST_CHECKOUT
 *   COMMIT_PICK     → cart: pitch handle only        → POST_CHECKOUT
 *   anything else   → no cart, DISCOVERY fallback
 *
 * If currentPitchHandle is null/empty → DISCOVERY fallback + console.warn.
 */
import { getProductByHandle, createCartWithLines } from '~/lib/shopify.server'
import { resolveTransition } from '../transitions.server'
import {
  acceptTemplate,
  commitTemplate,
  discoveryFallbackTemplate,
} from '../templates/checkout-templates'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

// ---------------------------------------------------------------------------
// Validate that a URL looks like a real Shopify checkout URL.
// The fabricated-URL validator in v1 is the belt — this is the suspenders.
// ---------------------------------------------------------------------------

const XDIPX_CHECKOUT_RE = /https?:\/\/(?:xdipx\.com|[\w-]+\.myshopify\.com)\//i

function looksLikeRealCheckoutUrl(url: string): boolean {
  return XDIPX_CHECKOUT_RE.test(url) && (url.includes('/cart/') || url.includes('/checkouts'))
}

// ---------------------------------------------------------------------------
// Resolve a product handle → first in-stock variant GID
// ---------------------------------------------------------------------------

async function resolveVariantId(handle: string): Promise<string> {
  const product = await getProductByHandle(handle)
  if (!product || product.variants.length === 0) {
    throw new Error(`checkout_stage: no variants for handle "${handle}"`)
  }
  const chosen = product.variants.find((v) => v.availableForSale) ?? product.variants[0]
  if (!chosen?.id || !/gid:\/\/shopify\/ProductVariant\/\d+/.test(chosen.id)) {
    throw new Error(`checkout_stage: could not resolve valid variant GID for handle "${handle}"`)
  }
  return chosen.id
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function executeCheckoutStage(
  ctx: EmmaContext,
  intent: IntentResult,
  _customerText: string,  // unused — kept for signature consistency
): Promise<StageResponse> {
  const pitchHandle    = ctx.conversation.currentPitchHandle
  const upsellHandle   = ctx.conversation.currentUpsellHandle
  const currentStage   = ctx.conversation.stage

  // --- Illegal-transition fallback: no pitch handle ---
  if (!pitchHandle) {
    console.warn(
      `[checkout_stage] currentPitchHandle is null/empty — returning DISCOVERY fallback`,
      { phone: ctx.conversation.phone, intent: intent.intent },
    )
    return {
      stageOut: resolveTransition(currentStage, 'DISCOVERY'),
      goalAchieved: false,
      segments: [
        {
          prose: discoveryFallbackTemplate(),
        },
      ],
      stateWrites: {
        stage: 'DISCOVERY',
      },
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        fabricationCaught: undefined,
      },
    }
  }

  // --- Handle non-purchase intents: illegal-transition fallback → DISCOVERY ---
  if (
    intent.intent !== 'UPSELL_ACCEPT' &&
    intent.intent !== 'UPSELL_DECLINE' &&
    intent.intent !== 'COMMIT_PICK'
  ) {
    console.warn(
      `[checkout_stage] unexpected intent "${intent.intent}" in CHECKOUT stage — falling back to DISCOVERY`,
      { phone: ctx.conversation.phone },
    )
    return {
      stageOut: resolveTransition(currentStage, 'DISCOVERY'),
      goalAchieved: false,
      segments: [
        {
          prose: `Let me know what you're looking for and I'll find the right fit.`,
        },
      ],
      stateWrites: {
        stage: 'DISCOVERY',
      },
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        fabricationCaught: undefined,
      },
    }
  }

  // --- Build cart ---
  const handlesToAdd: string[] =
    intent.intent === 'UPSELL_ACCEPT' && upsellHandle
      ? [pitchHandle, upsellHandle]
      : [pitchHandle]

  // Resolve variant IDs from handles — catches deleted/unavailable products
  let cartUrl: string
  let cartItems: Array<{ handle: string; quantity: number }>
  let fabricationNote: string | undefined

  try {
    const lines = await Promise.all(
      handlesToAdd.map(async (handle) => ({
        variantId: await resolveVariantId(handle),
        quantity: 1,
      })),
    )
    const cart = await createCartWithLines(lines)
    cartUrl = cart.checkoutUrl

    // Fabrication safety check — if the URL doesn't look real, log loudly.
    // This should never fire in production if Shopify returns a real cart.
    if (!looksLikeRealCheckoutUrl(cartUrl)) {
      console.error(
        `[checkout_stage] FABRICATION GUARD: Shopify returned a suspicious checkout URL`,
        { cartUrl, phone: ctx.conversation.phone, handles: handlesToAdd },
      )
      fabricationNote = `suspicious_url: ${cartUrl}`
    }

    cartItems = handlesToAdd.map((handle) => ({ handle, quantity: 1 }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[checkout_stage] cart create failed — falling back to DISCOVERY`, { msg, phone: ctx.conversation.phone })
    return {
      stageOut: resolveTransition(currentStage, 'DISCOVERY'),
      goalAchieved: false,
      segments: [
        {
          prose: `Something went sideways on my end. Tell me what you were looking at and I'll sort it out.`,
        },
      ],
      stateWrites: {
        stage: 'DISCOVERY',
      },
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        fabricationCaught: `cart_error: ${msg}`,
      },
    }
  }

  // --- Compose reply ---
  const prose =
    intent.intent === 'UPSELL_ACCEPT'
      ? acceptTemplate({ url: cartUrl })
      : commitTemplate({ url: cartUrl })

  // --- State writes ---
  const stateWrites = {
    stage: resolveTransition(currentStage, 'POST_CHECKOUT') as typeof currentStage,
    currentPitchHandle:  null as null,
    currentUpsellHandle: null as null,
    lastQuoteUrl:        cartUrl,
    lastQuoteItems:      cartItems,
    lastQuoteCreatedAt:  new Date(),
  }

  return {
    stageOut: 'POST_CHECKOUT',
    goalAchieved: true,
    segments: [
      {
        prose,
        cta: { kind: 'checkout', url: cartUrl },
      },
    ],
    stateWrites,
    telemetry: {
      intent: intent.intent,
      intentConfidence: intent.confidence,
      fabricationCaught: fabricationNote,
    },
  }
}
