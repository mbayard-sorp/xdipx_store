# Collections audit and hero imagery plan (2026-10-23)

Status: **plan for owner review.** Nothing has been changed in Shopify, Sanity, or the repo, and no images have been generated.

Owner direction, verbatim: *"I would like to do a full audit of all the existing collections. I think there has been drift as we've added products over the months and they are no longer accurate. Where we have a brand collection, we need a logo for that collection. ... I want every collection to have an image at a register 9. No text or labels. ... I would like to see cast members in at least half of them. These should be sexy, and attractive collection images and they need to be cohesive, ideally they each tell a story ... No empty rooms. These are products that are used in the bedroom. ... If we no longer need a collection, I'm fine to delete it."*

Evidence: Shopify Admin bulk export of all 5,990 products with collection membership (5,611 active, 5,143 active and in stock); all 211 collection rules; GA4 page views for every `/collections/*` URL over 90 days; GSC weekly snapshots and URL inspections; the 172 Sanity `collectionPage` docs; and the 415 owner verdicts in `social_asset_feedback` (204 hearts, 211 thumbs-down, with notes). Specialists convened: homepage-ia (taxonomy), seo-pdp-auditor (deletion impact), homepage-designer (art direction and category scenes), media-manager (brand scenes, logos, production).

Appendices in `docs/audits/collections-audit-2026-10-23/`:
- `collection-inventory.csv`: every collection, with active, in-stock and archived counts and its product-type mix
- `scenes-category.md`: the series bible, plus a scene for each of 93 category and theme collections
- `scenes-brand.md`: logo sourcing, plus a scene for each of 82 brand collections
- `hearted-sample-1.jpg`, `hearted-sample-2.jpg`: one hearted library image per product, 39 frames

---

## 1. What the audit found

### The catalog outgrew the rules

There are 211 collections. 22 have an image and none has a logo. All the collection pages together drew 1,265 views in 90 days, and the brand pages drew close to none. Deleting a collection therefore costs almost no traffic, but it still needs a redirect (see section 3).

**The biggest single cause of drift: 883 active products carry the product type "Discontinued".** Only 10 of them have a `discontinued_at` date, and 683 have more than 3 units in stock. The 2026-09-25 pricing work already ruled that discontinued is a state, not a type (`app/lib/discontinued-state.ts`). In practice, a working product gets its real type overwritten and then:
- it drops out of every type-based collection. Wands, Vibrators, Plugs and the rest are all short.
- it pads every tag-based collection with what reads as clearance stock.
- it makes `on-sale` (730 items) and `last-chance` (772) look like a sale when most of these items are full price.
- it makes brand counts wrong. Playboy shows 1 live product but has 30 in stock.

**Tag over-application.** `for:couples` is on 46% of the catalog. `matters:beginner-friendly` is on 198 anal plugs. `matters:warming` is on plugs, strokers, cock rings and candles, so "Warming Lubes" holds 35 lubes out of 392 products. `for:gift` is on 57 cock rings, and `matters:hands-free` is on strokers and realistic dildos. `matters:natural` is on realistic dildos.

**Rules that never matched their titles:**
- `massage-mood` uses TYPE CONTAINS "Massage", which pulls in 108 wands and 57 prostate massagers.
- `vibrators` uses TYPE CONTAINS "Vibrator", which leaves wands out.
- `anal` omits Vibrating Anal Toy.
- `training-sets` matches any title containing "training".
- `flavored-lubes` includes condoms, wipes and massage oils.
- `just-dropped` includes 25 Discontinued-typed items.
- `bath-body` and `natural-organic` use the identical rule.
- `on-sale` and `last-chance` differ only by inventory greater than 1 versus greater than 0.
- `fetish-roleplay` and `fetishwear` hold nearly the same products.
- "Hybrid Lubircants" is misspelled.

**Utility collections are leaking.** `welcome-eligible`, `curious15-eligible`, `shop-products`, `lube-week-2026` and `daily-deal` are published to the storefront and non-empty. Nothing in the code hides them, so they show on the `/collections` hub, in the sitemap, and in llms.txt.

