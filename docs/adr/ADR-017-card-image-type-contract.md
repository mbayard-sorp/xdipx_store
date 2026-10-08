# ADR-017: `Product.cardImage` — an additive card-art field on the shared type contract

**Date:** 2026-10-08
**Status:** Accepted
**Owner:** tech-architect (layer ruling recorded on PR #1579; this ADR formalizes it)
**Implementation owner:** rr7-engineer (ticket #14190)

---

## Context

`pickBareProductImage()` (`app/lib/shopify.server.ts`, ticket #10341) has existed since before this
ADR, exported and unit-tested, but called from nothing in production. Card art (rails, grids,
carousels) rendered whichever frame Shopify listed first — `images[0]` — through the
`card_art_blocked` gate, which only suppresses a flagged packshot and never reorders. Proven
consequence (ticket #14190, run 1298): the live Magic Wand Original card rendered the retail
carton (`53906A`) while the bare wand (`53906B`) sat one frame later in the same media list.

The question this ADR answers: where does the bare-frame pick live, given `Product.images` feeds
roughly 79 other `images[0]` consumers (the PDP gallery, the cart drawer, OG tags, JSON-LD
structured data) that must never see a reordered list?

Tech-architect ruled on PR #1579 (card-art doubt-heuristic repair) that this **does** warrant an
ADR, unlike that PR itself — #1579 repaired the heuristic `pickBareProductImage()` and
`gateCardImages()` both lean on, but did not touch the shared type contract in
`app/types/index.ts`. This ticket does.

---

## Decision

Add an **additive, optional** field to the shared `Product` (and the derived `LeanCardProduct`)
type:

```ts
cardImage?: {
  url: string
  altText: string
  fellBack: boolean
}
```

Computed exactly once, at the existing single conversion point in `nodeToProduct()`
(`app/lib/shopify.server.ts`), immediately beside the `card_art_blocked` gate (`gateCardImages()`)
that already governs `Product.images` there. `cardImage` is populated by
`pickBareProductImage()` run against the raw media list with `cardArtBlocked`/`moodImageUrl`
passed through, so the same blocked-wins / mood-fallback rule `gateCardImages` enforces for
`images` also governs `cardImage` — there is exactly one place a reviewer needs to read to audit
either field.

**`Product.images` itself is never reordered or filtered beyond the existing gate.** Card surfaces
read `cardImage ?? images[0]`; every other consumer (PDP gallery, cart drawer, OG tags, JSON-LD)
keeps reading `images[0]` directly, untouched by this change.

`toLeanCardProduct()` (`app/lib/homepage-payload.server.ts`) carries `cardImage` through verbatim
to `LeanCardProduct`, the same way it already does for `images[0]`/`videos[0]` truncation.

## Alternatives considered

**Per-card-component selection.** Rejected: scatters the heuristic across ~79 call sites instead
of the one conversion point the existing `card_art_blocked` gate already uses, and risks a card
component drifting out of sync with the gate's blocked/mood-fallback rule.

**Select in the loaders instead of the conversion function.** Rejected: creates a second
conversion point reading the same metafields a second time, with no mechanism to keep it in sync
with `gateCardImages()`'s decision for the same product.

**Reorder `Product.images` so `images[0]` is already the bare frame.** Rejected outright
(tech-architect's PR #1579 ruling): `images` feeds the PDP gallery, the cart drawer, OG tags, and
JSON-LD structured data. Reordering it to fix card art would silently change what those surfaces
show and what search engines/LLMs read as the product's primary image — a much larger and riskier
blast radius than one additive field.

**Widen the cached `DiscoveryProduct` (the algorithmic discovery index) to carry `cardImage` too.**
Deferred, not rejected. `DiscoveryProduct` is KV-cached and version-gated
(`INDEX_VERSION` in `app/lib/discovery.server.ts`); a shape change there needs a version bump and
affects every algorithmic rail, not just the homepage surfaces this ticket's evidence covers (the
Nº03 anchor grid and the team-curated rails, which are a direct Shopify fetch, not the cached
index). Ticket #14190 scopes to the direct-fetch path only; extending the fix to the cached
discovery index is a reasonable follow-on, sized and scheduled separately.

## Consequences

- `Product.cardImage` and `LeanCardProduct.cardImage` are optional and additive: no existing
  caller breaks, and any caller that doesn't care about card art ignores the field for free.
- Any future change to the card-art selection rule (the #14113 doctrine question — whether a
  product's own printed label counts as doctrine §4 item 4 case 1 or case 2 — is still
  unresolved) is a change to `pickBareProductImage()` alone; no card-surface component needs to
  change again.
- `fellBack: true` is a real, inspectable signal (surfaced as `data-card-image-fallback` on the
  card media wrapper in `ProductCarousel.tsx` and `EmmaContextRow.tsx`), not swallowed, so a
  capture or audit pass can tell a best-guess card from a confirmed bare shot.
- `VaultDeal`/`VaultCard` and `DiscoveryProduct`/the algorithmic discovery rails are untouched by
  this ADR's decision and remain open follow-ons if the same defect is confirmed there.
