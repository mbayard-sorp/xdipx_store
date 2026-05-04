/**
 * app/lib/sms-v2/templates/checkout-templates.ts
 *
 * Pure-function SMS reply templates for the CHECKOUT stage.
 * No state, no async, no LLM calls.
 *
 * NOTE (Phase 6a): `acceptTemplate` and `commitTemplate` are no longer the
 * source of truth for the checkout closing line. The closing line is now
 * admin-editable via /admin/voice-and-sms (pipelineSettings key
 * `smsCheckoutClosing`); see `app/lib/sms-v2/sms-config.server.ts` and the
 * resolution in `stages/checkout.server.ts`. The variant arrays below are
 * left in place (no behavioral references) so the file isn't disruptive
 * to read in a single PR — they may be removed in a Phase 6b cleanup once
 * we're sure no one wants to reintroduce variant rotation.
 *
 * `discoveryFallbackTemplate` IS still live — used when CHECKOUT is
 * entered without a pitch handle.
 *
 * Variant selection: index into the array using Math.floor(Math.random() * N).
 * Math.random() is fine here — this is cosmetic variety, not crypto.
 *
 * Voice rules (from CLAUDE.md):
 *   - No "buy now" / "buy" language
 *   - No em-dashes (use periods/commas; hyphens in compounds are fine)
 *   - No countdown language
 *   - "♥" motif allowed
 *   - Brand is XDIPX, billing descriptor reads "XDIPX"
 */

export interface CheckoutSlots {
  url: string
}

// ---------------------------------------------------------------------------
// UPSELL_ACCEPT — both items in the cart
// ---------------------------------------------------------------------------

const ACCEPT_TEMPLATES: ReadonlyArray<(s: CheckoutSlots) => string> = [
  ({ url }) => `Both in. Here's your checkout: ${url} ♥`,
  ({ url }) => `Locked in. Take a peek: ${url}`,
  ({ url }) => `Got 'em both queued up. ${url}`,
]

// ---------------------------------------------------------------------------
// UPSELL_DECLINE / COMMIT_PICK — main item only
// ---------------------------------------------------------------------------

const COMMIT_TEMPLATES: ReadonlyArray<(s: CheckoutSlots) => string> = [
  ({ url }) => `Coming right up: ${url}`,
  ({ url }) => `Done. Here you go: ${url} ♥`,
  ({ url }) => `On its way. Tap here to finish: ${url}`,
]

// ---------------------------------------------------------------------------
// DISCOVERY fallback — lost the pitch handle
// ---------------------------------------------------------------------------

const DISCOVERY_FALLBACK_TEMPLATES: ReadonlyArray<() => string> = [
  () => `Hmm, lost the thread. What were you eyeing? Tell me what kind of vibe and I'll find the right fit.`,
]

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

function pick<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

export function acceptTemplate(slots: CheckoutSlots): string {
  return pick(ACCEPT_TEMPLATES)(slots)
}

export function commitTemplate(slots: CheckoutSlots): string {
  return pick(COMMIT_TEMPLATES)(slots)
}

export function discoveryFallbackTemplate(): string {
  return pick(DISCOVERY_FALLBACK_TEMPLATES)()
}