**Duplicates.** Several shelves do the same job:
- vibrators and all-vibrators
- dildos and all-dildos
- realistic and realistic-dildos
- anal and vibrating-anal
- prostate and prostate-toys
- silicone and body-safe-silicone
- penis-pumps and penis-sleeves inside pumps-extenders
- the 37-item app-controlled and the 188-item discover-app-controlled
- pride and discover-lgbtq
- date-night-box and discover-date-night

**Unshelved.** Erotic books (70 live), panties (58), and 14 brands with 15 or more live products have no collection. The largest are Screaming O, Male Power, Shinesty and Womanizer.

### The image pipeline has never worked

`updateCollectionImage` in `app/lib/shopify.server.ts:6399` is a stub that returns an empty string. The admin "generate collection image" flow on `/admin/collections-mgr` has never put an image on a collection. The flow also has two other problems: it watermarks the xdipx logo into the pixels, and it appends "no logos", which strips a product's real brand mark (the doctrine allows that mark since 2026-09-19).

The image appears in four places with different crops:

| Surface | Crop | Size at 375px |
|---|---|---|
| Collection page hero | 16:6 | about 343x129 |
| Hub cards | about 1.7:1 | 200px tall |
| Featured hub cards | about 1.35:1 | 200px tall |
| Merchandised pages (Body, Play, Pleasure, Wear, On sale) | 4:3 masthead | full width |

The hub only reads Shopify `collection.image`, so that is where the image has to live.

No logo field exists anywhere, so collection logos need a new data home.

### What your library feedback says

All 204 hearted images are Atlas seedream-4.5-edit cast frames. The pattern:
- Daylight bedrooms with white or deep plum sheets.
- Skimpy sheer lingerie.
- A diverse cast, including Vivian.
- Couples. Sofia and Diego were hearted 16 times.
- Faces showing pleasure or amused anticipation. Your note: "Love that this is showing what looks like pleasure on her face. More like this!"
- Two products in one frame.
- A hand that clearly holds the product.

Your rejection notes are written into every scene as hard requirements:

- The cast member holds the product. No floating, no resting, nothing that looks stuck to the body. *"No more products shown against arms."* Not on shoulders, backs or arms.
- A product appears only where and how it is used:
  - a clitoral stimulator never on a back
  - a grind vibrator is sat on
  - a strap-on harness is worn by a woman, with the dildo in the front O-ring
  - blindfolds in couples bondage scenes, never sleep
  - handcuffs are handcuffs
- Female-anatomy products on female cast only.
- Labels on bottles and boxes must be visible. This is product depiction, so it fits within "no text or labels" in the sense of no captions, overlays, or invented words.
- No bare breasts. Nipple covers should be subtle. No visible genitals and no pubic hair above the waistband.
- Every frame tells a story. Your note: *"Vibrators are not used while drinking coffee at the table. Set the scene and the story!"*
- Correct product scale and anatomy. Extra hands and misplaced belly buttons were common failures, so the QA gate checks for them.

---

## 2. Taxonomy plan

The tree below is shopper-facing and lives on the hub and in the nav. Shopify itself has no nesting.

| Hub group | Collections |
|---|---|
| Vibrators & wands | vibrators (parent, re-ruled to include wands), wands, finger-clit-vibes, rabbits-dual-action, g-spot, bullets-eggs, suction-air-pulse, thrusting-vibrating, couples-vibrators, app-controlled |
| Dildos & strap-ons | dildos, realistic-dildos, silicone-dildos, vibrating-dildos, fantasy-non-phallic, strap-on-harnesses, strap-on-compatible |
| Anal & prostate | anal, plugs, beads, training-sets, prostate |
| For him | strokers, cock-rings, pumps-extenders, mens-underwear |
| Lube, oils & wellness | lubricants, water-based, silicone-based, hybrid-lubricants, warming-lubes (retitled "Warming & cooling"), flavored-lubes, anal-lubes, enhancers-arousal, desensitizers, oral-enhancers, massage-mood, massage-oils, toy-cleaners, hygiene-douches, condoms, pheromones, kegel-exercisers, natural-organic, body-safe-silicone |
| Bondage & kink | restraints, blindfolds, collars, gags, paddles-crops, nipple-toys, sex-furniture, chastity-cages, electrostim, fetish-roleplay |
| Lingerie, wear & books | wear, bra-panty-sets, bodysuits-teddies, babydolls-chemises, bodystockings, hosiery, sets, pasties, costumes, plus new **Panties** and **Erotic books** |
| Shop by need | couples, first-time, best-sellers, just-dropped, on-sale, under-25, under-50, games-romance, discover-gift-guide, discover-date-night, discover-long-distance, discover-discreet-picks, discover-whisper-quiet, discover-travel-friendly, discover-lgbtq, discover-bachelorette, wearable-toys, plus-size |
| Merchandised section pages (no change this pass) | pleasure, play, body, wear, wellness-care |
| Brands | about 80, with a curated top 24 on the hub and an A-Z list |

