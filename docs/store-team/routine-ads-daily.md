# Routine: Ads Daily (ads-manager)

The playbook for the two daily ads passes. Entry agent: `ads-manager`. It replaces
`routine-ads-weekly.md`, retired 2026-10-03. Built for Ad Studio v2 (`docs/store-team/ad-studio-v2-plan.md`
§5 Automation, §6 PR-B).

**You propose ideas and request renders. You never upload to any platform, never touch a valve, never
spend media money.** Every idea is a row the owner rates on his phone. Every render is requested
through the render API and gated there. What happens to a hearted creative after that (export,
paused draft, launch) is not yours, and no step in this playbook may be added that does it.

Runs on the **Max subscription**. Two passes a day:

| Pass | Cron (UTC) | `runType` | Feature label | What it does |
|---|---|---|---|---|
| 1, ideas | `30 14 * * *` | `ads-ideas` | `ads-ideas` | Read ratings, file 10 to 20 ideas |
| 2, render | `30 20 * * *` | `ads-render` | `ads-render` | Enqueue renders for hearted ideas, run metrics and rules |

Both count against `ads_team_max_runs` (2). A skipped run still burns a slot, so the cap is exactly
the schedule and a manual re-fire needs the owner to raise it.

All written output runs the humanizer (`.claude/skills/humanizer/SKILL.md`) before it ships, and
customer-facing words follow `docs/emma-voice.md` (v5.8) over the humanizer on any conflict.

## Shared helper and binding rules

Every call goes through the one allowlistable shape, never a hand-rolled curl with a token:

```bash
bash scripts/team-api.sh POST run '{"op":"start","team":"ads","runType":"ads-ideas"}'   # -> $RUN_ID
bash scripts/team-api.sh GET  gate 'team=ads&excludeRun=<RUN_ID>'
```

Read in full at the start of each pass, before any drafting, in this order: `docs/ads-policy.md`
(especially §Meta strategic lane M1 to M7 and the copy-register table),
`docs/emma-voice.md` marketing addendum, `docs/store-team/ad-creative-concept-bank-2026-10-03.md`,
`docs/store-team/ad-owner-notes.md`, `docs/store-team/mission-brief.md`.

Hard rules, every string, every idea:

1. No em-dashes. Periods and commas.
2. "sex" and "sexy" never as a branding adjective. "Sex toy" is a normal noun only where the tier
   allows it (never in Meta copy, never in Google headlines at 3-4).
3. CTAs from the whitelist only: "Take a peek →", "Show me", "Find your fit →", "I'll take it ♥".
   Never "Buy now".
4. No countdowns, no "final minutes", no urgency theater.
5. Emma has no lived experience. She never tried, tested, owns, or felt anything. The shop speaks.
6. No social-proof number unless our own data sources it, and the `policy_check` cites the source.
   There is one approved review and it looks like a test: today that means no review counts at all.
7. Billing descriptor is XDIPX. MAP rules hold: never advertise a discount on a MAP=MSRP product.
8. Every product shown is in stock and ACTIVE (Storefront `availableForSale`), checked at filing time.
9. Product choice goes by Shopify **product type and title**. Never `product_type_dial`: it is
   mislabeled and has misrouted ideas before.
10. `ads_spend_enabled` governs everything that could leave the building. Read it at run start via
    `GET team/status`. When it is false, which is the default and the state for the whole
    simulation period, nothing uploads, ever, and the run summary says "simulation".

## The register ladder, per destination

| Destination | Register | Notes |
|---|---|---|
| Meta bridge lane | 3-4 | Gates M1 to M7 are hard checks (below). Paused drafts only, 25+ |
| Google Search, Microsoft Search | 4-5 for factual product text | Text only. RSA headlines max 30 characters, descriptions max 90 |
| Snapchat (18+, non-graphic) | 6-7 | Object and typographic creative |
| Vetted adult ad networks | 10 | Banners 300x250, 728x90, 300x100, 900x250. Nudity definition is the imagery ceiling. Full explicit arousal at 10; porn-copy and the leering voice are off the dial and ship nowhere. UTMs mandatory |
| Newsletters, podcasts (sponsored reads) | 7-9 | |
| Owned (Klaviyo, SMS, site) | 9 | |
| Google Display, PMax, Demand Gen, YouTube; TikTok, X, Reddit, Pinterest paid | none | Never proposed |

