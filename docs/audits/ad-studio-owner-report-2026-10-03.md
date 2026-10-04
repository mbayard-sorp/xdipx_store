# Ad Studio: what we have, what is true, what to build

Owner report, 2026-10-03. Three Opus analyses feed this: the codebase audit
(`ad-studio-audit-2026-10-03.md`), the platform and policy research
(`ad-platform-research-2026-10-03.md`), and the creative concept bank
(`docs/store-team/ad-creative-concept-bank-2026-10-03.md`). This page is the summary.
Nothing here is built, scheduled, or spending. It is the report you asked for before feedback.

## 1. The short version

- **Ad Studio has never produced anything.** Zero ad creatives, zero ad images, zero image spend
  logged in production, ever. Six campaigns sit "approved" with no launch, the oldest for 78 days.
- **Every button that looks like it does something, fails silently.** Generate and all three Push
  buttons return errors the page never renders. Google says "not configured" even with keys set,
  Meta is policy-blocked for the pleasure catalog, TikTok always blocks.
- **The ads agent is weekly, text-only, and mostly skipped.** It wrote real proposals on 2 of 13
  runs. It is forbidden to make images. Its budget is $5/day of its own compute, not ad spend.
- **No spend is measured anywhere.** `ad_spend` is $0.00 on every day, including the days you have
  been running Shop Campaigns. A kill-by-conversion feature today would be judging on nothing.
- **The Arcads video build was never wired into ads.** The helper that attaches a video to an ad
  creative has no callers. Five video jobs ever, two succeeded, none posted.
- **Verdict: gut the page and the workflow, keep the chassis.** The two tables, the policy-check
  discipline, the unified image generator, and the socials rating pattern are all sound and reusable.

## 2. The part that changes the plan: where register-9 display can legally run

Your ask was provocative register-9 display ads pushed to Meta and imported to Google. Research
and the binding policy doc say this, and no amount of code changes it:

| Surface | Sex toys in ads? | Register ceiling | Notes |
|---|---|---|---|
| Meta paid (FB/IG) | **No.** Lube, moisturizer, kegel trainers only, framed as health, 18+ | 3-4 | Reviewers follow the click to the landing page. Pixel, CAPI and 232 Shop products live on the same business, so a rejection pattern risks all of it |
| Google Search | Yes, 18+, SafeSearch, text only | 4-5 | The one mainstream intent channel. No images exist in Search ads |
| Google Display, PMax, YouTube | **No** | n/a | Category excluded from every network except Search |
| Microsoft Ads | Yes, via its Adult Advertising Program | 4-5 | Usually cheaper than Google. Needs an application |
| Snapchat | Conditionally. Non-graphic vibrator ads, 18+ | 6-7 | Most permissive mainstream platform. Untested by us |
| TikTok, X, Reddit, Pinterest paid | No | n/a | X's 2024 loosening was organic only |
| ExoClick, JuicyAds (adult networks) | **Yes** | 8-9 | Site-targeted banners on toy-review sites. CPM roughly $0.50 to $8. The only place register-9 display ads can run as paid |
| Newsletters, podcasts (sex-positive) | Yes, per publisher | 7-9 | Flat $50 to $300 or $18 to $40 CPM. Best register match for Emma |
| Email, SMS, site (owned) | Yes | 9 | Klaviyo has zero flows built, so register-9 retargeting is a build, not a switch |

Three corrections to the brief, so nobody builds on sand:

1. **Zooming in to hide the toy is a look, not a disguise.** Macro abstraction is a strong style on
   owned, X, adult networks and Instagram. On Meta it is classified as evasion, and the reviewer
   still lands on a sex toy store.
2. **"Body parts not identifiable" is not the test for paid.** Any product on bare skin is
   ineligible in paid creative regardless of what can be recognized. Bodyscapes stay owned and
   organic, where §3.2c already licenses them.
3. **Register-9 retargeting on a pixel audience still runs on Meta inventory,** so it still faces
   Meta's ban. Register 9 retargeting means Klaviyo browse and cart abandonment flows.

So the platform has to be a **ladder**: the same concept rendered at 3-4 for Google Search and
Shop, 6-7 for Snap and sponsorships, 8-9 for adult networks and owned. The concept bank is written
that way for all 14 concepts and all 74 slogans.

## 3. Economics you should know before we spend

- Current real data: 9 orders, $431 revenue, AOV $47.91. Some of those are your own test orders.
  The Google launch plan's unhold bar is $45 AOV over 10+ real orders. Close, not there.
