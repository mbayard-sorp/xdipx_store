# Ad Studio v2: build plan

Status: proposed 2026-10-03, awaiting owner approval of the checklist in §8. Nothing below is
built. Inputs: `docs/audits/ad-studio-owner-report-2026-10-03.md`, the three analyses it
summarizes, and `docs/audits/meta-ads-category-teardown-2026-10-03.md` (Nancy and six peers).

## 1. Owner decisions, recorded

| # | Decision | Effect on the plan |
|---|---|---|
| 1 | Adult networks run at register 10 | Charter change. The charter says 10 never ships; adult networks become the one surface where it does. Needs the owner's "codify" on `docs/emma-voice.md` and `docs/ads-policy.md` before any agent writes at 10. Until then agents draft at 9 and label the 10 rung "pending codify" |
| 2 | Meta, strategically | A Meta lane built on the Nancy pattern (§3). `docs/ads-policy.md` Meta row changes from Prohibited to a strategic lane with the 5a rules as hard gates. Owner codify |
| 3, 4 | Testing starts | Google Search, Microsoft Adult Program, Snap, one adult network, one newsletter, Meta bridge lane. Spend stays off during the two-week simulation |
| 5 | Kill rule default accepted | R1 to R8 ship as editable valves. Default pause at 2x break-even with zero orders after 48h live |
| 6 | Group Chat concept killed | Replaced by "Overheard at the Counter" (§4), scripted lines that are obviously ours, no fake chat UI |
| 7 | Klaviyo flows approved | Browse abandonment, cart abandonment, post-purchase, built as their own ticket in parallel |
| 8 | Meta connector | Owner authorizes when Phase 3 starts. Pin read-only on the seven unpinned cloud triggers in Phase 0 |
| 9 | Ads auto-approve flipped off | Verified by reading the `pipeline_settings` row in Phase 0 |

Goal: orders and traffic. Every lane ends in a Shopify order attributed to a creative id.

## 2. Simulation mode (first two weeks)

The whole system runs daily with spend dark. The owner rates, the team learns, nothing uploads.

- Ideas and creatives generate every day. Ratings read back into the next run.
- Exports are produced and stored (Google CSV, Meta paused-draft payloads, adult-network zips) and
  shown in the UI as "ready", never uploaded. A `ads_spend_enabled` valve, default off, gates every
  upload and every MCP write.
- The Live tab runs on imported Shop Campaigns history and a seeded sample so the kill rules can be
  watched firing before real money is behind them.
- Exit criteria to leave simulation: owner says so, plus 10 straight days of a successful routine
  run, plus at least 30 hearted creatives across at least 3 lanes, plus the bridge page live.

## 3. The Meta lane, copied from what works and nothing from what gets banned

From the teardown's ranked rules (15 of them, 7 brands) and its do-not-copy list.

**Build**
- A bridge subdomain, `curious.xdipx.com`, served by this app (a host-aware layout, not a second
  platform). One screen: hands or object photograph, one headline, one claim, one button to the
  PDP with `utm_content=<creative id>`. Product named, no category words on the first screen. Same
  page for every visitor, no cloaking. Pixel, GA4 and Klaviyo loaded. 18+ gate per our own policy
  (Nancy has none; we keep ours).
- A health and body-literacy block on the destination PDPs for the lane's SKUs (mechanism,
  body-safe materials, who it is for, "not a medical device" disclaimer), rendered to everyone.
- A curated Meta product subset: object-first products (Wild Rose, ROMP Lipstick, Dame Zee, the lube
  and kegel carve-out, Womanizer Liberty 2) with renamed display titles and position-0 packshots on
  coral-soft or in a hand over fabric. Never the raw Shopify feed.
- Copy at 3-4: what it is, who it is for, the offer (discreet box, XDIPX on the statement, the
  guarantee), a real social-proof number only when we have one. No "sex toy", no act names, no
  pleasure outcome.
- One advertiser page: xdipx. Hard 25+ targeting. Paused drafts only until the owner flips them.

**Never**
- Persona pages, fake bylines, advertorials with invented authors.
- Rotating domains or pages, link shorteners.
- Countdowns, "final minutes", orgasm claims.
- Product on bare skin, in use, or any recognizable toy silhouette.

## 4. Creative lanes and the register ladder

| Lane | Destination | Register | Creative source |
|---|---|---|---|
| Meta bridge | Meta, 25+ | 3-4 | Concepts 2.1 Sculpture Hall (object rung), 2.7 Statement Reads XDIPX, 2.13 Spec Sheet, 2.14 Second Spring, 2.10 The Gift |
| Google Search | RSA text | 4-5 | Slogan bank R3-4 lines, 30-char headlines, keyword sets from the existing Google plan |
| Microsoft Search | RSA text | 4-5 | Same as Google |
| Snapchat | Snap Ads, 18+ | 6-7 | Non-graphic object and typographic creative |
| Adult networks | ExoClick, JuicyAds banners 300x250, 728x90, 300x100, 900x250 | 10 (pending codify) | Full concept bank including Body Map |
| Newsletters, podcasts | Sponsored reads | 7-9 | Say It Plain, Hands Only, For Him Plainly |
| Owned | Klaviyo flows, SMS, site | 9 | Bodyscape openers of the exact product left behind |

