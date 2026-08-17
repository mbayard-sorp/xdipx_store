# Routine — Weekly Strategy (store-strategist)

The exact playbook for the scheduled "Weekly Strategy" cloud routine. Entry agent:
`store-strategist`, with `inventory-sentinel`, `promo-manager`, `loyalty-referral-manager`,
`product-manager` (review-only here — the daily product routine owns queue execution), and
`program-manager` as sub-steps under the same run. **Advisory only** — this routine publishes a brief and files
suggestions; it changes nothing itself. Recommended schedule: Monday morning.

Runs on the **Max subscription**: own reasoning, site only for data + spend logging. Never call the
site's Anthropic-keyed endpoints.

## Preconditions

- Callback secret as `TEAM_TOKEN` (falls back to `HOMEPAGE_TEAM_TOKEN` / `CRON_SECRET`); sent as
  `x-team-secret` on every call. `BASE_URL` = deployed origin.
- Hard `maxTurns` ~14. Read `docs/store-team/mission-brief.md` after the gate; it is binding.

## Step 0 — Start the run

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"strategy","runType":"strategy"}'
# → { "id": 42 }   → $RUN_ID
```

## Step 1 — Gate (abort if not ok)

```bash
curl -s "$BASE_URL/api/team/gate?team=strategy&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

If `ok:false`: post `{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}` and **stop**.

## Step 2 — Read (data only)

- Previous brief: `GET /api/team/brief`.
- Search performance: the latest `gsc_snapshots` row (written Monday 06:00 UTC by
  `/cron/gsc-snapshot`; last-28-day totals, top queries, top pages, sitemap status). Report
  click/impression trends and overlap with covered content clusters in the brief; file a
  suggestion on regressions or sitemap errors. A missing or stale (> 8 days) snapshot is itself
  reportable: either the cron broke or the GSC service-account env vars are not set yet.
- Homepage SERP snippet: pull the `https://xdipx.com/` entry out of that snapshot's `top_pages`
  (impressions, clicks, CTR, position) and read the current **published** `singleton.homeSeo`
  (`*[_id == "singleton.homeSeo"][0]{seoTitle, seoDescription, _updatedAt}`, published perspective).
  Report both in the brief, side by side. You never write Sanity: `homepage-orchestrator` is the sole
  writer of that document. When a rotation is warranted, authorise it with a line reading exactly:

  ```
  HOMESEO: ROTATE week=<this brief's own weekStart, YYYY-MM-DD>
  ```

  The `week=` binding is not optional. Briefs stay `status='active'` until superseded and the daily
  merchandise routine reads them every day, so an unbound directive would re-authorise the same
  rotation every day for a week. The consumer's matching rules are in
  `docs/homepage-team/routine-daily-merchandise.md` Step 5c; keep the token identical in both files.

  **Evidence floor.** Do not direct a CTR-driven rotation until the homepage clears a rolling 28-day
  floor of several hundred clicks. The 2026-07-27 snapshot showed 48 impressions and 5 clicks
  sitewide, 28 and 3 of them on the homepage, whose queries are almost entirely brand-name
  misspellings ("dipx", "xdip", "dip x"). At that volume CTR is noise, and Google caches SERP titles
  for days to weeks, so a rotation measured a week later compares the old title against a new
  baseline. Same discipline as the GA4 300-sessions rule, stricter floor because clicks are the whole
  signal. Below the floor the only valid triggers are: the snippet is empty, it violates the voice
  charter, it is factually wrong, or the owner asked.
- Citation spot-check (zero infra): web-search 3 rotating queries from the approved keyword bank
  and note in the brief whether xdipx.com is cited or linked in the answers/results.
- Cross-team activity: `POST /api/team/event {"op":"list","sinceDays":7}`.
- Improvement bus state: `POST /api/team/suggestion {"op":"list"}`.
- Outcomes: `daily_profit_summary` (orders/revenue/margin/AOV/ad_spend), GA4 via the
  `google-analytics` MCP (≥300 sessions/week to weight it), `social_posts` (drafts vs posted),
  `ad_campaigns` statuses, calendar `GET /api/team/calendar`.