### Delete

All of these get a 301 to the named parent, except where 410 is listed.

| Delete | Why | Redirect |
|---|---|---|
| frontpage, daily-deal, bonus-deal | Daily deals retired 2026-08-03 | 410 |
| cbd-supplements (0), all-wellness (1), kits-sets (1) | Empty | /collections |
| thrusting-rotating (6) | Duplicate | thrusting-vibrating |
| last-chance | Duplicate of on-sale, and the name reads as urgency theater, which the voice charter bans | on-sale |
| discover | Umbrella over every discover tag (1,106 items); its categoryPage is a draft, never live | /collections |
| under-30, under-100 | under-100 is 90% of the catalog | under-25 / under-50 |
| rechargeable, accessories | Rule-flawed (accessories is mostly lube upsells) | vibrators / /collections |
| bath-body | Same rule as natural-organic, and the tag is wrong | natural-organic |
| 16 thin brands (fewer than 8 in stock): honey-play-box, fifty-shades-of-grey, fuck-water, playground, clone-a-willy, njoy, lifestyles, classic-brands, the-male-rose, beloved, thevibed, oh-la-la-cheri, savage-me, twisted-wares, bonks, rhino | Products stay live on their category pages | nearest category |

Magic Wand (6) stays as an exception. It is the category-defining brand and a paid landing page. Playboy, Kixies, B Swish and Tentra stay pending the re-measure in step 2 of section 4.

### Merge

The loser gets a 301 to the keeper. Redirects always point at the final keeper, never through a chain.

| Keep | Absorb | Note |
|---|---|---|
| vibrators | all-vibrators | 6 blog links point at all-vibrators |
| dildos | all-dildos | |
| realistic-dildos | realistic | |
| anal | vibrating-anal | |
| prostate | prostate-toys | 6 blog links point at prostate-toys |
| fetish-roleplay | fetishwear, masks, body-harnesses | |
| body-safe-silicone | silicone | 3 blog links |
| pumps-extenders | penis-pumps, penis-sleeves | 1 blog link |
| app-controlled (keeps its handle and image) | discover-app-controlled | Re-ruled to the larger 188-item tag set |
| discover-lgbtq | pride | |
| warming-lubes | cooling | Retitled "Warming & cooling" |
| discover-date-night | date-night-box | |
| massage-mood | candles | massage-mood re-ruled to oils and candles |
| wear | apparel | |
| play | all-bondage | |

### Re-rule (keep the handle, fix what it holds)

- **vibrators:** TYPE IN (every vibrator type, plus Wand Massager).
- **anal:** add Vibrating Anal Toy.
- **massage-mood:** TYPE IN (Massage Oil, Massage Candle).
- **warming-lubes:** TYPE = Lubricant AND tag warming or cooling.
- **flavored-lubes:** TYPE IN (Lubricant, Oral Enhancer).
- **just-dropped:** exclude Discontinued.
- **training-sets:** tag-based (anal training kits, kegel sets).
- **discover-beginner-kits:** retitled "Beginner friendly", with the plug over-tagging fixed. Rename or fold into first-time. See question 7.
- **hybrid-lubricants:** fix the title typo.
- **wellness-care:** re-ruled to lube and care types. It is indexed in Google and linked from the footer, so keep it.
- **natural-organic, wearable-toys, couples:** re-tag. `for:couples` should mean "designed for two", with a 10-15% target.
- **on-sale:** rebuilt on real clearance (`discontinued_at` set, or a compare-at price above the price).

### Add

