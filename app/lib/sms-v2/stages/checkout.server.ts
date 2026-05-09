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
import { getProductByHandle, createCartWithLines, addLinesToCart } from '~/lib/shopify.server'
import { resolveTransition } from '../transitions.server'
import { discoveryFallbackTemplate } from '../templates/checkout-templates'
import { getSmsConfig, fillCheckoutClosing, SMS_DEFAULTS } from '../sms-config.server'
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
// Variant resolution
//
// For single-variant products: pick the first in-stock variant (current
// behavior — straightforward).
//
// For multi-variant products (sizes, colors): match the customer's text
// against variant titles. If we can't find a confident match AND the
// product has more than one variant, throw VariantPickRequiredError so
// the caller can prompt for an explicit choice instead of silently
// adding the wrong size to the cart.
// ---------------------------------------------------------------------------

class VariantPickRequiredError extends Error {
  constructor(
    public readonly handle: string,
    public readonly productTitle: string,
    public readonly availableVariants: ReadonlyArray<{ title: string; inStock: boolean }>,
  ) {
    super(`variant_pick_required: ${handle}`)
    this.name = 'VariantPickRequiredError'
  }
}

/**
 * Best-effort match of a customer message to a variant title.
 * Strategy:
 *   1. Lowercase both.
 *   2. Try the longest variant title that appears as a substring (catches
 *      "L/XL" inside "I'll take it L/XL" or "the m/l one").
 *   3. Fall back to a size-keyword map (small→S, medium→M, large→L, xl→X-Large)
 *      if the customer used a word the variant title doesn't literally contain.
 *
 * Returns null on no confident match — caller decides whether to ask.
 */
function matchVariantToText(
  customerText: string,
  variants: ReadonlyArray<{ id: string; title: string; availableForSale: boolean }>,
): { id: string; title: string } | null {
  const text = customerText.toLowerCase().trim()
  if (!text) return null

  // Step 1: longest-substring match against variant titles.
  const matches = variants
    .filter((v) => v.availableForSale)
    .map((v) => ({ ...v, lower: v.title.toLowerCase() }))
    .filter((v) => v.lower && text.includes(v.lower))
    .sort((a, b) => b.lower.length - a.lower.length)
  if (matches.length > 0) {
    const m = matches[0]!
    return { id: m.id, title: m.title }
  }

  // Step 2: size-keyword fallback. Map common size words to single-letter
  // tokens, then look for variant titles containing that letter as a token.
  // Conservative: only when the customer's message is short (≤ ~5 words),
  // so we don't accidentally match "large" inside "I have a large dog".
  const wordCount = text.split(/\s+/).filter(Boolean).length
  if (wordCount > 6) return null

  const sizeMap: Array<{ keyword: RegExp; letter: string }> = [
    { keyword: /\b(extra\s*small|x-?small|xs)\b/, letter: 'xs' },
    { keyword: /\b(small|sm)\b/, letter: 's' },
    { keyword: /\b(medium|med)\b/, letter: 'm' },
    { keyword: /\b(large|lrg|lg)\b/, letter: 'l' },
    { keyword: /\b(extra\s*large|x-?large|xl)\b/, letter: 'xl' },
    { keyword: /\b(xxl|2xl|2x)\b/, letter: 'xxl' },
  ]
  for (const { keyword, letter } of sizeMap) {
    if (!keyword.test(text)) continue
    // Find a variant whose title contains this letter as a token segment.
    // For "L/XL" with letter "l": split on /, |, space → tokens contain "l" → match.
    // For "L/XL" with letter "xl": tokens contain "xl" → match.
    const variantMatch = variants
      .filter((v) => v.availableForSale)
      .find((v) => {
        const tokens = v.title.toLowerCase().split(/[\s/\\|,-]+/)
        return tokens.includes(letter)
      })
    if (variantMatch) return { id: variantMatch.id, title: variantMatch.title }
  }

  return null
}