Replacement for Group Chat: **Overheard at the Counter.** A typographic card with one short
scripted exchange between the shop and a customer, set in Newsreader, visibly ours ("At the xdipx
counter" kicker). No chat bubbles, no phone frame, no implied real person. Example, R6-7: "'Does it
come in a plain box?' 'Plainer than your mail.'"

## 5. Architecture

Additive only. No existing table is modified, no existing schema file is edited.

**Schema (migration 114, additive SQL only, merges on the ordinary lane)**
- `ad_ideas`: id, run_id, concept_slug, lane, register_tier, title, one_liner, products jsonb,
  headlines jsonb, body jsonb, audience jsonb, destination_url, break_even_json, policy_check text
  not null, status (proposed, hearted, rejected, rendered, archived), created_at.
- `ad_idea_feedback` and `ad_creative_feedback`: same shape as `social_asset_feedback` (verdict up
  or down, reasons jsonb, note, rated_by), keyed to ideas and creatives respectively, one live verdict
  per row.
- `ad_creatives` gains columns: idea_id, lane, register_tier, slogan, layout_template, plate_asset_id,
  width, height, export_payload jsonb, external_ad_id, launched_at, paused_at, pause_reason.
- `ad_creative_daily_metrics`: creative_id, day, platform, spend_cents, impressions, clicks,
  orders, net_revenue_cents, source (csv, mcp, shopify).
- `ad_rule_events`: rule_id (R1 to R8), creative_id, fired_at, action, applied_by, applied_at.
- `pipeline_settings` keys: `ads_spend_enabled` (off), `ads_media_monthly_cap_cents`,
  `ads_kill_*` thresholds for R1 to R8, `ads_team_max_runs` 2, `ads_team_daily_cents` sized for images.

**Server**
- `app/lib/ad-ideas.server.ts`: idea CRUD, feedback upsert, read-back summary.
- `app/lib/ad-render.server.ts`: plate generation through `generate-image.server.ts` (archetype B
  for paid-safe, on-skin axes only for owned and adult lanes), then slogan composition in a layout
  layer (HTML template rendered headless, Newsreader and DM Sans, coral budget rule), per-format
  sizes, vision gate, product-fidelity gate, voice gate, humanizer on every string.
- `app/lib/ad-export/`: `google-editor-csv.server.ts` (UTF-16 CSV, RSA columns, keywords,
  negatives, UTM final URLs), `meta-draft.server.ts` (adimages hash then ad with status PAUSED via
  the Meta MCP or Marketing API, carve-out and bridge lane only), `banner-zip.server.ts` (sized PNGs
  plus copy plus UTM links for adult networks and sponsors). The three existing push stubs are
  deleted; the `ad-publish` registry becomes the export registry.
- `app/lib/ad-metrics.server.ts`: CSV import for Google Ads and Shop Campaigns, MCP insights for
  Meta, Shopify order attribution by `utm_content`, daily rollup that also writes
  `daily_profit_summary.ad_spend` (the column nothing writes today).
- `app/lib/ad-rules.server.ts`: R1 to R8 evaluated daily against net revenue, each firing writes an
  `ad_rule_events` row and a one-tap recommendation; auto-apply only for R7 spend guard.
- `app/routes/api.team.ad-ideas.tsx`, `api.team.ad-render.tsx`, `api.team.ad-feedback.tsx` (read
  only, like the social one; no team-token write of ratings).
- Bridge host: `app/routes/bridge.$slug.tsx` behind a host check for `curious.xdipx.com`, content
  from a new Sanity doc type `adBridgePage` (additive).

**UI, phone-first at 375px, dashboards style from the taste pack (variance 4, motion 4, density 7),
brand tokens unchanged**
- `/admin/ad-studio` rebuilt with four tabs: Ideas, Creatives, Live, Spend. Bottom tab bar on
  phones, side rail at md and up. Sticky top bar: today's spend against the cap, simulation badge.
- Ideas: full-width cards, concept name, lane badge, register tier, products, first headline, the
  break-even line in mono. Heart or thumbs-down with reason chips (on-brand, strong-hook,
  product-fit, lane-fit versus off-policy, too-tame, weak-hook, wrong-product, duplicate). Hearted
  ideas show "rendering" then link to their creatives.
- Creatives: one card per creative, the rendered ad at its real aspect, slogan under it, lane badge,
  gate results as small chips, export state. Same rating gesture with the ads chip set. Filters by
  lane, concept, product, rating, status. "Ready" exports never show a platform button they cannot
  use.
- Live: per-creative row, spend, impressions, CTR, orders, net ROAS, the rule that fired, one-tap
  Pause, Scale, Refresh with the rule named. Empty state explains simulation mode.
- Spend: monthly cap (owner-only), planned versus actual per campaign and lane, CSV import drop
  zone, compute budget shown separately from media budget.
- Every action goes through fetchers with visible pending, success and error states. No silent
  failures anywhere.

**Automation**
- New cloud routine `routine-ads-daily.md` (RemoteTrigger, 14:30 UTC): read strategy brief, stock,
  ratings since last run, concept bank, lane rules; file 10 to 20 ideas; render creatives for ideas
  hearted since last run; run gates; write rows; file a digest line "N ideas and M creatives await
  rating". Picks products by Shopify type, not the dial field.
- Second daily pass 20:30 UTC: render for anything hearted during the day, run metrics import and
  rules, write recommendations.
- `ads-manager.md` rewritten as the daily ideas agent; the weekly routine retired. `cron-expectations`
  entries added for both passes.
- Klaviyo: browse and cart abandonment flows created in Klaviyo off the Viewed Product, Added to
  Cart and Started Checkout events (correction 2026-10-03: the client fires Added to Cart only, Viewed Product is never sent and Started Checkout only from the SMS path), templates in Emma voice at 9 with
  product-specific bodyscape headers from the creative library.

## 6. Phases and PRs

Sonnet 5.5 builds each PR. An Opus 5.5 reviewer runs QA on each before it goes to the bus. Every PR
files its ticket in the same breath. Protected paths (migrations, `.github`, valves) escalate to the
owner as always.

| Phase | PR | Scope | Done when |
|---|---|---|---|
| 0 | none | Verify auto-approve off, pin Meta MCP read-only on 7 triggers, size `ads_team_daily_cents`, owner codify of register 10 and the Meta lane in the two docs | Rows read back, docs merged |
| 1 | PR-A (in review, #1503) | Migration 114, `ad_ideas`, feedback tables, creative columns, settings keys, `ad-ideas.server.ts`, team endpoints, Ideas tab, nav | Owner can rate a seeded idea on a phone; routine can read ratings back |
| 1 | PR-B (merged, #1501) | `routine-ads-daily.md`, `ads-manager.md` rewrite, RemoteTrigger, cron expectations, concept bank wired as the idea source, Overheard at the Counter added | Two consecutive daily runs file ideas with policy checks |
| 2 | PR-C | `ad-render.server.ts`, layout layer templates, format matrix, gate chain, Creatives tab with rating and filters | Hearted idea produces gated creatives in all its lane's sizes within one run |
| 2 | PR-D | Bridge page route and Sanity doc type, PDP health block, curated Meta subset with display titles, packshot sweep on position 0 | `curious.xdipx.com/<slug>` renders the same page to every visitor with pixel and UTM |
| 3 | PR-E | Export registry: Google Editor CSV, Meta paused draft, banner zip; `ads_spend_enabled` gate; owner authorizes Meta connector here | Each hearted creative has a downloadable or stored export; nothing uploads with the valve off |
| 3 | PR-F | Klaviyo flows (API-created where possible, otherwise documented clicks), templates, bodyscape header selection. **In review: [#1502](https://github.com/mbayard-sorp/xdipx_store/pull/1502), ticket #13383.** Cart and post-purchase flows created as drafts; browse abandonment waits on a Viewed Product event nothing sends yet | Test profile receives the browse abandonment email with the right product |
| 4 | PR-G | Metrics import (CSV, MCP insights, Shopify attribution), `ad_spend` backfill, Live tab | Shop Campaigns history visible per day; `daily_profit_summary.ad_spend` non-zero on spend days |
| 4 | PR-H | Rules R1 to R8, `ad_rule_events`, recommendations UI, R7 auto-pause, Spend tab, owner digest section | Seeded metrics fire R1 and R5 visibly; owner can one-tap pause |
| 5 | docs | Playbook, lane rules, owner runbook for flipping `ads_spend_enabled` and going live platform by platform | Simulation exit criteria met |

Design pass before PR-A and PR-C: `homepage-designer` loads ui-ux-pro-max and the taste pack
dashboards style, produces wires for the four tabs at 375px and 1024px, and hands them to the
builders. Deliverable checked into `docs/store-team/ad-studio-v2-wires.md`.

## 7. Risks held open

- Register 10 on adult networks is a charter change nobody has written yet. Agents hold at 9 until
  codified.
- A Meta rejection pattern reaches the pixel and the Shop. The lane runs paused drafts, 25+, bridge
  only, and the owner flips each ad live himself.
- Attribution: GA4 purchases arrive Unassigned. Shopify order attribution by `utm_content` is the
  source of truth for the rules, so the bridge and every final URL must carry it.
- Image budget: a daily render lane draws on `ads_team_daily_cents`. Size it in Phase 0 or the gate
  skips runs the same way it skipped 11 of 13.
- Reviews: there is one approved review and it looks like a test. No social-proof numbers in copy
  until the invite flow produces real ones.

## 8. Approval checklist

- [ ] Phase order and PR split as in §6
- [ ] `curious.xdipx.com` as the bridge host (or name another)
- [ ] Overheard at the Counter replaces Group Chat
- [ ] Simulation exit criteria in §2
- [ ] Owner will say "codify" for register 10 on adult networks and the Meta strategic lane, or
      will hold both at the current charter
- [ ] Owner will authorize the Meta connector at Phase 3
