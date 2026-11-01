# Live ad campaigns

The campaigns running on paid platforms right now that the owner built by hand, outside the
ad-action ledger, and the standing rules for each. The daily ads routine
(`docs/store-team/routine-ads-daily.md`), `paid-media-buyer` and the weekly burn review read this
file at the start of every run. A campaign gets a section here the day it goes live and leaves when
it ends. A campaign the owner has paused keeps its section, marked paused, with its final numbers.
Changes land through an `instructions` suggestion and an agent-editor PR, or an owner PR;
nobody edits this file mid-run.

## What "manage" means for an owner-built campaign

The team reads these campaigns and proposes. It never writes to them. That holds for every campaign
in this file.

1. Read it every Pass 2: spend, impressions, link clicks, CPC, landing page views, checkout starts
   and purchases per ad, from `team/ad-metrics` and the Step 4a account read. Ticket #18774 (PR
   #1828) made these ads visible to `team/ad-metrics`. They carry no attributed revenue, so read
   orders from Shopify and not from those rows.
2. Judge them on the same R1 to R8 thresholds as any synced ad, and send pauses and budget changes
   as `team/ad-action {op:'propose'}` cards for the owner. `appliedBy` stays null.
3. Never edit a creative, open a draft in Ads Manager, duplicate an ad or add an ad. Opening an MCP
   draft in Ads Manager adds AI text and turns the Shop destination on. Every Meta ad here was built
   inline with the Shop destination, text optimizations and product extensions opted out, which is
   what got it approved. New creative for a live campaign is a Pass 1 idea like any other, and the
   owner builds it.
4. Put each campaign in the Sunday memo with spend, orders, contribution and a keep, cut or change
   verdict.

## Meta status: three lead ads on, everything else paused

The owner paused every Meta ad by 2026-10-31: "I paused all of my meta ads, it was getting too
expensive and we didn't see any sales." The Meta spend from 2026-10-24 through 2026-10-30 was $101.46.

On 2026-11-01 the owner restarted three Curious lead funnel ads to keep collecting email leads. They
are listed below. Advent26, the Shopify-managed Advantage+ campaign, the HOLD campaign and every other
lead funnel ad stay paused.