| New collection | Live products / note |
|---|---|
| Screaming O | 51 |
| Male Power | 38 |
| Shinesty | 38 |
| Womanizer | 37; first, it has strong branded search |
| Together Toy | 28 |
| Rouge Garments | 25 |
| Perfect Fit | 24 |
| Sensuva | 23 |
| ID Lubricants | 21 |
| Luv Inc. | 21 |
| Rene Rofe | 17 |
| UVA | 17 |
| Nu Sensuelle | 15 |
| Stockroom | 15 |
| Erotic books | 70; category instead of a Hachette brand page |
| Panties | 58 |

Multi-vendor strings such as "Lovehoney,Womanizer" slip past a VENDOR EQUALS rule, so vendor names need normalizing first.

### Utility

Keep these four, give them no hero image, and hide them from the hub, sitemap and llms.txt: welcome-eligible, curious15-eligible, shop-products, lube-week-2026. Delete lube-week-2026 if the promo is over.

**Net:** about 211 collections become about 145, made up of about 93 category and theme collections, about 80 brands, and 4 hidden utility collections.

---

## 3. Imagery plan

**Series: "One Saturday, every door open."** It is built on your line: *"The door doesn't have to stay closed, and we don't have to hide in the dark to use sex toys."* Every image is one moment in the same sunlit house on one Saturday, from 8am to sunset:
- Body collections are the morning.
- Pleasure is late morning to noon.
- Wear and Discover are the afternoon.
- Couples and Play are golden hour.

The hub grid then reads as the day going by, with the same eight people moving through the same rooms. The full bible is in `scenes-category.md` §1.

What holds the set together:
- **Four rooms.** White, coral-soft and plum-soft plaster, plus a bath and a hotel room.
- **One window.** Always frame-left, with a hard mullion shadow and a named hour.
- **One lens.** 50mm at mattress height.
- **One coral note per frame.**
- **At most one story cue per frame.** The half-open walnut toy drawer, the open door, or a charging cable.
- **Wardrobe from the cast closets.** Skimpy and sheer at register 9, with opaque detail only where the ceiling needs it.

Brand frames use the same house and light, shot waist-up: a cast face plus the hands holding that brand's signature product. Category frames show bodies and moments, and brand frames show people.

**Cast coverage:**
- Category: 81 of 93 frames (87%) carry named cast. The other 10 are hands-only frames, using named cast hands identified by their jewellery. No empty rooms and no seamless backdrops.
- Brand: 60 of 82 frames (73%) carry cast.

**Couples:**
- Sofia and Diego
- Maya and Marcus
- Priya and Jade
- Diego and Marcus
- Vivian with Marcus or Diego

Emma chooses or anticipates, and never appears in an afterglow frame.

Sample scenes:
- **Vibrators:** Jade brings the Womanizer Next to Priya's hip, and Priya is laughing before it is even on.
- **Strap-on harnesses:** Priya kneels on the bed in the Bend Over harness, the dildo in the front O-ring, grinning down at Jade.
- **Blindfolds:** Jade knots the Twilight Tease behind Priya's head, and Priya's lips part into a smile.
- **Lubricants:** Maya squeezes the Coconu onto Marcus's fingers, and they both watch the strand stretch.
- **Couples:** at golden hour Maya holds the We-Vibe Chorus. One cuff is already on Marcus's wrist, and he is laughing.

**Products are the hero.** Every frame uses the real Shopify packshot as a reference (one to three products, all checked as active, in stock, and in that collection). Labels are composited from the packshot rather than drawn by the model. This overrides the image-prompt-library default of no reference for collection images, per your direction today.

**Crop.** One 2560x1440 (16:9) master, with faces, hands and product in the middle band (x 18-82%, y 25-75%). That master survives all four crops. The product spans at least 35% of the band height, so it still reads at 343x129 on a phone.

**Ceiling.** The ceiling is instagram-campaigns.md §3.2a with §3.2c, which on-site surfaces have inherited since 2026-09-20. Your feedback tightens it in a few places:
- Breasts are covered by lingerie.
- Pleasure and anticipation show on faces, with use implied by framing.
- The act itself is never depicted.

Collections that cannot be shown in use honestly are shown held or about to be used:
- chastity, pumps, gags and nipple clamps are held
- electrostim is limited to the violet wand above a thigh
- desensitizers use the spray only
- hygiene uses washes and mists only