- Review funnel: invite/review counts from `review_invites` + `review_aggregates` (the data behind
  `getReviewStats` in `app/lib/reviews.server.ts`). Report invites-sent and reviews-landed in the
  brief; **if orders shipped this week but invites-sent is 0 for 7 straight days, file a
  suggestion** (the invite webhook or the review-reminders cron has silently broken).

## Step 3 — Retro on last week's brief

Directive by directive: followed? outcome? keep/adjust/drop? One `decision` event each:

```bash
curl -s -X POST "$BASE_URL/api/team/event" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"record","runId":'$RUN_ID',"eventType":"decision","agentRole":"store-strategist","phase":"retro","summary":"<directive>: <verdict + numbers>"}'
```

## Step 3b — Drain the `strategy` kind (close or carry every approved row)

The strategist already holds the terminal edge on `strategy` rows: `RUN_CLOSE_ACTORS` in
`app/lib/team.server.ts` includes `agent:store-strategist` and `RUN_CLOSE_KINDS` includes `strategy`,
so `ALLOWED.approved` grants `approved → applied` on any `strategy` row today, no code change and no
valve. The lane is not missing, the instruction was. At run start list them:

```bash
-d '{"op":"list","status":"approved","kind":"strategy","orderBy":"age","limit":200}'
```

For each row, exactly one of two outcomes — no third option:

- **(a) Fold it into this week's brief and close it:**
  ```bash
  -d '{"op":"transition","id":N,"to":"applied","actor":"agent:store-strategist","note":"folded into brief week=YYYY-MM-DD as <directive>"}'
  ```
- **(b) Carry it:** name it explicitly in the brief as carried, with the reason it is not yet folded.

A row that is neither folded nor named is a bug in the run. This is what Step 7's "rows CLOSED since
last run" line always asked for and no step implemented; 0 of the standing `strategy` rows had ever
reached `applied` before this step existed.

**Outreach fence (exempt from 3b).** Any row whose text begins "OFFSITE PITCH" or is a brand-partner
pitch is the outreach send-arm's live input per `docs/store-team/outreach-pipeline.md` and stays
`approved` until the pitch is sent or the prospect is closed. Never fold one into a brief to close it,
and never retire it: retiring frees the undated per-domain `dedupeKey` and `offsite-scout` re-files
the identical pitch next Tuesday. Say plainly in the brief that these rows are an **owner-send queue**,
not backlog.

## Step 3c — Triage the blocked pile

Nothing else in the system reviews blocked rows: the only automated exit
(`reopenBlockedOnRepeatObservation`) needs a `dedupeKey` plus a repeat detection of the identical
condition, which a governance ticket never gets, and every other exit is owner-only. So each week read
every blocked row and its latest `suggestion_links` note (that note is where R-DEV writes the reason;
`last_error` is null by design on this path) and sort each into one bucket, then act:

- **RESOLVED / superseded** (e.g. a block note that already reads "RESOLVED ... superseded on main") →
  say so in the brief and list it for owner dismissal.
- **WRONG LANE** (belongs to content, shopify-ops, or is not application code at all) → state the
  correct owner and the re-file needed.
- **GENUINELY PROTECTED PATH or awaiting a dependency** (e.g. dependents waiting on an unmerged PR) →
  leave blocked and name it in the brief with what would unblock it.

Report the three counts (resolved / wrong-lane / genuinely-blocked) in the run summary so a growing
blocked pile is visible.

## Step 3d — Social drift check (the healing loop)

Owner direction 2026-08-16 ("a healing loop on our strategy so we don't drift"), ticket #3737. Read
`docs/store-team/social-crossplatform-strategy.md` §8 plus the week's `social_posts` rows, and put
a six-line verdict in the weekly brief, one yes/no per line, where **yes is the healthy answer**:

1. Every platform ran the active campaign spine.
2. X companion beats shipped for the week's Instagram product posts.
3. Toy posts carried their lube pairing.
4. Every caption stayed inside its platform register cap (4-5 IG/TikTok, 6-7 X).
5. The campaign runway is at least 4 weeks.
6. Every maker engagement (like/reply/reshare) was flagged to `offsite-scout`. A week with no maker
   engagement is a yes, said plainly.

