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
re-verified **2026-08-08**, and §Meta Shops, which was added **2026-08-15** from the store's own
live channel state. If a proposal hinges on a policy detail, re-verify against the live
policy page that run and cite it in the `policyCheck`.

---

## Platform matrix

| Platform | Paid ads for pleasure products (sex toys) | What IS possible | Risk |
|---|---|---|---|
| **Meta** (FB/IG) | **Prohibited.** "Adult sexual arousal products or services" are banned outright — erotic products explicitly listed. | Narrow carve-out: sexual/reproductive **health & wellness** products (contraception, family planning) targeted 18+, focused on health and medical efficacy, **never on sexual pleasure**. For xdipx that covers at most lubricants/wellness-adjacent SKUs with strictly clinical framing — and the pleasure catalog can never ride along. Pixel/CAPI conversion tracking for organic/other traffic is fine and already wired. | **High.** Enforcement is aggressive; a rejected-ad pattern or a policy-violating landing page can ban the account. Never "wellness-wash" a pleasure product — reviewers follow the landing page. |
| **TikTok** | **Prohibited.** Sexual products/services banned, including devices for sexual pleasure or performance. | Nothing paid. Do not propose TikTok, ever. | Ban risk plus brand-safety blowback. |
| **X** | **Prohibited in ads.** Despite X's permissive *organic* adult-content policy, its advertising and shopping policies ban adult/sexual merchandise globally. | Organic posting (labeled appropriately per X's adult-content rules) — which is the social team's lane, not paid. | Ads get rejected; repeat attempts risk the ad account. |
| **Google Ads** | **Restricted, not prohibited. The only mainstream paid channel.** Sex toys are "moderately restricted" sexual merchandise: ads serve only in limited scenarios (user search intent, 18+, local law, SafeSearch), never to minors. **Eligible on the Search Network only. Prohibited on the Display Network and the Google Ad Manager Network.** No certification or allowlist application exists for this category; serving limits apply automatically. | Search text ads on category and brand intent ("where to buy X"). Shopping is a **separate** surface with its own policy and review queue, see §Merchant Center. Non-explicit creative and landing experience. Expect "Limited" serving status as the *normal* state, not an error. | **Medium.** Compliant-but-limited is sustainable; explicit creative or policy-evasion attempts escalate to account action. |
| **Reddit** | Effectively prohibited for adult products in its ads program. | Organic community participation where subreddit rules allow (unpaid, social team's judgment). | Low spend exposure since there's no viable paid path. |
| **Adult ad networks** (e.g. category-specialist networks) | **Allowed — it's their business.** | Display/native on adult and adjacent inventory. Vet each network's traffic quality and brand-safety before proposing; model conservative conversion rates. | Quality/fraud risk, not policy risk. Attribution via UTMs is mandatory. |
| **Owned + earned channels** | No gatekeeper. | Email/SMS to consented lists (the email team), SEO/AEO (already invested), affiliates and creator/newsletter sponsorships (disclosure required, creator's platform rules apply), the referral program once built. | Lowest risk, best margins — the default recommendation when paid math is thin. |
| **Etsy** | Not an ad platform for this store; the question is whether xdipx's catalog can list there at all. **The Nalpac-fulfilled physical toy catalog cannot, in any form.** See §Etsy for the two independent policy blockers. | A narrow, digital-only, design-original lane (adult party games, printables, digital art), disconnected from the Nalpac catalog and from Shopify inventory. Manual, owner-run; not an automated channel. | **High if physical toys are listed** (policy-prohibited item type, twice over). **Low** for the digital-only lane if kept to original designs with proper mature-content tagging. |

**Channel priority for proposals:** (1) owned/earned, (2) Google restricted-serving Search,
(3) vetted adult networks and newsletter/creator sponsorships, (4) Google Shopping via Merchant
Center once §Merchant Center is satisfied, (5) Meta only for genuinely health-framed SKUs that pass
the carve-out honestly. Never TikTok; never X paid.

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
| **Instagram / Facebook** | Editorial and educational only. The account is a publication; commerce lives at post → profile → link in bio → site. A Shops surface also exists and is live, see §Meta Shops; it is governed by Meta's Commerce Policies rather than by this row, and it loosens nothing here. | No sale attempt in the post (no price, discount, promo code, or shop CTA), no describing what a product does to a body. Imagery is governed by the ceiling in `docs/store-team/instagram-campaigns.md` §3.2a, which licenses product in hand and against skin, beds, lingerie and implied use, and blocks genitalia, nipples, hands on genitals and depicted acts. The blanket "no product in hand or on a body" that stood here was withdrawn by owner ruling 2026-08-16 after it had already been contradicted by the 2026-08-12 hand ruling for four days. | **High.** Enforcement is account-level and retroactive; repeat strikes disable the account with little recourse. Appeal every removal. |
| **TikTok** | Same posture as Instagram, applied harder — TikTok moderates the category more aggressively than Meta. | As above. Treat any borderline draft as a no. | **High.** |
| **X** | The one genuinely permissive organic surface. X's adult-content policy allows the category; posts it covers must be labeled per X's own rules. | Still no explicit creative and no porn-adjacent aesthetics per §Creative. Paid remains prohibited. | **Medium.** |
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
- **Product tagging is live as of 2026-08-16** (ticket #3744). The owner added the
  `instagram_shopping_tag_products` permission, and the publisher
  (`app/lib/social-publish/instagram.server.ts`) now tags the gate stamp's featured product on feed
  photos and carousels when Meta's `available_catalog_product_search` returns it, which by
  construction limits tags to Shops-approved products. A tag is additive and loosens nothing: the
  sale-attempt checks in this document still bind, the post stays editorial, and any tag failure
  (no approved match, missing scope, API refusal) degrades to publishing without the tag, never to
  a failed publish. The pre-2026-08-16 claim that no post can carry a product tag is obsolete.
- **Approval is not a licence and rejection is not a ban.** Commerce review judges a catalog item;
  community standards judge a post. Never treat an approved product as permission to post something
  §Organic social forbids, and never treat a rejected product as ineligible to appear in an
  editorial post. Draft product selection is never filtered on catalog approval status
  (`docs/store-team/routine-social-daily.md` Step 2.7).
- **Do not hand-delete rejected items in Commerce Manager.** The catalog's only data source is the
  Shopify partner integration, so deletions are re-created on the next sync. Unpublish from the
  Facebook & Instagram channel in Shopify instead.

Re-verify the counts before citing them. They move as Meta works through the review queue.

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

**Market read, honestly:** party games and POD are real, active Etsy categories, but commodity-
crowded; the edge is original design and personalization, not the "adult" framing itself. Treat any
Etsy lane as a small side experiment against the $2,000/month storefront goal, not a strategic bet,
until it proves revenue.

**Architecture, if pursued:** keep it manual and digital-only. No Etsy listing, inventory, or order
data syncs with Shopify or Nalpac; no `app/lib/etsy.server.ts` exists and none is needed for a
manual shop. This deliberately avoids protected paths (no cart, checkout, payment, or migration
touches). A synced or automated integration, or a dedicated `marketplace-ops` agent, is future scope
only after the manual lane proves out — do not build infrastructure for an unvalidated channel.

Sources: [Etsy Prohibited Items Policy](https://www.etsy.com/legal/policy/prohibited-items-policy-effective/1475031537022), [Etsy Adult Nudity and Sexual Content policy](https://www.etsy.com/legal/policy/adult-nudity-and-sexual-content/1269612959532), [Listing Mature Content Correctly](https://www.etsy.com/legal/policy/listing-mature-content-correctly/242665462117), [Etsy Seller Policy](https://www.etsy.com/legal/policy/seller-policy-effective-through-july-8/1489086421092).

## Creative rules (paid AND organic)

- No nudity, no explicit imagery, no depiction or simulation of product use on a body.
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

## Sources (last verification, 2026-07)

- Meta: [Adult products or services ad standard](https://transparency.meta.com/policies/ad-standards/content-specific-restrictions/adult-products-or-services), [Health & wellness policy](https://www.facebook.com/business/help/2489235377779939)
- TikTok: [Adult content ad policy](https://ads.tiktok.com/help/article/tiktok-ads-policy-adult-content)
- X: [Adult or sexual products and services ads policy](https://business.twitter.com/en/help/ads-policies/ads-content-policies/adult-or-sexual-products-and-services), [Shopping policies](https://help.x.com/en/rules-and-policies/shopping-policies)
- Google (re-verified 2026-08-08): [Sexual content ad policy](https://support.google.com/adspolicy/answer/6023699), [Merchant Center adult-oriented content](https://support.google.com/merchants/answer/6150138), [Advertiser verification](https://support.google.com/adspolicy/answer/9703665)

Organic (community standards, not ad standards):

- Meta: [Restricted Goods and Services](https://transparency.meta.com/policies/community-standards/restricted-goods-services/), [Adult Sexual Solicitation and Sexually Explicit Language](https://transparency.meta.com/policies/community-standards/sexual-solicitation/), [Adult Nudity and Sexual Activity](https://transparency.meta.com/policies/community-standards/adult-nudity-sexual-activity/)
- Instagram: [Sensitive Content Control](https://help.instagram.com/251027992727268), [Branded Content Policies](https://help.instagram.com/1695974997209192)
- Meta: [Helping teens see age-appropriate content](https://transparency.meta.com/policies/age-appropriate-content/) (why the category is recommendation-ineligible)
