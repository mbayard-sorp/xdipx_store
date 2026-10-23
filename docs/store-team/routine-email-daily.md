# Routine: Daily Promo Email (email-marketing-manager)

**Status: SENDING, trigger PLANNED.** Owner direction 2026-10-12 designed the program; owner direction 2026-10-23 turned it on. The first campaign was built by hand in an interactive session and drafted in Klaviyo on 2026-10-23 (campaign `01M5MXTKW2VPJHEYJSZQAH56EM`, 77 estimated recipients). The daily trigger still waits on the code in the activation checklist at the bottom. Until it exists, interactive sessions build send-day drafts by this playbook, and the weekly routine (`routine-email-weekly.md`) keeps running under this doc's cadence and imagery rules.

## Owner direction, 2026-10-23 (binding)

> "I want to enable that team to start sending emails to our customer list via Klaviyo. I want the team to collaborate with /all-hands on what they should promote in the emails and I want them nicely designed. I also want to view them before they are sent and have a way to send back for changes. ... I expect them to be full HTML emails with products that are great deals, new products, links to new notebook articles, tips and tricks for using our products, they should reflect seasonality. ... These emails should be motivation for a customer to buy. They can come from Emma or any of the cast members."

What that makes standing policy:

- **Every email gives the reader a reason to buy.** At least one of: a live deal (a minted code or a real Shopify price fact) or a new arrival. An email that only educates does not ship.
- **The content menu.** Across each week's three sends, all five appear: deals, new arrivals, a link to a recently published Notebook article, a tip for using a product we sell (tied to products in the email), and the season's moment from the calendar. Not every block every time; the email's one job still picks the blocks.
- **Register 9, per the charter.** The owner chose 9 on 2026-10-23; 10 stays on vetted adult ad networks only.
- **Sender: Emma or a cast member.** The sender address is always hello@xdipx.com. The from label reads "Emma at xdipx", or "<Name> at xdipx" for a cast member from `docs/store-team/creative-platform.md` (Sofia, Marcus, Jade). Emma never claims lived experience. A cast member follows the product-talk rule in `docs/emma-voice.md` (video addendum): they may say they want things and have felt things before, and never claim to have used, tested, tried, or owned the specific product. The charter does not yet name email bylines; until the owner codifies one, that pointer is the rule.
- **The owner sees every email before it goes.** The routine builds a Klaviyo draft and the owner sends. Changes come back two ways: today, the owner replies in the session or edits the draft in Klaviyo; once ticket #17445 merges, **Request changes** on `/admin/email` stores the notes and the next run revises that draft before it does anything else (re-render, same `campaign_key`, new template version, re-send the review link).
- **What to promote is a team decision, written down.** The email plan lives in `marketing_calendar` (one row per send, theme plus job), so homepage, social, and content see the same week. Email reads the calendar and the strategy brief at run start and promotes what the calendar says; a disagreement goes on the bus as a `strategy` suggestion, never as a quiet substitution.
- **Drive margin.** Owner, same day, after the first draft: "I want to drive products that have good margin." Featured products are chosen by gross margin at the live price (`wholesale_cost` against the current variant price), and a product under 35% gross margin does not get a featured slot unless it is a minted-code deal or a new arrival. Prefer the higher margin-dollar product when two fit the job equally.
- **Good, better, best** (owner, 2026-10-23): "a section with good, better, best and select a type of product. A low-cost, mid-range, and a lux option." Most sends carry one: a single product type (cuffs, wands, lube, air pulsation), three in-stock products at a low, mid, and lux price, each at 35% gross margin or better, with a one-line reason per tier. The lux tier sits on the plum-soft card. Rotate the product type every send; the first one (2026-10-23) was restraints at $16.99, $37.99, and $62.99.
- **Featured brand** (owner idea, 2026-10-23). A recurring section, about once a week: one brand with at least five in-stock products, healthy margin, and something true to say from the catalog (materials, what the line is known for in the specs and reviews). No invented brand history or claims. Rotate brands; don't feature the same brand twice in four weeks.
- **Audience.** The consented Klaviyo lists: Email List (`RLFrJY`), Paid leads from curious.xdipx.com (`UHiJc9`), and Daily Deal Subscribers (`Uzt8Aa`). Klaviyo dedupes across lists, and Smart Sending stays on.