Every "no" becomes a suggestion row filed the same run at the team that owns it, with a
`dedupeKey`, never a narrative-only note. Once migration 079 lands (ticket #3536), the check also
reads the engagement op and names the week's best and worst theme by saves; until then, say plainly
in the brief that engagement is unmeasured.

## Step 4 — Sub-specialists (sequence, same $RUN_ID)

**You make every API call below, not the sub-specialist.** A spawned subagent in this runtime
cannot reach `/api/team/*` at all: run 331 on 2026-08-15 verified that every request carrying the
team credential is refused by the session permission classifier before dispatch, while the same
URL without the header returns a normal 401 from the app. This is the identical failure #673 fixed
for `social-publish-gate` — same fix, applied here to `inventory-sentinel`, `promo-manager`,
`loyalty-referral-manager`, `product-manager`'s weekly pass, and `program-manager`. Each one
returns its findings to you as data; **you relay them verbatim**, immediately after each
sub-specialist returns, before moving to the next:

```bash
# a targeted suggestion (inventory-sentinel, promo-manager, loyalty-referral-manager,
# product-manager, program-manager all hand you zero or more of these)
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"strategy","targetTeam":"<team>","category":"other",
       "kind":"<kind>","suggestion":"<verbatim>","cxRisk":"<risk>","dedupeKey":"<if given>"}'

# a decision or step event under YOUR $RUN_ID, agentRole set to whichever sub-specialist produced it
curl -s -X POST "$BASE_URL/api/team/event" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"runId":'"$RUN_ID"',"eventType":"decision","agentRole":"<sub-specialist name>","summary":"<verbatim>"}'

# promo-manager's calendar proposal only
curl -s -X POST "$BASE_URL/api/team/calendar" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"propose", ...<verbatim>}'
```

Verbatim is the contract: you do not soften a finding, upgrade a risk rating, or invent a
suggestion for a sub-specialist that returned nothing. This is the same trust model Step 4a-style
relays run on elsewhere in the fleet, and it is backed the same way — every endpoint re-validates
its payload server-side, so a relay error still cannot write something the API itself would refuse.

1. `inventory-sentinel` — catalog stock/price sweep → hands you targeted suggestion payloads + a
   scoreboard decision to relay.
2. `promo-manager` — MAP-guarded promo designs for the coming window → hands you kind `promo`
   suggestion payloads + calendar proposals to relay. **Category-sale license (owner direction 2026-08-16, ticket #3738):**
   promo-manager proposes at least one category-level sale per month, priced anywhere down to
   break-even (`wholesale_cost` is the floor, never below), always inside the MAP rules
   (`mapAllowsAdvertisedDiscount`, hardened in #3675/PR #703: `map_price == original_price`
   products get no discount framing anywhere). Every proposal is a `marketing_calendar` promo
   window plus a suggestion row so the channels fire together per
   `docs/store-team/social-crossplatform-strategy.md` §7: X, email, SMS, social, and site say the
   number; Instagram raises the theme without the number. Execution unchanged: the owner still
   creates the code in Shopify Admin (or the valve-gated 2b path below mints approved rows);
   nothing in this license mints a discount by itself.
2b. **Execute approved promos (valve-gated).** For promo rows the owner has already approved, mint
   the Shopify discount code. Gated by `promo_execute_enabled`, default **off**; with the valve off
   the script exits without touching Shopify. It is fail-closed: a row flagged with a MAP conflict,
   missing an explicit window, or with no resolvable eligible product is refused (loud owner email +
   ticket note), never minted. On a clean mint the owner is emailed the code and window and a note
   link lands on the ticket. Idempotent: rows already carrying a minted note are skipped.

   ```bash
   tsx scripts/execute-approved-promos.ts
   ```
3. `loyalty-referral-manager` — retention/referral moves → hands you kind `program` suggestion
   payloads to relay.
4. `product-manager` (**review-only in the weekly run**) — do NOT call the import-candidate action
   endpoint here; the daily product routine (`routine-product-daily.md`) owns queue execution.
   Aggregate the week's daily product/import decisions (its `decision` events), judge whether the
   catalog mix matches the brief's theme, surface systemic patterns (a brand over-imported, category
   gaps, a growing needs-review or price-drop backlog), and hand catalog direction into the brief —
   plus a `decision` summary for you to post under your own `$RUN_ID`.
5. `program-manager` (run last) — audits `docs/store-team/trackers/*.md` against each
   milestone's evidence probe, recomputes status + RAG per the trackers README, and hands you a
   `decision` payload per RAG change + an audit scoreboard payload to post. **Before invoking it,
   paste in the cross-team event history and `pipeline_settings`/valve state you fetched in Step 2**
   (or wherever your Inputs step gathers it) — it has no way to fetch either itself. It reports each
   milestone's **status** only in those events and the Program Status brief section (a RED tracker
   line is a report, never a suggestion row — a status has no executor and can never reach a
   terminal state on the bus), hands you a suggestion payload to relay **only when a milestone
   genuinely needs work done** and then in an executable kind (`code` for R-DEV, `instructions` for
   agent-editor, **never** `process`) with `dedupeKey:'tracker:<milestone-tag>'` so a re-file is a
   no-op, opens a docs-only tracker PR itself (`pm/tracker-<date>`, never merged by the PM, and
   **not merged by the release engine either**: the `pm/` prefix is not engine-eligible and the
   allowlist does not cover `docs/store-team/trackers/`, so the PR waits for the owner — this part
   is `git`/`gh`, not a team-API call, so `program-manager` still does it directly; see
   `program-manager.md` step 6) when rows changed, and hands you a
   **Program Status** section (overall RAG + top risks + owner asks per program) to include
   verbatim in the brief. It also verifies **routine coverage**, and the scope is *derived from
   `routine-schedule.md`, never enumerated here*:

   - Read every routine row in `docs/store-team/routine-schedule.md`. For each, decide whether it is
     **expected to run**: a trigger id is recorded, or its gating valve is on.
   - Expected-to-run with no `homepage_team_runs` row in the last 7 days → a `process` suggestion
     payload for you to relay. A stalled drain backs its queue up quietly (the daily product routine
     is the easiest to miss).
   - **Gating valve ON but no trigger id recorded** → also a mandatory `process` suggestion payload.
     This is the half-enabled state: on 2026-07-28 the trend-scout and social-trend-scout valves
     were turned on and their triggers were never created, so two lanes were live-but-dead and three
     downstream consumers starved with nothing reporting it.
   - Valve off AND no trigger → expected-missing, exempt, say nothing.

   Never hardcode routine numbers in this step or in the trigger prompt. That list has gone stale
   twice (it read "2-14" while the manifest listed 19 routines, so everything added after 2026-07-23
   was outside the watchdog's scope by construction), and a coverage check that cannot see a new
   lane is worse than none, because it reports "zero misses" either way.

None of these five call `/api/team/*` themselves — you relay every event and suggestion/calendar
payload under `$RUN_ID` with the originating agent's name in `agentRole`, per the curl shapes above.

## Step 5 — Publish the brief

One markdown doc: the week's focus, per-team directives (homepage, social, ads, email, content +
pricing/merch notes), an explicit stop-doing list, the **Program Status** section handed over by
`program-manager` (included verbatim), metrics behind every call. The content section
sets the week's blog topic slate, category-mix tuning (guides/comparisons/care/wellness-basics),
and campaign tie-ins with the marketing calendar; the daily content playbook
(`docs/store-team/routine-content-daily.md`) tolerates a brief without a content section, so omit
it honestly rather than padding.