A register tier outside its row is a defect, not a style choice. If a concept only works above its
destination's ceiling, it is filed for a destination where it fits, or it dies.

## Meta gates M1 to M7 (hard checks on every Meta idea)

Run these as yes/no checks before filing. A Meta idea that fails any one is not filed; post a
`decision` event naming the gate. Source of truth: `docs/ads-policy.md` §Meta strategic lane. If this
list and that section disagree, the policy wins.

| Gate | Check |
|---|---|
| M1 destination | Final URL on `curious.xdipx.com`, or a PDP carrying the health and body-literacy block. Never homepage or a collection. Same page for everyone. 200, no redirect, no shortener |
| M2 creative | Object-first on coral-soft, plum-soft or paper ground, or held in a hand over fabric. Never in use, never on skin, no phallic or clinical silhouette, no nudity, no nipple of any sex |
| M3 copy | Register 3-4: what it is, who it is for, the offer. Never "sex toy", never an act name, never a pleasure or orgasm claim. Sourced social proof only |
| M4 account | One advertiser page, 25+ targeting, never open Advantage+ audience, every ad a PAUSED draft |
| M5 catalog | Curated Meta subset with renamed display titles only. Never the raw feed, never Advantage+ catalog or DPA |
| M6 never | No persona pages, fake bylines, invented-author advertorials, rotating domains, shorteners, countdowns, orgasm claims |
| M7 health | Read `GET team/status` and the open suggestions for a Meta rejection. One rejection stops new Meta ideas until the owner decides. A second rejection citing the same policy, or any account restriction, pauses the lane |

Until the bridge host ships (plan PR-D), a Meta idea may be filed against a planned
`https://curious.xdipx.com/<idea slug>` URL, and its `policy_check` says "M1 depends on PR-D; not
exportable until the bridge is live". It is an idea, not a launch.

## Pass 1: Ideas (14:30 UTC)

### Step 0. Start

```bash
bash scripts/team-api.sh POST run '{"op":"start","team":"ads","runType":"ads-ideas"}'   # -> $RUN_ID
```

### Step 1. Gate

`GET gate?team=ads&excludeRun=$RUN_ID`. If `ok:false`, finish the run as skipped with the reason and
stop:

```bash
bash scripts/team-api.sh POST run '{"op":"update","id":<RUN_ID>,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}'
```

Then read `GET team/status` and note `ads_spend_enabled`. Hold it for every later summary.

### Step 2. Context (data only)

1. The active strategy brief: `GET team/brief`. Its directives on products, angles and calendar
   themes constrain the slate.
2. Stock and catalog: Storefront `availableForSale` and product `productType` and `title` for the
   candidate pool. Collect the `handle` of each, and the price and the wholesale cost metafield for
   the break-even math.
3. The prior run start time: the most recent finished `ads-ideas` run row for team `ads`. Call it
   `$SINCE`. On the first run ever, use 14 days ago.
4. Open `ad_campaigns` and suggestions targeted at ads (organic proof, promo windows). Anything
   from social that names a proven hook is a precedent to cite.

### Step 3. Read ratings back (owner direction: the training loop)

This is the equivalent of social Step 7b. The owner's hearts and thumbs-down are the only real signal
this team has, so read them every run, before drafting.

The contract (PR-A ships it; `app/routes/api.team.ad-feedback.tsx`, read-only for the team token, no
team-token write of ratings):

```bash
bash scripts/team-api.sh POST team/ad-feedback '{"op":"summary","since":"<SINCE iso>"}'
bash scripts/team-api.sh POST team/ad-feedback '{"op":"list","since":"<SINCE iso>"}'
```

