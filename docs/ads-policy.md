# Ad Platform Policy — Sexual Wellness (BINDING for ads-manager and all paid media)

xdipx sells sex toys and sexual-wellness products — the most restricted mainstream ad category
there is. **The house rule: when a campaign can't make an honest written compliance case, it does
not get proposed.** An ad-account ban is a worse outcome than any missed impression, and enforcement
is often account-level and retroactive.

`ads-manager` must read this document in full at the start of every run. Every `ad_campaigns`
proposal must carry a `policyCheck` naming the platform category it fits and why it complies (the
API rejects proposals without one). The creative rules in §Creative apply to **organic social too**.

Policies drift. Last verified **2026-07** against the platform sources listed at the bottom, except
the Google sections (platform matrix row, §Google network eligibility, §Merchant Center), which were
re-verified **2026-08-08**, §Meta Shops, which was added **2026-08-15** from the store's own
live channel state, and §Shop app and Shop Campaigns, added **2026-09-30** from Shopify's help
center and the store's live Shop publication, and §Meta strategic lane, added **2026-10-03** on
owner decision from `docs/audits/meta-ads-category-teardown-2026-10-03.md`. If a proposal hinges on a policy detail, re-verify against the live
policy page that run and cite it in the `policyCheck`.

---

## Platform matrix