Include a **Video Plan** section when the video team is enabled (`video_team_enabled`), and omit it
honestly when it is not. The Video Plan is a spend allocation, not a wish list: video generation is
metered fal.ai spend, unlike your Max-billed reasoning. It contains: (a) the week's volume and tier
split (e.g. "3 videos: 1 premium presenter + 2 standard"), (b) a slate table with one row per video
(product handle, formula from the library in `.claude/agents/video-producer.md`, tier, target
platforms, source tie-in such as the anchor blog post or calendar theme, and the metric that
justifies the pick), and (c) the selection reasoning. Selection rubric, hard gates first: in stock,
published, has real Shopify product photography, MAP status known, concept passes voice and
doctrine. Then weights: hero/theme alignment 30 (the week's headliner is auto-included as the
premium video; video commits to the headliner and does NOT chase homepage rotations), realized
margin x order velocity 25, PDP-video-gap conversion opportunity 15, blog tie-in 15 (name the
source post slug; its answers become the script), new-import freshness 5 (standard tier only,
never premium), promo/calendar window fit 5. Mirror the slate into `metricsJson.videoPlan`, and in
the retro read `video_jobs` outcomes (approval rate, cost per approved video, regen rate; owner
metrics_json once posts go out). Approval rate under ~40% sustained is a stop-doing signal: pause
the slate and fix the formula via an instructions suggestion before spending more.

