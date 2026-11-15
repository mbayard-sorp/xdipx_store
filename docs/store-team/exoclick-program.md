# ExoClick program

Status: approved by the owner 2026-11-15. He answered the plan with five rulings, recorded in section 8.

Owner direction 2026-11-15, verbatim: "We need to put a team together to drive ads on Exoclick... I need a team to do all of it end to end. Come up with the deals, design the ads, build out the content, test the ads, very closely monitor performance... You have to watch for runaway impressions with no clicks. The goal is to figure out what works to make profit using ExoClick ads."

## 1. Where round one left us

Read live on 2026-11-15 from the production mirror, GA4 and Shopify.

| Measure | Value |
|---|---|
| Spend | $27.66 of $200 funded. About $172 left (balance unread, the API token is invalid) |
| Impressions | 367,269 |
| Clicks billed | 186 (CTR 0.05%, $0.149 a click, bought on CPM at 75 cents) |
| GA4 sessions on curious.xdipx.com from ExoClick | 29 (7 engaged) |
| Orders, leads | 0, 0 |
| Cost per counted arrival | $0.95 |

What that says:

1. The product was never tested. 29 arrivals cannot judge a $69.99 product. The standing rule in `sales-pages.md` asks for 300.
2. The traffic failed first. Half the spend went to sites that never clicked, and 84% of billed clicks never showed up as a session. We do not know yet whether those clicks were lost, accidental, or just uncounted.
3. The math did not work even on paper. At $0.95 an arrival and $23.67 profit an order, break-even needs 4% of cold adult-site visitors to buy a $70 toy.
4. The store's real buyers spend $35. Shopify shows 49 orders in 90 days, AOV $34.84, and no stroker sold. Only 7 of the top 40 products sold at $50 or more.

About $172 buys roughly 1,100 clicks at round-one prices. That is enough to learn what works, not enough to make a profit. This program is built to answer three questions in order and stop spending the moment an answer is no.

## 2. The team

| Role | Who | Does |
|---|---|---|
| Operator (media buyer) | R-EXO routine, upgraded from watch to operate | Builds campaigns, runs the kill rules, blocks placements, reports |
| Offers | `pricing-ops` and `promo-manager` | Picks products and deals inside the offer rules in section 4 |
| Creative | `ads-manager` daily pass, the Ad Studio render pipeline on Atlas, `emma-copywriter`, `emma-empathy-reviewer` | Banners at register 10, native ads, short video banners |
| Landing pages | `sanity-content-builder` for standard `salesPage` docs, `rr7-engineer` only for hand-designed pages | One page per offer on curious.xdipx.com |
| Measurement | `rr7-engineer` through R-DEV | Arrival counter, GA4 gap, per-site stats |
| QA | `qa-reviewer` | Checks every page and the buy path before a cell goes live |
| Owner | Mike | Funds the account, approves the envelope once, merges protected paths, rules on policy |

## 3. The test ladder

Each cell has a cap and a pass line. A cell that fails stops; the money rolls to the next question.

| Cell | Cap | Question | Pass line |
|---|---|---|---|
| 0. Fix the instruments | $0 | Can we count arrivals and conversions? | Server arrival counter live, postback confirmed with a test order, token valid |
| 1. Traffic | $40 | Can we buy a real arrival for $0.30 or less? | 130+ arrivals, at least 70% of billed clicks arrive |
| 2. Offer | $80, split over two offers | Does anything sell? | Either offer at 1 order per 150 arrivals or better |
| 3. Prove it | $50 | Does the winner repeat? | Spend per order under the offer's unit profit |

Cell 1 changes from round one:

- Buy on CPC, not CPM. A placement that never clicks then costs nothing, which removes the runaway-impression problem at the source.
- Mobile only, US only, one impression per visitor per day.
- Start from the sites that clicked in round one. Block the ones that did not before the first dollar.
- Three formats: 300x250, 300x100 mobile header, and native. Add video banners (MP4, 1.5 MB cap) once a static wins.
- Three variations per format, ExoClick's variation optimizer on.

