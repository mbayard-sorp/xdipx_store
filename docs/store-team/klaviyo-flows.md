# Klaviyo flows: browse abandonment, cart abandonment, post-purchase

Built 2026-10-03 as PR-F of the Ad Studio v2 plan (`ad-studio-v2-plan.md` §4 Owned lane, §5 Klaviyo,
owner decision 7). Owned channel, register 9. Code: `app/lib/klaviyo-flows.server.ts`,
`app/lib/klaviyo-flow-templates.ts`, `scripts/klaviyo-flows-setup.ts`.

## What exists in Klaviyo right now

Verified against the live account on 2026-10-03 (the account had zero flows and zero templates before).

| Object | State | Notes |
|---|---|---|
| 5 templates, `xdipx <flow> <key>` | Created | Saved templates, HTML plus text. Editable in Klaviyo |
| `xdipx Cart Abandonment` flow (`TvzW5L`) | **Draft** | Trigger Added to Cart, 1h then 24h, filter: zero Placed Order in the last 30 days |
| `xdipx Post-Purchase` flow (`XCPvmX`) | **Draft** | Trigger Placed Order, day 3 then day 14 |
| `xdipx Browse Abandonment` flow | **Not created** | The Viewed Product metric does not exist yet (wiring shipped, waiting on its first qualifying PDP view). See "Browse abandonment: wired, waiting on its first event" |

The Create Flow API works on this account (revision 2026-07-15, `flows:write`). It cannot create a live
flow: the endpoint rejects a `status` field and documents that every flow is created as a draft, and
no helper in the codebase changes a flow's status. Nothing can send until the owner sets a flow live.

## Owner steps (the blocker is `klaviyo:flows-go-live`)

1. Klaviyo > Flows. Open `xdipx Cart Abandonment` and `xdipx Post-Purchase`.
2. Check each email's preview with a test profile (Preview and test > Select profile, then pick an
   event with ProductName and HeaderImageURL). Until the code in this PR is deployed, Added to Cart and
   Placed Order events do not carry those properties, so the preview shows the name default ("your pick")
   and no image plate. After deploy, add one real item to a cart while signed in with
   marketing consent and the next event carries them.
3. Review the flow filter and the delays. The filter is "zero Placed Order in the last 30 days", the API's
   form of "has not ordered since" (Klaviyo's UI option "since starting this flow" is not exposed by the
   API). It is equivalent for these delays.
4. Smart Sending is on (16 hours). Leave it on: it is the frequency guard behind the 2-sends-a-week rule.
5. Set each flow to Live, one at a time. Cart first.
6. For browse abandonment, see the next section. Do not build it by hand yet.

## Browse abandonment: wired, waiting on its first event (ticket #13384)

The plan said the client "already fires" Viewed Product. As of this ticket it actually does, from the
PDP loader (`app/routes/_layout.products.$slug.tsx`), but the metric still does not exist in Klaviyo yet
because nobody has generated a qualifying page view since deploy — Klaviyo creates a metric only when its
first event arrives, so the flow cannot be built, by API or by hand, until one does.

