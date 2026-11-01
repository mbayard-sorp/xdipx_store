# Sales pages

Long-form product pages at `curious.xdipx.com/<slug>`, built for adult ad network traffic (ExoClick first). One Sanity `salesPage` document per page. Words and section order live in the document. Price, images, variants and stock come from Shopify at request time. Code: `app/lib/sales-page.ts`, `app/components/funnel/SalesPageView.tsx`, `SalesAddOnView.tsx`, and the `sales` kind in `app/routes/bridge.$slug.tsx`. The landing exception is recorded in `docs/ads-policy.md`, Adult ad networks row.

## Register

The page runs at 9, the owned-channel target. The voice charter (`docs/emma-voice.md`) allows 10 only on banners and copy exported to the networks, and says a 10 line never reaches the site. Changing that takes the owner's codify, not a page edit.

## Hand-designed pages

`gawk-gawk-3000` runs the owner's Claude Design file instead of the Sanity section layout. Words and photos are in `app/lib/gawk-sales-page.ts`, the layout is `app/components/funnel/GawkSalesView.tsx`, and the route picks it by slug. The Sanity document still controls `live`, the SEO fields and the add-on screens. Its section and headline fields no longer render on this page.

Owner decisions for this page, 2026-10-31:

- **Photos ship as designed**, including the three where a nipple shows through sheer fabric (hero, Head on demand, P.S.). Owner's words: "Do not change any photos." This is above the charter's nudity ceiling, and the charter has not been edited because no codify was given.
- **The design's explicit copy and its CTAs ship as designed**, which also runs above the register 9 and the CTA whitelist set out above and in the charter. Same status: a decision for this page, not a charter change.
- **No invented discount.** The design's "51% OFF, was $142.99" came off because Shopify holds no such price: compare-at and MAP were both $69.99 when this was built. A struck price and a percent badge appear on their own if Shopify holds a real compare-at, through the same MAP gate and 10% floor as the store's cards (`gawkOffer`).
- **No sold-out or scarcity claims.** "The viral stroker" stays, on the owner's word. Sold out for weeks, waitlists, resellers, limited offer and "when this batch is gone" came out: the history could not be verified, stock was 1,406, and the charter bans urgency.

Free shipping on this page is real, and no code gives it: the automatic "Free Shipping" discount covers orders of $59.99 and up on rates under $10, so Standard US is free at this product's price (checked at checkout 2026-10-31). Hawaii, Alaska and Puerto Rico ($14.99) and international are not covered, and the FAQ says so for HI, AK and PR. If that automatic discount ends (it is set to expire 2027-04-14) or the price drops below $59.99, this page's free shipping claim goes false.

Returns on this page state the store policy: unopened within 30 days, hygiene rules once used (`app/lib/faq-content.ts`).

### Upgrades on this page (owner direction 2026-10-31)

The page also sells up to the other Male Roses, the way `advents26` steps up to Luxury. A card under the hero buy button pitches the Rose 3 and scrolls to an upgrade section before the Offer: Pro, Rose 3 and Rose 2 with their own buy buttons, a side-by-side, and a way back to the Gawk. Clicks on the card log `cta_click` as `gawk_upsell`. The sales action accepts only these three products beyond the page's own, and they go through the same lube add-on screen. Words and specs are in `GAWK_UPGRADES`, written from each product's `custom.original_description`; the shorter Shopify description on the Pro wrongly says suction. The dollar gap comes from live prices, and a Rose that is sold out or not priced above the Gawk drops off.

All three sit at MAP since 2026-10-31, when the owner had them moved up from $71.99, $71.99 and $80.99: Pro and Rose 2 at $79.99 (cost $39.99, 50.0%, $40 a unit), Rose 3 at $89.99 (cost $45, 49.99%, $44.99 a unit), against the Gawk at $69.99 (cost $34.99, 50.0%, $35). The Male Rose is in `pricing_map_brands`, so the daily batch should hold these. The add-on screen's words were made generic the same day, because the Rose 2 has no rotation.

