# Live ad campaigns

The campaigns running on paid platforms right now that the owner built by hand, outside the
ad-action ledger, and the standing rules for each. The daily ads routine
(`docs/store-team/routine-ads-daily.md`), `paid-media-buyer` and the weekly burn review read this
file at the start of every run. A campaign gets a section here the day it goes live and leaves when
it ends. Changes land through an `instructions` suggestion and an agent-editor PR, or an owner PR;
nobody edits this file mid-run.

## What "manage" means for an owner-built campaign

The team reads these campaigns and proposes. It never writes to them. That holds for every campaign
in this file.

1. Read it every Pass 2: spend, impressions, link clicks, CPC, landing page views, checkout starts
   and purchases per ad, from the entity mirror and the Step 4a account read. These ads have no
   `ad_creatives` rows yet, so `team/ad-metrics` does not see them (ticket below); report them from
   the mirror until it does, and say so.
2. Judge them on the same R1 to R8 thresholds as any synced ad, and send pauses and budget changes
   as `team/ad-action {op:'propose'}` cards for the owner. `appliedBy` stays null.
3. Never edit a creative, open a draft in Ads Manager, duplicate an ad or add an ad. Opening an MCP
   draft in Ads Manager adds AI text and turns the Shop destination on. Every Meta ad here was built
   inline with the Shop destination, text optimizations and product extensions opted out, which is
   what got it approved. New creative for a live campaign is a Pass 1 idea like any other, and the
   owner builds it.
4. Put each campaign in the Sunday memo with spend, orders, contribution and a keep, cut or change
   verdict.

## Advent26 (Meta)

Live since 2026-10-28. Owner direction 2026-10-28 (/all-hands): "Make sure the team knows about these
ads and will manage and optimize them accordingly."

| | |
|---|---|
| Account | `920738511029316` |
| Campaign | `120249883168230056` "Advent26", sales objective, purchase on pixel `1619122322498289` |
| Budget | $25/day, campaign budget (CBO), scheduled stop 2026-11-25 |
| Ad set | `120249883168680056`, US, ages 25 to 65, Facebook and Instagram, the four M8 exclusion audiences, Advantage audience off |
| Landing | `curious.xdipx.com/advents26?c=<calendar>`, UTM-tagged (GA4 reads source `meta`, medium `paid_social`) |

| Ad | Ad id | Status 2026-10-28 |
|---|---|---|
| womanizer-24 Connection | `120249883184860056` | Active |
| womanizer-24 Nostalgia | `120249884413170056` | Active |
| womanizer-24 Relief | `120249884417940056` | Active |
| romance-7 Connection | `120249884416950056` | Active |
| romance-7 Nostalgia | `120249884417260056` | Active |
| luxury-24 Connection | `120249884417460056` | Disapproved, paused, dropped |

**Baseline, lifetime through 2026-10-28 evening.**
- **Meta:** $8.22 spent, 376 impressions, 17 link clicks ($0.48 a click), 0 landing page views, 0 checkout starts.
- **GA4:** 52 `meta` / `paid_social` sessions landed on `/advents26` that day.

Meta's zero landing page views next to GA4's 52 sessions says the pixel is not reporting from the
curious host, or the dataset is dropping our events (#17642). Treat Meta's own conversion columns as
unreliable until that is resolved. Count results from GA4 and Shopify.

Rules for this campaign:

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
