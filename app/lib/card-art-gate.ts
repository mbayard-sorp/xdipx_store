/**
 * The card-art doctrine gate, as a pure function the discovery index can call
 * (ticket #9675 originally; this file exists because of run 2212's finding).
 *
 * `gateCardImages()` in `app/lib/shopify.server.ts` has enforced
 * design-doctrine.md §4.3's on-site imagery ceiling since #9675: once
 * `xdipx.card_art_blocked` is set on a product, its default Shopify image must
 * never render as card art, because card art is the one on-site surface where a
 * supplier packshot goes live with no human review step. The frames that ticket
 * was filed for were a sheer harness with nipples visible through it and a
 * depicted bondage scene, both of which a merchandising run could pick into a
 * rail without anyone seeing them first.
 *
 * That gate's own comment claims the flagged packshot "can never resurface as
 * card art from any caller." It cannot, from any caller that goes through
 * `nodeToProduct()`. The discovery index does not: `nodeToDiscoveryProduct()`
 * and `fetchHonoraryProducts()` both read `featuredImage` straight off the
 * Admin API node, and that index is what populates the homepage hero
 * (`featured[0]`), every homepage rail, and `/discover`. A gate placed at "the
 * single conversion point" of one data path cannot see a second data path
 * serving the same pixels, which is ticket #1450's wrapper-bypass lesson and
 * ticket #22810's one-of-two-siblings lesson, one level up.
 *
 * Pure and framework-free on purpose: it takes the two metafield values and the
 * frame, and returns the frame that is allowed to render. No Shopify client, no
 * `.server` suffix needed (same shape as `app/lib/product-shelf.ts`), so both
 * data paths and a unit test can call the identical code rather than two
 * implementations that agree today.
 *
 * Degrades TOWARD the doctrine rule, never away from it (hard rule #12616).
 * When a product is blocked and carries no reviewed `mood_image_url`, the
 * answer is "no image", not "the flagged photo": `StorefrontHome`'s hero and
 * `StorefrontProductCard` both already render a sage ♥ placeholder inside the
 * same fixed-ratio frame for a null image, so the compliant outcome costs no
 * layout shift and no crash.
 *
 * What this does NOT do, deliberately: it does not make the
 * carton-versus-bare-frame choice that `pickBareProductImage()` makes among the
 * surviving frames (#11028 / #14190). That needs the product's whole media
 * list, and the discovery queries fetch only `featuredImage` — adding an image
 * connection to a catalog crawl already pacing at its Admin-API break-even is a
 * cost decision, not a cheap fix. Filed separately with its measurement.
 */

/** One image frame, in the shape both discovery projections already hold. */
export interface CardArtFrame {
  url: string | null
  altText: string | null
}

/** The two metafield values the gate reads. Raw strings, as Shopify returns them. */
export interface CardArtMetafields {
  /** `xdipx.card_art_blocked`. Only the exact string `'true'` blocks. */
  cardArtBlocked: string | null | undefined
  /** `xdipx.mood_image_url`, the reviewed fallback. */
  moodImageUrl: string | null | undefined
}

/** True only for the exact string Shopify writes for a checked boolean metafield. */
export function isCardArtBlocked(raw: string | null | undefined): boolean {
  return raw === 'true'
}

/**
 * Return the frame that is allowed to render as card art.
 *
 * Not blocked: the frame, untouched.
 * Blocked with a reviewed mood image: the mood image.
 * Blocked with no mood image: no image at all, never the flagged frame.
 */
export function gateCardArtFrame(frame: CardArtFrame, mf: CardArtMetafields): CardArtFrame {
  if (!isCardArtBlocked(mf.cardArtBlocked)) return frame
  const mood = (mf.moodImageUrl ?? '').trim()
  // `altText: null`, not `''`, and deliberately unlike `gateCardImages()`'s
  // empty string: both card renderers read `imageAlt ?? title`, and an empty
  // string is not nullish, so `''` would ship a content image with an empty
  // `alt` on exactly the products a reviewer has already touched. Null lets the
  // product title through, which is what every ungated card already does.
  if (mood) return { url: mood, altText: null }
  return { url: null, altText: null }
}
