/**
 * app/lib/sms-v2/templates/discovery-spin-bank.ts
 *
 * SPIN-style qualifying questions for the DISCOVERY stage.
 * LLM picks ONE question per turn by id. Server renders the prose.
 *
 * Voice rules (from CLAUDE.md + Emma persona):
 *   - Emma is a trusted friend who tests everything she recommends.
 *   - Suggestive is fine, explicit is not.
 *   - Never "sex" as adjective. Use "intimate", "pleasure", "wellness", "satisfaction".
 *   - No em-dashes. Use commas, periods, or hyphens in compounds.
 *   - No countdowns, no "buy now".
 *   - Brand is "XDIPX" (pronounced "ex-dip-ex").
 */

export type SpinDimension = 'situation' | 'problem' | 'implication' | 'need_payoff'

export interface SpinQuestion {
  id: string
  dimension: SpinDimension
  /** Renders the final prose string. Slots are optional — use graceful fallbacks. */
  prose: (slots: { firstName?: string | undefined; todaysPickTitle?: string | undefined }) => string
  /**
   * Signals this question covers. When customer answers reveal these signals,
   * the readiness check (Phase 6+) can mark this dimension satisfied.
   */
  signalsCovered: ReadonlyArray<string>
}

export const SPIN_BANK: ReadonlyArray<SpinQuestion> = [
  // ─── SITUATION ──────────────────────────────────────────────────────────────
  {
    id: 'situation_solo_or_partner',
    dimension: 'situation',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, what's the vibe, solo adventure, with a partner, or either works?`
        : `Quick one: solo adventure, with a partner, or either works?`,
    signalsCovered: ['audience', 'use_case'],
  },
  {
    id: 'situation_first_time',
    dimension: 'situation',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, is this your first time exploring this stuff, or have you been around the block a bit?`
        : `Is this your first time exploring this kind of thing, or have you dabbled before?`,
    signalsCovered: ['experience_level'],
  },
  {
    id: 'situation_occasion',
    dimension: 'situation',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, what's the occasion? Date night, treating yourself, or just because?`
        : `What's the occasion? Date night, treating yourself, or just because?`,
    signalsCovered: ['occasion', 'use_case'],
  },
  {
    id: 'situation_gifting',
    dimension: 'situation',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, is this for you or are you shopping for someone special?`
        : `Is this for you, or are you shopping for someone special?`,
    signalsCovered: ['audience', 'gifting'],
  },
  {
    id: 'situation_new_or_returning',
    dimension: 'situation',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, have you tried anything from us before, or are you just getting started with XDIPX?`
        : `Have you tried anything from us before, or are you just getting started with XDIPX?`,
    signalsCovered: ['returning_customer'],
  },

  // ─── PROBLEM ────────────────────────────────────────────────────────────────
  {
    id: 'problem_whats_missing',
    dimension: 'problem',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, what's missing from whatever you've tried before? Or is this totally new territory?`
        : `What's missing from whatever you've tried before? Or is this totally new territory for you?`,
    signalsCovered: ['gap', 'experience_level'],
  },
  {
    id: 'problem_not_loving_current',
    dimension: 'problem',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, anything specific about what you have now that isn't quite landing?`
        : `Anything specific about what you currently have that isn't quite landing?`,
    signalsCovered: ['gap', 'dissatisfaction'],
  },
  {
    id: 'problem_intensity_preference',
    dimension: 'problem',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, do you lean toward gentle and buildy, or do you want something that doesn't hold back?`
        : `Do you lean toward gentle and buildy, or do you want something that doesn't hold back?`,
    signalsCovered: ['intensity', 'sensation_preference'],
  },
  {
    id: 'problem_practical_constraint',
    dimension: 'problem',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, any practical things I should know? Like quiet is important, or it needs to be travel-friendly?`
        : `Any practical things I should know? Quiet is a must, needs to be travel-friendly, anything like that?`,
    signalsCovered: ['practical_constraint', 'features'],
  },

  // ─── IMPLICATION ────────────────────────────────────────────────────────────
  {
    id: 'implication_what_changes',
    dimension: 'implication',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, if we get this right for you, what does that look like? More "finally" or more "let's see"?`
        : `If we get this right for you, what does that look like? More "finally" or more "let's see"?`,
    signalsCovered: ['motivation', 'urgency'],
  },
  {
    id: 'implication_keep_going_back',
    dimension: 'implication',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, what's the part of an experience that makes you want to go back to it?`
        : `What's the part of an experience that makes you want to go back to it?`,
    signalsCovered: ['motivation', 'sensation_preference'],
  },
  {
    id: 'implication_partner_dynamic',
    dimension: 'implication',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, when you're picking something to share with a partner, is it more about adding novelty or deepening what you already have?`
        : `When you're picking something to share with a partner, is it more about adding novelty or deepening what you already have?`,
    signalsCovered: ['audience', 'motivation', 'use_case'],
  },

  // ─── NEED PAYOFF ────────────────────────────────────────────────────────────
  {
    id: 'need_payoff_confirm_combo',
    dimension: 'need_payoff',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, so if I pointed you at something that was beginner-friendly, quiet, and easy to get started with, that's the move?`
        : `So if I pointed you at something that was beginner-friendly, quiet, and easy to get started with, that's the move?`,
    signalsCovered: ['experience_level', 'features', 'confirmation'],
  },
  {
    id: 'need_payoff_ready_to_see',
    dimension: 'need_payoff',
    prose: ({ firstName, todaysPickTitle }) => {
      const pickRef = todaysPickTitle ? ` (today I'm loving ${todaysPickTitle})` : ''
      return firstName
        ? `${firstName}, want me to point you at something that fits what you just described${pickRef}?`
        : `Want me to point you at something that fits what you just described${pickRef}?`
    },
    signalsCovered: ['confirmation', 'purchase_intent'],
  },
  {
    id: 'need_payoff_couple_features',
    dimension: 'need_payoff',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, last thing: any features that are a dealbreaker for you? Rechargeable, app-controlled, waterproof, any of those matter?`
        : `Last thing: any features that are a dealbreaker for you? Rechargeable, app-controlled, waterproof, anything like that?`,
    signalsCovered: ['features', 'confirmation'],
  },
  {
    id: 'need_payoff_budget_check',
    dimension: 'need_payoff',
    prose: ({ firstName }) =>
      firstName
        ? `${firstName}, rough budget in mind, or are you more of a "show me what's worth it" kind of shopper?`
        : `Any rough budget in mind, or are you more of a "show me what's worth it" kind of shopper?`,
    signalsCovered: ['budget', 'confirmation'],
  },
] as const