Judge by the ad's own `status` and by spend. Ad sets under a paused campaign read `ACTIVE` with
`CAMPAIGN_PAUSED` delivery. Two paused ads read `WITH_ISSUES` (womanizer-24 Connection
`120249883184860056` and the lead funnel's `120249792444390056`), and neither is running.

- Only the owner restarts a paused Meta ad. Do not propose a restart or new creative for one.
- Spend on any Meta ad outside the three below goes at the top of the run report, because it means
  that ad came back on.
- The Sunday memo gives the lead funnel its own line and one line for the rest of Meta: paused, with
  final numbers.

## Curious lead funnel (Meta)

**Three ads live since 2026-11-01, restarted by the owner.** The owner asked for at most three, chosen
by clicks, and these are the most-clicked ads that collect email and still show their original
creative.

| | |
|---|---|
| Account | `920738511029316` |
| Landing | `curious.xdipx.com/hello`, UTM-tagged with `utm_content=img<n>` |
| Optimizes for | Lead on pixel `1619122322498289` |
| Targeting | US, ages 25 to 65, Facebook and Instagram, the four M8 exclusion audiences |

| Ad | Ad id | Campaign | Budget |
|---|---|---|---|
| img30 "needs met", Proven | `120249775570910056` | `120249775564700056`, ad set `120249775568300056` | $7/day, no spend cap |
| img31 "easy to start" | `120249792500680056` | `120249748010640056`, ad set `120249748011930056` | Shares $10/day with img45 |
| img45 "comfort first sessions" | `120249824045940056` | `120249748010640056`, ad set `120249748011930056` | Shares $10/day with img31 |

Campaign `120249748010640056` has a $100 spend cap and had spent $69.96 at restart, so img31 and img45
stop after about three days. Raising the cap is the owner's call.

**Numbers before the restart, read 2026-11-01.**

| Ad | Spent | Link clicks | Cost per click | Leads on the Klaviyo list |
|---|---|---|---|---|
| img30 Proven | $42.98 | 41 | $1.05 | 15, shared with the two paused img30 ads |
| img31 | $15.86 | 16 | $0.99 | 1 |
| img45 | $19.21 | 15 | $1.28 | 7 |

Across the funnel: $112.94 spent and 28 ad-tagged leads, about $4.03 each. The break-even CPL in the
2026-10-18 audit was $0.48 to $0.75. CURIOUS15 had 0 redemptions.

Rules for this campaign:

1. **Count leads from Klaviyo.** Use the "Paid leads" list `UHiJc9`, grouped by the `utm_content`
   profile property. The pixel recorded 1 Lead from 2026-10-10 to 2026-11-01 against those 28, and
   Meta's lead column is empty (#17642). Do not read an empty column as no leads.
2. **Count sales from Shopify.** Use CURIOUS15 redemptions and orders.
3. **Do not reuse img30 `120249750018570056`.** Its 41 clicks at $0.27 came with a catalog creative
   swapped in by the 2026-10-21 Ads Manager edit (headline `{{product.name}}`, Shop Now).
4. **Leave the staged Test ad set alone.** A $3/day "Test" ad set, `120249775569340056`, sits
   unpublished under the Proven campaign.
5. **img45's copy says "your first order", and CURIOUS15 works for any customer.** That fails M8. The
   owner knows and restarted it anyway, because changing the copy sends it back through Meta review.

## Advent26 (Meta)

**Paused by the owner.** Ran 2026-10-28 to 2026-10-30. The campaign itself was also paused on 2026-10-31.

| | |
|---|---|
| Account | `920738511029316` |
| Campaign | `120249883168230056` "Advent26", sales objective, purchase on pixel `1619122322498289` |
| Budget | $25/day, campaign budget (CBO), scheduled stop 2026-11-25, no spend while the ads are paused |
| Ad set | `120249883168680056`, US, ages 25 to 65, Facebook and Instagram, the four M8 exclusion audiences, Advantage audience off |
| Landing | `curious.xdipx.com/advents26?c=<calendar>`, UTM-tagged (GA4 reads source `meta`, medium `paid_social`) |

| Ad | Ad id | Status | Spent | Link clicks | Cost per click |
|---|---|---|---|---|---|
| womanizer-24 Relief | `120249884417940056` | Paused | $21.15 | 29 | $0.73 |
| romance-7 Connection | `120249884416950056` | Paused | $7.94 | 12 | $0.66 |
| womanizer-24 Connection | `120249883184860056` | Paused | $3.16 | 6 | $0.53 |
| womanizer-24 Nostalgia | `120249884413170056` | Paused | $5.70 | 3 | $1.90 |
| romance-7 Nostalgia | `120249884417260056` | Paused | $4.92 | 5 | $0.98 |
| luxury-24 Connection | `120249884417460056` | Disapproved, dropped | | | |

**Final numbers, read 2026-10-31.**
- **Meta:** $42.90 spent, 1,047 impressions, 55 link clicks ($0.78 a click), 1 checkout start, 0 purchases.
- **GA4:** 58 `meta` / `paid_social` sessions landed on `/advents26`, with no add to cart, checkout or
  purchase. The page logged 1 `cta_click` from all traffic.

Meta's link clicks and GA4's sessions do not agree by day, and nobody has traced why. Trace this before
any restart, because it decides whether the page numbers above can be trusted.

| Date | Meta link clicks | GA4 sessions on `/advents26` |
|---|---|---|
| 2026-10-28 | 19 | 52 |
| 2026-10-29 | 31 | 5 |
| 2026-10-30 | 5 | 1 |

On launch day Meta reported zero landing page views next to GA4's 52 sessions, so either the pixel is
not reporting from the curious host or the dataset is dropping our events (#17642). Treat Meta's own
conversion columns as unreliable until that is resolved. Count results from GA4 and Shopify.

These rules apply if the owner restarts the campaign. Rule 1 holds now as well. Nothing gets proposed
under rule 6 or rule 7 while it is paused.

1. **Luxury stays off Meta.** luxury-24 was rejected four or more times, and on 2026-10-28 the owner
   dropped it from Meta. Do not propose Luxury creative for Meta, and do not resubmit the disapproved
   ad. The M7 decision has been made: Meta keeps the five approved ads, and these rejections do not
   pause the lane. Luxury sells through the page's step-up card (PR #1821), email, Search and the
   adult networks.
2. **Prices are MAP.** The advent calendars' Shopify prices equal MAP: Indulge $129, Romance $139,
   Womanizer $109, Couples $219, Luxury $369. No creative, idea or proposal shows a lower price or a
   discount on these five.
3. **No countdowns or urgency.** The countdown came off the page on 2026-10-28 (PR #1820, M6). Nothing
   written for this campaign counts down, says "ends soon", or turns the ship-by date into pressure.
4. **This is a smoke test.** At $25 a day the campaign cannot reach about 50 purchases a week, so it
   is labelled a smoke test under M8. Judge it on cost per checkout start and on orders, not on Meta's
   learning phase. The budget is above the default $20 `ads_media_daily_cap_cents`. That cap governs
   the ledger, not this owner-launched campaign, so report spend against both and do not file it as
   a breach.
5. **How to measure it.**
   - **Clicks:** Meta link clicks per ad.
   - **Landings:** GA4 sessions with landing page `/advents26` and session source `meta`.
   - **On-page intent:** GA4 `cta_click` with `cta_name` `advent_lineup` or `advent_upsell` (the
     Luxury step-up; `cta_location` is the calendar the visitor left), and `begin_checkout`.
   - **Orders:** Shopify orders carrying the cart attribute `_landing: curious/advents26`.
   - Name which source each number comes from.
6. **What to propose.**
   - **Pause:** an ad that fails an R1 to R8 threshold, or has spent $10 with no link click.
   - **Budget:** a cut when the campaign has no checkout start after $50 lifetime spend. An increase
     only once orders cover their cost at `ads_gross_margin_pct`.
   - **Rotation:** when one calendar's ads clearly win, propose shifting the mix toward it. Never
     propose adding Luxury.
   - All of these go to the owner as cards.
7. **End date.** The page promises the advent price and December 1 delivery only for orders placed
   by Nov 24, and the campaign's scheduled stop is Nov 25. Flag any spend after Nov 24 in the memo.
   If the stop has not been moved by Nov 17, propose ending it on Nov 24.