| Platform | Paid ads for pleasure products (sex toys) | What IS possible | Risk |
|---|---|---|---|
| **Meta** (FB/IG) | **Written policy: prohibited.** Meta's Health and Wellness standard bars ads that promote "sexual arousal products that focus on sexual pleasure or enhancement", sex toys listed first. **xdipx posture: strategic lane** (owner decision 2026-10-03), run only under the hard gates in §Meta strategic lane. | Ads built to the written health line: object-first creative, register 3-4 copy about what the product is, who it is for, and the offer, sent to the bridge host or a health-framed PDP. The health and wellness carve-out (lube, menopause, 18+) stays the safest subset inside the lane. Pixel/CAPI conversion tracking for organic and other traffic is fine and already wired. | **High.** A new, small account gets the strict enforcement and none of the tolerance aged accounts see (teardown §4b). Enforcement can reach the whole Meta business, which also holds the pixel, CAPI, and the Shops catalog. Reviewers follow the landing page. A rejection pattern pauses the lane (§Meta strategic lane, M7). |
| **TikTok** | **Prohibited.** Sexual products/services banned, including devices for sexual pleasure or performance. | Nothing paid. Do not propose TikTok, ever. | Ban risk plus brand-safety blowback. |
| **X** | **Prohibited in ads.** Despite X's permissive *organic* adult-content policy, its advertising and shopping policies ban adult/sexual merchandise globally. | Organic posting (labeled appropriately per X's adult-content rules) — which is the social team's lane, not paid. | Ads get rejected; repeat attempts risk the ad account. |
| **Google Ads** | **Restricted, not prohibited. The primary mainstream paid channel.** Sex toys are "moderately restricted" sexual merchandise: ads serve only in limited scenarios (user search intent, 18+, local law, SafeSearch), never to minors. **Eligible on the Search Network only. Prohibited on the Display Network and the Google Ad Manager Network.** No certification or allowlist application exists for this category; serving limits apply automatically. | Search text ads on category and brand intent ("where to buy X"). Shopping is a **separate** surface with its own policy and review queue, see §Merchant Center. Non-explicit creative and landing experience. Text only, copy at register 3-4, up to 4-5 for factual product text. Expect "Limited" serving status as the *normal* state, not an error. | **Medium.** Compliant-but-limited is sustainable; explicit creative or policy-evasion attempts escalate to account action. |
| **Reddit** | Effectively prohibited for adult products in its ads program. | Organic community participation where subreddit rules allow (unpaid, social team's judgment). | Low spend exposure since there's no viable paid path. |
| **Pinterest** | **Prohibited.** Sex toys, body-part-shaped products, and sexual enhancement products are banned in ads. | Nothing paid. Do not propose Pinterest ads. | n/a |
| **Microsoft Advertising** (Bing search) | **Allowed through the Adult Advertising Program**, approved advertisers only, in US, CA, UK, AU, NZ, IE, FR, DE, TW. Approved adult keywords include "sex toys". Realistic sex toys are prohibited in creatives. | Search text ads with the same discipline as Google Search: text only, copy at register 3-4, up to 4-5 for factual product text. The account must be accepted into the program (participation form) before any proposal. | **Medium**, the same shape as Google: compliant-but-limited is sustainable. |
| **Snapchat** | **Restricted, not prohibited.** Snap's ad policy gives "vibrator ads that do not use graphic language or imagery" as its example of allowed restricted content, age-gated 18+. | Snap Ads targeted 18+ with non-graphic object and typographic creative, copy at register 6-7: allusion is fine, graphic language is not. No nudity under the charter definition, and Snap also bars exposed nipples, bare buttocks, and partially obscured nudity. | **Medium.** The most permissive mainstream social platform for the category, run as a test lane. |
| **Adult ad networks** (ExoClick, JuicyAds, TrafficJunky, and vetted peers) | **Allowed. It's their business.** | Display/native on adult and adjacent inventory. Vet each network's traffic quality and brand-safety before proposing; model conservative conversion rates. Copy runs at **register 10**, the one surface where the voice charter lets it ship (`docs/emma-voice.md`, intensity dial and marketing addendum, codified 2026-10-03). The imagery ceiling is the charter's nudity definition: no visible female nipples, labia, penis, or anus. | Quality/fraud risk, not policy risk. Attribution via UTMs is mandatory: every banner URL carries `utm_source=<network>`, `utm_medium`, `utm_campaign`, and `utm_content=<creative id>`, and a banner without them is not exported. |
| **Owned + earned channels** | No gatekeeper. | Email/SMS to consented lists (the email team), SEO/AEO (already invested), affiliates and creator/newsletter sponsorships (disclosure required, creator's platform rules apply), the referral program once built. | Lowest risk, best margins — the default recommendation when paid math is thin. |
| **Shopify Shop** (Shop app, Shop Campaigns) | **Approved for this catalog by Shop's own review** (owner report 2026-09-30): every product is approved except one held for missing images. Shop's written prohibited list names "Mature and adult content or services", so the review verdict, not the list, is the operative fact. Shopify, not xdipx, buys third-party placements (Meta, Google, X, Snap, Pinterest), several of which ban the category outright. See §Shop app and Shop Campaigns. | The approved catalog, with product-as-object imagery at media position 0, paid-register titles, and third-party placements off. Owner-run in Shopify admin. | **Medium.** Shop has approved the catalog, so the channel itself is sound today. The residual risk is a later policy change or re-review, and because the store runs on Shopify Payments, a Shopify-side action reaches checkout, not just an ad channel. |
| **Etsy** | Not an ad platform for this store; the question is whether xdipx's catalog can list there at all. **The Nalpac-fulfilled physical toy catalog cannot, in any form.** See §Etsy for the two independent policy blockers. | A narrow, digital-only, design-original lane (adult party games, printables, digital art), disconnected from the Nalpac catalog and from Shopify inventory. Manual, owner-run; not an automated channel. | **High if physical toys are listed** (policy-prohibited item type, twice over). **Low** for the digital-only lane if kept to original designs with proper mature-content tagging. |

**Channel priority for proposals:** (1) owned/earned, (2) Google restricted-serving Search,
(3) vetted adult networks and newsletter/creator sponsorships, (4) Google Shopping via Merchant
Center once §Merchant Center is satisfied, (5) Snapchat 18+ non-graphic, and Meta only through
§Meta strategic lane with every gate passed. Microsoft Advertising sits with Google Search at (2)
once the Adult Advertising Program accepts the account. Never TikTok; never X, Reddit, or Pinterest
paid. Shop Campaigns sits outside this ladder: it is
an owner-run surface under §Shop app and Shop Campaigns, and `ads-manager` never proposes widening it.

**Copy register by paid surface** (owner decision 2026-10-03; `docs/emma-voice.md` governs the
registers themselves):

| Surface | Register | Format limit |
|---|---|---|
| Meta strategic lane | 3-4 | Object-first creative, gates M1 to M7 |
| Google Search | 3-4, up to 4-5 for factual product text | Text only |
| Microsoft Advertising (Adult Advertising Program) | 3-4, up to 4-5 for factual product text | Text only |
| Snapchat | 6-7 | Non-graphic, 18+ |
| Vetted adult ad networks | 10 | Nudity definition is the imagery ceiling; UTMs mandatory |
| Google Display, PMax, Demand Gen, YouTube; TikTok, X, Reddit, Pinterest paid | None. Prohibited | Never proposed |

## Google network eligibility (the rule that kills campaign types)

Verified 2026-08-08 against Google's sexual content policy. This is the most consequential detail in
this document, because Google's own UI actively recommends the campaign types that are prohibited.

**Eligible:** Search Network text ads.

**Prohibited:** Display Network, Google Ad Manager Network.

Therefore, by construction, **never propose Performance Max, Demand Gen, Discovery, YouTube, or any
Smart campaign.** Those types serve Display, YouTube, Gmail, and Discover inventory with no network
opt-out, so selecting one is selecting prohibited placements regardless of creative. A Standard
Search campaign with "Include Google Display Network" left checked is the same violation by
accident: **uncheck it explicitly, every time.**

Geo: sexual content does not serve at all in roughly twenty countries (Algeria, Bahrain, Djibouti,
Egypt, India, Iran, Iraq, Jordan, Kuwait, Lebanon, Libya, Morocco, Oman, Palestine, Qatar, Saudi
Arabia, Syria, Tunisia, UAE, Yemen). Strongly restricted content additionally does not serve in
China, Germany, Hong Kong, Indonesia, Malaysia, Peru, Philippines, Russia, Singapore, South Korea,
Taiwan, Thailand, Ukraine, Vietnam. Set **Location options to "Presence"**, not the "Presence or
interest" default, or ads reach users in excluded countries who merely searched about a target one.

No certification, allowlist, or pre-approval process exists for this category. Serving restrictions
apply automatically based on user age, local law, and SafeSearch.

## Merchant Center and Shopping (separate policy surface)

Shopping is **not** governed by the ad policies above. It has its own classification, its own
attribute requirements, and its own review queue with its own latency. Verified 2026-08-08.

- Merchandise intended to enhance sexual activity is **restricted, not prohibited**, for Shopping
  ads and local inventory ads. Sexually explicit content is prohibited outright.
- The `adult` attribute is **required** on these items. The store's feed already emits
  `<g:adult>yes</g:adult>` unconditionally (`app/routes/[feed.xml].tsx`).
- Country exclusions apply as above and are enforced at the Merchant Center account level.
- **Shipping and price in the feed must match checkout exactly.** Mismatch is a misrepresentation
  suspension, and it is the single most common way a compliant catalog loses its account.
- Landing pages for adult items must not surface adult content on non-adult product pages.

Shopping is a **phase two** lane, never a week-one launch dependency: it stacks three review queues
(account, domain claim, adult-merchandise review) behind a feed that must already be exact. Search
launches on the Ads account alone. Submit the feed in parallel; do not block on it.

## Meta strategic lane (owner decision 2026-10-03)

Mike's "codify both" on 2026-10-03 moved Meta from Prohibited to a strategic lane for the pleasure
catalog (`docs/store-team/ad-studio-v2-plan.md` §1 decision 2, §3). Meta's written policy did not
change: it still bars ads that focus on sexual pleasure. The lane is built to that written line,
using the ranked rules and rejection causes in `docs/audits/meta-ads-category-teardown-2026-10-03.md`
§5a and §5c, because a new, small ad account gets strict enforcement. Each gate is a yes/no check.
A Meta ad, draft, or proposal that fails any one of them is not created, and the `policyCheck` or
the kill event names the gate it failed.

**M1. Destination.**
- The final URL is on the bridge host `curious.xdipx.com`, or is a PDP that renders the health and
  body-literacy block (mechanism, body-safe materials, who it is for, a "not a medical device"
  disclaimer) to every visitor.
- Never the homepage, a collection page, or any other xdipx.com page.
- Every visitor and every reviewer gets the same page. No cloaking: no user-agent, referrer, IP, or
  geo switching.
- The URL in the ad is the final URL and returns 200 with no redirect. No redirect chains, no link
  shorteners.

**M2. Creative.**
- Object-first: the product on a coral-soft, plum-soft, or paper ground (design doctrine §4), or
  held in a hand over fabric.
- Never in use, never on or against bare skin.
- No recognizably phallic or clinical silhouette in frame. A realistic dildo, a standard wand, or a
  rabbit fails; pick SKUs whose shape reads as an object.
- No nudity and no visible nipple of any sex (§Creative rules, paid line).

**M3. Copy.**
- Register 3-4 per `docs/emma-voice.md`: what the product is, who it is for, and the offer (discreet
  box, XDIPX on the statement, the guarantee).
- Never the words "sex toy", never an act name, never a pleasure-outcome or orgasm claim ("best
  O's", "get off", and their family).
- A social-proof number appears only when our own data sources it, and the `policyCheck` cites the
  source. Never borrowed, rounded up, or invented.

**M4. Account and audience.**
- One advertiser page: xdipx. No second page, no category sub-page.
- Age targeting hard-set to 25+. Never an open Advantage+ audience, never below 25.
- Every ad is created as a PAUSED draft. Only the owner flips an ad live; no agent and no automation
  activates a Meta ad.

**M5. Catalog.**
- Only the curated Meta product subset, with renamed display titles (no category words such as
  "clitoral vibrator") and position-0 object packshots.
- Never the raw Shopify feed, never Advantage+ catalog or Advantage+ shopping campaigns, never
  dynamic product ads over the full catalog. The Facebook & Instagram channel catalog in §Meta Shops
  is the raw feed and never backs an ad.

**M6. Never.** Persona pages, fake bylines, advertorials with invented authors or "verified
purchase" journalists, rotating domains or pages, link shorteners, countdowns or "final minutes"
urgency, orgasm claims (teardown §5b).

**M7. Account health and the pause rule.** The ad account shares a Meta business with the pixel,
the Conversions API feed (`meta-capi.server.ts`), and the Facebook & Instagram Shops catalog. Meta
enforces circumvention and repeat violations at the business level, so a banned ad account can take
the conversion signal and the Shops surface down with it. Per §Escalation, one rejected ad stops new
Meta proposals until the owner has read it and decided. A rejection pattern (a second rejection
citing the same policy, or any account-level restriction) pauses the whole lane, and only the owner
reopens it.

## Organic social

Organic posting is a different policy surface from ads and is governed by each platform's
**community standards**, not its ad standards. `social-media-manager` reads this section and the
social addendum in `docs/emma-voice.md` at the start of every run.

The rule that catches storefronts like ours is not nudity. Meta's Restricted Goods and Services
standard removes organic content that **promotes the use of, or attempts to sell, adult products**.
A tasteful product photo with a clean caption is removable when the post is selling. Sex education
and health discussion is a real carve-out: allowed, but explicitly not recommended, which means no
Explore or Reels distribution and invisibility under default Sensitive Content Control.

| Platform | Organic posture | Hard limits | Risk |
|---|---|---|---|
| **Instagram / Facebook** | Editorial and educational only. The account is a publication; commerce lives at post → profile → link in bio → site. A Shops surface also exists and is live, see §Meta Shops; it is governed by Meta's Commerce Policies rather than by this row, and it loosens nothing here. | No sale attempt in the post (no price, discount, promo code, or shop CTA), no graphic detail in words: no narrating an act or an arousal state in the body, no crude slang, no emoji-anatomy, no solicitation. Plain nouns in a fact or mechanism sentence (orgasm, the orgasm gap, clitoris) are licensed; gesturing at them ("gets there", "closes it") is banned as evasion (owner correction 2026-08-22). This is a graphic-detail fence, not a register cap: innuendo, anticipation, and suggestion are licensed in full by the `docs/emma-voice.md` social addendum (Instagram at 9 by implication, owner order 2026-08-22). Bellesa Boutique (700K followers) was permanently deleted the week of 2026-04-08 over the literal use of "clitoris" in caption text, which Meta classified as a "true positive" under its Community Standards ban on sexually explicit language in organic content and refused to reinstate ([Xtra Magazine](https://xtramagazine.com/video/bellesa-instagram-ban-sexual-health-281447)); the fence is what separates an age-restricted post from a deleted account. Imagery is governed by the ceiling in `docs/store-team/instagram-campaigns.md` §3.2a, which licenses product in hand and against skin, beds, lingerie and implied use, and blocks genitalia, nipples, hands on genitals and depicted acts. The blanket "no product in hand or on a body" that stood here was withdrawn by owner ruling 2026-08-16 after it had already been contradicted by the 2026-08-12 hand ruling for four days. | **High.** Enforcement is account-level and retroactive; repeat strikes disable the account with little recourse. Appeal every removal. |
| **TikTok** | Same posture as Instagram, applied harder — TikTok moderates the category more aggressively than Meta. | As above. Treat any borderline draft as a no. | **High.** |
| **X** | X's adult-content policy is more permissive than Meta's on paper — it allows the category, conditioned on posts being labeled per X's own rules. **In practice this store cannot label media as sensitive yet** (ticket #10277: `postTweet` in `app/lib/twitter.server.ts` accepts only text and media ids, no sensitive-media flag), so the condition that unlocks the wider posture is unmet. Until labeling ships, **the imagery fence on X is identical to Instagram's** (`docs/store-team/instagram-campaigns.md` §3.2a), not looser — see `docs/store-team/routine-social-daily.md`'s X subsection, which has had this right since 2026-08-19. | Still no explicit creative and no porn-adjacent aesthetics per §Creative. Paid remains prohibited. A hotter X frame only manufactures rows `social-publish-gate` blocks. | **Medium.** |
| **LinkedIn** | Industry authority only, no products (LinkedIn addendum, `docs/emma-voice.md`). | No product imagery, no store links, no promo codes. | **Low** when the addendum is followed. |
| **Reddit** | Organic participation where subreddit rules allow. Rules are per-subreddit and enforced by humans; read them before posting. | Never post promotionally in a subreddit that bans it. | **Low** (per-community bans, not account loss). |

**Never route around a filter.** Coded vocabulary, character substitution, reclaimed hashtags, and
"algospeak" to get a blocked term past moderation are policy evasion in their own right and
escalate from post removal to account action. If a draft only survives by disguising itself, kill
the draft.

**Account hygiene.** Assume the account is loseable: push followers to email and SMS relentlessly,
keep the audience somewhere we own, and never make platform reach load-bearing for revenue.

## Meta Shops (Facebook and Instagram shops)

**Correction, 2026-08-15.** The §Organic social table previously stated that adult products are
barred from Instagram Shopping and in-app commerce entirely. That is not what this store's account
shows, and the sentence has been removed. Anything written against it should be re-checked.

The Shopify catalog is connected to Meta catalog `1551461513373481` through the Facebook & Instagram
sales channel. Both the Facebook shop and the Instagram shop report **Active**. Meta reviews each
product against its **Commerce Policies**, a third rulebook distinct from the ad policies in
§Platform matrix and the community standards in §Organic social. A verdict on one says nothing about
the others.

Measured 2026-08-15 on the channel overview in Shopify admin:

| Verdict | Products |
|---|---|
| Approved | 232 |
| Rejected | 418 |
| Has issues | 1 |

651 of the 4,691 products published to the channel carried a verdict at that point; the rest had
none yet. The rejected set spans every category the store sells, lubricant and condoms included, so
a rejection is not evidence that a product is unusually explicit.

What follows from this:

- **Approved products can appear in the shops. Rejected ones cannot.** Meta's diagnostic scopes the
  rejection to `mini_shops`, which is the shops surface, not ad delivery and not organic reach.
- **Product tagging was never actually live, and is now permanently removed** (ticket #10732,
  superseding the 2026-08-16 #3744 claim below). `available_catalog_product_search` is not a real
  Graph API edge — the correct one, `catalog_product_search`, requires a `catalog_id` this store
  has never had, so every publish attempt was malformed from day one and silently degraded to
  untagged while leaking a raw Graph error into `cron_runs.result`. Even a corrected call could
  never succeed regardless: Meta's commerce policy prohibits promoting the buying, selling, or
  trading of adult products across Shops on Facebook and Instagram
  (facebook.com/policies_center/commerce/adult_products, help.instagram.com/1627591223954487), so a
  sexual-wellness catalog cannot pass Shop review. The tagging code path is removed from
  `app/lib/social-publish/instagram.server.ts`; every post publishes untagged, which is correct and
  was always the actual outcome. Do not re-add it without an explicit owner decision that a real,
  policy-compliant path exists.
- **Approval is not a licence and rejection is not a ban.** Commerce review judges a catalog item;
  community standards judge a post. Never treat an approved product as permission to post something
  §Organic social forbids, and never treat a rejected product as ineligible to appear in an
  editorial post. Draft product selection is never filtered on catalog approval status
  (`docs/store-team/routine-social-daily.md` Step 2.7).
- **Do not hand-delete rejected items in Commerce Manager.** The catalog's only data source is the
  Shopify partner integration, so deletions are re-created on the next sync. Unpublish from the
  Facebook & Instagram channel in Shopify instead.

Re-verify the counts before citing them. They move as Meta works through the review queue.

## Shop app and Shop Campaigns (Shopify)

Added 2026-09-30 on owner direction, verbatim: "I've started to run ads on Shopify's Shop
platform. We need a strategy for images and ads to leverage the platform within their guidelines."
This is a fourth rulebook, separate from the ad policies in §Platform matrix, the community
standards in §Organic social, and Meta's Commerce Policies in §Meta Shops. A verdict under one says
nothing about the others.

### What Shopify's own rules say (read 2026-09-30)

- **Shop's prohibited-products list** names "Mature and adult content or services, or products that
  have nudity". Shop's content policy (shop.app/content-policies, read via search on 2026-09-30
  because the page rate-limited a direct fetch) separately bars content that is sexually
  suggestive or intended to arouse. There is no restricted-with-conditions tier for adult products on Shop the
  way Google has one; the category is on the prohibited list.
- **Shop Campaigns eligibility** requires Shopify Payments to be set up on the store, "Sell directly
  on Shop with direct checkout" on, Shopify Network Intelligence on, and compliance with the Shop
  merchant eligibility rules, the Shop Campaigns Merchant Terms, the Shopify Acceptable Use Policy,
  and the **Shopify Payments Terms of Service**.
- **Shopify Payments.** Its eligibility page prohibits products with sexually explicit content, and
  widely cited summaries of its US terms list adult toys among prohibited businesses (the US terms
  themselves were not re-read at the primary source on 2026-09-30; confirm before relying on
  either reading). That exposure is why this store was specified on a high-risk processor in the
  first place (CLAUDE.md tech stack, which named Segpay/Verotel until 2026-09-30). The store in
  fact runs on Shopify Payments. Shop's approval of the whole catalog (see the store's state
  below) is Shopify-side evidence that these products are acceptable, though it is a Shop channel
  verdict, not a Shopify Payments ruling, and the Payments terms were not re-read.
- **Placements.** Shop Campaigns ads run on the Shop app, the Shop website, the Shopify Product
  Network (other merchants' storefronts), and **optional third-party placements** where Shopify
  buys the media on Meta, Google, X, Snap, and Pinterest. §Platform matrix records that Meta, X,
  and TikTok-class platforms prohibit this category in ads. Shopify being the advertiser of record
  does not make our products eligible there.
- **Creative is assembled from catalog data.** The Merchant Terms license Shopify to use, reproduce,
  and display the merchant's materials (product images, titles, descriptions) in ads for up to a
  year after the campaign ends. In practice the ad image is the product's Shopify media and the ad
  copy is the product title. There is no separate ad-creative review we control, which means **the
  catalog is the creative.**
- **Enforcement.** Shopify may end the Merchant Terms "at any time for any reason", and Shop may
  redact content or delist a store. The costliest failure is not the channel. It is a Shopify
  Payments review that terminates processing and holds funds, which takes checkout down for every
  channel at once.

### The store's state (measured 2026-09-30)

- The **Shop** publication exists on the store and the catalog is published to it wholesale. A
  sample of the 25 most recently updated active products was 25 of 25 on Shop, including realistic
  dildos, a realistic torso stroker, anal plugs, penis pumps, and strokers.
- **Shop's review has approved the whole catalog** (owner report 2026-09-30, from the Shop channel in
  Shopify admin). The only unapproved product was Nalpac SKU 101629 (`power-delay-cream-2-oz`), held
  for missing images, not for its category. It had zero media; the Nalpac main feed carried one
  clean packshot, which was attached as media position 0 on 2026-09-30 so Shop can re-review it.
  This supersedes this section's first reading, written the same morning from Shop's prohibited
  list alone, that most of the catalog was ineligible and should be unpublished from Shop. Like
  §Meta Shops, this is a lesson in reading the account's actual verdicts before the published
  rulebook: the review is Shopify's own judgment of these products.
- Shop Pay is an enabled wallet. The store is on the Basic plan.
- **The store processes payments through Shopify Payments** (owner confirmed 2026-09-30, closing
  the gateway question the 2026-07-22 drift audit raised). CLAUDE.md's tech stack now records it.
  Every rule below therefore protects the store's only payment processor, not just an ad channel.

### The rules (binding)

1. **Shop Campaigns is owner-run, owner-scoped, and never widened by an agent.** `ads-manager` does
   not propose Shop Campaigns, does not propose adding products to the Shop publication, and does
   not size Shop budgets. It does retro any live Shop Campaigns spend the owner reports (log as
   `platform:'other'`, `name` prefixed `shop-`), the same way it retros any launched row.
2. **Third-party placements stay off.** They put our products on platforms whose ad policies ban
   the category, under a buyer who can drop us for it.
3. **The eligible set is what Shop has approved, and every product stays approvable.** Do not
   unpublish Shop-approved products from the Shop channel on category grounds; Shop's review is the
   verdict. The work is keeping each product reviewable: an active product with zero Shopify media
   is not approvable on Shop at all (SKU 101629 was held for exactly this), so any product that
   reaches the Shop channel with no image gets its Nalpac feed image attached as position 0, or is
   flagged to `shopify-ops` when the feed has none. If Shop rejects or redacts a product for its
   content rather than for missing data, rule 7 applies; do not re-submit it in disguise.
4. **Image rule for any product published to Shop.** The product's Shopify media position 0 is
   what Shop shows and what a Shop Campaigns ad shows. With the whole catalog approved, the whole
   catalog is potential ad creative, so position 0 must be paid-clean everywhere, and must stay
   that way to keep the approvals it has:
   - Product as object on a clean or single-tint ground (design doctrine §4 Archetype B, or a clean
     packshot). No body, no skin, no hand near a body, no on-skin frame under
     `docs/store-team/instagram-campaigns.md` §3.2c, no implied use. The on-skin licence the voice
     charter extended to owned surfaces on 2026-09-20 stops at Shopify product media for anything
     published to Shop; those frames live in `mood_image_url`, Sanity, and site-only surfaces.
   - Never the Nalpac packaging shot as primary. Retail boxes frequently carry model photography and
     baked-in text; `scripts/sweep-packshot-primaries.ts` finds and fixes them.
   - No text in pixels, no price or discount in the image, no stars or badges baked in.
   - Every Shopify product image carries alt text that reads as a product description.
   - No product video attached as Shopify media (`attachVideoToProduct` from the video studio or the
     LTX/Veo upload routes) on a Shop-published product unless it meets the same paid ceiling:
     product as object, no body.
5. **Words on Shop are paid-ad words.** The title and description Shop pulls are the storefront's
   own, so for the Shop-published set they must already read at the paid-ads register in
   `docs/emma-voice.md` (3-4, education and mechanism, no pleasure claim, no act named). A lubricant
   titled by its base, size, and brand passes; a title that sells an orgasm does not. Never create a
   Shop-only title that says something different from the PDP to slip review; that is the
   disguised-listing pattern §Etsy and §Organic social already ban.
6. **Offers.** Shop Campaigns pays per acquired customer. Any discount it carries follows §Creative's
   MAP rule and the voice charter's no-urgency rule.
7. **A Shop notice is an account-health event.** Any Shop delisting, product redaction, Shop
   Campaigns rejection, or Shopify Payments inquiry is surfaced to the owner the same day and
   stops any further Shop work, per §Escalation.

## Etsy

Added 2026-08-19 following an owner idea run past the team (custom bundles, how-to guides, party
games, print-on-demand, digital artwork). This is not a paid-ads surface; it is a listing-policy
question about whether xdipx can sell there at all, so it lives here alongside the other
platform-by-platform reads rather than in a new document.

**The Nalpac-fulfilled physical toy catalog is blocked twice over, independently:**

1. Etsy's Adult Nudity and Sexual Content / Prohibited Items policy (effective 2026-08-11) bans
   **insertable/penetrable adult toys** outright — dildos, vibrators, anal plugs, sex dolls,
   fleshlights. That is the core of the store's catalog. Only non-insertable accessories
   (restraints, harnesses, nipple clamps, impact-play gear) are permitted at all.
2. Independent of the item-type ban, Etsy's Seller Policy bars reselling mass-produced goods and
   bars dropship-sourced items as a seller's "production." A Nalpac-fulfilled catalog fails this on
   its own, even for the sliver of items the item-type rule would otherwise allow.

**Do not propose listing any Nalpac-sourced physical product on Etsy, bundled or not.** Custom
bundles built from the existing toy catalog are not a viable Etsy lane under current policy.

**Never disguise a prohibited item as a different listing to route it past moderation.** A
"digital guide" listing that ships a physical toy and lube alongside it, undisclosed in the
photos/description, does not escape the item-type ban — Etsy determines category from what ships,
not from what the seller chose to photograph, and it stacks a materially bigger risk than a
takedown: Etsy Payments settles through card networks with their own high-risk merchant-category
rules for sex toys, and a listing structured specifically to route a prohibited item past content
review reads as payment-category evasion, which risks frozen funds or account termination for
cause. Same principle as §Organic social's "never route around a filter" — if a listing only works
by hiding what it actually is, kill it.

**What is viable, each with a caveat:**

- **Adult party games** (bachelorette/couples novelty games, signage) as original, xdipx-designed
  printables or print-on-demand goods — not resold Nalpac items. The best entry point: an
  established, non-toy Etsy category with real demand.
- **How-to / intimacy-education guides** as digital PDFs — text/illustration only, no photorealistic
  depiction of sex acts or genitalia, proper mature-content tagging and thumbnail obscuring per
  Etsy's listing rules.
- **Print-on-demand goods** (apparel, mugs, cards) with original designs through a disclosed POD
  production partner (e.g. Printify/Printful) — standard, policy-compliant path as long as imagery
  avoids explicit nudity/sex acts.
- **Digital artwork/illustrated downloads** — same nudity/photorealism ceiling as the guides above;
  stylized/suggestive illustration is the safe lane, explicit art is not.

**A cheap guide that links out to xdipx.com is a distinct, structurally sound lane — nothing
physical ships through Etsy at all.** A low-priced digital guide (e.g. $0.99) whose content
recommends specific products with links to their xdipx.com product pages does not engage either
Etsy blocker: Etsy never sees a toy transaction, only the guide transaction plus a hyperlink. This
is different from the disguised-bundle case above because no physical item ships from the Etsy
order. Etsy's **Off-Platform Transactions** policy bars completing *the same transaction* off-Etsy
(soliciting a buyer to pay outside Etsy to dodge the fee on that item) — it does not bar linking
from delivered content to a *different* product on a site the Etsy shop doesn't itself sell, which
is standard practice among Etsy digital sellers (pattern/recipe PDFs linking to external supply
lists). Three conditions keep this compliant, not blockers:
  1. The guide must be a genuine, substantive item for sale, not a bare link list — Etsy requires
     listings to offer a real item; a thin wrapper whose only purpose is redirecting risks removal
     as non-substantive, independent of the adult-content questions.
  2. Mature-content tagging still applies to the guide's own content if it describes sexual acts or
     use, per the same rules as the standalone-guide lane above.
  3. No Etsy-hosted checkout for the toy itself — links go to xdipx.com for a separate purchase,
     never a "buy this here" flow inside the Etsy listing.
  Re-verify the Off-Platform Transactions policy before scaling this beyond a pilot; it was read
  2026-08-19 via search, not fetched directly from Etsy (egress to etsy.com was blocked from this
  environment that day).

**Market read, honestly:** party games and POD are real, active Etsy categories, but commodity-
crowded; the edge is original design and personalization, not the "adult" framing itself. Treat any
Etsy lane as a small side experiment against the $2,000/month storefront goal, not a strategic bet,
until it proves revenue.

**Architecture, if pursued:** keep it manual and digital-only. No Etsy listing, inventory, or order
data syncs with Shopify or Nalpac; no `app/lib/etsy.server.ts` exists and none is needed for a
manual shop. This deliberately avoids protected paths (no cart, checkout, payment, or migration
touches). A synced or automated integration, or a dedicated `marketplace-ops` agent, is future scope
only after the manual lane proves out — do not build infrastructure for an unvalidated channel.

Sources: [Etsy Prohibited Items Policy](https://www.etsy.com/legal/policy/prohibited-items-policy-effective/1475031537022), [Etsy Adult Nudity and Sexual Content policy](https://www.etsy.com/legal/policy/adult-nudity-and-sexual-content/1269612959532), [Listing Mature Content Correctly](https://www.etsy.com/legal/policy/listing-mature-content-correctly/242665462117), [Etsy Seller Policy](https://www.etsy.com/legal/policy/seller-policy-effective-through-july-8/1489086421092), [Off-Platform Transactions policy](https://www.etsy.com/legal/policy/off-platform-transactions/1254654515806).

## Creative rules (paid AND organic)

- No nudity, where nudity means visible female nipples, labia, penis, or anus (owner definition
  2026-09-20, amended 2026-10-02: male nipples are not nudity on organic surfaces), and no explicit
  imagery. For **paid** creative, additionally no visible nipple of any sex, no depiction or
  simulation of product use on a body and no on-skin frame per
  `docs/store-team/instagram-campaigns.md` §3.2c: a product resting on bare skin is paid-ineligible
  whether or not it reads as use. For **organic** social, imagery is governed by the ceiling in
  `docs/store-team/instagram-campaigns.md` §3.2a with the on-skin treatment in §3.2c (which
  licenses product against bare skin and implied use); this line was corrected 2026-09-01 to match §Organic social above, which was corrected
  first.
- **Adult ad networks** are the one exception to the paid-only additions above (owner decision
  2026-10-03). Their imagery ceiling is the nudity definition alone: no visible female nipples,
  labia, penis, or anus. Copy there runs at register 10 per `docs/emma-voice.md`. Every other paid
  surface keeps the paid line, and the Meta lane adds M2 on top.
- Education/wellness framing; product-as-object photography (the store's bright editorial style is
  an asset here). Never porn-adjacent aesthetics.
- Copy follows `docs/emma-voice.md` on top of platform rules: suggestive about what a product does,
  never crude, no "sex/sexy" as branding adjectives, no countdowns or urgency theater.
- Age: all targeting 18+ minimum. Nothing that could read as appealing to minors. On **Meta**, treat
  25+ as the working floor because the platform age-gates the category harder. On **Google Search**
  this does not apply: Google enforces the 18+ floor itself for restricted sexual content, and the
  "Unknown" age bucket is routinely 40-60% of Search impressions, so excluding it strangles delivery
  for no policy benefit. Use a negative bid adjustment on 18-24 for high-ticket ad groups instead of
  an exclusion. That is an economics decision, not a compliance one.
- Landing pages are part of the ad: reviewers follow them. The page must match the ad's framing and
  never promise what the PDP doesn't deliver. **Note the current state honestly:** the store has no
  site-wide age gate. `AgeGatePanel` (`app/components/store/AgeGate.tsx`) is mounted only in the
  cart drawer and `/social`, is `localStorage`-only, and is a UI convention rather than a compliance
  control. Google does not require an age interstitial for this category, so this is not a rejection
  risk, but no `policyCheck` may ever claim the landing page carries an age gate.
- MAP rules apply to promoted prices: never advertise a discount on a MAP=MSRP product.

## The `policyCheck` protocol

Every proposal's `policyCheck` field states, in 2–5 sentences: (1) the platform and the exact policy
category the campaign fits; (2) why this product + creative + landing page complies; (3) the residual
risk, honestly. Ambiguous cases are proposed **with the risk flagged** — the owner decides — or
killed. "It'll probably slip through review" is never a compliance case.

## Escalation

- Policy ambiguity or a carve-out judgment call → flag in the proposal, owner decides.
- A rejected ad or any platform policy notice on a live account → stop proposing for that platform,
  record an `error` event, surface to the owner immediately (account health outranks the campaign).
- An organic post removed or an account restricted → `social-media-manager` records an `error`
  event and surfaces it to the owner the same run, with the offending draft quoted. Pause that
  platform's drafts until the owner has appealed and decided. One removal is a signal about the
  rules; a second on the same pattern is a signal about our instructions, and gets a suggestion
  (kind `instructions`, target `social`) proposing the fix.
- Material policy changes spotted during a run → file a suggestion to update this document
  (kind `instructions`, target `ads`), citing the source.

## Changelog

- **2026-10-03**, owner decision ("codify both"), from `docs/store-team/ad-studio-v2-plan.md` §1
  decisions 1 and 2. Meta moves from Prohibited to a strategic lane for the pleasure catalog, gated
  by §Meta strategic lane (M1 to M7, drawn from the teardown's §5a and §5c); the matrix row still
  records Meta's written policy as prohibiting the category. Adult ad networks run copy at register
  10, the one surface where the voice charter (v5.8) lets it ship, with the nudity definition as
  the imagery ceiling and UTMs mandatory; §Creative rules gains the matching exception. Microsoft
  Advertising (Adult Advertising Program), Snapchat (non-graphic, 18+, register 6-7), and Pinterest
  (prohibited) join the matrix, sourced from `docs/audits/ad-platform-research-2026-10-03.md`, and
  a copy-register table now lists every paid surface. Google Search stays text only at 3-4 (4-5
  for factual product text). Google Display, PMax and YouTube, and TikTok, X, Reddit and Pinterest
  paid, stay prohibited. The channel priority list is updated to match.

## Sources (last verification, 2026-07)

- Meta (re-read 2026-10-03): [Health and Wellness ad standard](https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness), which the adult-products URL below now redirects to
- Microsoft (read 2026-10-03): [Adult content policies](https://advertise.bingads.microsoft.com/zh-tw/resources/policies/tw-en/adult-content-policies-en), [Adult Advertising Program participation form](https://about.ads.microsoft.com/en/forms/policies/adult-advertising-program-participation-form)
- Snap (read 2026-10-03): [Snap Ad Policies](https://snap.com/ad-policies?lang=en-US)
- Pinterest (read 2026-10-03, secondary source): [Pinterest advertising guidelines via ConductAtlas](https://conductatlas.com/platform/pinterest-ads/pinterest-advertising-guidelines/provision/CA-P-066064/prohibition-on-advertising-sex-toys-and-adult-products/)
- Meta: [Adult products or services ad standard](https://transparency.meta.com/policies/ad-standards/content-specific-restrictions/adult-products-or-services), [Health & wellness policy](https://www.facebook.com/business/help/2489235377779939)
- TikTok: [Adult content ad policy](https://ads.tiktok.com/help/article/tiktok-ads-policy-adult-content)
- X: [Adult or sexual products and services ads policy](https://business.twitter.com/en/help/ads-policies/ads-content-policies/adult-or-sexual-products-and-services), [Shopping policies](https://help.x.com/en/rules-and-policies/shopping-policies)
- Google (re-verified 2026-08-08): [Sexual content ad policy](https://support.google.com/adspolicy/answer/6023699), [Merchant Center adult-oriented content](https://support.google.com/merchants/answer/6150138), [Advertiser verification](https://support.google.com/adspolicy/answer/9703665)
- Shopify (read 2026-09-30): [Prohibited products on Shop](https://help.shopify.com/en/manual/online-sales-channels/shop/eligibility/prohibited-products), [Shop Campaigns eligibility](https://help.shopify.com/en/manual/online-sales-channels/shop/shop-campaigns/eligibility), [Shop Campaigns overview](https://help.shopify.com/en/manual/online-sales-channels/shop/shop-campaigns), [Shop Campaigns Merchant Terms](https://www.shopify.com/legal/shop-campaigns-merchant-terms), [Shopify Payments eligibility](https://help.shopify.com/en/manual/payments/shopify-payments/onboarding/eligibility), [Content on Shop](https://shop.app/content-policies)

Organic (community standards, not ad standards):

- Meta: [Restricted Goods and Services](https://transparency.meta.com/policies/community-standards/restricted-goods-services/), [Adult Sexual Solicitation and Sexually Explicit Language](https://transparency.meta.com/policies/community-standards/sexual-solicitation/), [Adult Nudity and Sexual Activity](https://transparency.meta.com/policies/community-standards/adult-nudity-sexual-activity/)
- Instagram: [Sensitive Content Control](https://help.instagram.com/251027992727268), [Branded Content Policies](https://help.instagram.com/1695974997209192)
- Meta: [Helping teens see age-appropriate content](https://transparency.meta.com/policies/age-appropriate-content/) (why the category is recommendation-ineligible)