`trackViewedProduct(email, props)` (`klaviyo.server.ts`) fires fire-and-forget from the PDP loader, gated
on exactly the conditions this section used to ask for: a known profile email (reusing the
`customerAPI(customerToken).getProfile()` lookup the loader already runs for sticky vote state, logged in
via either the Storefront or the Customer Account API — not a second lookup, so the "a profile lookup on
every PDP view is a performance decision" concern above no longer applies, that lookup already happens),
marketing consent (`getMarketingConsent`), and `isCapiEligible` — the same bot/crawler/prefetch exclusion
the ViewContent CAPI send next to it uses, so a hover-prefetched or crawled PDP does not mint a Viewed
Product any more than it mints a conversion event. Anonymous visitors send nothing. The onsite-JS option
below (anonymous visitors who later identify) is still not built.

Confirmed via `npx tsx scripts/klaviyo-flows-setup.ts --dry-run` (2026-10-04, post-wiring, pre-first-event):
the metric still reads as not existing, which is the correct and expected state until a real signed-in,
consented customer loads a PDP on production. **Next step once this ships:** after the first qualifying
PDP view lands in production, re-run `npx tsx scripts/klaviyo-flows-setup.ts --dry-run` to confirm the
`Viewed Product` metric now exists, then run it live (drop `--dry-run`) to create the browse flow draft.

Remaining option:
- Load Klaviyo's onsite JS on the storefront. Covers anonymous visitors who later identify, one script
  tag, a consent and performance review.

Once the first Viewed Product event lands, run `npx tsx scripts/klaviyo-flows-setup.ts`. It creates
the browse flow as a draft (4h delay, not-ordered filter, template `xdipx browse-abandonment browse-4h`).
The manual clicks are in `MANUAL_FLOW_STEPS` and printed by the script.

Also worth knowing: the account has a Klaviyo metric named "Checkout Started" from another source, and our
own "Started Checkout" has never fired (only the SMS cart-link path sends it). The cart flow therefore
triggers on Added to Cart, the one cart event this app sends.

## Event contract

The templates read these event properties, attached by `flowEventProps(handle)` in
`klaviyo-flows.server.ts` and wired into Added to Cart (`api.cart.tsx`), Started Checkout
(`sms-v2/email-delivery.server.ts`) and Placed Order (`server/webhooks.ts`, first line item).

| Key | Meaning | Template default |
|---|---|---|
| `ProductName` | Shopify title | "your pick" |
| `ProductURL` | `https://xdipx.com/products/<handle>`, no query string | `https://xdipx.com/` |
| `ProductHandle` | Shopify handle | none |
| `ProductType` | Inferred from title and tags by `inferProductType` (air-pulsation, wand, vibrator, lube, wear), picks the act paragraph. The Storefront Product type does not carry the `product_type_dial` metafield | generic paragraph |
| `HeaderImageURL` | Header art, see below. Shopify CDN URLs arrive pre-cropped to a 1200px square (`emailHeaderImageUrl`) | no image plate; the email opens on the masthead and the product name |
| `HeaderKind` | `onskin`, `packshot` or `none` | none |

A lookup failure sends the event unchanged. An email never fails to render for a missing key.

## Header art

`pickHeaderAsset(productHandle)` returns, in order:

1. A rated-up (`verdict up`) frame of that exact handle from the social asset library, archetype `cast`
   then `macro` (the on-skin and bodyscape archetypes), whose vision verdict did not fail and that is not
   product-identity blocked. Wider aspects win over tall ones. These frames already passed the vision gate and
   the nudity definition (visible female nipples, labia, penis, anus), so owned email inherits the
   `instagram-campaigns.md` §3.2a ceiling with the §3.2c on-skin treatment, exactly as the charter
   says it should.
2. The product's position-0 Shopify image (already card-art-gated, so a blocked packshot never appears).
3. Nothing: the template drops the image plate and opens on the masthead and the product name.

**Later source.** When the ads creative library (Ad Studio v2 PR-C, `ad_creatives` with a rated-up
verdict, lane `owned`, concept 2.2 Body Map and 2.5 The Morning After) exists, it becomes the preferred
source. The swap is one lookup ahead of the social-library lookup inside `pickHeaderAsset`; no caller changes.

**How the daily ads routine refreshes headers.** Header art is resolved when the event fires, not when the
template is saved, so a new rated-up asset is used on the next event with no template edit. The daily ads
routine's only job here is to keep the pool deep: render and gate on-skin and bodyscape creatives for the
products people actually view, add to cart and buy, and let the owner's hearts promote them. A product with
no rated-up frame falls back to its packshot, and the routine can list those products as "needs a header" in
its digest.

## Copy and voice

Register 9 on an owned channel (`docs/emma-voice.md`, owner 2026-09-20). Rules these emails follow:

- Acts named plainly, sensation in the body, a temptation closer. No dares, no mind-reading, no hedging
  ("if", "might", "maybe"), no mechanism or spec talk, no "sexy" as an adjective.
- Emma is an AI with no lived experience. No email says she tried, tested or owns anything, and none
  speaks as Emma at all: the voice is the shop's.
- No price in the copy (prices move daily), no countdown or urgency, no discount, no review quotes or
  counts (there are none to show).
- One CTA, from the whitelist: "Show me" (browse), "I'll take it ♥" (both cart emails), "Take a peek →"
  (post-purchase day 3), "Find your fit →" (day 14). The link is the PDP.
- The discreet-shipping or XDIPX line appears once per email. The statement always reads XDIPX.
- No em-dashes. The humanizer pass ran on every string.
- Post-purchase emails are marketing, not order confirmation. Order and shipping mail stay plain at 2-3
  (charter marketing addendum) and are not touched here.

The act paragraph is chosen by `ProductType`. Five are written (air pulsation, wand, vibrator, lube, wear) plus a default for everything else, so an unrecognized product still gets honest copy.

## Design

Redesigned 2026-10-03 after the owner rejected the first drafts. One editorial system renders all five
emails (`renderFlowEmail` in `app/lib/klaviyo-flow-templates.ts`), built to `docs/design-doctrine.md`:

- **Order, top to bottom:** text wordmark masthead (`xdipx` in Newsreader, ink, no logo image: the
  Sanity logo is the retired orange gradient), a square product image plate full-bleed in the 600px
  column, the product name large in Newsreader, the headline as a Newsreader dek with exactly one italic
  plum word (`emphasis` on each spec), the lead in DM Sans 17/27 at a 60ch measure, the act paragraph as
  an italic Newsreader pull-quote on a line-3 rule, the closer, one centred coral button, the discreet
  line in 14px ink-3, a hairline, and the footer (hello@xdipx.com, the account address tag, unsubscribe
  and preferences tags).
- **Colour:** paper ground everywhere, ink type ramp, plum only on the emphasis word, coral only on the
  button. No gradients, icons or emoji. Nothing is centred except the button.
- **Image plate:** fixed 600x600 with `width`/`height` attributes and a paper-2 cell behind it, so a slow
  or blocked image never shifts the layout and alt text sits on a quiet plate. `flowEventProps` asks the
  Shopify CDN for a 1200px centre crop, so every product gets the same plate whatever its source aspect.
- **Fonts:** Newsreader and DM Sans load by `@import` for clients that honour it (Apple Mail, iOS Mail).
  Klaviyo strips `<link>` tags from code templates, so do not switch back to one. Fallbacks are Georgia
  and Arial; Outlook for Windows is forced onto them by an `mso` style block.
- **Button:** bulletproof. A VML roundrect for Outlook for Windows, and for everyone else a padded link
  whose cell carries coral as `bgcolor`, `background-color` and a one-colour `linear-gradient` image fill.
  The last one is there because Gmail's dark mode repaints background colours but leaves background images
  alone, so the button stays coral instead of turning muddy.
- **Dark mode:** `color-scheme: light dark` is declared, every cell has `bgcolor` plus inline
  `background-color`, and a `prefers-color-scheme` block (with Outlook.com `[data-ogsc]`/`[data-ogsb]`
  twins) switches to an ink ground, light type and a lifted plum. The coral button does not change.
- **Preheader:** Klaviyo injects the message's preview text, so the template carries only a hidden
  zero-width filler run after it. That keeps the masthead from trailing into the inbox snippet, and the
  A/B preview variants keep working.
- **Weight:** about 13KB per template, far under Gmail's 102KB clip. Table layout, inline styles, no
  flex, grid, position or float. `klaviyo-flow-templates.test.ts` asserts the coral button markup, the one
  emphasis word, the dark-mode declaration and the unsubscribe tag.

Copy changes in the redesign: the product name is now its own title above the headline, so the headlines
and leads stopped repeating it ("Said plainly.", "Right where you left it.", "Your first evening with
it.", "Two weeks in. Here is what pairs with it."). "Is waiting" was retired as a house tic. Subjects
and previews are unchanged.

## Subject and preview variants

Variant 1 is in the flow. Variants 2 and 3 are the A/B candidates (Klaviyo flow email > A/B test).
`{{ event.ProductName }}` is the product title with a default.

| Email | Subjects (1, 2, 3) | Previews (1, 2, 3) |
|---|---|---|
| browse-4h | `<name>: the long version` / `A closer look at <name>` / `The part of <name> the photos leave out` | Slow, warm, and all yours. / What it feels like, said plainly. / Come back to it whenever you like. |
| cart-1h | `<name> is in your cart` / `Your cart, with <name> in it` / `Back to <name>` | Exactly where you left it. / One tap from here. / The rest of the evening is yours. |
| cart-24h | `<name> and the first night with it` / `No wrong answers, <name> included` / `<name> is saved in your cart` | Beginner-safe by default. / Thirty days, and no wrong answers. / Take it at your pace. |
| post-3d | `Your first evening with <name>` / `<name>, out of the box` / `Settling in with <name>` | Take your time with the first one. / No schedule, no wrong answers. / It rewards patience. |
| post-14d | `What pairs with <name>` / `Round two with <name>` / `The thing that makes <name> better` | Two weeks in, here is what goes with it. / A good thing, improved. / Find your fit. |

## UTM scheme

Every link: `?utm_source=klaviyo&utm_medium=email&utm_campaign=<flow>&utm_content=<step>`.

| Flow (`utm_campaign`) | Steps (`utm_content`) |
|---|---|
| `browse-abandonment` | `viewed-4h` |
| `cart-abandonment` | `cart-1h`, `cart-24h` |
| `post-purchase` | `post-3d`, `post-14d` |

Shopify order attribution by these values is the source of truth (GA4 purchases arrive Unassigned).

## Operating the setup script

```bash
npx tsx scripts/klaviyo-flows-setup.ts --dry-run          # print the plan, create nothing
npx tsx scripts/klaviyo-flows-setup.ts                    # create what is missing, as drafts
npx tsx scripts/klaviyo-flows-setup.ts --update-templates # also overwrite existing template HTML
```

Idempotent by name. A flow copies its template when created, so editing a template later does not change
an existing flow's email. The API cannot edit that copy either (verified 2026-10-03 on revision 2026-07-15:
PATCH on a flow message's template id returns 404, and Update Flow accepts only `status`). To ship a template
change: `--update-templates`, then delete the draft flows (`DELETE /api/flows/{id}`, drafts only) and rerun
the script, which recreates them with the same trigger, filter and delays. Edit the email in Klaviyo instead
once a flow is live. Create Flow is
throttled to 1 request a second and 100 a day, which the script respects.

## Agents

The email-marketing-manager may propose copy refreshes for these flows as `campaign` suggestions
(subject variants, act paragraphs, a new header-art rule). It still sends nothing and has no flow or
template write access: a refresh lands as a suggestion, the owner approves, and the setup script's
`--update-templates` plus a flow rebuild applies it.
