# Meta ads category teardown: how sex-toy brands get through review (2026-10-03)

Read-only competitive teardown. No codebase changes. Every claim below is something visible in the
public Meta Ad Library, on a public landing page, or in Meta's published policy text on the day of
capture. Nothing here recommends cloaking or deception; where a competitor does something
deceptive, it is labeled as such and listed under "do not copy".

Scratchpad for all captures:
`/private/tmp/claude-501/-Users-mikebayard-Claude-xdipx-store--claude-worktrees-ad-studio-platform-redesign-9162de/a73e47eb-9e41-4387-91ff-b14973999439/scratchpad/teardown/`
(abbreviated below as `$TD/`). The full file list is in the Appendix.

## TL;DR

1. **The owner is right that sex-toy brands run Meta ads daily, at scale.** Hello Nancy alone has
   ~950 active ads worldwide (~800 in the US), and created a fresh batch of 30 on 2026-10-02.
   Lovehoney/Womanizer, LELO, Bellesa, Unbound, Maude and Tabu are all live too.
2. **Meta's written policy has not changed to allow sex toys.** The current Health and Wellness
   policy (last updated 2026-07-22) still lists "Sex toys" as the first example of what ads cannot
   promote. What it allows is sexual-health products "as long as the focus is on health and the
   medical efficacy... and not on the sexual pleasure or enhancement."