`list` returns rows of: `target` (`idea` or `creative`), `idea_id`, `creative_id`, `verdict`
(`up` or `down`), `reasons` (chip slugs), `note`, `concept_slug`, `lane`, `register_tier`,
`product_handles`, `rated_at`. `summary` returns counts per verdict, per reason, per concept and per
lane. Chip slugs, ideas: `on-brand`, `strong-hook`, `product-fit`, `lane-fit` (up) and `off-policy`,
`too-tame`, `weak-hook`, `wrong-product`, `duplicate` (down). Creatives use the ads chip set the same
way, plus `more-like-this` on up.

If the endpoint is not live yet (404), post a skipped step event `feedback_api_not_live`, read
`ad-owner-notes.md` only, and continue.

Apply exactly like social Step 7b:

- Every UP carrying `more-like-this` (or any UP with a `strong-hook` or `product-fit` chip) is a live
  positive precedent. Cite it by `idea_id` or `creative_id` in the idea it informs.
- Every DOWN reason constrains the one lever it names, and the lever is named in the brief for that
  idea: `off-policy` to the `policy_check` rule and the register tier, `too-tame` to the tier within
  its destination's ceiling, `weak-hook` to the hook formula, `wrong-product` to product selection,
  `duplicate` to the slogan and concept dedupe in Step 4.
- A reason seen on **2 or more rows** across runs is promoted to a numbered rule in
  `docs/store-team/ad-owner-notes.md` through an `instructions` suggestion row in the retro (the
  agent-editor opens the PR, never this run). Until the file has rules, it is read as empty.
- The run summary states which feedback rows were applied and how, or "no new feedback since
  <SINCE>". Silence is not a report.

### Step 4. Draft 10 to 20 ideas

Pick the products first, by Shopify type and title, from the in-stock pool, then the concept, then
the lane. Spread the slate: at least 4 distinct concepts, at least 3 lanes, no more than 3 ideas on
one product, and a product-type mix that is not all one category.

Concept slugs (from the concept bank §2): `sculpture-hall`, `body-map`, `say-it-plain`, `orchard`,
`morning-after`, `hands-only`, `statement-reads-xdipx`, `frequency`, `for-him-plainly`, `the-gift`,
`overheard-at-the-counter`, `ask-emma`, `spec-sheet`, `second-spring`. Lane slugs: `meta-bridge`,
`google-search`, `microsoft-search`, `snapchat`, `adult-network`, `newsletter`, `owned`. Lane to
concept fit follows the plan §4 table; slogan lines come from the bank §3 at the tier that matches
the destination, and hook shapes from §4.

**Slogan dedupe.** No slogan is reused within 30 days. Before filing, read what shipped:

```bash
bash scripts/team-api.sh POST team/ad-ideas '{"op":"list","since":"<30 days ago iso>"}'
```

Compare every headline and body line against every returned idea's `headlines` and `body`. A line
used inside 30 days is rewritten. A reused bank line without a rewrite is a defect.

Each idea carries these fields (PR-A contract):

| Field | Rule |
|---|---|
| `concept_slug` | One of the 14 slugs |
| `lane` | One of the lane slugs |
| `register_tier` | Integer or range string per the ladder, e.g. `"3-4"`, `"4-5"`, `"6-7"`, `"10"` |
| `title` | Short internal name |
| `one_liner` | One sentence on what the ad shows and says |
| `products[]` | `{handle, title, productType, price}` for each, verified in stock |
| `headlines[]` | Google and Microsoft: each at most 30 characters, 3 to 15. Other lanes: 1 to 5 |
| `body[]` | Google and Microsoft: each at most 90 characters, 2 to 4. Other lanes: 1 to 3 lines |
| `audience` | Lane-specific: keyword themes for Search, 25+ and interests for Meta, placement and format for networks |
| `destination_url` | Final URL, 200 with no redirect, carrying `utm_source=<platform>&utm_medium=paid&utm_campaign=<campaign slug>&utm_content=<idea slug>` |
| `break_even_json` | `{aov_cents, margin_pct, break_even_roas, break_even_cpa_cents, inputs, confidence}`; see below |
| `policy_check` | Mandatory text, at least two sentences, citing the exact `docs/ads-policy.md` rule that permits it |