After cell 3 the owner gets one page: what worked, cost per order, and whether adding funds is worth it. Adding funds is always his call.

## 4. Offers

Rules, so the team can pick without asking each time:

- Unit profit of $40 or more after cost and $9 fulfillment, or a bundle that reaches it.
- Price at or above MAP. A product priced below its `map_price` metafield is not advertised until the metafield is checked. 795 of 1,525 active $50+ products are in that state today.
- No discount claim without a real compare-at source. No countdowns, no stock scarcity. ExoClick's holiday guide recommends countdown timers and "while supplies last"; the charter forbids both, so we take its other advice: free shipping, gift framing, bundles, festive colour.
- Every offer carries free shipping (automatic at $59.99+, runs to 2027-04-14) and one real code.
- 100 units in stock, or 40 with a named fallback.

Recommended for cell 2, pending the owner's nod and a MAP check:

| Offer | Product | Price | Unit profit | Stock | Angle |
|---|---|---|---|---|---|
| A. Gift for her | Magic Wand Plus HV-265 | $114.99 | $54 | 368 | The one she already knows from the videos. Holiday gift framing, lube add-on with GLIDE quantity discount |
| B. For him | Hot Octopuss Pulse Solo Essential | $112.99 | $42 | 64 | Hands-free, no MAP, room for a real 10% code |
| Control | Gawk Gawk 3000 (page exists) | $69.99 | $24 to $26 | 860 on the line | Used in cell 1 because the page is built and the product was never judged |

### Price check, 2026-11-15

Unit profit above left out the payment fee of about 3%. With it:

| Offer | Our price | Street price | Unit profit | Verdict |
|---|---|---|---|---|
| Magic Wand Plus | $114.99 | $76 to $81 at Walmart, Best Buy marketplace and IntiMD; $104 to $120 at boutiques | $50.99, or $41.29 with a $10 code | We sit about $35 over the big retailers. Matching them leaves about $22 an order. Not a lead offer until that is settled |
| Pulse Solo Essential | $112.99 | $119.99 at hotoctopuss.com | $38.18 today, $44.97 at $119.99 | Lead offer for him at the maker's price. The raise needs a pricing rule or the daily batch reverts it. Stock is 64; fallback is Lovense Gush 2 Motion (312 units, $129 at MAP, $51.13) |
| Magic Wand Rechargeable | $190.14 | $110 to $130 | $28.94 at street | Rejected. Also not published to the online store |

New rule for the envelope: an offer is checked against the maker's site and two large retailers before any page is built. A product we cannot sell within 10% of street price is not a lead offer.

A draft page and ad copy for the wand exist (slug `magic-wand-gift`, not published, not voice-reviewed). They wait on the price question.

Held back: every Male Rose product (MAP binds, thin profit), We-Vibe and Womanizer sets (priced below MAP), advent calendars (one left in stock, 23 units).

## 5. Kill rules

The operator checks every hour for the first 24 hours of a live cell, then every 4 hours. It acts first and reports after. Every rule below only ever reduces spend.

| Rule | Trigger | Action |
|---|---|---|
| Dead placement | A site or zone with 2,000 impressions and 0 clicks, or 5,000 at under 0.02% CTR | Block it on every campaign |
| Dead banner | A variation with 5,000 impressions and 0 clicks | Pause the variation |
| Dead campaign | 20,000 impressions at under 0.03% CTR | Pause the campaign, push to owner |
| Phantom clicks | 50 billed clicks with under half arriving | Pause the campaign, push to owner |
| Runaway pace | More than $5 in any hour on one campaign | Pause the campaign |
| No interest | $25 spent on an offer with no buy-button click | Stop the offer |
| No sale | A cell reaches its cap with no order | Stop the cell |
| Offer drift | Price, compare-at, stock or page no longer matches the banner | Pause everything on that offer |
| Blind | Mirror older than 2 hours while anything is live | Pause everything, push to owner |

## 6. What blocks full automation today

