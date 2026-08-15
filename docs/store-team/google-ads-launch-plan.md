# Google Ads: first campaign launch plan

Status: **proposed, awaiting owner sign-off.** Written 2026-08-08 from an `/all-hands` convening
(`ads-manager`, `homepage-cro`, `tech-architect`). **Revised 2026-08-15** by a second `/all-hands`
convening after the 8/13-8/14 target slipped with nothing executed. Nothing here has been executed.

`docs/ads-policy.md` is binding and outranks this document. Read it first.
`docs/store-team/google-ads-ad-copy.md` holds the approved copy bank.

## What changed on 2026-08-15, and why the first attempt stalled

The 8/08 plan was sound. It did not happen because **every step in it is owner-only manual work with
no ticket, no reminder, and no surface that shows it is outstanding.** `ad_campaigns` proposals are
not read by `owner-digest.server.ts`, so three approved proposals sat invisible for a month. That is
the durable failure, and it is fixed by the visibility ticket, not by rewriting the plan.

Corrections landed in this revision, each verified against live data rather than inferred:

| # | Correction | Where |
|---|---|---|
| 1 | **AOV was assumed at $80. The only real order is $26.47.** Break-even CPA is ~$9.87, not $18.40 | §4 |
| 2 | **Ad group D (lubricant) fails this document's own stock gate**: 3 in-stock items ≥ $60, not 6 | §3 |
| 3 | **Ad group A bid on two LELO products the store does not stock** | §3 |
| 4 | Three collection handles in circulation are 404s | §2 |
| 5 | **Never land on `/`**: the hero runs intensity-9 desire copy above the fold and rotates daily | §3 |
| 6 | **Never land on a Notebook post**: 2 PDP clicks and 0 subscribes from 82 reads in 28 days | §3 |
| 7 | gclid capture already shipped. The gap moved to the last hop, and it is no longer irreversible | §5 |
| 8 | GA4 `purchase` is confirmed firing in production, so checklist step 5 is already done | §2, §5 |
| 9 | `UploadClickConversions` is deprecated 2026-06-15. Build on the Data Manager API | §5 |
| 10 | **AI Max auto-upgrades qualifying Search campaigns from 2026-09-01** | §2 |
| 11 | Brand bidding carries an unpriced trademark risk | §3 |
| 12 | Four receiving-end defects sit on the paid path | §8 |
| 13 | `ad_campaigns` row #1 conflicts with this plan and should be rejected | §9 |

**The tension this revision exposes, which only the owner can resolve:** the minimum budget that can
produce a statistically readable answer is about **$25/day for 4 weeks ($700)**, while the first-order
economics at a $26 AOV cannot justify that spend. Both are true. See §4.

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

Account status as of 2026-08-08: **exists, GA4 link completed 2026-08-07, never used to run a
campaign.** A cold account is genuinely good news on policy (no inherited strikes, and in this
category strikes are account-level and retroactive) and genuinely slower on billing.

| # | Step | Latency | Blocks launch? |
|---|---|---|---|
| 1 | Google Ads account exists | done | - |
| 2 | GA4 to Google Ads link | done 2026-08-07 | - |
| 3 | **Add billing and clear first-charge verification** | 2-5 business days on a cold account | **yes, the long pole. Do it first.** |
| 4 | Complete advertiser identity verification | days to weeks | not at first, but a new account can be paused on a deadline. Start it day one |
| 5 | ~~Confirm `GA4_API_SECRET` is set in prod~~ | **DONE** | **Verified 2026-08-15.** GA4 shows exactly 1 `purchase` event in 90 days, matching the 1 real order, so the server-side Measurement Protocol path is live in production. No action needed |
| 6 | Mark `purchase` a key event in GA4, then import it as a conversion in Google Ads and confirm it appears under Goals | ~1 hour | yes. The link alone imports nothing |
| 7 | Confirm auto-tagging is ON (it is the default) | minutes | **yes.** Without it no `gclid` reaches the site and the capture has nothing to capture |
| 8 | **Run Keyword Planner** on the §3 keyword list to replace the assumed $1.20 CPC with real numbers | ~20 min | yes. Cheapest de-risking in this plan. If model-name CPCs come back above ~$1.50 the economics in §4 fail and the keyword set needs re-scoping |
| 9 | Ship §8 items 1 and 2 (cart age gate, `generate_lead`) | ~1.5 hours dev | **yes.** Item 1 is a wall at peak intent; item 2 makes month one's primary success metric measurable |
| 10 | Build the campaign per §3, leave it **paused**. Apply the negative list before anything can serve | ~2 hours | yes |
| 11 | Unpause once billing clears and ads are approved | - | - |

