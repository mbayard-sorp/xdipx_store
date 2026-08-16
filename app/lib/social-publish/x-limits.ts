/**
 * X post limits and per-post cost, as pure functions.
 *
 * Separate from `x.server.ts` on purpose. The pre-publish gate needs the length
 * rule and the publish job needs the cost rule, and neither should have to pull
 * in `twitter.server.ts` (and through it the database and Shopify clients) to
 * ask how long a caption is. Everything here is pure and directly testable.
 */

/** X's post ceiling for a standard (non-Premium) account. */
export const X_CAPTION_MAX = 280

/** X accepts at most 4 images on one post. */
export const X_MEDIA_MAX = 4

/**
 * Every link on X is rewritten through t.co and billed against the character
 * count at a fixed width regardless of the real URL's length. A 90-character
 * PDP URL therefore costs 23, and a naive `caption.length` would reject posts X
 * accepts. 23 is the documented t.co length for https links.
 */
export const T_CO_LENGTH = 23

/** Matches http(s) URLs well enough to weight them; not a validator. */
const URL_RE = /https?:\/\/\S+/gi

/**
 * Caption length as X counts it, with every URL weighted at t.co width.
 *
 * Deliberately an over-estimate in one direction only: we count the URL at 23
 * even when the real URL is shorter, because being wrong toward "too long"
 * blocks a post that would have fit, while being wrong the other way ships a
 * post X rejects at publish time, after the spend is already committed.
 */
export function weightedTweetLength(caption: string): number {
  const urls = caption.match(URL_RE) ?? []
  const withoutUrls = caption.replace(URL_RE, '')
  return withoutUrls.length + urls.length * T_CO_LENGTH
}

/** Does this caption carry a link? Drives both the cost tier and the gate. */
export function captionHasLink(caption: string): boolean {
  URL_RE.lastIndex = 0
  return URL_RE.test(caption)
}

/**
 * X's pay-per-use write pricing, as of the February 2026 credit model.
 *
 * A linked post costs more than 13x a plain one, which is why this is modelled
 * at all rather than assumed flat: xdipx posts carry PDP links essentially
 * always, so the expensive tier is the normal case and a flat estimate would
 * understate real spend by an order of magnitude.
 *
 * These are the published list prices. If X changes them, this constant is the
 * one place to correct, and `estimateXPostCostUsd` is the only caller.
 */
export const X_COST_PER_POST_USD = 0.015
export const X_COST_PER_LINKED_POST_USD = 0.20

/** What one post of this caption will cost to publish. */
export function estimateXPostCostUsd(caption: string): number {
  return captionHasLink(caption) ? X_COST_PER_LINKED_POST_USD : X_COST_PER_POST_USD
}

/** What a batch of already-posted captions cost, for month-to-date spend. */
export function estimateXSpendUsd(captions: readonly string[]): number {
  return captions.reduce((sum, c) => sum + estimateXPostCostUsd(c), 0)
}