- At a ~$33 basket and ~45% margin, break-even cost per order is about $15. Meta's learning phase
  wants ~50 conversions a week, about $750/week at that cost. Our $20 to $50/day cannot buy
  platform learning, so kill and scale decisions have to run on our own math, from Shopify orders
  tagged with a creative id.
- Shop Campaigns ROAS counts shipping and tax. Profit break-even there is about 2.7x, not 2.2x.
- Your "kill at 2x AOV with zero orders" is looser than break-even. At $33 AOV it lets an ad burn
  about 4x break-even before stopping. Recommended default: pause at 2x break-even (~$30) with zero
  orders after 48 hours live, with a revive rule for late attribution. Eight default rules (R1 to
  R8) are drafted in the research doc, all meant to be editable valves.

## 4. What exists and what to do with each piece

| Piece | State | Keep / gut |
|---|---|---|
| `ad_campaigns`, `ad_creatives` tables | Sound, no rating or metric columns | Keep, extend additively |
| `policyCheck` required note + structural Meta/TikTok block | Working guard | Keep |
| `app/lib/ad-creative.server.ts` (3-image batch via unified generator) | Never run in prod, synchronous in a route action | Keep the seam, move to a team-token batch endpoint |
| `app/routes/admin.ad-studio.tsx` | Shows name, platform, objective, 220 chars of policy note. Hides budget, headlines, keywords, URLs. Swallows all errors | Gut and rebuild |
| Push stubs (Google, Meta, TikTok) | Inert | Stop rendering as buttons. Replace Google with an Ads Editor CSV export, Meta with paused-draft creation via MCP for carve-out SKUs only |
| `ads-manager` agent + weekly routine | Text proposals, 2 of 13 runs produced output, names MCP tools that no longer exist | Rewrite as a daily ideas-plus-creatives routine |
| Arcads video pipeline | Built, zero callers into ads | Wire later, after stills lane is live |
| `/admin/socials` rating system (heart / thumbs-down, fixed reason chips, note, owner-only writes, read-back endpoint the routine consumes, 121 ratings in use) | Working | Port as-is to ad creatives and to campaign ideas |
| Image pipeline (Atlas-first generator, vision gate, product-fidelity gate, voice gate, humanizer, stock and text checks) | Working for social | Reuse unchanged |
| Spend ingestion | Does not exist | Build: CSV import for Google and Shop Campaigns, MCP insights for Meta, per-creative daily metrics table |
| Meta Ads MCP | Needs OAuth in each session. Seven cloud triggers carry it with no tool pin, so agents could technically create or boost | Pin to read-only everywhere; owner authorizes |

## 5. What the rebuilt platform would be

Working name: **Ad Studio v2**. Phone-first at 375px, same rating gestures you use in Socials.

1. **Ideas tab.** Daily, the team files 10 to 20 campaign ideas as readable cards: concept, ladder
   tier, products, headline set, audience, destination, break-even math. You heart or thumb-down
   with a reason chip. Hearted ideas get creatives made. Rating an idea before rendering saves the
   image spend on the weak half.
2. **Creatives tab.** Rendered ads as full-width cards, one per creative, sized per destination
   (1:1, 4:5, 9:16, 1200x628, 300x250 and 728x90 for adult networks), slogan composited in a layout
   layer, never baked into the pixels. Same heart / thumbs-down / chips. A policy-lane badge, so a
   creative that cannot run on Meta never shows a Meta action.
3. **Export and push.** Google: Ads Editor CSV for Responsive Search Ads with keywords, negatives,
   UTM'd final URLs. Meta: paused drafts through the MCP, carve-out SKUs only, you flip them live in
   Ads Manager. Adult networks and sponsors: a zip of sized PNGs plus copy plus UTM links. Shop
   Campaigns: the creative is your catalog, so the job is color-block packshots at media position 0.
4. **Live tab.** Per-creative spend, impressions, clicks, Shopify orders by creative id, ROAS on
   net revenue. Fed by CSV import and MCP insights. Rules R1 to R8 fire as one-tap recommendations
   (pause, scale, refresh) with the rule named. A sticky bar shows today's spend against your cap.
5. **Spend.** One owner-only monthly media cap valve, planned versus actual per campaign, and the
   compute budget separated from the media budget (the playbook currently conflates them).
6. **Daily automation.** A new cloud routine: read the strategy brief and stock, pick products
   (by Shopify type, since air-pulsation and wands are mislabeled `vibrator` in the dial field),
   draft ideas, render creatives for hearted ideas, run the gates, write rows, file a digest line.
   Your ratings read back into the next run exactly as they do for social.