3. **So the brands are not exploiting a loophole in the text. They are operating in an enforcement
   gap,** using a recognizable set of techniques that keep the automated reviewer from classifying
   the ad as a pleasure product: object disguise (a lemon, a tennis ball, a "massager"),
   wellness/self-care/menopause vocabulary, innuendo instead of nouns, groin-adjacent but clothed
   imagery (which Meta's nudity policy permits with 18+ targeting), creator partnership ads, and
   landing pages on separate subdomains or separate domains. Several of the explicit ones (Lovehoney's
   "Get off, every time", Nancy's "best O's of your life") are clearly over the written line and
   are running anyway. That is risk tolerance on a large, aged ad account, not permission.
4. **The compliant subset xdipx can copy is real and still effective:** object-first product
   photography, a "personal massager / wellness device" register, menopause and body-literacy
   education angles, a single-purpose bridge lander that matches the ad's register, discreet
   shipping and guarantee as the offer, and creator partnership ads. The parts xdipx must not copy
   (fabricated advertorial bylines, rotating throwaway pages and domains, link shorteners, countdowns)
   are listed in Section 5.

---

## 1. Hello Nancy in the Ad Library

**Access:** The Ad Library page loaded without login in the built-in browser and in headless
Chromium. The `start_date[min]=2026-09-01` filter in the owner's URL was not honored by the public UI
(it returned ads started as early as 2025-08-29); the sort by total impressions was honored. Per-ad
targeting (age/gender breakdown behind "EU transparency" and "See ad details") did not render
without login, so the age floor Nancy uses is **not visible** here. The Meta Ads MCP
`ads_library_search` returned 950 active ads for page `104131582317919` (all countries); the newest
30 were created 2026-10-02 08:08 UTC and are billed in **HKD** (the ad account currency).

Page URL used: https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&search_type=page&sort_data[mode]=total_impressions&sort_data[direction]=desc&view_all_page_id=104131582317919

Second Nancy-branded page seen in keyword search: **"Love Nancy"** (ad `1120840390269025`, started
2026-08-17, video 1:42, "When life hands you a lemon, make a very good decision.").

### 1a. Top 25 active ads, US, sorted by impressions

Platforms for Nancy's own-page ads: Facebook, Instagram, Audience Network, Messenger, Threads (five
icons). Creator partnership ads show four (no Messenger). "Variants" means the Library's "N ads use
this creative and text" count. Creative file references (`cNN.jpg` in `$TD/nancy-creatives/`) are
order-matched from the page render to the ad card; the tile screenshots `$TD/nancy-adlib-tile-00.png`
to `-02.png` show the same cards in place.

| # | Library ID | Started | Type | What the creative shows | Class | Primary text (quote) | Headline | CTA | Lander | Variants |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3362950760532678 | 2026-01-20 | Image | Illustrated oval frame, hand holding the yellow Lem, white rabbits, "YOU'RE NOT BROKEN." plus "fall asleep" and "puffiness" benefit lines (c02) | product-visible, text overlay | "Meet Lem - your zesty new playmate" | (none shown) | (none shown) | (none shown) | 2 |
| 2 | 1399400144876812 | 2026-01-08 | Image | Lemon toy on a bed of red roses, "Lem's on sale. Regret isn't." (c03) | product-visible, text overlay | "Have the best O's of your life" | This New Year, Lem Ends the Guessing. | Shop now | unlock.hellonancy.com | 1 |
| 3 | 1406190500958859 | 2026-01-08 | Image | Poster: "WE'RE SORRY" apology joke, "50% OFF SANITY", lemon cut-out (c04) | text-only (product small) | same as #2 | same as #2 | Shop now | unlock.hellonancy.com | 1 |
| 4 | 949619171176829 | 2026-04-20 | Video 0:21 | Hand holding Lem, suction opening facing camera (c05) | product-visible | "Meet Lem - your zesty new playmate" | (none shown) | (none shown) | (none shown) | 4 to 6 |
| 5 | 2124144838516531 | 2026-08-05 | Image, multiple versions | Pink card, giant lemon, "IT'S JUST A LEMON right?" "UP TO 50% OFF" (c06) | product-visible, text overlay | "Some things don't need an explanation." | New Year Sale. Up to 50% Off. | Shop Now | (none shown) | 3 |
| 6 | 4470731369825113 | 2026-03-07 | Image | Lemon held in front of a woman's grey briefs at the groin, torso cropped, "You'll Thank Us Later" (c07) | product-visible, groin-adjacent skin | Long first-person story, "my search history was a disaster" | The ultimate self-care upgrade. | Learn more | get.officialnancy.com | 1 |
| 7 | 1063770975746713 | 2025-08-29 | Video 0:20 | Iridescent mailer, caption "POV: You ordered Lem during a sale... curled up like a croissant" (c08) | product-abstracted (packaging), meme caption | "Meet Lem - your zesty new playmate" | Discreet Packaging + Free Shipping | Shop now | unlock.hellonancy.com | 1 |
| 8 | 865031509832666 | 2026-01-23 | Video 0:40 | Creator in bedroom holding Lem gift box, TikTok-style reply bubble "A lemon shouldn't cost this much!" (c09) | UGC/talking-head | "Remember the stress last Valentine's?" | This Valentine's, You Win. | Shop now | unlock.hellonancy.com | 1 |
| 9 | 1175449781453534 | 2026-01-08 | Image, multiple versions | "IT'S JUST A LEMON" card (c06 dup) | product-visible, text overlay | same as #2 | This New Year, Lem Ends the Guessing. | Shop Now | (none shown) | 1 |
| 10 | 931974462578251 | 2026-03-07 | Video 0:29 | Creator face, caption "If you bought Lem in the last few months at full price..." (c11) | UGC/talking-head | "Meet Lem - your zesty new playmate" | Discreet Packaging + Free Shipping | Shop now | unlock.hellonancy.com | 1 |
| 11 | 734494959720039 | 2026-01-08 | Image | Roses + lemon (c03 dup) | product-visible | same as #2 | same as #2 | Shop now | unlock.hellonancy.com | 1 |
| 12 | 1437396824652122 | 2026-03-07 | Image | Lemon against black lace underwear, hip and groin crop, "Your New Obsession" (c13) | product-visible, groin-adjacent skin | Same long story as #6 | The ultimate self-care upgrade. | Learn more | get.officialnancy.com | 1 |
| 13 | 1225992416123946 | 2026-01-23 | Video 0:34 | Product close-up on a desk, "If you bought Lem..." caption (c14) | product-visible | "Remember the stress last Valentine's?" | This Valentine's, You Win. | Shop now | unlock.hellonancy.com | 1 |
| 14 | 1682027162933597 | 2026-04-20 | Video 1:07 | Extreme close-up of a woman's face with pink light, "#1" badge (c15) | lifestyle-no-product (opening frame) | "Meet Lem - your zesty new playmate" | (none shown) | (none shown) | (none shown) | 2 to 3 |
| 15 | 2045815462947599 | 2026-04-20 | Video 0:20 | Woman lying in bed, same "POV... croissant" caption (c16) | UGC/meme | "Meet Lem..." | (none shown) | (none shown) | (none shown) | 2 to 3 |
| 16 | 1705243093904183 | 2026-09-17 | Video 0:05 | Nightclub, two women, shirtless male performers in background, "Nancy girls wildest dreams coming true" (c17) | lifestyle-no-product | "Flying topless men for the Nancy girls" | (none) | (none) | (none) | 2 |
| 17 | 2101333740424818 | 2026-04-13 | Image | Black poster "HURRY!! BEFORE IT'S OUT OF STOCK", Lem + Berri, "ALL FOR THE oh-yes MOMENTS" (c18) | product-visible, text overlay | "Remember the stress last Valentine's?" | (none shown) | (none shown) | (none shown) | 2 |
| 18 | 2177560976353117 | 2026-04-21 | Video 1:25 | Talking-head creator holding the lemon, caption "as the Lemon" (c19) | UGC/talking-head | "Meet Lem..." | (none shown) | (none shown) | (none shown) | 2 to 3 |
| 19 | 1397285089202256 | 2026-09-17 | Video 0:41 | Woman in tropical setting, retreat footage (c20) | lifestyle, product incidental | "sometimes loving someone as they become themselves" | (none) | (none) | (none) | 2 to 3 |
| 20 | 1765443341173795 | 2026-09-16 | Video 0:12, partnership "Ashley Wilson with Hello Nancy" | Creator in bikini at pool with lemons as hair curlers (c21) | UGC/creator, product as prop | "now this was fun" | (none) | (none) | (none) | 1 |
| 21 | 947348781746952 | 2026-09-17 | Video 0:30, partnership "Nika and Emeka with Hello Nancy" | Mom in hotel room unpacking Nancy tote, caption about healing journey (c22) | UGC/creator testimonial | "The postpartum healing plan has apparently escalated" | (none) | (none) | (none) | 4 |
| 22 | 1697458471446531 | 2026-06-16 | Video 0:17 | Woman cross-legged on bed holding Lem, "Do THIS" (c23) | UGC/talking-head | "Meet Lem..." | Discreet Packaging + Free Shipping | Shop now | unlock.hellonancy.com | 1 |
| 23 | 931962499985672 | 2026-09-16 | Video 0:42, partnership "Amanda McCants with Hello Nancy" | Creator in jungle, "POV you're the Samantha of the group", "Pleasure is wellness" (c24) | UGC/creator | "You wake up with a coffee? She wakes up with a" @hellonancy | (none) | (none) | (none) | 1 |
| 24 | 2962465837463045 | 2026-09-15 | Video 0:10, partnership "Sex Ed with DB with Hello Nancy" | Creator holding a tennis ball, "Girls will be like 'I needed this' and it's just a tennis ball" (c25) | UGC/meme, product disguised | "I did indeed need the smash" | (none) | (none) | (none) | 2 to 3 |
| 25 | 880605218369141 | 2026-04-20 | Image | Lemon over sheer mint underwear, navel to upper thigh crop, "So Good You'll Scream" (c26) | product-visible, groin-adjacent skin | "Meet Lem..." | (none shown) | (none shown) | (none shown) | 2 |

"(none shown)" means the Library card rendered no link card. For the partnership ads that is
expected (boosted creator posts). For Nancy's own catalog-style ads it most likely means a dynamic
or Advantage+ format the public card does not expand; treat the lander as unknown.

### 1b. Aggregate counts (129 ads rendered on the US page)

- **Landing domains:** `UNLOCK.HELLONANCY.COM` 84, `GET.OFFICIALNANCY.COM` 8, `HELLONANCY.COM` 2.
  The main store domain is almost never the ad destination.
- **CTA buttons:** "Shop now/Shop Now" 81, "Learn more" 8 (all 8 on the get.officialnancy.com
  advertorial). No "Order now", no "Sign up".
- **Start months:** Sep 2026 61, Jan 2026 29, Apr 2026 18, Mar 2026 13, Aug 2026 5, Jun 2026 2,
  Aug 2025 1. Winners run for 8 to 13 months untouched (the 2025-08-29 croissant video is still in
  the top 10 by impressions).
- **Creative reuse:** the single primary text "Meet Lem - your zesty new playmate" appears on **52**
  of 129 ads. Nancy holds the words fixed and rotates the visual.
- **Creator partnership ads (Sep 2026, "Nancy Out of Office" retreat in Playa del Carmen):** 13
  distinct creators, including "Amanda McCants" (6), "Sex Ed with DB" (2), "Health NewsExplained"
  (2), "Luvbites by Dr. Tara" (1), plus 11 others. Hashtags `#PleasureIsWellness`, `#NancyOutOfOffice`.
- **Newest batch (2026-10-02, via MCP):** 30 ads with headlines like "Grand Slam Behavior", "A
  'tennis ball,' sure.", "Mixed doubles?", "The Little Lemon Secret", "This Is Not Avocado Toast"
  for the new Tennis Collection (Smash wand, Ace suction) and Avo/Berri.

### 1c. Creative classification across ~130 unique creatives

Contact sheets: `$TD/nancy-contact-0.png` through `-5.png` (132 unique creatives after de-dup).

| Class | Share (eyeballed from contact sheets) | Typical example |
|---|---|---|
| UGC / talking-head / creator | ~40% | Creator on bed holding the box; retreat vlogs; partnership posts |
| Product-visible, object-first (product on surface, in hand, on roses/lemons/silk) | ~25% | c03 roses, c05 hand, c46 water-splash lemon, c90 lemon on pink silk |
| Product-visible on clothed groin/hip/belly (underwear or swimwear, torso crop, no face) | ~10% | c07, c13, c26, c34, c85 couple in underwear, c89 orange tights |
| Text-only / poster (big type, small product) | ~10% | "WE'RE SORRY", "IYKYK.", "YOU'RE NOT THE PROBLEM" list |
| Lifestyle-no-product (party, pool, retreat) | ~10% | c17 nightclub, c28 two women kissing on boat, c77 pool floats |
| Meme / screenshot (reply-bubble, POV caption) | ~5% (overlaps UGC) | "A lemon shouldn't cost this much!", POV croissant |

Observed visual rules, consistent across every Nancy creative:

- The product is never shown in use, never touching skin directly on a body part, never near a
  face in a suggestive way. On-body shots are always **product held or placed over fabric**.
- No visible nipples, no genitals, no sheer-enough-to-see fabric except c26 (sheer mint, nothing
  visible). Bikinis and underwear are allowed and used heavily.
- The device is always the lemon shape. A reviewer (human or classifier) sees fruit. The new tennis
  line repeats the trick: "it's just a tennis ball".
- Overlay text does the sexual work through innuendo: "So Good You'll Scream", "You'll Thank Us
  Later", "Worth Every Squeeze", "curled up like a croissant", "legs give out". Some overlays
  self-censor with algospeak: "s3*xual wellness" (c91), "Segs toy brand trip" (c32).
- Brand system is constant: hot pink + lemon yellow, the script "Nancy" wordmark, roses and
  lemons as props.

### 1d. Copy register in Nancy's ads

- Nouns used: "Lem", "playmate", "air suction bliss", "the lemon", "self-care upgrade", "wellness".
  The words "vibrator" and "sex toy" do **not** appear in any top-25 primary text. "Clitoral"
  appears on the store, never in the ads.
- Sexual outcome language that does appear: "best O's of your life", "what their bodies are capable
  of", "pleasure", "ecstasy" (once, inside a long story). This is over Meta's written line and still
  running.
- Social proof number in the first line: "Over 500,000+ women".
- Discount and urgency: "Up to 50% off", "Limited units available", "Don't regret missing this".
  Seasonal hooks reused far out of season (New Year and Valentine's ads still active in October).
- Long-form story format (#6, #12): a 40-line first-person confession about being overwhelmed by
  options, resolving in "Stop scrolling. And start feeling." Pointed at an advertorial domain with a
  "Learn more" CTA.

---

## 2. The Nancy landers

### 2a. https://unlock.hellonancy.com/lem-holiday (the "bridge")

Screenshots: `$TD/nancy-lander-lem-holiday.png` (desktop), `$TD/nancy-lander-lem-holiday-mobile.png`.
HTML and text: `$TD/nancy-lander-lem-holiday.html`, `.txt`.

- **Subdomain strategy.** `unlock.` is a separate **Webflow** site (`data-wf-site=62d16842feb6841eb61fae8e`),
  not Shopify. The main store `hellonancy.com` is Shopify. So the URL Meta's reviewer crawls is a
  different host, a different platform, and contains none of the store's product pages. The CSS
  class `ACC_HN_Bridge_Unlock_16` (an Instant.so test variant) names it what it is: a bridge page,
  version 16.
- **Structure, top to bottom.** (1) Full-bleed, blurred, warm-toned close-up of two hands touching,
  no product. (2) Headline "Start the New Year by Exploring Your Curious Side" with "Curious" in hot
  pink. (3) One sentence: "Join the 500,000+ Who Found Their YES. Shop Up to 50% Off Today." (4) One
  pink button: "Click here to Unlock the Lem". (5) An animated "As seen on:" press-logo ticker (Time
  Out, Tatler, plus three smaller outlets). That is the whole page.
- **Words used for the product:** only "the Lem". No vibrator, no sex toy, no clitoral, no
  massager, no pleasure, no wellness. The page title is "Lem Holiday".
- **Imagery explicitness:** zero. Hands only. The product is **not visible at all**.
- **Path to purchase:** the single button links to
  `https://hellonancy.com/products/lem?hn_at=<long token>`, i.e. straight to the Shopify PDP with an
  attribution token. No quiz, no add-to-cart on the bridge, no redirect chain.
- **Offer:** "Up to 50% Off", social proof "500,000+".
- **Trust elements:** the press ticker only.
- **Age gate:** none.
- **Tracking loaded on the bridge (network capture):** Meta Pixel (`connect.facebook.net/en_US/fbevents.js`
  and `facebook.com/tr/`), Google Tag Manager `GTM-KVD8WD6`, GA4 `G-G8Q0F6KVZQ`, Google Ads
  `AW-11033179838` and `AW-18031112964`, Klaviyo onsite (`company_id=WCvs6L`, signup forms), Elevar
  (`shopify-gtm-suite.getelevar.com`), Triple Whale (`config-security.com`), Microsoft Clarity,
  Reddit pixel `a2_fal2or3i6uin`, X/Twitter pixel, PostHog, Bing. **No TikTok pixel on the bridge**
  (TikTok fires on the main store).

### 2b. https://get.officialnancy.com/lem/ (the advertorial, a separate registered domain)

Screenshot: `$TD/nancy-get-officialnancy.png`; text `$TD/nancy-get-officialnancy.txt`.

- A listicle advertorial: "7 Reasons This Lemon-Shaped Toy Broke TikTok". Byline "Sarah Mitchell",
  "Verified Purchase" badge on the byline. A sticky "SALE LIVE ... Ends in 05:59:43" countdown.
- Calls the product a "clitoral massager" and "lemon-shaped toy" once each, then leans on air-pulse
  explainer, "under 50 decibels", IPX7, "medical-grade silicone", a doctor quote, a comparison table
  vs "traditional toys", and the 30-day guarantee and discreet billing.
- Every CTA ("See If It's Still In Stock", "Try It Completely Risk-Free") links to
  `hellonancy.com/products/lem`.
- The same "Sarah Mitchell" byline appears on a third-party-looking site,
  `bestadulttoys.com/lemadvice/full-article` ("The Lemon That Saved My Life"), which is the lander
  for persona pages "Hidden Bloom" and "Lem & Light" (Section 3f). A fourth advertorial,
  `read.modernwellnessinsider.com`, is labeled "by Hello Nancy" on the page itself
  (`$TD/affiliate-mwi-starting-over.png`).

### 2c. Store register: hellonancy.com and the Lem PDP

Screenshots: `$TD/nancy-home.png`, `$TD/nancy-pdp-lem.png`.

The store is far more explicit than the ads and the bridge. This is the register gap the bridge
exists to bridge.

- **Homepage:** "Me time. O time.", "UNLOCK YOUR BEST ORGASM", product names "Lem Clitoral Massager",
  "Avo Clitoral Massager", "Berri Edging Clitoral Massager", "WAND VIBRATOR SMASH". Blurb for Lem
  says "So good, you'll scream." Countdown timer in the cart drawer and "Final minutes to save" in
  the announcement bar. Trust bar: free shipping, discreet packaging, 30-day guarantee, "Whisper-quiet
  (<50dB)", "20,000+ reviews | 1,000,000+ O's".
- **PDP (Lem, $89, struck from $159):** "4.8 (19,387 reviews)", "CLINICALLY RECOGNIZED" block
  ("Recognized by menopause specialists", "Used in pelvic floor wellness", "Backed by 6 peer-reviewed
  studies"), a doctor review from "Dr. Angela Wright, GP, Clinical Sexologist, BMS Registered
  Menopause Specialist", population cards for menopause, cancer recovery and SSRIs with study
  citations, and the disclaimer "Lem is a wellness device, not FDA-cleared as a treatment."
  Customer quotes on the same PDP are graphic (multiple orgasms, squirting).
- **Takeaway:** the clinical/menopause scaffolding on the PDP is what lets every surface Meta can
  reach (ad, bridge, advertorial) point at a page that *also* reads as sexual health. The explicit
  reviews sit below it.

---

## 3. Other brands on Meta (US, active, 2026-10-03)

Method: Ad Library keyword search (exact phrase, US, active) in headless Chromium, then link
extraction from the rendered cards and a lander capture. Keyword totals are Meta's "~N results" for
the phrase, which includes unrelated advertisers; page-level counts are what rendered in the first
~30 cards.

| Brand | Advertiser page name(s) seen | Active? | Creative strategy | Lander domain pattern |
|---|---|---|---|---|
| **Lovehoney + Womanizer** (same parent) | **"Womanizer.afterdark"** (17 of first ~30 cards) | Yes, since 2026-08-11 / 09-07 | Lovehoney Lemon (ROMP Lemon Crush) video ads, and Womanizer Premium videos incl. influencer UGC. Copy is the most explicit in the category: "Lemon: Get off, every time", "intense, body-shaking Os". Womanizer: "pleasure is self-care", "100 Day Pleasure Guarantee", code WOW20. | **bit.ly** short links. Lovehoney resolves to a separate domain `welovehoney.com/lemontoy/`, which sends buyers to **Amazon** with code EXTRA20LEMON. Womanizer resolves to `womanizer.com/us/premium` with ASC (Advantage+ Shopping) UTMs. |
| **LELO** | **"LELO Vibes"** | Yes, since 2026-04 | Wellness and "sonic wave technology" register: "LELO wellness products", "full-body massager", "Sonic waves, not vibration", plateau/"Stop Settling for Just Close". Price-led statics ("$79.50, 50% off applied at checkout"). | A separate brand domain `lelovibes.com` (not lelo.com), with campaign subdomains `feel.lelovibes.com/unlock-collection` (one-screen "Ready To Unlock Your Deepest Desires?" + "UNLOCK" + **"18+ only"**) and `explore.lelovibes.com/sona2-offer` (long-form single-product lander with add-to-cart, "It doesn't vibrate. It sends sonic waves."). Also an affiliate comparison `cornermagazine.online/compare/lelo-sona-3-vs-hello-nancy-lem/`. |
| **Bellesa Boutique** | **"BBwellness", "BB Vital", "BB Self", "BB Wellness", "Viva Bellesa"** | Yes, Aug to Sep 2026 | "Women-founded. Award-winning design. Body-safe everything.", "Plain Packaging. Not-So-Plain Results.", "Up to 60% off. Limited time." Product-on-pink statics, close-up textures. | **Four parallel lookalike domains**: `shopbb.co`, `bbvital.co`, `bbself.co`, `boutiquebb.co`, each with `?promo_offer=60SAVE-PS`. Lander is a full storefront clone (For Women / Beginners / Couples / Men, "WhisperTech", Trustpilot 4.8, "10 year quality guarantee"). This is page-and-domain rotation; see Section 5. |
| **Unbound (Unbound Babes)** | "Unbound Babes" | Yes, 2 ads started 2026-10-02 | Product spec bullets: "Unbound's most powerful and best-selling vibe", 10 speeds, waterproof, 1-year warranty. Short product video. Uses the word "vibe". | Main domain PDP `unboundbabes.com/products/unbound-ollie-vibe`. Meta Pixel and TikTok pixel. Unbound is also the brand that publicly ran a fake-brand test exposing Meta's uneven enforcement ([Beauty Independent](https://www.beautyindependent.com/unbound-fake-brand-expose-meta-unequal-treatment-ads-women-focused-sexual-products/)). |
| **Maude** | "maude" | Yes, 4 ads started 2026-10-01 | Ultra-conservative: "Thoughtfully crafted, inclusive, body-safe products for simple, everyday intimacy." Retail proof "Now at Target / Ulta Beauty". No device named. | Main domain `getmaude.com` homepage (vibrators sit next to lube, condoms, candles, body wash; "600,000+ nightstands upgraded"). |
| **Tabu** | "Tabu" (+ creator "aliciasinclair with Tabu") | Yes, 21 ads, May to Sep 2026 | Product is a wedge pillow, not a toy. "Elevate Your Bedroom Game", "This pillow saved my sex life", pelvic-floor-PT and GYN endorsement line, "As seen in Goop, New York Post". | Main domain `heytabu.com/products/theprim` and an advertorial `heytabu.com/pages/5-reasons-why-women-love-golden-hour-2`. PDP says "Never Crude. And not a toy." Billing descriptor "TABU GROUP". |
| **Dame** | not found | No hits for `dame.com` or a Dame page in the first results (the bare word "Dame" returns ~18,000 unrelated ads) | n/a | n/a |
| **Smile Makers** | not found | "Smile Makers" returns only dental practices | n/a | n/a |
| **Vush** | not found | 2 results, neither Vush | n/a | n/a |

### 3f. The persona-page and advertorial ecosystem around air-pulse toys

Searching "air pulse" (~3,500 results) and "clitoral" (~920) surfaces a second layer of advertisers
that are not brand pages at all:

- **Persona pages** with human names or publication-style names: "Camille Rhodes", "Everyday Bliss",
  "Hidden Bloom", "Lem & Light", "Serena Vance", "Marcus Chen", "Green Feminine Daily", "FEM Health
  Daily", "My NUMY Wellness", "Dr. Kimberly Langdon".
- **Copy:** 2 to 4 minute videos and very long first-person stories pegged to menopause, divorce,
  postpartum, "clitoral atrophy", "stored tension", with specific invented-sounding life details.
  Products are framed as "wellness stimulator", "Air-Pulse ritual", "reset your nervous system".
- **Landers:** advertorial domains `modernwellnessinsider.com` / `read.modernwellnessinsider.com`
  (states "by Hello Nancy"), `bestadulttoys.com/lemadvice/full-article`, `herdailyinsight.com`,
  `get.lubracil.com`, `mynumy.com`, `bodyandcalm.com`.
- This layer exists because it gets through. It is also the layer most likely to be fabricated
  testimony. **Do not copy** (Section 5).

---

## 4. Meta's written policy, and where the line actually is

Sources fetched 2026-10-03:

- Health and Wellness (the adult-products URL now redirects here), last updated **2026-07-22**:
  https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness
  (old URL: https://transparency.meta.com/policies/ad-standards/content-specific-restrictions/adult-products-or-services)
- Adult Nudity and Sexual Activity, last updated 2025-05-14:
  https://transparency.meta.com/policies/ad-standards/objectionable-content/adult-nudity-and-sexual-activity
- Adult Sexual Solicitation and Sexually Explicit Language:
  https://transparency.meta.com/policies/ad-standards/objectionable-content/adult-sexual-solicitation-and-sexually-explicit-language/

### 4a. The exact language

**Prohibited (Health and Wellness, sexual and reproductive health section):**
- Ads may not "Promote sexual arousal products that focus on sexual pleasure or enhancement, such
  as:" and the first listed example is "Sex toys".
- Also prohibited: erotic products, adult sexual services, and "Instructional sexual services, such
  as tantric services, orgasmic therapy..."

**Allowed, with 18+ targeting:**
- Ads may "Promote sexual and reproductive health and wellness products or services, as long as the
  focus is on health and the medical efficacy of the product or the service and not on the sexual
  pleasure or enhancement."
- Listed allowed categories include products for sexual dysfunction (ED, PE, HSDD, pain relief),
  contraceptives, **"Lube and pheromones"**, reproductive health apps, and family planning including
  **"The effects of menopause."**
- No age restriction for sex education "as long as there's no sexualized or suggestive content, and
  the focus is on health and not sexual pleasure or enhancement."

**Imagery (Adult Nudity and Sexual Activity):**
- Never allowed: nudity "even where otherwise permitted", "near nudity such as nudity covered only
  by digital overlay", sexual activity, gestures signifying genitalia or sex acts, "simulated sex,
  sexual dancing or kissing with visible tongue", audio of sexual activity.
- **Allowed only with 18+ targeting:** images "Focused on individual body parts such as groin,
  buttock or female breast(s)", "Depicting people in sexually suggestive poses, revealing clothing,
  or stripping", and "Depicting people sexually touching or moving commonly sexualized body parts".

**Language (Adult Sexual Solicitation and Sexually Explicit Language):** prohibits ads that
"Contain content discussing sexual practices or experiences", but with 18+ targeting permits
"Sexually suggestive language referring to sexual encounters" and "Sexually explicit language in
satirical or humorous contexts".

### 4b. Reconciling the rules with what is running

| What Nancy et al. do | Which written rule it leans on | Is it inside the line? |
|---|---|---|
| Lemon/tennis-ball object, never shown in use | The product category is not identifiable as a "sexual arousal product" from the asset alone | **Inside on the asset.** The classifier sees fruit. A human reviewer who follows the lander can still decide it is a sex toy. |
| Lemon placed over underwear at the groin, torso crop | Nudity policy: groin focus and revealing clothing are **18+-only, not prohibited** | **Inside**, if the ad set targets 18+. This is the single most useful finding for imagery. |
| "Self-care upgrade", "wellness", "Pleasure is wellness", menopause, postpartum, "you're not broken" | Allowed category: sexual wellness "focus on health", "effects of menopause" | **Inside** when the claim is about health, body confidence or menopause. **Outside** the moment it becomes "best O's". |
| "best O's of your life", "Get off, every time", "body-shaking Os" | None. This is "focus on sexual pleasure" | **Outside the written line.** Running anyway on aged, high-spend accounts. |
| Innuendo overlays ("So Good You'll Scream", "IYKYK") | Sexual-language policy allows "suggestive" and "humorous" language at 18+ | **Grey.** Suggestive is allowed for language; the product-category rule still applies. |
| Bridge lander with no product and no category words | Reviewers follow the landing page | **Inside on the bridge itself.** It is not cloaking (same page for everyone), but it is one click from an explicit store. |
| Creator partnership ads from a "wellness retreat" | Content focus is experience/community; creators' own accounts | **Mostly inside**; the product is a prop. |
| PDP clinical block (menopause, pelvic floor, SSRIs, peer-reviewed cites, "not FDA-cleared") | Allowed health focus on the destination | Gives the destination a defensible health reading. |

**Policy change context.** The sexual-wellness carve-out has existed since Meta's October 2022
update; brands reported it changed little in practice. In 2025 Meta announced it would reduce
over-enforcement and focus on high-severity violations, which commentators read as loosening the
practical climate for vibrator ads without changing the text
([Beauty Independent](https://www.beautyindependent.com/unbound-fake-brand-expose-meta-unequal-treatment-ads-women-focused-sexual-products/),
[fempowerhealth](https://fempowerhealth.beehiiv.com/p/meta-s-policy-shift-revolution-or-risk-for-women-s-health),
[aimerce](https://www.aimerce.ai/blogs/what-metas-health-wellness-ad-policy-actually-allows)).
The observable result in October 2026: a wide enforcement gap, with explicit copy surviving on big
accounts. **The written line is "health focus, not pleasure focus"; the enforced line is "does the
asset and the first page look like a sex toy to a classifier".** xdipx should build to the written
line, because a new, small ad account gets the strict enforcement and none of the tolerance.

---

## 5. Playbook

### 5a. The observable rules, ranked by how consistently they appear

Consistency is across Nancy, Lovehoney/Womanizer, LELO, Bellesa, Unbound, Maude, Tabu (7 brands).

1. **Never show the product in use or on bare skin at a sensitive area. (7/7)** Products are held,
   placed on surfaces, or placed over fabric. No brand shows contact with a body.
2. **No nudity, no near-nudity, no sexual activity or gesture. (7/7)** Underwear, bikinis and torso
   crops are the ceiling, and they rely on 18+ targeting.
3. **Never use "sex toy" in ad copy; prefer a soft noun. (7/7 avoid "sex toy"; 6/7 avoid
   "vibrator" in primary text, Unbound says "vibe")** Used instead: "massager", "wellness device",
   "playmate", "the Lem", "Pleasure Air technology", "sonic waves", "intimacy essentials".
4. **Discreet packaging and discreet billing as a headline benefit. (7/7)** It appears in ad
   headlines ("Discreet Packaging + Free Shipping"), landers and PDPs.
5. **"Shop now" as the CTA; "Learn more" only for advertorials. (6/6 brands where CTA rendered)**
6. **A guarantee as risk reversal. (6/7)** Nancy 30-day, Womanizer and Lovehoney 100-day,
   Bellesa 10-year quality, Unbound 1-year warranty.
7. **Big social-proof number in line one. (6/7)** "500,000+ women", "50,000+ women", "1,000,000+
   women", "685K Women Follow Bellesa", "600,000+ nightstands", "100,000 couples".
8. **Hold the copy, rotate the visual; keep winners running for months. (Nancy and Lovehoney
   clearly; Bellesa, LELO likely)** Nancy's one primary text runs on 52 ads; a 2025-08 video is still
   top-10.
9. **Object disguise or object-first art direction. (5/7)** Lemon (Nancy, Lovehoney), tennis ball
   (Nancy), throw pillow (Tabu), candle/lifestyle (Maude), sculptural object shots (LELO).
10. **Wellness, self-care or health vocabulary as the frame. (6/7)** "self-care", "wellness",
    "menopause", "pelvic floor", "body-safe", "medical-grade silicone", "Pleasure is wellness".
11. **Destination is not the storefront homepage. (6/7)** Bridge subdomain (Nancy `unlock.`, LELO
    `feel.`/`explore.`), separate brand domain (`lelovibes.com`, `welovehoney.com`), a single PDP
    (Unbound, Tabu), or an advertorial. Maude is the exception.
12. **Bridge landers are single-purpose and match the ad's register. (Nancy, LELO, Lovehoney)** One
    headline, one claim, one button to a PDP. Product names only, no category words on the first
    screen.
13. **Creator partnership ads ("X with Brand"). (Nancy heavily, Tabu, Womanizer UGC)** The creator's
    face and voice carry the message; the brand handle is the attribution.
14. **The destination PDP carries a health or clinical layer. (Nancy, Tabu, LELO)** Expert quote,
    menopause/pelvic floor framing, study citations, explicit "not FDA-cleared" disclaimer.
15. **A separate advertiser page name for the category. (Lovehoney/Womanizer "Womanizer.afterdark",
    LELO "LELO Vibes")** Keeps the main brand page out of category enforcement. A legitimate,
    disclosed brand sub-page is fine; serial throwaway pages are not (below).

### 5b. Do not copy (deceptive or high-ban-risk, even though it is visibly running)

- Fabricated advertorial bylines and "verified purchase" journalists ("Sarah Mitchell" on two
  domains), persona pages posing as independent women or doctors, invented life stories.
- Page-and-domain rotation (Bellesa's four `bb*.co` domains and four "BB" pages). This is the pattern
  Meta treats as circumvention and bans at the business level.
- Link shorteners (bit.ly) as the ad destination.
- Countdown timers and "Final minutes" urgency (Nancy store and advertorial). Also banned by the
  xdipx voice charter.
- Explicit orgasm claims in ad copy ("best O's", "Get off", "came first"). They survive on aged
  accounts; they will not survive on a new one.

### 5c. The five things that would most likely get xdipx rejected

1. **Sending Meta traffic to xdipx.com as it stands.** The owned-channel voice runs at intensity 9
   ("explicit-indulgent, act-anchored") and the homepage and PDPs name acts plainly. Reviewers follow
   the link; the destination would read as a pleasure-focused sex-toy store. Needs a register-matched
   bridge page or a health-framed PDP variant, same page for every visitor (no cloaking).
2. **Any creative with a product on bare skin, implied use, or a recognizably phallic or clinical
   toy silhouette.** Nancy gets away with on-body shots because the object reads as fruit and sits on
   fabric. A standard wand or rabbit on skin is an instant reject. (xdipx's own ads-policy already
   bans on-skin frames for paid; keep it.)
3. **Pleasure-outcome copy.** Anything in the "best O's / get off / orgasm" family, or "sex toy"
   and act names in primary text. The written allowance is health focus only, and paid ads are
   already capped at intensity 3-4 by the charter. Use body-literacy, menopause, discreetness, design
   and guarantee angles.
4. **Targeting below 18 (or Advantage+ audience left open), plus no history.** The groin/revealing
   clothing allowance exists only at 18+. A new account with an open audience and a rejected ad or
   two will be restricted fast. Set 18+ hard (xdipx policy says 25+ working floor on Meta).
5. **Catalog/Advantage+ Shopping with the full Shopify feed.** A dynamic ad pulling product titles
   like "Clitoral Vibrator" and default product images straight from the catalog bypasses every
   creative rule above. If catalog ads are ever used, the feed must be a curated, renamed,
   object-photo subset.

### 5d. A compliant xdipx equivalent, in one paragraph

Object-first product photography on paper/coral-soft grounds (or held in hand over fabric), never in
use. Copy in the 3-4 register about what the device is (quiet, waterproof, body-safe silicone, air
pulse vs vibration), who it is for (first-timers, menopause, couples), and the offer (discreet
shipping, XDIPX on the statement, the guarantee). A single-purpose bridge page on a subdomain that
serves the same content to every visitor, names the product, explains the technology and the
health/body-literacy angle, shows reviews and the guarantee, and links to the PDP. Creator
partnership ads where a real creator speaks to the body-confidence angle. Ad sets hard-targeted 18+
(25+ per the binding doc). One legitimate, clearly-xdipx advertiser page; no rotation, no shorteners,
no personas.

Note for the owner: `docs/ads-policy.md` currently classifies Meta as "Prohibited" for the pleasure
catalog. That remains the accurate reading of the **written** policy. This teardown shows the
**enforced** reality is looser for brands that follow the rules in 5a. Any change to the binding doc
is an owner decision, not something this report makes.

---

## Appendix: capture files

All under `$TD/` =
`/private/tmp/claude-501/-Users-mikebayard-Claude-xdipx-store--claude-worktrees-ad-studio-platform-redesign-9162de/a73e47eb-9e41-4387-91ff-b14973999439/scratchpad/teardown/`

Nancy Ad Library
- `nancy-adlib-browser-first-view.jpg` (built-in browser, first view, ~950 results all countries)
- `nancy-adlib-full.png` (full-page US render, 1280x27235) and `nancy-adlib-full.txt` / `.html`
- `nancy-adlib-tile-00.png` to `nancy-adlib-tile-13.png` (the full render sliced into 2000px tiles)
- `nancy-creatives/c01.jpg` to `c174.jpg` (creative images and video posters pulled from the page)
- `nancy-creative-urls.txt` (source URLs)
- `nancy-contact-0.png` to `nancy-contact-5.png` (contact sheets, 132 unique creatives)

Nancy landers and store
- `nancy-lander-lem-holiday.png`, `nancy-lander-lem-holiday-mobile.png`, `.html`, `.txt`
- `nancy-get-officialnancy.png`, `.html`, `.txt`
- `nancy-home.png`, `.txt`; `nancy-pdp-lem.png`, `.txt`
- `affiliate-mwi-starting-over.png` (Modern Wellness Insider, "by Hello Nancy")
- `affiliate-bestadulttoys-lem.png` (Sarah Mitchell advertorial)

Other brands
- Keyword Ad Library renders: `kw-womanizer.png` (+ `-top.png`), `kw-lelo.png` (+ `-top.png`),
  `kw-bellesa.png` (+ `-top.png`), `kw-tabu.png` (+ `-top.png`), `kw-maude.png`,
  `kw-unbound-babes.png`, `kw-air-pulse.png`, each with `.txt` (and `.html` for most)
- Landers: `lovehoney-welovehoney-lemontoy-hero.jpg`, `lelo-feel-unlock-collection.png`,
  `lelo-explore-sona2-offer.png`, `bellesa-shopbb.png`, `tabu-prim.png`, `maude-home.png`,
  `unbound-ollie.png`, `womanizer-premium.png`

What could not be seen: per-ad age/gender targeting and spend (requires login or EU-only
transparency data); the landers behind Nancy's catalog-style ads whose cards rendered no link; any
Dame, Smile Makers or Vush activity (none found).
