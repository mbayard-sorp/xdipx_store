# Google Ads: first campaign launch plan

Status: **proposed, awaiting owner sign-off.** Written 2026-08-08 from an `/all-hands` convening
(`ads-manager`, `homepage-cro`, `tech-architect`). Nothing here has been executed. No `ad_campaigns`
row exists yet.

`docs/ads-policy.md` is binding and outranks this document. Read it first.

---

## 1. The shape of the decision

Two things get called "connecting Google Ads" and only one is on the critical path.

**Account side (needed to launch):** a Google Ads account with approved billing. No code.

**API side (not needed to launch):** a manager (MCC) account, a developer token, an OAuth2 client,
and a user refresh token, so agents could push paused drafts programmatically. Basic Access approval
is backlogged. This is deferred, see §6.

The campaign is built and launched **by hand in the Google Ads UI**. That is not a workaround; it is
the correct posture for a propose-only ads lane in a restricted category, where the work that
decides whether the campaign survives (policy posture, disapproval appeals, "Limited" serving
remediation) is UI and appeal work the API does not express.

## 2. Owner checklist, in order

| # | Step | Latency | Blocks launch? |
|---|---|---|---|
| 1 | Create the Google Ads account on the identity that owns GA4 and Search Console | same day | yes |
| 2 | Add billing. Expect manual review for this vertical | 2-5 business days | **yes, start first** |
| 3 | Begin advertiser identity verification (legal entity + business name) | up to 4-5 weeks | no, serves while pending |
| 4 | Link GA4 to Google Ads, import `purchase` as a conversion, mark it Primary | ~1 hour | no, but do it before spend |
| 5 | Confirm auto-tagging is ON (it is the default) | minutes | yes, see §5 |
| 6 | Build the campaign per §3 | ~2 hours | yes |

No certification or category application exists. Serving limits apply automatically.

## 3. Campaign: `gsearch-intent-aug26`

**Type:** Search, Standard. **Not** Performance Max, Demand Gen, or Smart. See
`docs/ads-policy.md` §Google network eligibility for why those are prohibited by construction.

**Networks:** Search Network only. Uncheck "Include Google Display Network" (prohibited) and
uncheck "Include Google search partners" for the test (partner inventory is where porn-adjacent
placements leak in and it is not separably reportable at this budget).

**Bidding:** Manual CPC, Enhanced CPC off. The store has near-zero conversion history, and smart
bidding below roughly 30 conversions per 30 days optimizes on a portfolio prior rather than on this
account. Revisit at 30 conversions in a rolling 30 days, not before.

**Ad rotation:** rotate indefinitely for the first 14 days, to get a real per-RSA CTR read.

**Geo:** United States only. Set Location options to **Presence**, not the "Presence or interest"
default. Exclude HI, AK, PR for the test: their free-shipping threshold is $145 vs $99
(`app/lib/shipping.ts`), so their unit economics muddy a ~300-click sample.

**Age:** leave Google's own 18+ enforcement to do its job. Do not exclude the "Unknown" bucket.
Apply a -50% bid adjustment on 18-24 for the higher-ticket ad groups.

### Ad groups

Phrase and exact match only. **No broad match anywhere in this vertical**, at any time.

| Ad group | Keywords | Max CPC | Landing collection |
|---|---|---|---|
| A · lelo-brand | `[lelo sona 2]`, `[lelo sila]`, `[buy lelo]`, `"lelo vibrator"`, `"lelo official"` | $0.70 | `/collections/lelo` |
| B · wand | `[wand massager]`, `[best wand massager]`, `"rechargeable wand massager"`, `"cordless wand massager"` | $1.20 | `/collections/wands` |
| C · couples | `[couples vibrator]`, `[vibrator for couples]`, `"remote control couples vibrator"` | $1.20 | `/collections/couples` |
| D · lubricant | `[water based lubricant]`, `[best water based lube]`, `"sliquid h2o"`, `"system jo lubricant"` | $0.80 | `/collections/lubricants` |

Brand ad groups are the profit hypothesis. Category ad groups are a **labeled learning expense**:
their week-one job is a clean search-terms report and a CVR estimate, not profit.

Verify each collection has at least six in-stock items above $60 before it gets budget.

