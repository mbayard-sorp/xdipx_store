# Shop image strategy (Shop app and Shop Campaigns)

Owner direction 2026-09-30: "Now give me the image strategy for Shop ads." Companion to
`docs/ads-policy.md` §Shop app and Shop Campaigns, which holds the binding floor (rule 4). This
document is the plan for turning that floor into images that win in the Shop feed. Where the two
disagree, ads-policy wins.

## 1. What Shop actually shows

- **The product's Shopify media position 0 is the ad.** Shop Campaigns builds its units from
  catalog data; there is no separate creative upload. Every product card in the Shop app, the Shop
  website, and the Shopify Product Network leads with that image.
- **The rest of the Shopify gallery is the Shop product page.** A shopper who taps through sees
  positions 1 onward before they ever reach xdipx.com.
- **The Shop store page** carries the store logo and a cover image, synced from Settings, Brand in
  Shopify admin (cover: PNG or JPEG, 1920x1080 minimum).
- Shop approved the whole catalog as it stands (ads-policy §Shop). Every change below keeps the
  product itself as the subject so nothing moves a product toward a re-review.

## 2. Where the catalog stands (measured 2026-09-30, 100 active products via Admin API)

| Signal | Result |
|---|---|
| Alt text on the first image | 2 of 100 |
| First image is a Nalpac "A" shot with other images available | 52 of 100 |
| Of a visually reviewed sample of those "A" shots, retail box instead of product | 6 of 9 |
| First image 800px or smaller | about 1 in 6 (smallest 640px) |
| Background already removed | 1 seen (`jo-h2o-original-water-based-lubricant-4-oz-nobg.png`) |

In a feed, a retail box reads as a clearance flyer: baked-in text, another brand's logo, a dildo
still in its blister pack. The teardown already names text in pixels as a cheap tell
(`docs/homepage-team/competitor-teardown-2026-07-live.md` finding 6). Roughly a third of the
catalog is leading its Shop ad with the box.

## 3. The strategy, in three layers

### Layer 1. Hygiene, catalog-wide, no spend

1. **Product, not box, at position 0.** Run `scripts/sweep-packshot-primaries.ts --apply`, which
   promotes the clean sibling (B, C...) over the Nalpac "A" packaging shot. The box moves down the
   gallery; it is never deleted (it answers "what arrives").
2. **Alt text on every image**, reading as a plain product description at the paid-ad register
   (title, size, brand). Screen readers and search engines read it; 98 of 100 sampled have none.
3. **At least one image.** A product with zero media cannot be approved on Shop (SKU 101629). Pull
   the Nalpac main-feed image; if the feed has none, flag to `shopify-ops`.
4. **Square, 1000px or larger** at position 0. Below 1000px, look for a larger sibling first.

### Layer 2. The signature ground, catalog-wide, about $0.01 per image

Every other merchant in the Shop feed shows a white-background packshot. Ours should be
recognizable at a glance, and the doctrine already says how: one ground behind every product
("consistency, not budget, is the million dollars signal", `docs/design-doctrine.md` §4).

- **The real product photo, background removed, composited onto one flat `coral-soft` field
  (`#FFE6DD`)**, product centered and large (about 75 to 80 percent of the frame), soft contact
  shadow. One tint for every Shop primary, so the whole catalog reads as one brand in a scroll.
  Why coral-soft: it is the brand's warm ground, and `paper` is plain white, which is exactly the
  sameness this layer exists to escape.
- **Real product pixels only.** Background removal (`scripts/remove-product-bg.ts`, fal.ai
  BiRefNet, about $0.01 per image) plus a flat composite. No AI regeneration of the product itself
  at position 0: a regenerated product can drift from what actually ships, which is a
  misrepresentation risk on the one image Shop approved and shows in every ad.
- **Pilot before rollout.** 20 products get the tinted primary, 20 comparable products keep the
  cleaned white packshot, for two weeks of Shop Campaigns traffic. Roll out only if the tinted
  cohort's conversions per impression hold or beat the control. If Shop's reporting cannot split
  it that finely, compare the two cohorts' orders from Shop over the same window.

### Layer 3. The gallery, for bestsellers and campaign products

| Position | Content | Archetype |
|---|---|---|
| 0 | The signature-ground primary (Layer 2) | B, flat |
| 1 | Scale in hand: one hand holding the product, away from the body, same ground | A |
| 2 | Macro: texture, material, the control buttons | A or D |
| 3 | What arrives: the retail box, moved down from position 0 | packshot |
| 4+ | Remaining clean supplier angles | packshot |

Generated frames (positions 1 and 2) go through `media-manager` and the existing vision gate, with
the product rendered from its real reference image.

## 4. Never on Shopify media for a Shop-published product

- A body, skin, or any on-skin frame (`docs/store-team/instagram-campaigns.md` §3.2c). The on-skin
  licence stops at Shopify media for anything on Shop; those frames live in `mood_image_url` and
  Sanity for the site.
- Text, prices, discounts, stars, or badges in the pixels.
- An AI-regenerated product standing in for the real one at position 0.
- A product video that breaks any rule above.

## 5. The Shop store page

- **Logo:** the xdipx mark, square, on the brand ground.
- **Cover (1920x1080):** an Archetype B or D still on `coral-soft`, several products arranged as
  one composition, no people. `media-manager` produces it; the owner sets it in Settings, Brand.

## 6. Who does what

| Work | Owner | Lane |
|---|---|---|
| Layer 1 sweep, alt-text backfill, zero-media check | `rr7-engineer` via R-DEV, then `shopify-ops` runs it | code ticket |
| Compositing step for Layer 2 | `rr7-engineer` via R-DEV | code ticket |
| Layer 2 pilot and rollout spend | owner decision (about $0.20 pilot, about $52 full catalog) | owner |
| Layer 3 frames | `media-manager`, vision-gated | after the pilot |
| Cover image | `media-manager` produces, owner sets | owner click |
| Watching Shop Campaigns results | `ads-manager` retro, per ads-policy §Shop rule 1 | weekly |