7. **Owned register-9 lane.** Klaviyo browse and cart abandonment flows that open on a bodyscape of
   the exact product the reader left. This is the cheapest register-9 placement available and it
   does not exist yet.

## 6. What you had not asked for, and should consider

- Text in a layout layer, not in the image, so one plate serves every slogan and every tier.
- Bundles as the ad unit ("Le Wand Petite plus Sliquid H2O") to fix AOV instead of buying into it.
- One landing page per concept. Reviewers and buyers both follow the click.
- Attribution fix first: GA4 purchases arrive Unassigned today. Every creative gets its own
  `utm_content`.
- Creative fatigue clock: each slogan runs once per campaign and retires. Paid creatives flag
  "refresh" when CTR drops 30% off their first three days.
- Snapchat as the mainstream test lane nobody in the category is using well.
- Microsoft Adult Advertising Program as the cheaper Google.
- Newsletter and podcast sponsorships from the existing podcast shortlist, at register 7-9.
- Reddit organic, human-run, Spec Sheet posts and AMA threads. Paid is closed.
- Review-quote ads are impossible today: the reviews table has one approved row and it looks like a
  test. The invite flow has to run first. Never fabricate proof.
- Never test pleasure creative on the Meta business that holds the pixel and the Shop.

## 7. Creative direction, in brief

Fourteen concepts, each with a 3-4 / 6-7 / 9 rung, a target destination, and an image prompt spec:
Sculpture Hall (macro product as gallery object), Body Map (bodyscape, owned and organic only),
Say It Plain (typographic-only), Orchard (fruit and flower metaphor), The Morning After (domestic
evidence stills, no tableware), Hands Only (couples), Statement Reads XDIPX (discretion as the
product), Frequency (vibration made visible with water), For Him Plainly, The Gift, The Group Chat
(scripted text thread, labeled), Ask Emma (quiz ads to /discover), Spec Sheet (comparison), Second
Spring (midlife wellness, the only honest door onto Meta).

Seventy-four slogans across product families, every R3-4 line fits a 30-character Google headline.
A few, by tier:

- [R3-4] "Billing Reads XDIPX" / "Plug-In Wand, No Recharging" / "Which Lube Suits Silicone?"
- [R6-7] "The box is boring on purpose." / "ROMP Lipstick. Reapply as needed." / "Sync 2: settle
  who holds the remote." / "Men's toys, shelved next to everyone else's."
- [R9] "Corded, so your orgasm never waits on a battery." / "Two in the afternoon is a fine hour
  for an orgasm." / "The box says nothing. You won't be quiet."

Fifteen hook formulas with filled examples are in the concept bank.

## 8. Decisions only you can make

1. **Adult networks at register 6-9?** The charter currently reserves the full register for owned
   channels. Approving ExoClick and JuicyAds at 8-9 is a codify.
2. **Meta at all?** Second Spring and lube carve-out ads are policy-compliant but a rejection
   pattern reaches the pixel and the Shop on the same business.
3. **Google Search now or at the $45 AOV bar?** 9 orders, $47.91 AOV, some of them yours.
4. **First test budget split.** Research suggests, at $20 to $50/day: Google Search $10 to $15,
   Microsoft $5 to $10 once approved, Snap $5 to $15, one adult network $5 to $10, plus one
   newsletter sponsorship a month.
5. **Kill rule defaults.** 2x break-even (~$30, zero orders, 48h) as recommended, or your 2x AOV
   "patient" mode.
6. **The Group Chat concept.** Is a "scripted" corner mark enough disclosure, or owned surfaces only.
7. **Klaviyo flows.** Approve the build that makes register-9 retargeting real.
8. **Meta Ads MCP.** Authorize it in your connector settings, and approve pinning it read-only on
   the seven cloud triggers that currently carry it unpinned.
9. **Rip the auto-approve on the ads team back off?** It was flipped on 2026-10-02 against
   ADR-012's advice, so agent-filed instruction changes to the ads lane now merge with no triage.

## 9. Build shape, pending your feedback

Four PRs on the release-engine lane, Sonnet 5.5 builders, ui-ux-pro-max and the taste pack for the
admin surface, Opus 5.5 for QA review. Rough order: (1) schema plus rating plus daily routine and
Ideas tab, (2) creative rendering with the layout layer and Creatives tab, (3) exports (Google CSV,
adult-network zip, Meta paused drafts), (4) metrics ingestion, Live tab, rules R1 to R8, spend
valves. Klaviyo flows run in parallel as their own ticket. Detailed plan comes after your answers
to section 8.