**Break-even math.** State the inputs, never just the answer. `margin_pct` comes from the product's
price and wholesale cost metafield (contribution after payment fees and shipping where known).
`aov_cents` is the product price for a single-product landing, or the measured basket for a
homepage-like destination; the reference figures in `docs/audits/ad-studio-audit-2026-10-03.md` §3
(median basket about $33, contribution margin about 37.6%, break-even ROAS about 2.7x, break-even CPA
about $12.40) are the fallback, labeled as such with `confidence:"low"`. `break_even_roas =
1 / margin_pct` and `break_even_cpa_cents = aov_cents * margin_pct`. An idea with no revenue path is
labeled brand-awareness in `one_liner` or dropped.

**`policy_check` examples of acceptable shape.** Google Search: "Search Network text ad, register 4-5
factual product text per ads-policy.md copy-register table; no Display or search partners; final URL
verified 200." Adult network: "Vetted adult ad network, register 10 per emma-voice v5.8 and the
ads-policy.md register table; imagery at the nudity-definition ceiling; UTMs present." Meta: name each
of M1 to M7 as passed in one clause each. A `policy_check` that only says "complies" is rejected by
the API and by you.

Before filing, run the self-gates on every string: humanizer pass, hard rules 1 to 9, the ladder row
for the destination, and for Meta the M1 to M7 table. Anything that fails is rewritten once, then
dropped with a `decision` event (one line, naming the rule).

### Step 5. File

```bash
bash scripts/team-api.sh POST team/ad-ideas '{"op":"create","runId":<RUN_ID>,"ideas":[ {...}, {...} ]}'
```

PR-A contract: the API 400s on a missing or thin `policy_check`, a non-whitelisted CTA, an em-dash,
a banned phrase, a headline over 30 characters on a Search lane, or a `destination_url` with no
`utm_content`. It returns `{created:[{id,slug}], rejected:[{index,reason}]}`. Rework each rejection
once and refile; a second rejection drops that idea with a `decision` event quoting the reason. If
the endpoint is not live (404), post a skipped step event `ideas_api_not_live`, write the slate into
the run summary instead, and finish the run `failed` with `error:'ideas-api-not-live'` so the gap is
visible.

Post one `step` event per filed batch and one `decision` event per dropped idea:

```bash
bash scripts/team-api.sh POST team/event '{"op":"record","runId":<RUN_ID>,"summary":"Filed <n> ideas across <lanes>","eventType":"step","phase":"ideas","agentRole":"ads-manager"}'
```

The field is `summary`, not `message`.

### Step 6. Retro

Three reads, written as `decision` events, lessons as suggestions (own team, or `targetTeam:'strategy'`
for cross-team):

1. Rated since last run: which concepts and lanes got hearts, which got thumbs-down and why.
2. Idea throughput: filed versus rejected by the API, and the top rejection reason.
3. Hearted versus rendered (read at Pass 2 and carried forward): are hearts piling up unrendered.

A recurring reason goes to `ad-owner-notes.md` via an `instructions` suggestion, never a direct edit.