Entry agent: `email-marketing-manager`. Helpers: `emma-copywriter`, `email-designer`, `email-analyst`, `emma-empathy-reviewer`. Bills to the Max subscription.

## What the owner asked for

> "I want the agent team to draft a daily email, I'll review, and hit send for now. Eventually, we will fully automate the process... covering what's new on the site, great deals we have, and it should also reflect seasonality... products add-ons specific to what the customers have already bought... well designed and on brand with our logos... from Emma using the hello@xdipx.com email address. I want full traceability and daily analysis for what is working and what is not. This should be a self improving process."

Also: "The email team should also be able to use any of the images I've favorited in the Social Media library and or use the AtlasCloud integration to generate new images as needed."

## Decisions on record (2026-10-12)

- **Cadence:** the routine runs every day. Each subscriber gets a promo email on **Tuesday, Thursday, and Saturday** (America/Phoenix). This overrides the old cap of two marketing sends a week, until the consented list reaches about 250 people. At that point `email-marketing-manager` files a `strategy` suggestion asking the owner whether to change cadence.
- **Owner sends.** The routine builds a Klaviyo draft and emails the owner a review link. The owner sends a test and hits send in Klaviyo. Nothing in this routine can send.
- **Sender:** Emma, hello@xdipx.com. Replies land in the Zoho inbox that `customer-service-emma` already works.
- **Purchase data comes from Klaviyo's own Shopify integration** once the owner repairs it (blocker `email:klaviyo-shopify-sync`). It is the only path that sees customer emails on Shop app and guest orders; the store's own token gets them redacted.
- **Per-reader add-ons are written as flat Klaviyo profile properties** before each draft (`xdipx_addon_{1..3}_{handle,title,image,url,why}` plus `xdipx_addons_kind`), so one template shows each reader their own pairings. Readers with no purchase history get a generic set.
- **Full automation is a later valve.** `email_campaign_autosend_enabled` does not exist yet. When it does it is owner-only, and the proposed bar for turning it on is 14 consecutive drafts the owner sent without edits and no complaint spike. Until then the owner sends.

## Black Friday and Cyber Monday 2026 (all-hands 2026-10-23)

The November plan is `marketing_calendar` rows 49 to 57; row 50 lists every send from Oct 27 to Dec 1. In short:

- **Early access, Nov 17 to Nov 26, list only.** Code `EARLYGIFT25` (promo row #17448): 25% off 11 hero products, $40 minimum, once per customer. Sends Nov 17, 19, 21, 24. Nothing about Black Friday pricing appears on the homepage or social before Nov 27.
- **Public, Nov 27 to Nov 30.** Code `BLACKFRIDAY25` (promo row #17449): the same 11 products and terms. Sends Nov 27 and 28 and Cyber Monday Nov 30. Fri Nov 27 and Mon Nov 30 are off the Tue/Thu/Sat cadence and wait on the owner's decision.
- **The 11 heroes** are all map_price 0, about 26% gross after the code: Doxy Original wand, Nixie rechargeable wand, ROMP Spin Travel, Vessa, Together Double Tap, Juven app panty, Lucile rabbit, Adam & Eve Full of Love, Miss Nikita, Daily Vibe kit, and the Tantus vibrating ring. The reserve is the Camtoyz Flexicurve rabbit. Re-check stock on Nov 24.
- **Copy:** say "25% off" and state the dates. No struck MSRP, no savings-against-MSRP claim, no countdown, no "last chance". Early access is a perk the reader earned by subscribing, never a clock.
- A code exists only once the owner mints it. Until the promo row shows minted, the copy names no code.

## Step 0: Start and gate

```bash
curl -s -X POST "$BASE_URL/api/team/run" -H "Authorization: Bearer $TEAM_TOKEN" \
  -H "content-type: application/json" -d '{"op":"start","team":"email","runType":"email"}'   # -> $RUN_ID
curl -s "$BASE_URL/api/team/gate?team=email&excludeRun=$RUN_ID" -H "Authorization: Bearer $TEAM_TOKEN"
```

If the gate is not ok, finish the run as `skipped` with the reason and stop.

## Step 1: Load context

`docs/emma-voice.md` with its email addendum, `docs/design-doctrine.md`, `docs/store-team/mission-brief.md`, the weekly strategy brief (`GET /api/team/brief`), the calendar (`GET /api/team/calendar`), what the homepage and social are featuring this week, and the last 28 days of the email ledger (`POST /api/team/email {op:'ledger'}`, ticket #15002).

## Step 2: Read results (every day): `email-analyst`

Follow `.claude/agents/email-analyst.md`. It writes `retro` events per send, `decision` events when a hypothesis clears the confidence bar, and `instructions` suggestions that turn verdicts into standing rules. It proposes the next send's hypothesis.

On a non-send day (Sunday, Monday, Wednesday, Friday) the run also stages the next send: its job, a product shortlist of in-stock handles, and the hypothesis. Record these as an `event` (`phase:'plan'`). Then skip to Step 7.

## Step 3: Plan the send (send days only)

Pick the email's one job, the blocks that serve it, and the products. Inputs:

- **What's new:** in-stock products tagged `new-arrival`.
- **Deals:** Shopify price facts. MAP rules apply (no struck price on `map_restricted`, no discount framing at MAP = MSRP). Use a code only if `promo-manager` proposed it and the owner minted it. No time pressure, ever.
- **Seasonality:** the calendar and the strategy brief.
- **Notebook:** the most recent published Notebook posts (Sanity `blogPost`, newest `publishedAt`). Link one that fits the email's theme, and keep its teaser inside what the post's own excerpt says.
- **Tip:** one short how-to for a product in the email (blindfold before the first touch, lube before the toy, lowest setting first). Gate it like selling copy.
- **Your add-ons:** rendered per reader by the server. Nothing to pick here.

Check every featured handle the same day: active, in stock, and its PDP returns 200 on xdipx.com. Product art must pass the imagery ceiling; packaging shots are fine.

Write the hypothesis. One per send.

## Step 4: Words, `emma-copywriter`, then `emma-empathy-reviewer`

Subject plus preview text (two candidates; the lead picks one, since there is no split test below 100 recipients per variant), the hero line, each block's copy, and Emma's note. Run the pre-voice-gate checklist from `routine-email-weekly.md` Step 3 (no mechanism vocabulary in the selling body; the canonical Emma intro). Gate every string to a clean PASS.

## Step 5: Layout and imagery: `email-designer`

Follow `.claude/agents/email-designer.md`:

1. Owner-hearted Social Studio library frames first (`POST /api/team/social-asset-feedback {op:'list', verdict:'up'}`).
2. Then an unrated reuse search.
3. Then Atlas generation through `/api/team/social-image` with `team:'email'` (ticket #15006), at most two generated frames per send.

Render the preview and record the design-check verdict.

## Step 6: Build the draft (send days only)

```bash
curl -s -X POST "$BASE_URL/api/team/email" -H "Authorization: Bearer $TEAM_TOKEN" \
  -H "content-type: application/json" --data-binary @draft.json
# draft.json: {op:'draft', date, runId, sections, products, seasonalTheme, emmaNote,
#              hypothesis, subject, previewText, audienceListId}
```

The server does four things:

1. Syncs each recipient's add-on properties.
2. Assembles the HTML from the block library with block-level UTMs (`utm_source=klaviyo&utm_medium=email&utm_campaign=daily-YYYYMMDD&utm_content=<block>-<handle>`).
3. Creates the Klaviyo draft, its template, and the assignment.
4. Writes the `email_sends` row and emails the owner the review link.

The call is idempotent on `daily-YYYYMMDD`. With `email_campaign_push_enabled` off, the server returns the preview and creates nothing; say so in the summary.

## Step 7: Spend and finish

Log tokens (`feature:'email-daily'`). Finish the run with the summary format in `.claude/agents/email-marketing-manager.md`.

## Traceability, end to end

| Question | Where the answer lives |
|---|---|
| What did we send, to whom, and why? | `email_sends`: campaign_key, Klaviyo campaign and template ids, template version, audience, subject, blocks, featured handles, hypothesis, voice and design verdicts, run id, sent_at |
| How did it do? | `email_campaign_metrics`, pulled daily by `/cron/email-metrics-pull` (ticket #15004) |
| Which block and product earned the click or the order? | `utm_content` on the order, joined from `order_attribution` |
| What did we learn? | `email-analyst`'s `retro` and `decision` events, shown on `/admin/email` (ticket #15005) |
| Did the lesson stick? | The `instructions` suggestion it became, and the agent-def or playbook diff that merged |

## Code this routine depends on (filed 2026-10-12, team email, kind code)

| Ticket | What |
|---|---|
| #14997 | `email_sends` and `email_campaign_metrics` tables (additive migration) |
| #14998 | Block library and raster v3 logo |
| #14999 | Daily assembler with block-level UTMs and the Tue/Thu/Sat guard |
| #15000 | Draft push attaches the HTML template and the audience; no send helper |
| #15001 | Per-reader add-on sync to Klaviyo profile properties |
| #15002 | `POST /api/team/email` (draft, preview, ledger) |
| #15003 | `email` channel bucket in order attribution |
| #15004 | Daily Klaviyo reporting pull and metrics join |
| #15005 | `/admin/email` page |
| #15006 | `/api/team/social-image` accepts `team:'email'` so generation gates and bills the email team |
| #15007 | Owner toggle for `email_campaign_push_enabled` on the Email tab of `/admin/homepage-team` |

## Activation checklist

Do these in order. Each owner item is on the owner blocker list under the key shown. State as of 2026-10-23 is in brackets.

1. Tickets #14997 to #15002, #15006, and #15007 merged. [All merged except #14999 (assembler) and #15002 (`POST /api/team/email`), both re-approved by the owner 2026-10-23 after their dependency cleared. Ticket #17445 (review loop) and #17446 (Notebook, tip, byline, and deal-code blocks) were added the same day.]
2. Owner: repair Klaviyo's Shopify integration with customer and email-consent sync and historical order sync (`email:klaviyo-shopify-sync`). Verified when Klaviyo's Shopify "Placed Order" metric shows events. [Done. Weekly Placed Order counts since 2026-09-21: 1, 9, 15, 12, 3.]
3. Owner: Klaviyo branded sending domain for xdipx.com, plus a DMARC record (`email:sending-domain`).
4. Owner: written Klaviyo confirmation that this store's content is within their acceptable-use terms (`email:klaviyo-aup`). [Open. The owner accepted the risk and sends meanwhile, decision 2026-10-23.]
5. Owner: flip `email_campaign_push_enabled` to true on `/admin/homepage-team`, Email tab (the toggle is ticket #15007) (`email:push-valve`). It creates drafts only.
6. An interactive session creates the daily trigger: cron `30 13 * * *` UTC (06:30 Phoenix), team `email`, this playbook, git source attached and verified. Record its id in `routine-schedule.md`. The owner then disables routine 5 (`trig_01FkT8YQZJWvPqVQ8nBEPzjq`, Email Briefs), so the email team's one-run-a-day cap holds (`email:activate-daily-routine`).
7. Flip this doc's status to LIVE in the same PR that records the trigger id.
