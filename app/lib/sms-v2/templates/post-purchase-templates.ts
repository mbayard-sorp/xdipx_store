/**
 * app/lib/sms-v2/templates/post-purchase-templates.ts
 *
 * Phase 6b — POST_PURCHASE fabrication-caught fallbacks.
 * Used when the LLM output contains $ signs, PDP URLs, or product handles
 * (i.e., it attempted a sales pitch in a support stage).
 *
 * No em-dashes. No product pitches. No $ in prose.
 * All under 480 chars.
 */

// ─── 1. Physical issue with product ─────────────────────────────────────────

export const PHYSICAL_ISSUE_FALLBACK =
  `That sounds frustrating, and I want to make sure it's sorted. Email hello@xdipx.com with your order number and a quick description of the issue. We'll get back to you same day.`

// ─── 2. Cleaning / care question ────────────────────────────────────────────

export const CLEANING_CARE_FALLBACK =
  `Great question. For cleaning: warm water and mild fragrance-free soap works for most items. Pat dry and store in a breathable bag. Check your product packaging for material-specific notes. If you're unsure, email hello@xdipx.com and we'll send the exact care guide.`

// ─── 3. Generic catch-all ────────────────────────────────────────────────────

export const GENERIC_POST_PURCHASE_FALLBACK =
  `Totally get it. Email hello@xdipx.com with your order number and I'll make sure the right person sees it today. We take care of our customers.`

// ─── Convenience array ──────────────────────────────────────────────────────

export const POST_PURCHASE_FALLBACKS = [
  PHYSICAL_ISSUE_FALLBACK,
  CLEANING_CARE_FALLBACK,
  GENERIC_POST_PURCHASE_FALLBACK,
] as const