async function resolveVariantId(handle: string, customerText: string): Promise<string> {
  const product = await getProductByHandle(handle)
  if (!product || product.variants.length === 0) {
    throw new Error(`checkout_stage: no variants for handle "${handle}"`)
  }

  // Single-variant product → current behavior, no customer disambiguation needed.
  if (product.variants.length === 1) {
    const chosen = product.variants[0]
    if (!chosen?.id || !/gid:\/\/shopify\/ProductVariant\/\d+/.test(chosen.id)) {
      throw new Error(`checkout_stage: could not resolve valid variant GID for handle "${handle}"`)
    }
    return chosen.id
  }

  // Multi-variant product → try to match the customer's text against variant titles.
  const matched = matchVariantToText(customerText, product.variants)
  if (matched) {
    if (!/gid:\/\/shopify\/ProductVariant\/\d+/.test(matched.id)) {
      throw new Error(`checkout_stage: variant match returned invalid GID for handle "${handle}"`)
    }
    return matched.id
  }

  // No match → ask the customer to pick. Throw a typed error the caller catches.
  throw new VariantPickRequiredError(
    handle,
    product.title,
    product.variants.map((v) => ({ title: v.title, inStock: v.availableForSale })),
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function executeCheckoutStage(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
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
  // Web channel UX differs from SMS: instead of minting a fresh checkout cart
  // and pasting the URL into chat prose, we add to the SHOPPER'S existing
  // cart cookie when one is present. The chat widget then dispatches the
  // cart-drawer event and the cart slides open with the new line items.
  const isWeb = ctx.channel === 'web'
  const existingCartId = ctx.cart?.cartId

  try {
    const lines = await Promise.all(
      handlesToAdd.map(async (handle) => ({
        variantId: await resolveVariantId(handle, customerText),
        quantity: 1,
      })),
    )
    if (isWeb && existingCartId) {
      const cart = await addLinesToCart(existingCartId, lines)
      cartUrl = cart.checkoutUrl
    } else {
      const cart = await createCartWithLines(lines)
      cartUrl = cart.checkoutUrl
    }

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
    // Variant disambiguation needed — the customer's message didn't match
    // any variant title and the product has multiple. Surface the options
    // and stay in PRESENTATION (NOT POST_CHECKOUT) so their next reply is
    // treated as the variant pick.
    if (err instanceof VariantPickRequiredError) {
      const inStock = err.availableVariants.filter((v) => v.inStock)
      const variantList = (inStock.length > 0 ? inStock : err.availableVariants)
        .map((v) => `'${v.title}'`)
        .join(', ')
      console.warn(
        `[checkout_stage] variant pick required — asking customer`,
        { handle: err.handle, productTitle: err.productTitle, phone: ctx.conversation.phone, customerText },
      )
      return {
        stageOut: resolveTransition(currentStage, 'PRESENTATION'),
        goalAchieved: false,
        segments: [
          {
            prose:
              `Quick check — ${err.productTitle} comes in ${variantList}. Reply with the one you want and I'll get the cart link ready.`,
          },
        ],
        stateWrites: {
          // Stay on the same pitch handle; let the customer's next message be
          // the variant pick.
          stage: 'PRESENTATION',
        },
        telemetry: {
          intent: intent.intent,
          intentConfidence: intent.confidence,
          fabricationCaught: undefined,
        },
      }
    }

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
  // Web: items are now in the existing cart cookie; the chat widget receives
  // cartUpdated:true (driven by the segment's checkout cta below) and slides
  // the cart drawer open. Don't paste the cart URL — it's redundant clutter
  // and the user has the drawer.
  // SMS/voice: honor the admin-editable closing line ({url} slot substituted
  // server-side). Fallback to SMS_DEFAULTS on Neon hiccup so a paying customer
  // can't get stranded mid-cart.
  let prose: string
  if (isWeb) {
    prose =
      handlesToAdd.length > 1
        ? "Both in your cart — peek the drawer ♥"
        : "Added to your cart ♥"
  } else {
    let closing = SMS_DEFAULTS.checkoutClosing
    try {
      const smsCfg = await getSmsConfig()
      closing = smsCfg.checkoutClosing
    } catch (err) {
      console.error('[checkout_stage] sms config load failed — using default checkout closing', err)
    }
    prose = fillCheckoutClosing(closing, cartUrl)
  }

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