No certification or category application exists. Serving limits apply automatically.

**Weekly owner work, for the first month, that no agent can do.** Search-term pruning, negative
appends, disapproval appeals, and "Limited" remediation are hands-on in-UI work that the propose-only
valve forbids any agent from doing and that the API could not express anyway. Budget **20 minutes on
days 2, 5, and 10, then weekly.** If this does not happen, the negative list never tightens and the
test measures the keyword list rather than the store. Put it on a recurring calendar item.

### Dated trap: the AI Max auto-upgrade on 2026-09-01

Google reached general availability on AI Max for Search on 2026-04-15, and **from 2026-09-01 it
automatically upgrades Search campaigns that use broad match or automatically created assets to AI
Max, with no genuine opt-out** ([Google Ads Help](https://support.google.com/google-ads/answer/15910187),
retrieved 2026-08-15). AI Max adds landing-page-based search term matching, which for a 4,700-SKU
adult catalog means Google generating queries and ad copy from arbitrary product pages, in the most
restricted category on the platform, with no keyword control.

**Meeting neither trigger is what keeps the account out of it:**

1. **Never use broad match**, in any ad group, ever.
2. **Turn OFF "automatically created assets"** at campaign level.
3. Verify search term matching is toggled off in ad group settings.
4. Put a calendar reminder on **2026-09-01** to re-audit every campaign's settings.

Also disable **auto-apply recommendations** entirely (Recommendations, three-dot menu, Auto-apply
settings, disable all). Google will otherwise silently switch the bid strategy, add broad-match
keywords, and raise the budget on the account's behalf.

### Verified collection handles (three in this document were wrong)

Checked live 2026-08-15. The repo's own tooling was guessing on three of these.

| Assumed | Reality |
|---|---|
| `/collections/rabbits` | **404.** Use `/collections/rabbits-dual-action` |
| `/collections/air-pulse-suction` | **404.** Use `/collections/suction-air-pulse` |
| `/collections/remote` | **404.** Use `/collections/app-controlled` |

**`/for-him`, `/for-her`, and `/vault` are 301 redirects** (`app/lib/retired-routes.ts`). Google Ads
penalizes final URLs that redirect and requires the display domain to match. Never use them as final
URLs.

### Cold-account specifics

- **Build paused, with the negative list applied before anything can serve.** A brand-new account
  in the most restricted ad category, launching straight into live spend, is the profile that draws
  scrutiny. The negatives are what stop the first day's budget evaporating on porn and DIY intent.
- **Expect a slower first ad review.** New accounts queue behind established ones, and restricted
  categories queue again. One to two business days is typical, longer here.
- **"Eligible (limited)" is the normal steady state for this category, not an error.** Do not
  "fix" it by loosening creative or keywords, which is how a compliant account becomes a
  non-compliant one.
- **Refuse Google's setup prompts.** The campaign creation flow will push Performance Max, Smart
  campaigns, broad match, and a higher budget. All four are wrong here: the first two serve
  prohibited networks (§Google network eligibility in `docs/ads-policy.md`), broad match burns a
  cold budget on junk queries, and smart bidding has no conversion history to work from.
- **Do not front-load spend to "learn faster."** On a cold account it buys noise and risk, not
  signal.

### Realistic timeline for a launch the week of 2026-08-10

| Day | What happens |
|---|---|
| Mon 8/10 | Billing submitted, advertiser verification started, prod env checks done |
| Mon-Tue | Campaign built paused, negatives applied, conversion imported and verified in Ads |
| Wed-Thu | Billing clears, ads submitted for review |
| **Thu 8/13 - Fri 8/14** | **Realistic first serve** |

Next week is achievable, but it is the **back half** of next week, not Monday. The only way it slips
past that is if billing review runs long, which is the one step nobody can accelerate.

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

> **Keyword defect, found 2026-08-15: ad group A bids on two products the store does not stock.**
> `[lelo sona 2]` and `[lelo sila]` are not in the catalog. `/collections/lelo` carries GIGI 3,
> LIV 3, LILY 3, MIA 3, NEA 3, SONA Cruise, MONA Spectra, Boomerang, Surfer 2, and Beads Plus.
> Buying those two keywords sends a ready buyer to a store without the product, at full CPC. The
> corrected keyword set is in the table below. **The general rule this implies: no keyword enters a
> proposal until the exact product or collection behind it has been verified in stock.**

| Ad group | Keywords | Max CPC | Landing collection |
|---|---|---|---|
| A · lelo-brand | `[lelo gigi 3]`, `[lelo liv 3]`, `[lelo lily 3]`, `[lelo mia 3]`, `[lelo nea 3]`, `[lelo sona cruise]`, `[lelo mona]`, `"buy lelo"`, `"lelo vibrator"` | $1.00 | `/collections/lelo`, model terms to the PDP |
| A0 · magic-wand (**new, highest-value group in the account**) | `[magic wand original]`, `[magic wand rechargeable]`, `[magic wand hv 260]`, `[magic wand plus]`, `[magic wand mini]`, `[hitachi magic wand]`, `"magic wand massager"` | $1.40 | `/collections/magic-wand`, model terms to the PDP |
| B · wand | `[wand massager]`, `[best wand massager]`, `"rechargeable wand massager"`, `"cordless wand massager"` | $1.20 | `/collections/wands` |
| C · couples | `[couples vibrator]`, `[vibrator for couples]`, `"remote control couples vibrator"` | $1.20 | `/collections/couples` |
| D · lubricant | `[water based lubricant]`, `[best water based lube]`, `"sliquid h2o"`, `"system jo lubricant"` | $0.80 | `/collections/lubricants` |

Brand ad groups are the profit hypothesis. Category ad groups are a **labeled learning expense**:
their week-one job is a clean search-terms report and a CVR estimate, not profit.

Verify each collection has at least six in-stock items above $60 before it gets budget.

### Stock gate, measured 2026-08-15

| Collection | In stock | In stock ≥ $60 | Verdict |
|---|---|---|---|
| `/collections/lelo` | 29 | 27 | pass |
| `/collections/wands` | 82 | 52 | pass |
| `/collections/couples` | 200 | 107 | pass |
| `/collections/lubricants` | 243 | **3** | **FAILS** |

**Ad group D does not launch.** Lubricant fails this document's own gate, and it fails it
structurally rather than temporarily: lube is a sub-$20 category, so it will never carry a $9.87
break-even CPA as an acquisition term. Lube is an **attachment** product, not an acquisition
product. Move it to `FrequentlyBoughtWith` and to email, and give its budget to ad group B.

### Two risks this table did not originally price

- **Brand bidding carries a trademark risk that is not a Google policy risk.** Ad group A bids on
  LELO. There is no authorized-reseller documentation anywhere in this repo, and premium brands in
  this category (LELO, We-Vibe, Womanizer) run their own brand campaigns and file Google trademark
  complaints against resellers they have not authorized. The failure mode is ad removal, not an
  account strike, so it is survivable. But confirm reseller standing through Nalpac before ad group
  A gets budget, or expect the ads to be pulled. If reseller standing cannot be confirmed, the
  strongest in-stock brand inventory by volume is We-Vibe (35 items ≥ $60), b-Vibe (37), Womanizer
  (28), Lovense (28), Le Wand (17), Tantus (38), FemmeFunn (45).
- **Lovense is MAP-restricted** (`MAP_RESTRICTED_VENDORS` in `pricing-engine.server.ts`). If it ever
  gets an ad group, no discount framing anywhere in the ad or on the landing page.

**Do not point any ad at `/`.** Two independent reasons, the second one decisive.

1. `app/lib/home-variant.server.ts` resolves `/` to one of three different experiences depending on
   env and Sanity state, and a nondeterministic landing page for a policy reviewer is an avoidable
   own goal. Never put `?variant=` in a final URL: it is honored from the query string with no auth.

2. **The homepage hero runs the charter's intensity-9 desire register above the fold, and the
   merchandising team rotates it daily.** Fetched live 2026-08-15, the first body copy on `/` was an
   explicit description of a sexual act. That is correct on-site behaviour and it is exactly what the
   voice charter asks for on an owned channel. It is also the single most likely cause of an ad
   disapproval under Google's sexual content policy, and in this category repeat disapprovals
   escalate to account-level action.

   **This is not a copy bug to fix.** Do not touch the hero. The charter governs `/`; this document
   governs where ads land. The resolution is that ads never land on `/`, on any day, regardless of
   what is rotating.

**Do not point any ad at a Notebook post either**, including the one named in `ad_campaigns` row #1.
Measured over 28 days: 82 `notebook_read_depth` events produced **2** `notebook_embed_click` (post to
PDP) and **0** `notebook_subscribe`. The Notebook earns its keep on SEO and AEO citation. As a paid
landing page it buys reading, not shopping.

**Land ads on PDPs and on collections.** Both were verified 2026-08-15 to render fully server-side
for Googlebot (`/collections/wands` returns 303KB with 73 product links, no `noindex`), both carry
price, trust, and add-to-cart, and a PDP cannot promise what it does not deliver because it is the
product. PDP education-register copy ("What it does", the FAQ block) reads as review-survivable as
written.

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

- **Opening daily: $25.00.** **Test length: 4 weeks. Committed total: $700**, with a hard go/no-go
  review at day 10 (~$250 spent). Split $18/day to the brand/model campaign and $7/day to the
  category campaign, so a hungry category ad group cannot eat the profit hypothesis.

### Why $25/day, and the floor below which spending is pointless

CPC first, honestly: **there is no public CPC benchmark for this category.** Mainstream benchmark
datasets cover 20-23 industries and exclude it. Two forces pull in opposite directions. Downward:
Amazon, Walmart, and Target do not bid here, and the whole PMax/Shopping/Display machine that
inflates retail auctions is closed to everyone in the category. Upward: every competitor's entire
paid budget is forced onto this one surface.

**Planning band $0.70-$2.00, planning number $1.20. Confidence low-to-medium. Replace it with
Keyword Planner data from the live account before committing budget.** That is a 20-minute job once
billing clears and it is the cheapest de-risking available in this document.

Clicks needed before a result means anything, `(1-p)^n < 0.05`:

| True CVR | Clicks before "zero orders" actually means "it's broken" |
|---|---|
| 3% | 98 |
| 2% | **148** |
| 1% | 298 |

Estimating a CVR you can optimize against needs ~10 conversions, so 333-500 clicks. **The bar is
300-500 clicks after pruning**, plus the 20-30% of week-one spend that burns on terms you have not
negated yet.

| Daily budget | Clicks/day @ $1.20 | Days to 300 clicks |
|---|---|---|
| **$3** | 2.5 | **120** |
| $10 | 8.3 | 36 |
| **$25** | 21 | **14** |

> **Below roughly $10/day you are donating to Google.** To clear the 148-click threshold inside a
> single 28-day month you need 5.4 clicks/day, which is $6.43/day at $1.20 and $10.80/day at the top
> of the band. **$3/day is about 3x below the floor.** The money is not wasted because $21 is a lot.
> It is wasted because it buys an uninterpretable result, which is worse than buying nothing, since
> it will be mistaken for evidence.

Three things make 4 weeks the floor on time: restricted-category ad review on a cold account takes
1-2+ business days; two search-term pruning passes are mandatory before the click data is clean, and
clicks banked before pass two are contaminated; and 300+ clean clicks then takes another 14 days.
Anything shorter measures the negative keyword list, not the store.

**Worst case is bounded.** Google can spend up to 2x the daily budget on any one day but hard-caps
the month at 30.4x daily and eats the overage, so $25/day cannot cost more than **$760** in a month.

### The AOV correction (2026-08-15, measured)

**The $80 AOV this section originally assumed has never been observed.** Measured against live data:

| Figure | Value | Source |
|---|---|---|
| Real (non-test) orders, all time | **1** | Shopify Admin API, 2026-08-15 |
| That order's total | **$26.47** (3 items) | order `#1002`, 2026-07-23 |
| Catalog median price, in-stock | **$26.99** | 3,000 in-stock products |
| Catalog median margin, in-stock | **43.8%** (p25 35.0%, p75 44.7%) | 1,396 products carrying `wholesale_cost` |

Contribution margin at the median, after ~6.5% high-risk processing: **37.3%**.

> **Break-even ROAS ≈ 2.7x** (better than the 4.3x previously stated, because realized margins run
> above the engine's floor).
> **But break-even CPA at a $26.47 AOV ≈ $9.87**, not $18.40. At a $1.05 CPC that needs a
> **10.6% conversion rate.**
> Confidence: margin high (n=1,396). AOV low (n=1). Both point the same direction.

**10.6% is not achievable.** Best-in-class ecommerce paid-search CVR is 2-4%. The measured
site-wide CVR today is **0.32%** (1 purchase / 311 sessions, GA4, 90 days).

**So state the conclusion plainly: Google Ads will not break even on first-order revenue at this
AOV.** That is not a reason to skip it. It is a reason to price the experiment correctly:

- The **deliverable of the first month is a list and a search-terms report**, not a P&L line. Judge
  it on cost per email captured and cost per add-to-cart, not ROAS.
- **The binding constraint is AOV and CVR, not traffic.** Note that free shipping starts at $99
  (`app/lib/shipping.ts`) against a $26.47 observed AOV, so a paid visitor pays $9.99 shipping on a
  ~$27 order, a 38% surcharge at the exact moment they decide. Raising AOV toward the threshold, or
  lowering the threshold, is worth more than any bid adjustment in this document.
- Revisit these numbers after 10 real orders. One order is an anecdote, not an AOV.

**Against the $2,000/month profit goal:** paid search at break-even contributes $0, and below
break-even it contributes negative. Its value here is first-order acquisition that feeds email and
repeat purchase. It is not the channel that reaches $2k/month on these numbers.

### Stop immediately, at any point, no discussion

1. **Any account-level policy notice or suspension.** Pause everything on Google, record an `error`
   event, escalate the same hour per `docs/ads-policy.md` §Escalation. Account health outranks the
   campaign. Do not edit creative until the owner has decided.
2. **"Eligible (limited)" is NOT this.** It is the normal steady state for the category. Do not
   loosen creative or keywords to make it go away. That is how a compliant account becomes a
   non-compliant one.
3. **Spend over $50 in a single day.** Google can spend 2x daily budget on one day; more than that
   means something is misconfigured. Pause and audit.

### Day-10 checkpoint (~$250 spent, ~200 clicks)

| Signal | Continue | Investigate | Kill |
|---|---|---|---|
| Junk spend after 2 negative passes | < 15% | 15-30% | **> 30%** |
| Orders | 2+ | 1 | **0** |
| Brand/model CTR | 4%+ | 2-4% | < 2% |
| Category CTR | 2%+ | 1-2% | < 1% |
| Blended CPC | < $1.30 | $1.30-$2.00 | **> $2.00** |
| Add-to-cart rate | 5%+ | 2-5% | < 2% |

**Kill the campaign** on zero orders at 250 clicks (at which point you are 99.4% confident true CVR
is under 2%), or >30% junk spend after two passes, or $200 spent at CPA > $60.
**Kill an individual ad group**, not the campaign, when it has spent $60 with zero add-to-carts.
Expect one or two category ad groups to die this way. That is the learning expense working.

### Day-28 verdict (~$700 spent, ~580 clicks)

**Working, scale:** 500+ clicks, 6+ orders, blended ROAS >= 2.5x with at least one ad group at or
above break-even, wasted spend <= 15%, CPA trending down week over week.

**Marginal, hold flat:** 3-5 orders, blended ROAS 1.5-2.5x. Run another 4 weeks at the *same* budget
while fixing landing pages. **Do not increase budget to fix a marginal result**; that converts a
small loss into a large one.

**Dead, stop:** under 3 orders at 500 clicks, or no ad group above 2x ROAS.

### Scale criteria: the exact "double it" bar

Double only when **all four** are true:

1. One ad group has sustained ROAS at or above break-even for 14+ days, on 3+ orders. Not blended.
   A single ad group, above break-even, twice over.
2. Wasted spend under 10% for two consecutive weeks.
3. **The conversion number reconciles with Shopify order count within ~20%.** If you cannot verify
   the number, you cannot scale on it.
4. That ad group's impression share is under 65%, so there is unbought volume at the current bid.

Raise 20-30% at a time, 5-7 days between increases, and scale the *winning ad group's* campaign, not
the account. Blended averages hide one ad group subsidizing four.

**Ceiling for the next 3 months: $50/day.** Above that you outrun your ability to fix the landing
pages and the measurement.

### The measurement gate that outranks the conversion count

Do not graduate to Smart Bidding on conversion count alone. The GA4-imported `purchase` will
systematically undercount, because consent mode boots `ad_storage: 'denied'` and gtag.js is deferred
behind first interaction, idle, or 8s, so short paid sessions never load it. Handing Smart Bidding a
biased 40%-coverage signal teaches it to bid up whatever segment happens to have tag coverage, which
is worse than manual bidding.

**Real gate: 30 conversions in 30 days AND reconciliation within ~20% of Shopify orders.**

## 5. Measurement: the part that must ship first

> **Re-verified 2026-08-15. Blocker 1 below is now FIXED; blockers 2 and 3 stand. A new, narrower
> blocker replaced it. Read the "current state" box before acting on the three numbered items,
> which are kept for history.**
>
> **Fixed:** `gclid`/`gbraid`/`wbraid` capture shipped in PR #572. `captureGoogleClickId`
> (`app/lib/attribution.server.ts`) writes a 90-day cookie preserving the click-id *type*, and
> `attribution-cart.server.ts` stamps `_gclid` and `_gclid_type` onto the Shopify cart, so it rides
> to the order. Capture is server-side from the URL param, which means **it works even when the
> visitor declines consent.**
>
> **Still broken, and this is now the whole gap:** *nothing consumes it.* `server/webhooks.ts` maps
> only `_utm_*` and `_ref_code` off `note_attributes`. `_gclid` arrives on the order and is dropped.
> There is no column, no export, and no upload.
>
> **Good news that lowers the urgency:** the click id is not lost. Shopify persists
> `note_attributes` on the order forever, so a backfill can read historical `_gclid` values out of
> the Shopify Admin API later. The earlier claim in this document that capture is "genuinely
> irreversible" was true only while capture itself was missing. It no longer is. **Google accepts
> offline conversions within ~90 days of the click**, so the real deadline is 90 days after the
> first paid click, not before it.
>
> **Also verified working:** GA4 receives a server-side `purchase` event. GA4 shows exactly 1
> `purchase` in 90 days, matching the 1 real order. So `GA4_API_SECRET` **is** set in production and
> owner-checklist step 5 is already satisfied. The Tier 1 path below is available today with zero
> code.
>
> **Deadline that changes the build:** Google's `UploadClickConversions` endpoint is deprecated as of
> **2026-06-15** in favour of the Data Manager API. Anything built now targets Data Manager, not the
> legacy endpoint. The manual CSV upload in the Google Ads UI is unaffected.

1. ~~**`gclid` is never captured.**~~ **Fixed, PR #572.** Historical text: `attribution.server.ts`
   captured `utm_*`, `ref`, and `fbclid`, but no `gclid`/`gbraid`/`wbraid`. Auto-tagging appends
   `gclid` and **not** UTM params, so with auto-tagging on, the server-side capture wrote nothing.
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
suspension-grade shipping defect that must be fixed before submission. **Measured 2026-08-15 against
the live `https://xdipx.com/feed.xml`:**

| Fact | Value |
|---|---|
| Items in feed | 4,410 |
| Items declaring `<g:shipping>` | 500 |
| Of those, declaring `0.00 USD` | **500 (all of them)** |
| Items declaring no shipping at all | 3,910 |
| Distinct shipping prices in the feed | `['0.00 USD']` |
| What checkout actually charges | **$9.99** unless order total >= $99 (`app/lib/shipping.ts`) |

So 500 items actively tell Google shipping is free when checkout charges $9.99. `docs/ads-policy.md`
names this exact failure: *"Shipping and price in the feed must match checkout exactly. Mismatch is a
misrepresentation suspension, and it is the single most common way a compliant catalog loses its
account."*

A second, independent misrepresentation vector: **994 `<g:description>` values embed a hardcoded
dollar price** (for example "$29.99 at xdipx"). The pricing agent moves prices daily, so those
descriptions drift out of truth on their own with nobody touching them.

**Neither defect blocks the Search launch.** Search does not read the feed. Both block Merchant
Center submission, and submitting before they are fixed risks the account rather than just the
listing.

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
`utm_content` is the interim workaround, and it buys ad-group granularity, not keyword.

## 8. Pre-launch fixes on the receiving end

From a `homepage-cro` audit, 2026-08-15. Paid clicks are the most expensive traffic the store will
ever buy, and these four defects all sit on the path they land in. Roughly one engineering day
total. **Items 1 and 2 gate the launch. Items 3 and 4 should land in week 1.**

1. **The cart drawer replaces the entire cart with an age gate.** `CartDrawer.tsx:101` swaps the
   line items *and the checkout button* for `AgeGatePanel` until `verified` is true, so a first-time
   paid visitor hits a compliance interruption at the single highest-intent moment in the funnel.
   Two problems compound it: `AgeGate.tsx:32` and `:105` put `href="https://google.com"` inside the
   cart, which is a one-tap exit that hands the click straight back to Google; and
   `use-age-verified.ts` calls `localStorage.setItem` unguarded, so if storage throws (blocked
   storage, some in-app webviews, quota) the visitor is locked out of their own cart with no error.
   **`docs/ads-policy.md` is explicit that Google does not require an age interstitial for this
   category**, so this gate buys nothing on the ad side. Remove it from the cart drawer, or make it
   non-blocking and fix the two bugs. Keep it on `/social`.
2. **`EmailSubscribe.tsx` fires no analytics event at all.** The store's most-placed email form is
   invisible in GA4. Since email capture is the realistic primary deliverable of month one (see §4),
   launching without this means the campaign's main success metric is unmeasurable. Add
   `generate_lead` with a `location` param. ~30 minutes.
3. **Collection quick-add fires no `add_to_cart`.** `SearchProductGrid.tsx:132` and
   `VaultCard.tsx:54` post to `/api/cart` with no tracking call. Ad groups landing on collections
   would have their primary leading indicator dark.
4. **Collection pages hide trust content below ~74% page depth.** A cold visitor never sees "billed
   as XDIPX" or "plain packaging". Hoist the existing trust strip component
   (`StorefrontHome.tsx:342`) directly under the collection masthead.

**Optional but high-leverage: an ad-safe PDP mode.** The store already captures the Google click id
server-side. Gating the desire-register copy off when a request carries one would make all ~4,700
PDPs review-safe landing pages via one loader flag, and would permanently close the reviewability
question without touching the voice charter or building a bespoke landing page. ~2 hours.

**A dedicated paid landing page is not warranted below roughly $30/day** of spend. It becomes a
second surface to keep merchandised and in voice, and it will drift.

## 9. Reconciling this document with `ad_campaigns` row #1

Two conflicting approved artifacts exist. Row #1 (`gads-search-bodysafe-education-2026w29`, $3/day,
$21 total, informational keywords, Notebook landing) predates this plan and contradicts it.

**Row #1 does not launch. Reject it and record the reason.** Not because education framing is wrong,
but for four reasons:

- **$21 cannot answer any question.** At a ~$1.20 planning CPC that is ~17 clicks. Even at a healthy
  2% CVR, the chance of seeing a single order is 29%, so "zero orders" is the expected result whether
  the campaign is good or bad. An uninterpretable result is worse than no result, because it gets
  mistaken for evidence.
- **Informational intent has no exit in this category.** The standard play is to capture cheap
  top-funnel traffic and retarget it down the funnel. **Retargeting is structurally unavailable to
  this store:** Display is prohibited by Google for the category, and Meta, TikTok, and X all
  prohibit it outright. A reader who lands and leaves is gone permanently unless they hand over an
  email on that page, and the Notebook's measured email capture rate is zero.
- **Its premise expired.** It was scoped while checkout was unproven. Checkout was proven
  2026-07-26.
- **The landing page has two product links in 2,600 words.**

Keep the body-safe idea for **week 5 or later**, at ~$5/day, as an **email-capture** ad group judged
on subscribe rate rather than orders, and only after §8 item 2 has shipped. That is a legitimate
campaign. It is not a first campaign.