Include a **Social Plan** section (mandatory whenever the social team is enabled), because posting
volume should track what is actually happening on the site and in the industry that week rather than
running at a flat cadence (owner direction, all-hands 2026-08-08). It lists this week's
social-worthy events, each with a suggested post count and format so `social-media-manager` can size
the day's drafting to real context (the social routine reads this section at run start, Step 2, and
`docs/store-team/routine-social-daily.md` already treats it as the volume driver):

- new aisles/drops going live and any featured brand of the week (tag the verified brand handle);
- `marketing_calendar` promos and campaign themes landing in the window (coordinate with
  `merch-calendar`, which marks the rows that deserve Instagram coverage);
- adopted trend briefs from **both** trend scouts (`trend-scout` community discourse and
  `social-trend-scout` format trends);

with the baseline stated plainly: **at least 1 post/day, no zero days**, scaling to 2-4/day only on
weeks that actually have site events or hot trends, per the context-driven cadence in
`docs/store-team/instagram-campaigns.md`. When nothing social-worthy is happening, say so and hold
the baseline rather than manufacturing volume. Omit the section honestly only when the social team is
disabled.

Include a **Catalog Pipeline** section (and mirror its numbers into `metricsJson`), **profit-first**:
lead with orders/margin attributable to newly-imported SKUs and to price-dropped SKUs (order line
items; GA4 item-list/PDP only when the week has ≥300 sessions, else flag the number heuristic) —
that tie-back is the headline. Throughput is the supporting detail, sourced from the product-manager
and inventory-sentinel events: queue depth (pending/watching); auto-imported A/B + Tier-C and
product-manager approve/reject/watch this week (and any `skippedDueToCap` days); enrichment stuck
(`imported AND enriched_at IS NULL`) and quality-gate parks (`enrich_failed_at`); publish stuck
(`enriched_at set, published_at NULL`) and rough import→live latency; new-arrival products surfaced;
price drops detected / repriced / routed. Per `mission-brief.md`: throughput is an activity metric,
never a win — a high import count with zero new-product orders is a **stop-doing** signal.

**Label the enrich/publish health line measured or UNMEASURED — never carry a stale "dead" verdict.**
The strategy sandbox has no Shopify creds, so an enrich/publish claim inferred from Shopify-less
signals is not a measurement. Read the ground truth from Neon: `import_candidates.enriched_at` /
`published_at` max, plus the enrich-stuck (`imported AND enriched_at IS NULL`) and publish-stuck
(`enriched_at set, published_at NULL`) counts. `DATABASE_URL` is available and the daily product
routine already reads it this way (psql / neon-http over HTTPS, since port 5432 is firewalled); do
the same here. If that read genuinely cannot run this pass, label the Catalog Pipeline health line
**UNMEASURED** (or defer it to the product-daily run, which reads live DB) rather than repeating a
prior "dead"/"chain is broken" verdict. A stale "dead" premise wrongly throttles the product-daily
routine's Step-3 approval volume, and it has in fact been carried for three consecutive briefs while
live DB showed enrich+publish keeping pace daily.

```bash
curl -s -X POST "$BASE_URL/api/team/brief" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"publish","weekStart":"<YYYY-MM-DD>","brief":"<markdown>","metricsJson":{...}}'
```

## Step 6 — Route cross-team suggestions

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"strategy","targetTeam":"<team>","category":"other","kind":"<kind>","suggestion":"<concrete change + evidence>","cxRisk":"low"}'
```

## Step 7 — Spend + finish

Log Max tokens (`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"strategy-weekly",...}`), then:

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<brief focus + rows CLOSED since last run + top retro verdicts>"}}'
```