**Do not point any ad at `/`.** `app/lib/home-variant.server.ts` resolves `/` to one of three
different experiences depending on env and Sanity state, and a nondeterministic landing page for a
policy reviewer is an avoidable own goal. Collections are stable. Never put `?variant=` in a final
URL: it is honored from the query string with no auth.

### Negative keywords

Build as a shared account-level list and apply it **before the first impression**. This is the
highest-value hour in the build.

- **Age-ambiguous (add first, non-negotiable):** teen, teens, teenage, young, younger, minor,
  minors, child, children, kid, kids, school, schoolgirl, student, barely legal
- **Porn/content intent:** free, porn, xxx, video, videos, tube, cam, cams, webcam, live, stream,
  watch, hentai, nude, nudes, naked, pics, photos, gif, erotica, onlyfans, escort, hookup, dating
- **DIY:** diy, homemade, how to make, make your own, substitute, alternative, household, 3d print
- **Research/no-buy:** what is, definition, meaning, wiki, wikipedia, reddit, quora, forum, side
  effects, dangerous, is it safe, study, research, symptoms, therapy, doctor, prescription
- **Free/discount:** freebie, giveaway, sample, coupon, promo code, voucher, cheap, cheapest,
  clearance
- **Marketplace/competitor:** amazon, walmart, target, ebay, aliexpress, temu, etsy, adam and eve,
  lovehoney, wholesale, bulk, dropship, distributor, near me, in store, local
- **Support/non-commercial:** repair, fix, manual, instructions, how to charge, warranty, return
  policy, refund, broken, troubleshoot, job, jobs, salary, affiliate program

Run the search-terms report on **day 2, day 5, and day 10** and append. Twenty minutes each.

### Creative

No final ad text is approved here. Headlines go through `emma-empathy-reviewer` against the ads
addendum (education register 3-4). Direction: mechanism-and-fit framing, discreet shipping and the
XDIPX descriptor as trust callouts, no "sex"/"sexy" as adjectives, no countdowns, no "Buy now".

Two hard rules:

- **No prices, discounts, "% off", struck prices, or promotion extensions in any ad or extension.**
  `MAP_RESTRICTED_VENDORS` in `pricing-engine.server.ts` blocks discount framing for some vendors,
  LELO enforces MAP in practice, and the pricing agent moves prices daily, so any price baked into
  an ad drifts out of compliance on its own.
