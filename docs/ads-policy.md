# Ad Platform Policy — Sexual Wellness (BINDING for ads-manager and all paid media)

xdipx sells sex toys and sexual-wellness products — the most restricted mainstream ad category
there is. **The house rule: when a campaign can't make an honest written compliance case, it does
not get proposed.** An ad-account ban is a worse outcome than any missed impression, and enforcement
is often account-level and retroactive.

`ads-manager` must read this document in full at the start of every run. Every `ad_campaigns`
proposal must carry a `policyCheck` naming the platform category it fits and why it complies (the
API rejects proposals without one). The creative rules in §Creative apply to **organic social too**.

Policies drift. Last verified **2026-07** against the platform sources listed at the bottom. If a
proposal hinges on a policy detail, re-verify against the live policy page that run and cite it in
the `policyCheck`.

---

## Platform matrix

| Platform | Paid ads for pleasure products (sex toys) | What IS possible | Risk |
|---|---|---|---|
| **Meta** (FB/IG) | **Prohibited.** "Adult sexual arousal products or services" are banned outright — erotic products explicitly listed. | Narrow carve-out: sexual/reproductive **health & wellness** products (contraception, family planning) targeted 18+, focused on health and medical efficacy, **never on sexual pleasure**. For xdipx that covers at most lubricants/wellness-adjacent SKUs with strictly clinical framing — and the pleasure catalog can never ride along. Pixel/CAPI conversion tracking for organic/other traffic is fine and already wired. | **High.** Enforcement is aggressive; a rejected-ad pattern or a policy-violating landing page can ban the account. Never "wellness-wash" a pleasure product — reviewers follow the landing page. |
| **TikTok** | **Prohibited.** Sexual products/services banned, including devices for sexual pleasure or performance. | Nothing paid. Do not propose TikTok, ever. | Ban risk plus brand-safety blowback. |
| **X** | **Prohibited in ads.** Despite X's permissive *organic* adult-content policy, its advertising and shopping policies ban adult/sexual merchandise globally. | Organic posting (labeled appropriately per X's adult-content rules) — which is the social team's lane, not paid. | Ads get rejected; repeat attempts risk the ad account. |
| **Google Ads** | **Restricted, not prohibited — the only mainstream paid channel.** Sex toys are explicitly in Google's "restricted sexual content" category: ads serve only in limited scenarios (user search intent, 18+, local law), never to minors, with muted formats. | Search ads on category intent ("where to buy X"), Shopping with a compliant feed (the store already has `gmc-metafields.server.ts` for Merchant Center), non-explicit creative and landing experience. Expect "Limited" serving status as the *normal* state, not an error. | **Medium.** Compliant-but-limited is sustainable; explicit creative or policy-evasion attempts escalate to account action. |
| **Reddit** | Effectively prohibited for adult products in its ads program. | Organic community participation where subreddit rules allow (unpaid, social team's judgment). | Low spend exposure since there's no viable paid path. |
| **Adult ad networks** (e.g. category-specialist networks) | **Allowed — it's their business.** | Display/native on adult and adjacent inventory. Vet each network's traffic quality and brand-safety before proposing; model conservative conversion rates. | Quality/fraud risk, not policy risk. Attribution via UTMs is mandatory. |
| **Owned + earned channels** | No gatekeeper. | Email/SMS to consented lists (the email team), SEO/AEO (already invested), affiliates and creator/newsletter sponsorships (disclosure required, creator's platform rules apply), the referral program once built. | Lowest risk, best margins — the default recommendation when paid math is thin. |

**Channel priority for proposals:** (1) owned/earned, (2) Google restricted-serving search/Shopping,
(3) vetted adult networks and newsletter/creator sponsorships, (4) Meta only for genuinely
health-framed SKUs that pass the carve-out honestly. Never TikTok; never X paid.

## Creative rules (paid AND organic)

- No nudity, no explicit imagery, no depiction or simulation of product use on a body.
- Education/wellness framing; product-as-object photography (the store's bright editorial style is
  an asset here). Never porn-adjacent aesthetics.
- Copy follows `docs/emma-voice.md` on top of platform rules: suggestive about what a product does,
  never crude, no "sex/sexy" as branding adjectives, no countdowns or urgency theater.
- Age: all targeting 18+ minimum; treat 25+ as the floor where platforms age-gate the category
  harder. Nothing that could read as appealing to minors.
- Landing pages are part of the ad: reviewers follow them. The page must match the ad's framing,
  carry the age gate, and never promise what the PDP doesn't deliver.
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
- Material policy changes spotted during a run → file a suggestion to update this document
  (kind `instructions`, target `ads`), citing the source.

## Sources (last verification, 2026-07)

- Meta: [Adult products or services ad standard](https://transparency.meta.com/policies/ad-standards/content-specific-restrictions/adult-products-or-services), [Health & wellness policy](https://www.facebook.com/business/help/2489235377779939)
- TikTok: [Adult content ad policy](https://ads.tiktok.com/help/article/tiktok-ads-policy-adult-content)
- X: [Adult or sexual products and services ads policy](https://business.twitter.com/en/help/ads-policies/ads-content-policies/adult-or-sexual-products-and-services), [Shopping policies](https://help.x.com/en/rules-and-policies/shopping-policies)
- Google: [Sexual content ad policy](https://support.google.com/adspolicy/answer/6023699)
