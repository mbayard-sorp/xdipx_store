# Sales pages

Long-form product pages at `curious.xdipx.com/<slug>`, built for adult ad network traffic (ExoClick first). One Sanity `salesPage` document per page. Words and section order live in the document. Price, images, variants and stock come from Shopify at request time. Code: `app/lib/sales-page.ts`, `app/components/funnel/SalesPageView.tsx`, `SalesAddOnView.tsx`, and the `sales` kind in `app/routes/bridge.$slug.tsx`. The landing exception is recorded in `docs/ads-policy.md`, Adult ad networks row.

## Register

The page runs at 9, the owned-channel target. The voice charter (`docs/emma-voice.md`) allows 10 only on banners and copy exported to the networks, and says a 10 line never reaches the site. Changing that takes the owner's codify, not a page edit.

## Choosing add-ons (owner direction 2026-10-31)

An add-on screen offers one thing, or a good, better, best choice of up to three products. A page has at most two screens. Every product on a screen must clear all of these at the price the store is charging when the page goes live:

- **Margin of at least 50%**, taken from the Shopify unit cost. Prefer the higher dollar profit between two products that clear it.
- **At least 100 units in stock**, so a paid campaign does not sell through it mid-flight.
- **Fits the main product.** A stroker gets water-based lube, because silicone lube can damage a toy sleeve.
- **Price at or above MAP** where the brand's MAP binds (`pricing_map_brands`).

Set the add-on's product handle to the tier most people should take. That tier is selected when the screen opens.

An exception to the margin bar is the owner's call and gets recorded here. Standing exception: System JO H2O 16 oz at 49% (owner, 2026-10-31), because it earns the most per bottle.

## Every upsell carries a bulk discount (owner direction 2026-10-31)

Always. The more they buy, the better the discount. The add-on screen shows the quantities and the price each, and the buy button adds that many and applies the code.

- The default ladder is 2 for 10% off and 3 for 15% off. Going deeper is an owner decision, since it spends margin.
- Check margin at the deepest tier before choosing a product. A product whose MAP binds cannot go on a bulk offer, because the discount would advertise it below MAP. That is why the Lovense jelly came off the first page's lube ladder.
- Each tier needs a real Shopify discount code limited to that add-on's products, with that minimum quantity. The page reads the code from Sanity; the code in Shopify is what gives the price. Codes in use: `GLIDE10` and `GLIDE15`, on System JO H2O 4, 8 and 16 oz.
- If a code stops applying, the customer sees full price at checkout after being promised less, and the route logs it to Sentry. Never leave a code expired while a page still offers it.

### When a product misses on margin

The owner has approved raising a lube's price toward MSRP to clear the margin bar. Pick a product that already clears it first. A price edited by hand in Shopify does not hold on its own, because the daily pricing batch (`/cron/pricing-batch-recompute`) recomputes every variant from its cost and pricing rules. A raise that has to last needs a pricing rule change in `/admin/pricing`, which is the owner's call.

## Publishing a page

1. Draft the copy against the charter, then run it through `emma-empathy-reviewer`.
2. Proof blocks take real reviews only, each with its source recorded. No reviews means no proof block.
3. Set `live` and publish. The page caches for 60 seconds.
4. Banner URLs carry the four UTMs from `docs/ads-policy.md`.