**Logos.** Logos are sourced, not generated. A fal-made logo would be a fabricated copy of a real company's trademark. The sources, in order:
1. Brand press kits and dealer portals (about 32 brands, transparent PNG near certain)
2. Brand site headers plus a trade request (about 38 brands)
3. Retitling the 12 distributor or house vendors that have no consumer mark (Paradise Marketing is really Trojan) or running them text-only

Display: the logo goes above the H1 on the brand page (36px on mobile) and in the hub brand card, never on the photo. Default is monochrome ink, with the brand's reversed file on dark surfaces. If there is no logo, the page shows the plain H1 and no imitation wordmark. Storage: a new additive Sanity type `brandIdentity`, which also records where each file came from.

**Model.** Atlas `bytedance/seedream-v4.5/edit`, not fal. Every image you hearted came from it. fal's input filter rejects these product-and-cast pairings, while the same model on Atlas passes them at $0.036 an image. fal stays as the fallback, and is used for background cutouts.

**Cost.**
- About 600 generations, at 3 candidates per cast frame and 4 per collage, including retries: about $22.
- Cutouts: about $1.
- Automated vision gate: $3-6.
- Requested cap: $45.

**QA, in order:**
1. A vision gate on the real page crops, checking hands, anatomy, product identity and label legibility.
2. A contact-sheet review by media-manager.
3. Your approval.

A frame that fails is regenerated once. If it fails again, it falls back to a product-photo composite. Nothing is customer-visible until you approve it.

---

## 4. Execution order

Deletion is the only step that cannot be undone, so it comes after the data is fixed and re-measured.

1. **Fix the Discontinued type.** Restore each product's real type using the derive logic in `product-type-derive.ts`, mark clearance only where `discontinued_at` is set, and fix whatever writer sets type "Discontinued". This is a code ticket plus a Shopify data sweep, with a dry-run list for review first.
2. **Re-measure all collections,** then re-check the delete and keep thresholds above. Some borderline brands will change sides.
3. **Code PR, one owner-visible change set:**
   - (a) a collection redirect map (301 and 410), checked before the 404 in the collection route and its .md twin
   - (b) hide the utility collections from the hub, sitemap and llms.txt
   - (c) implement `updateCollectionImage` (stagedUploadsCreate, then collectionUpdate), with no watermark on the collection path
   - (d) the `brandIdentity` Sanity type plus the logo in the brand page header and hub cards
   - (e) the hub grouping above, through an additive `hubGroup` field
   - (f) a contact-sheet review route, `/admin/collections-review`, showing each candidate at its real crops with Approve, Reject and Redo
4. **Re-rule, re-tag, add the new collections** in Shopify. The main menu gets updated first, because the sitemap emits menu links without checking that they exist.
5. **Repair links,** then delete and merge:
   - code links: Footer brand fallbacks for any brand that is deleted, the StorefrontHome mood pills (massage-mood), the category healthcheck (on-sale)
   - 16 blog-post links to merged handles (all-vibrators 6, prostate-toys 6, silicone 3, penis-sleeves 1)
   - orphaned Sanity `collectionPage` docs
6. **Imagery pilot:** 6 category and 6 brand frames, about $1.50, for your review on the contact sheet.
7. **Full batch** in groups by hub section, each group approved on the contact sheet, then uploaded to Shopify.
8. **Logos** for tier 1 brands first. Tiers 2 and 3 follow as files arrive.

### Standing policy to land after you approve

These are written so the direction does not need repeating:
- **`.claude/agents/media-manager.md`, via agent-editor:**
  - Atlas is primary, not fal.
  - The collection crop spec and the single 16:9 master.
  - Collection heroes use product references.
  - Your library rejection rules as a collection-hero checklist.
  - Logos are sourced, never generated.
- **`docs/store-team/instagram-campaigns.md` §3.2c, via agent-editor:** it still licenses beads along the spine and a mini wand across the lower back. Your notes ("No more products on arms", the clitoral stimulator on a back) say no. This edit needs your "codify".
- **`docs/homepage-team/image-prompt-library.md`:** the no-reference default for collection images is replaced by your direction today.

---

## 5. Decisions only you can make