| # | Blocker | Who clears it | How |
|---|---|---|---|
| 1 | `EXOCLICK_API_KEY` is invalid in production and locally (blocker #5344). Nothing can be read or changed | Owner | New token in ExoClick admin, set in Vercel and the local `.env`, redeploy |
| 2 | The ExoClick integration is read-only. No code can create, pause, bid or block | Owner merges | `exoclick/mutate.server.ts` is a protected path. The team writes the PR, the owner reads and clicks |
| 3 | `ads_spend_enabled` has no row (blocker #3125) and is shared with Meta | Owner | Do not flip the shared valve. The mutate PR adds `exoclick_operator_enabled` and `exoclick_total_cap_cents` so ExoClick has its own switch and cap |
| 4 | Four ExoClick tickets have sat at `proposed` since 2026-11-01: #19412 placement watch, #19413 runaway check, #19434 arrival counter, #19435 GA4 page_view gap | Owner | Approve the four rows. Ads auto-approve stays off |
| 5 | `docs/ads-policy.md` still says no visible nipples on adult banners. The owner ruled otherwise for ExoClick on 2026-11-15 (section 8), so the two disagree | Owner | Say "codify" and the team opens the `ads-policy.md` PR for him to merge. Until then this page is the exception of record for ExoClick banners only |
| 6 | `ads-manager` is forbidden to upload, and `routine-ads-daily.md` says never curious.xdipx.com and `utm_medium=paid` | Team, after approval | Instruction edits through the bus |
| 7 | Offers and deals are money decisions | Owner, once | Approve the rules in section 4 as a standing envelope |
| 8 | Atlas balance is $44.30; the image gate is $20 a day. Video banners will use it faster | Owner | Top up when it falls under $15 |
| 9 | Cloud routines have no ExoClick key by design | None | Stays that way. The operator acts through the site's team API once blocker 2 is merged |

Until blocker 2 is merged, an interactive session can operate the account by hand through the API with the same rules. That is slower and depends on someone starting the session, so it is a bridge, not the plan.

## 7. Order of work

1. Owner: rotate the token, approve the four tickets, answer the policy and envelope questions.
2. Team, same day: block list from round-one site stats, MAP check on offers A and B, banner and native creative for the control and offer A, sales page for offer A.
3. Team: mutate PR for owner merge; R-DEV builds the arrival counter and per-site stats.
4. Cell 1 goes live when cell 0 passes. No spend before that.

## 8. Owner rulings, 2026-11-15

Verbatim, in answer to the plan:

- "API key has been updated in local env". Verified the same hour: login works, balance $172.34. Production still needs the new key in Vercel (blocker #5344) or the mirror stays stale.
- "Have a team complete the stuck tickets". #19412, #19413, #19434 and #19435 moved to `approved` that hour, actor owner.
- "yes write whatever code is needed". The write path is being built as one PR on `claude/exoclick-write-path`, attached to #19412. It touches protected paths, so the owner merges it.
- "These ads run on Exoclick so there are no rules about what we can and can't show, but I don't think that was the problem before." ExoClick banners are not held to the nudity ceiling in `ads-policy.md`. This covers banners on ExoClick only. Sales pages on curious.xdipx.com, the site, email and every other channel keep their rules. ExoClick still reviews every banner itself, and a rejection there stops the offer until it is fixed.
- "You're free to create offers that have profitable potential". The rules in section 4 are the standing envelope. The team picks products and deals inside them without asking per offer. Creating a Shopify discount code is still a store change and is reported the day it is made.

## 9. Round-one placement lists

Built 2026-11-15 from `statistics/a/site`, all six campaigns, 2026-10-30 to 2026-11-03. 1,898 sites served the ads. 58 of them produced all 186 clicks for $13.63. The other 1,840 produced none and cost $14.02.

Block before any new spend (the section 5 rule applied to round one, $10.84 of the $27.66): m.youjizz.com (already blocked), thisvid.com, tnaflix.com, eporner.com, xxxmom.pro, letsporn.com, xxxtapes.net, voyeurhit.com, perfectgirls.xxx, sexient.com, rat.xxx.

Start cell 1 on the sites that clicked. xvideos.com gave 63 clicks at $0.135 each; 3xxx.pro gave 14 at $0.036.