## Which button sold it

Every buy button on a `sales` page carries a label (`spot` on `BuyForm`), and the route saves it on the cart as `_sales_cta`. Shopify copies it to the order, so the order's Additional details name the button that started the purchase: `hero`, `do-the-math`, `pinned-bar` and so on. On the Gawk page the labels follow its sections, `cta-05`, `cta-12` and `cta-16` being the three CTA-only sections. `upgrade-card` covers all three Roses, and the order's line item says which one. Nothing depends on GA4 or consent. The advent pages have their own form and do not carry it.

GA4 gets the same label on every click, buyer or not, as `cta_click` with `cta_name` `sales_buy` and `cta_location` set to the label.

## GA4 on curious.xdipx.com (owner direction 2026-11-01)

US visitors on this host start with GA4 analytics storage on, because with it denied GA4 kept almost none of the paid traffic. Ad storage stays denied and the Meta pixel still waits for "Accept all". The cookie banner still shows. "Essential only", or a browser sending Global Privacy Control, leaves GA4 off. Every other country and the main store keep the denied default. The country comes from Vercel's `x-vercel-ip-country`, and the page sends `Vary: X-Vercel-IP-Country` so the 60 second cache keeps US and non-US copies apart. Code: `app/lib/analytics-default.ts`.

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

## The exit offer (owner direction 2026-11-01)

`gawk-gawk-3000` asks a leaving visitor for an email and phone number in exchange for a code. The form is `app/components/funnel/ExitOffer.tsx` and the offer is `app/lib/exit-offer.server.ts`. It shows once a week per browser, and never after a buy button was pressed. On desktop the trigger is the cursor leaving through the top of the window. On touch it is a hard flick up the page or coming back to the tab. There is no back-button trap.

- **The code is `GAWK10`**: 10% off the Gawk only, one use per customer, $63.00 at $69.99. `CURIOUS15` is the wrong code here because it does not combine with the automatic Free Shipping discount. The owner allowed Free Shipping to combine with product discounts for this. The code is not limited to first-time buyers, so a past buyer can use it once. `CURIOUS15` is set up the same way. `GLIDE10` and `GLIDE15` combine with it (owner, 2026-11-01), so the add-on screen's bulk price holds on the same cart: a Gawk and two 8 oz bottles came to $122.40.
- **No percent or price shows before signup**, on the owner's call, because the Gawk's price equals its MAP. The code and terms live server-side and arrive only in the `/api/lead` response. A code still sells below MAP, and the owner accepted that risk with The Male Rose.
- **Signups go on their own Klaviyo list** (`TVq6Jz`), so they skip the `CURIOUS15` welcome series. The flow "Exit offer: Gawk code" sends the code. `scripts/klaviyo-exit-offer-setup.ts` created it as a draft, and the owner had it set live on 2026-11-01.
- **The phone is required, but consent to texts is its own unticked box.** An unticked number gets no texts. With `lead_sms_optin_enabled` off, the form asks for email alone.
- **The cookie does the applying.** `/api/lead` sets `xdipx_exit_code` for 30 days, and any buy button for the page's own product puts the code on the cart. Upgrades to the other Roses do not get it.

## Showing a toy in use

When a page or banner shows a product used on another toy, the other toy is a real product we sell, so the demo can be filmed or photographed for real. For strokers the prop is the Camtoyz Cody (`camtoyz-ultra-realistic-squirting-dildo-cody`), chosen 2026-10-31 by owner request: realistic, has balls and a suction base, and it actually squirts. Check it fits the stroker's cup before a shoot; the catalog does not list the cup's inner size.

## Publishing a page

1. Draft the copy against the charter, then run it through `emma-empathy-reviewer`.
2. Proof blocks take real reviews only, each with its source recorded. No reviews means no proof block.
3. Set `live` and publish. The page caches for 60 seconds.
4. Banner URLs carry the four UTMs from `docs/ads-policy.md`.