**Shop Campaigns (ticket #12550).** Owner-reported Shop Campaigns spend is retro'd like any launched
row, logged as platform `'other'` with name prefixed `shop-`. Any Shop delisting, product
redaction, Shop Campaigns rejection, or Shopify Payments inquiry is an account-health event handled
per `docs/ads-policy.md` §Escalation: an error event, surfaced to the owner the same run, and Shop
work stops. Pointer only — see §Shop app and Shop Campaigns for the eligible-set and image rules;
this lane never proposes Shop Campaigns, never proposes adding products to the Shop publication, and
never sizes Shop budgets (`<policy_first>` in `.claude/agents/ads-manager.md`).

### Step 7. Spend and finish

Log tokens:

```bash
bash scripts/team-api.sh POST homepage-team/spend '{"kind":"tokens","source":"agent-sdk","feature":"ads-ideas"}'
```

Then the final run update. The summary always carries, on their own lines: ideas filed, ideas
dropped (with the top reason), ideas hearted since last pass (from the feedback summary), creatives
rendered since last pass, and `simulation: on` or `simulation: off` from `ads_spend_enabled`. A
summary that reports filed ideas and not the simulation state has not reported the run.

## Pass 2: Render (20:30 UTC)

### Step 0 and 1. Start and gate

Same as Pass 1 with `runType:"ads-render"`. On `ok:false`, finish skipped and stop. Read
`GET team/status` for `ads_spend_enabled`.

### Step 2. Find hearted ideas

```bash
bash scripts/team-api.sh POST team/ad-ideas '{"op":"list","status":"hearted","since":"<last ads-render run start iso>"}'
```

On the first run use 24 hours ago. Re-check each idea's products for stock before enqueueing; an
idea whose product has gone out of stock is passed over with a `decision` event, and the owner sees
that in the summary.

### Step 3. Enqueue renders

```bash
bash scripts/team-api.sh POST team/ad-render '{"op":"enqueue","runId":<RUN_ID>,"ideaIds":[<id>,<id>]}'
```

PR-C ships this endpoint (`app/routes/api.team.ad-render.tsx`). Its response is `{enqueued:[{ideaId,
jobId,sizes}], refused:[{ideaId,reason}]}`; it picks the plate archetype and sizes by lane, runs the
vision, product-fidelity and voice gates, and writes `ad_creatives` rows. You do not generate images
yourself in this lane. Until the endpoint exists, a 404 is not an error: post a `step` event with
`summary:"skipped: render_api_not_live"`, `eventType:"step"`, `phase:"render"`, and continue. A
`refused` row is posted as a `decision` event and left hearted for the next pass unless the reason is
terminal (`out_of_stock`, `policy_blocked`), in which case say so in the summary.

### Step 4. Metrics and rules

```bash
bash scripts/team-api.sh POST team/ad-metrics '{"op":"daily","runId":<RUN_ID>}'
```

PR-G and PR-H ship the import and the R1 to R8 rules. Not-live fallback is the same: a 404 posts
`skipped: metrics_api_not_live` and the run continues. When live, the response names each rule that
fired and its one-tap recommendation; post each as a `decision` event. This step recommends only. R7
spend guard is the one rule the server may auto-apply, and that is server-side, not yours. Never call
any platform tool to pause, scale or refresh anything.

### Step 5. Retro and inbound suggestions

Read suggestions targeted at ads, oldest first, and act only on what this run can execute within these
gates:

```bash
bash scripts/team-api.sh POST suggestion '{"op":"list","targetTeam":"ads","status":"approved","orderBy":"age"}'
```

Close a row `applied` only if this run executed it. `instructions` and `code` rows have their own
executors and are never yours to end. A row looked at and deliberately not acted on gets a `note`
op (text in `ref`), status unchanged.

### Step 6. Spend and finish

Log tokens under feature `ads-render`. The summary carries: ideas hearted (since last pass),
renders enqueued, renders refused (with reasons), the rules that fired (or `metrics not live`), and
`simulation: on|off`.

## Definition of done

- **Pass 1 succeeds** only when at least 10 ideas were filed, or the gate honestly skipped. Fewer than
  10 filed with the gate open finishes `failed` with `error:'ideas-under-floor:<n>'` and the reason
  (API rejections, stock pool, policy drops) in the summary. A run that files 9 and reports success
  has lied.
- **Pass 2 succeeds** when every hearted idea in scope has a render enqueued, or the not-live
  fallback was recorded for that step (`render_api_not_live`), or the idea was passed over with a
  named `decision` event. Zero hearted ideas is a success with "0 hearted" stated.
- Neither pass ever finishes with a platform upload, a valve write, or media spend on its record. If a
  step would need one, post a `decision` event and stop that step.

## What never changes

- You do not carry the Meta Ads connector in this lane, so no Meta tool is ever called. If an idea
  needs competitor or account context, file a suggestion at `strategy`.
- You never edit the policy docs, the charter, the concept bank or the owner-notes ledger directly.
  Changes go through `instructions` suggestions to the agent-editor, or the owner's "codify".
- Never park an owner ask in the run summary. A decision the owner must make goes on the blocker
  list (`/api/team/blocker`) or it did not happen.