- **Drop the CTA glyphs.** The on-site whitelist uses `→` and `♥`; Google Ads' ad-text symbol policy
  will likely reject them. Use the whitelist words without glyphs in ad text ("Take a peek", "Find
  your fit"); keep the glyphs on-site.

## 4. Budget and economics

- **Opening daily: $25.00.** **14-day test total: $350.**

At a blended ~$1.05 CPC that is ~330 clicks, which at a cold-traffic 1.5-2.5% CVR is 5-8 orders:
the minimum sample that distinguishes "works" from "doesn't."

**Contribution margin**, derived from `app/lib/pricing-engine.server.ts` (`MARGIN_FLOOR = 0.20`,
tiered discounts against a `wholesale × 1.25` floor) minus ~6.5% high-risk processing:

> **Break-even ROAS ≈ 4.3x.** Range 3.0x on 37%-margin SKUs to 5.7x at the 20% floor.
> Break-even CPA at $80 AOV ≈ $18.40, which at a $1.10 CPC needs a **6% conversion rate.**
> Confidence: medium. Derived from engine constants, not from realized order data.

6% is achievable on brand and product-name searches where the shopper is choosing a retailer. It is
not achievable on category terms from cold traffic. Budget accordingly.

**Against the $2,000/month profit goal, state it plainly:** paid search at break-even contributes
$0. Its value here is first-order acquisition that feeds email and repeat purchase. It is not the
channel that reaches $2k/month on these numbers.

### Success and kill criteria at 14 days

**Working:** 300+ clicks, 4+ orders, blended ROAS >= 2.5x with at least one ad group >= 4.3x, CTR
>= 4% brand and >= 2% category, wasted spend <= 15% after two negative passes.

**Kill:** zero orders at 250 clicks; or >30% of spend on junk queries after two negative passes; or
$200 spent at CPA > $60. **Any account-level policy notice stops the platform immediately** per
`docs/ads-policy.md` §Escalation. Account health outranks the campaign.

## 5. Measurement: the part that must ship first

**A Google Ads click cannot be attributed to a purchase today.** Three independent blockers, all
verified in the repo:

1. **`gclid` is never captured.** `app/lib/attribution.server.ts` captures `utm_*`, `ref`, and
   `fbclid`, but no `gclid`/`gbraid`/`wbraid`. The only repo occurrences are the canonical-URL strip
   list in `app/lib/seo.ts`. Auto-tagging appends `gclid` and **not** UTM params, so with
   auto-tagging on, the server-side capture writes nothing.
2. **gtag cannot cover for it.** Consent-mode boots `ad_storage: 'denied'` (`app/root.tsx`), and
   with `ad_storage` denied gtag does not write `_gcl_aw` at all. gtag.js is also deferred behind
   first interaction, idle, or 8s, so short paid sessions never load it. This is the same failure
   that drove `_fbp` coverage to 1.6% and forced the server-side `_fbc` capture.
3. **Checkout is off-domain.** The purchase completes on Shopify's checkout, so no client-side
   conversion tag on xdipx.com can ever see it, and Enhanced Conversions for web has no web
   conversion to enhance. Cart attributes are the only channel across that boundary
   (`app/lib/attribution-cart.server.ts`), and they carry no `_gclid`.

**A click whose gclid was never persisted can never be attributed retroactively.** That makes
capture the one genuinely irreversible item: it ships before the first paid click, not after.

**The conversion path, in two tiers:**

- **Tier 1, no code:** mark GA4 `purchase` a key event, link GA4 to Google Ads, import. Partial
  coverage only, because it still depends on gtag having seen the gclid. Numbers will look plausible
  and be quietly low. Do it anyway, it is an hour.
- **Tier 2, the authoritative number:** capture gclid server-side, stamp it onto the cart, read it
  off `order.note_attributes` in `server/webhooks.ts` next to `_ga_cid`, and upload an offline click
  conversion. **Google Ads accepts a CSV upload in the UI, so this needs no API access.** Automate
  the last hop later, if ever. Conversions import within ~90 days of the click, so a few weeks of
  manual lag is fully recoverable, *provided the gclid was captured.*

Capture always, gate the upload on stored marketing consent (the position already taken for `_fbc`).
Surface the excluded count in the admin export so under-reporting is visible rather than silent.

## 6. What is deliberately not being built

**The Google Ads API connector stays inert.** `app/lib/ad-publish/google.server.ts` remains a stub.
Reasons, in order of weight: Basic Access is backlogged so it cannot serve this deadline at all; its
only output is a paused draft the owner must open the UI to launch anyway; the OAuth `adwords` scope
is read *and* write with no read-only variant, so it would put an unbounded-spend credential in the
env; refresh tokens from an app in "Testing" status expire every 7 days; and one campaign does not
amortize a protected-path change.

Revisit only for a **read-only reporting client**, and only past roughly $1.5-2k/month sustained
spend across three or more concurrent campaigns. Apply for the MCC and developer token now anyway,
purely to start the approval clock. Nothing blocks on it.

**Shopping stays phase two.** See `docs/ads-policy.md` §Merchant Center. The feed has a
suspension-grade shipping defect that must be fixed before submission (see the ticket list).

## 7. Landing URLs

Set at campaign level as a Final URL suffix, with auto-tagging left ON. Both coexist.

```
utm_source=google&utm_medium=paid&utm_campaign=gsearch-intent-aug26&utm_content=ag-{adgroupid}
```

`utm_medium=paid` is the house convention (`app/lib/attribution.server.ts`) but GA4's default channel
grouping expects `cpc|ppc|paidsearch` and will bucket `paid` as Unassigned. **Keep `paid`** since
order attribution is what pays the bills, and create a GA4 custom channel group mapping
`source=google` + `medium=paid` to Paid Search. Do not fix this by changing the UTM.

`UTMData` has no `term` field, so keyword-level order attribution is impossible until that ships.
`utm_content` is the interim workaround.