**Owner answers, 2026-10-24** (plan approved the same day):
1. for-him and for-her: **retire** (301 to the type-based keepers, matching `retired-routes.ts`).
2. Plus size: **add a plus-size cast member.**
3. Pasties: **shown worn.**
4. Prowler and Prowler RED: **merge into one collection.**
5. Brands on the hub: **curated top 24 plus an A-Z list** (read from "Yes").
6. Logo requests: **no emails.** The owner sources logos himself from the Nalpac brands page (https://www.nalpac.com/pages/brands) from a list we provide.
7. first-time and beginner-friendly: **merge into one.**
8. Spend: **$45 cap approved.**

The original questions follow for the record.

1. **for-him and for-her.** Specialists disagree. The designer says retire both with 301s: the code comment in `retired-routes.ts` says never send traffic to the gendered collections. Homepage-ia says keep the URLs and drive them from product-type lists: for-him is the most-viewed collection (159 views in 90 days), and the lead funnel links to it. **My recommendation:** keep both, re-ruled by product type, with no hero image and off the hub.
2. **Plus size.** None of the eight cast members has a plus-size body. Options: add a ninth cast member (a likeness decision), give plus-size a hands-only frame, or delete the collection. Its rule also pulls in cock rings and cages today.
3. **Pasties.** Shown worn (the pasty is the nipple cover, which is within the ceiling but at its edge), or shown being peeled off the card?
4. **Prowler and Prowler RED.** One house, so one collection, or two?
5. **Brands on the hub.** A curated top 24 plus an A-Z page, or all of them?
6. **Logo requests.** Tier 2 brands need a trade email asking for their logo files. Should I draft those for you to send?
7. **first-time vs discover-beginner-kits.** Keep one "Start here" collection (homepage-ia's call), or both?
8. **Spend.** Approve a $45 cap for generation, on Atlas rather than fal?

## 6. Pushback

- **The Discontinued fix has to come first.** Deleting collections on today's counts would delete Playboy, which has 30 products in stock, and keep shelves that are mostly mislabeled items.
- **Logos cannot be generated.** You said fal could make any images needed. For logos that would mean inventing a copy of a real trademark, so they get sourced instead.
- **"No text or labels" vs. "the box does not have the product label on it."** I read the first as no captions, overlays or invented words, and the second as: real product labels stay visible. Tell me if you meant otherwise.
- **GSC flags.** GSC lists `vibrators` as a soft 404 and `pumps-extenders` as a 5xx. Both pages serve 200 with products today, so those inspections look stale. Resubmit both once the cleanup is done, because they are merge targets.

---

## 7. Step 1 dry run: the Discontinued product type (2026-10-24)

Nothing has been written yet. The full list is `collections-audit-2026-10-23/retype-dry-run.csv`, with one row per product: the proposed type, how it was derived, Nalpac feed presence, stock, and the price before and after.

**Scope.** 894 active products are typed "Discontinued" today. 321 archived ones are out of scope.

**Finding.** 893 of the 894 are in today's Nalpac feeds:
- 531 are in the main feed only.
- 360 are also in Nalpac's on-sale feed.
- 2 are also in Nalpac's top-100 feed.

Only one product is actually discontinued: the Bcute Classic Curve Infinite LE vibrator, which appears in no feed. The rest are live products with the wrong type. No code writes the type "Discontinued" today, so this is legacy data and there is no writer to fix.

**Proposed types.**
- 885 rows were derived by the import pipeline's own rules in `product-type-derive.ts`, from the Nalpac Sub-Category and title.
- 33 of those 885 were corrected by title, where the rules are wrong:
  - 7 strap-on harness kits had been typed as dildos or vibrators
  - 6 masturbators carrying only Nalpac's "Non-Realistic" category had been typed "Dildo"
  - 4 G-spot vibrators had been typed "Prostate Massager"
  - 4 extender sheaths had been typed "Cock Ring"
  - 3 fantasy dildos had been typed "Anal Plug"
  - 1 thrusting dildo had been typed "Sex Machine"
  - 8 kits had no derivable type
- 14 packers are typed Dildo or Realistic Dildo because no packer type exists. They are flagged for review.
- Every proposed type exists in `pricing_product_type_map`.
- Largest groups: Realistic Dildo 59, Rabbit Vibrator 55, G-Spot Vibrator 44, Cock Ring 44, Anal Plug 40, Stroker 37, Men's Underwear 36, Erotic Books 33.

**Pricing impact (owner decision).** The pricing engine prices anything typed "Discontinued" on the clearance ladder, so retyping is a price change as well as a shelf change. I ran the engine's own functions (`computePrice`, the rule resolver, the cost precedence) over all 1,263 variants with the new types, read-only:

| | Variants |
|---|---|
| Price goes up more than 2% | 976 (median +12.5%) |
| Price goes down more than 2% | 77 |
| Within 2% | 210 |
| More than doubles | 36 (mostly Me You Us, e.g. a wand at $31.99 that prices at $80.99 on a $44.66 cost) |
| Sold below engine cost today | 36 (Me You Us 22, Prowler 13) |
| Would auto-apply at the next 07:00 UTC batch under `pricing_approval_mode=aggressive` | 1,227 |

Summed across variants, list prices go from $49,442 to $56,496.

**Time-sensitive interaction with #1765 (merged 2026-10-23).** The 07:00 UTC batch now stamps `discontinued_at` with today's date on every product still typed "Discontinued". The nightly sweep only clears a stamp it wrote itself, so a stamp on an in-feed product never clears, and it keeps the product on clearance pricing whatever its type. The apply step therefore deletes `discontinued_at` on every in-feed product it retypes. The clearance ladder deepens only at day 30, so nothing is lost if the apply lands this week.

**Apply plan, once approved:**
1. Write `productType` for the 893 in-feed products, and delete `xdipx.discontinued_at` on any of them that carry it. That covers the 10 stamped 2026-09-25/10-16 plus whatever the #1765 backfill stamps.
2. Bcute: type Vibrator, and keep it in the discontinued state.
3. Re-run the collection measurement (plan step 2).
4. Code ticket:
   - fix the four derive-rule gaps above so new imports land correctly
   - add a guard so nothing writes the type "Discontinued" again
   - retire the legacy `productType === 'Discontinued'` pricing route once the catalog is clean

**Collection rules that must follow the new types** (plan step 4): Nipple Toy vs Nipple Clamps, Kegel Exerciser vs Kegel Trainer, Gag vs Ball Gag, and Fetish Wear vs Fetishwear. Each collection rule needs both names, or the retyped products miss their shelf.

### Applied 2026-10-24 06:37-06:48 UTC (owner: "Apply the retype as proposed, clear discontinued_at on the in-feed products, and let normal pricing take over.")

- 894 of 894 products retyped with zero errors, before the 07:00 UTC pricing batch. Shopify shows 0 active products typed "Discontinued"; the 321 archived ones were left alone.
- `discontinued_at` was deleted on the 10 in-feed products that carried it. The Bcute vibrator, which is in no feed, was stamped discontinued. A follow-up check found no in-feed product with a stamp.
- Every product's type in Shopify matches the dry run.
- Re-measured in-stock shelf counts: vibrators 732 to 892, dildos 486 to 613, anal 285 to 345, realistic-dildos 257 to 311, rabbits 129 to 178, cock-rings 323 to 365, g-spot 128 to 168, men's underwear 81 to 112. The brand thresholds did not change: the same 17 brands sit under 8 in stock, and Playboy (30), Kixies (11), B Swish (8) and Tentra (8) all stay.
- **Side effect: `on-sale` and `last-chance` emptied**, because their only rule was TYPE = Discontinued. `on-sale` is a live drop page in the site menus, so it is re-ruled to the tag `sale:active`. That tag goes on active, in-stock products with a variant priced at 60% or less of compare-at (586 products on pre-batch prices). The set is recomputed after the 07:00 batch. `last-chance` stays empty until its planned deletion with a 301 to on-sale.
- Tickets: #17600 (derive-rule gaps, a guard against the Discontinued type, retiring the legacy pricing route) and #17601 (nightly `sale:active` sweep after the pricing batch).
- **Pricing batch 2026-10-24 (07:00 to 07:45 UTC)** on the 1,262 retyped variants:
  - 1,040 repriced automatically, average +14.8%, +$6,447 summed across variants
  - 36 queued as pending in the pricing approval queue because each change exceeds the 80% auto-apply threshold (average +133%, mostly Me You Us)
  - 186 unchanged
  - Re-checked after the batch: no in-feed product carries `discontinued_at`.
- **`on-sale` re-ruled** after the batch from TYPE = Discontinued AND inventory > 1 to TAG = `sale:active`, with the tag applied to the 518 products that qualify on post-batch prices.
