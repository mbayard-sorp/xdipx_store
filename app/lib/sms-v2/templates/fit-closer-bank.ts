/**
 * app/lib/sms-v2/templates/fit-closer-bank.ts
 *
 * FIT-CLOSER templates for the PRESENTATION stage of the discovery engine.
 * Each closer is a pure function of FitCloserSlots that returns a ready-to-send string.
 *
 * Voice rules (from CLAUDE.md + Emma persona):
 *   - Emma is an AI guide and editorial curator: she advises how a product works and could work for the reader, and never claims to have used, tried, tested, or owned it.
 *   - Suggestive is fine, explicit is not.
 *   - Never "sex" as adjective. Use "intimate", "pleasure", "wellness", "satisfaction".
 *   - No em-dashes. Use commas, periods, or hyphens in compounds.
 *   - No countdowns, no "buy now".
 *   - PRICE MUST APPEAR MID-REPLY, never as the closing line.
 *   - Brand is "XDIPX" (pronounced "ex-dip-ex").
 */

export type FitCloserContext =
  | 'single-strong-match'
  | 'single-budget-sensitive'
  | 'two-options-ab'
  | 'gift-confident-pick'
  | 'back-and-forth-needs-nudge'
  | 'experienced-trusts-emma'
  | 'first-timer-needs-reassurance'
  | 'decisive-shopper'

export interface FitCloserSlots {
  name: string
  price: string
  pdpUrl: string
  /** For two-options variants. */
  altName?: string
  altPrice?: string
  altPdpUrl?: string
  altWhy?: string
}

export type FitCloser = (slots: FitCloserSlots) => string

export const FIT_CLOSERS: Readonly<Record<FitCloserContext, FitCloser>> = {
  /** F-01: single strong match. Price mid-reply; closes with a soft choice. */
  'single-strong-match': ({ name, price, pdpUrl }) =>
    `This one keeps coming up for exactly the kind of thing you described. ${name}: ${pdpUrl}. It's ${price}. Want me to pull up one more option, or does this feel like the one?`,

  /** F-02: single budget-sensitive match. Price mid-reply with value framing; closes with an out. */
  'single-budget-sensitive': ({ name, price, pdpUrl }) =>
    `I think this is it. ${name}: ${pdpUrl}. It's ${price}, which for what it does is genuinely good. Want to take a look, or should I find something in a different price range?`,

  /** F-03: two options, A/B choice. Both prices mid-reply; closes with a question. */
  'two-options-ab': ({ name, price, pdpUrl, altName, altPrice, altPdpUrl }) =>
    `Two that fit what you described. First is ${name} at ${price}: ${pdpUrl}. Second is ${altName} at ${altPrice}: ${altPdpUrl}. Which sounds closer?`,

  /** F-04: gift, confident pick. Price mid-reply; closes with offer to show more. */
  'gift-confident-pick': ({ name, price, pdpUrl }) =>
    `If I were buying this for the person you described, I'd land here. ${name}: ${pdpUrl}. It's ${price} and it checks the boxes you mentioned. Want to grab it, or should I show you one more?`,

  /** F-05: back-and-forth needs a nudge. Price mid-reply; closes with direct yes/no. */
  'back-and-forth-needs-nudge': ({ name, price, pdpUrl }) =>
    `Okay. Based on everything you've said, this is the one. ${name}: ${pdpUrl}. ${price}. That feel right?`,

  /** F-06: experienced customer who trusts Emma. Price mid-reply; closes with a fit question. */
  'experienced-trusts-emma': ({ name, price, pdpUrl }) =>
    `This is the one I'd pick for you. ${name}: ${pdpUrl}. ${price}. I've pointed a lot of people toward it for exactly what you described. Want it?`,

  /** F-07: first-timer needs reassurance. Reframes "basic" positively; price mid-reply; closes with soft CTA. */
  'first-timer-needs-reassurance': ({ name, price, pdpUrl }) =>
    `Given what you told me, this one makes sense as a starting point, not because it's basic, but because it's going to feel really good without being overwhelming. ${name}: ${pdpUrl}. It's ${price}. Want to grab it?`,

  /** F-08: decisive shopper. Short. Price mid-reply; closes with the simplest possible ask. */
  'decisive-shopper': ({ name, price, pdpUrl }) =>
    `Here's my pick for you: ${name}, ${pdpUrl}. ${price}. Want it?`,
}

/**
 * Return the FitCloser function for the given context.
 * Callers invoke the returned function with their FitCloserSlots to get the final string.
 */
export function pickFitCloser(ctx: FitCloserContext): FitCloser {
  return FIT_CLOSERS[ctx]
}
