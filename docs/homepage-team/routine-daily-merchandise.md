# Routine A — Daily Merchandiser

The exact playbook the scheduled "Daily Merchandiser" cloud routine runs. Entry agent:
`homepage-orchestrator`. It **auto-publishes content** (products featured, copy, imagery, section
order within the stable shell) and **never touches code**. Code/layout changes are Routine B.

This routine runs on the **Max subscription** — it does its own reasoning and calls the site only for
**data** and **spend logging**. It must never call the site's Anthropic-keyed endpoints (that flips
free Max work to metered).

---

## Before Step 0 — Voice charter (mandatory, before any content is generated)

Read `docs/emma-voice.md`. All copy written or edited in this run must comply. If the charter is
missing from the checkout, STOP and report instead of writing copy.

## Preconditions

- The team callback secret is available to the routine as `HOMEPAGE_TEAM_TOKEN` (falls back to
  `CRON_SECRET`). Sent on every API call as `x-team-secret: $HOMEPAGE_TEAM_TOKEN` (or
  `Authorization: Bearer $HOMEPAGE_TEAM_TOKEN`).
- `BASE_URL` is the deployed site origin (e.g. `https://xdipx.com`).
- Hard `maxTurns` (~12–16). If you loop without converging, stop and report — do not re-run yourself.

The four endpoints, all secret-guarded:

| Call | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/homepage-team/gate` | Kill switch + remaining budget + run-cap state. Call before any paid step. |
| `POST` | `/api/homepage-team/run` | Run lifecycle (`start` → id; `update`). |
| `POST` | `/api/homepage-team/event` | Per-step activity feed for the dashboard. |
| `POST` | `/api/homepage-team/spend` | Record Max tokens + image cost into `api_token_log`. |

---

## Step 0 — Start the run

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/run" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" \
  -H "content-type: application/json" \
  -d '{"op":"start","runType":"merchandise"}'
# → { "id": 123 }
```

Capture `id` (call it `$RUN_ID`). Use it on every `/event` and `/run update` below.

## Step 1 — Gate (abort if not ok)

Always pass your own `$RUN_ID` as `excludeRun`. Step 0 already inserted your
run row as `running`, so without it the concurrency guard refuses YOUR OWN run
as `run_in_progress`. Other running rows still lock as intended.

```bash
curl -s "$BASE_URL/api/homepage-team/gate?excludeRun=$RUN_ID" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN"
```

Response shape (`GateResult`):

```jsonc
{
  "ok": true,                 // false → DO NOT proceed
  "enabled": true,
  "reason": "disabled" | "run_in_progress" | "over_budget" | "over_run_cap", // only when ok=false
  "dailyCents": 1500,
  "spentCents": 40,
  "remainingCents": 1460,     // hard-stop image gen when this hits 0
  "runsToday": 1,
  "maxRunsPerDay": 4
}
```

If `ok` is `false`, post a skipped status and **stop**:

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/run" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'"$RUN_ID"',"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}'
```

Otherwise note `remainingCents` — it's your hard image-budget ceiling for the run.

## Step 1b: Load the mission brief (binding)

Read `docs/homepage-team/mission-brief.md` and treat it as binding for the rest of the run. It
overrides older routine framing where they conflict; the voice charter at `docs/emma-voice.md`
overrides everything, always. If the brief is missing from the checkout, STOP and report instead of
merchandising blind.

## Step 1c: Monday only, before any merchandising

Skip this step Tuesday through Sunday. On Mondays, run both of these in order before Step 2:

1. **Competitor recon.** WebFetch the homepages of Lovehoney, Spectrum Boutique, In The Groove, and
   Too Timid, plus one new competitor you have not reviewed before. Write a short recon memo into
   the run log (an `/event` row) per mission brief section 4: what each leads with, what they do
   badly, one idea worth adapting, and one thing we will do this week that none of them do. The
   memo must change something concrete this week (the theme, a rail concept, a tile, or a Routine B
   backlog item). Recon that changes nothing is a wasted step.
2. **Set the week's theme.** Invoke `merch-calendar` to set or confirm this week's theme in
   `marketing_calendar` per mission brief section 3. Themes are editorial curricula, not sales
   events; the recon memo from the previous step feeds this decision.

## Step 2 — Read context (data only)

Emit an event, then gather inputs:

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/event" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"runId":'"$RUN_ID"',"eventType":"step","phase":"read","agentRole":"homepage-orchestrator","summary":"Reading calendar + GA4 + Nalpac top-100 + catalog"}'
```

- **Marketing calendar** — today's theme / promo window / weekday-vs-weekend variant (`merch-calendar`
  rows in `marketing_calendar`). Per mission brief section 3, read today's theme from the calendar
  and merchandise inside it: the hero, rails, and tiles picked below all live within the week's theme.
- **GA4** — engagement/conversion via the `google-analytics` MCP. **Treat sparse early traffic as weak
  signal**; run heuristic/best-practice-led until volume is meaningful.
- **Nalpac top-100** — `fetchAllNalpacFeeds()` → `inTop100Feed` (`app/lib/nalpac-feeds.server.ts`).
  Run `cleanDescription()` for the `ft.`/`in.` encoding (don't strip `in.` after digits — those are
  inches). Cross-reference to Shopify by `nalpacSku`.

## Step 2b — Yesterday's scoreboard

Before picking anything new, score what was featured yesterday:

- **GA4:** `getHomepageSignals()` (`app/lib/ga4.server.ts`) returns, alongside the existing
  engagement fields, `addToCarts` / `checkouts` / `purchases` / `revenue` plus an `itemLists`
  breakdown by `itemListName` (items viewed in list, added to cart, purchased, item revenue). Map
  yesterday's featured handles to their views (`topProductPages`) and to their rail's `itemLists`
  row to get per-slot views, add-to-carts, and purchases.
- **Orders + margin:** read yesterday's row from `daily_profit_summary` (Neon) for realized orders,
  revenue, and margin.

Log a `decision` event stating, per slot, **keep** or **drop**, with the numbers that justified it:

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/event" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"runId":'"$RUN_ID"',"eventType":"decision","phase":"read","agentRole":"homepage-orchestrator","summary":"Scoreboard: hero <handle> keep (views X, ATC Y, purchases Z); rail slot <handle> drop (0 ATC, margin unknown)"}'
```

**Threshold rule:** below **300 sessions/week**, this scoreboard is RECORDED but does not
auto-trigger swaps. The numbers are too sparse to act on mechanically; judgment stays with the
orchestrator, which keeps merchandising on margin + heuristics until traffic clears the threshold.

## Step 3 — Emma proposes, the orchestrator scores

Run `emma-copywriter` (inside this routine, Max-billed, **not** via the site's copy endpoint) over
the cleaned top-100 list to propose the **brand-representative hero + featured candidates** and draft
the copy (taglines, hero asides, section blurbs). Gate the copy through `emma-empathy-reviewer` (the
Emma voice gate). Emma owns brand fit and voice; she does not own the final slate.

The orchestrator (with `homepage-cro` as the pick gate) then scores the candidates on:

- **Margin:** `msrp` minus `wholesale_cost`, per unit. **Nothing ships with unknown margin**: if
  `wholesale_cost` is missing for a candidate, swap it out or resolve the cost first.
- **Price-point spread:** the featured set spans price points across the rails, and there is
  **always one entry rail under $30**.
- **`deal_score`:** from the feed-processor scoring, as a tiebreaker within brand-fit picks.
- **Stock depth:** enough inventory to sell for the whole placement window; thin stock loses to a
  comparable pick with depth.

**MAP rule (imported from `merch-calendar`):** never feature a MAP=MSRP product on any
discount-styled surface. MAP=MSRP products cannot advertise a discount at all; MAP<MSRP uses MAP as
the floor. Defer pricing claims to catalog data, never invent a discount.

Emit a `decision` event recording the proposed candidates, the scores, and the final slate with why.

## Step 4 — Imagery (reuse or generate, and place)

Hand the chosen surfaces to `media-manager`. **Reuse-before-generate:** it checks existing **Sanity**
assets (homepage art lives in Sanity, not Shopify Files) for a fitting image first; only generates when
none fits. Imagery follows mission brief section 2: the product is the star — pass the product's real
Shopify photo as a Kontext reference (`--ref-image`) for every product-linked surface, or use sensual
human context (lingerie on a body, skin, playful tension) matched to what the surface sells. Housewares
still-lifes with no product are banned, and so are dark/moody/candlelit scenes: bright daylight or
high-key studio light, saturated color-block backdrops, the product bold and large in frame. Fun and
curiosity-inspiring is the target; exposed genitalia, nipples, and sex acts are the hard limit.

Run this as a loop, one image at a time, tracking a per-run `imagesSoFar` counter:

1. **Re-check the gate before each generation** (or decrement your tracked `remainingCents`). Hard-stop
   the loop when `remainingCents <= 0` OR `imagesSoFar >= homepage_team_max_images` (12). The gate now
   also returns `imagesToday` + `maxImagesPerDay` and refuses with `reason:'over_image_cap'` server-side,
   so a stray extra call is rejected — but stop yourself first.
2. `media-manager` runs `scripts/gen-homepage-image.ts --target block|tile|promo --block-key <k>
   [--tile-key <k>] --prompt "<scene>" --alt "<screen-reader alt>" [--ref-image <shopify-photo-url>]
   --images-so-far <n> --run-id $RUN_ID --caller "merch-routine/<surface>"`. `--run-id` keeps the
   script's internal gate re-check from refusing on your own running row. `--ref-image` routes to
   FLUX Kontext so the real product appears in the scene — use it whenever the surface links to a
   product.
3. The script **gates → generates (fal FLUX → Imagen) → uploads to a Sanity asset → patches
   `singleton.homepage` → posts spend → prints a JSON manifest**. Read the manifest; if
   `placed:true`, increment `imagesSoFar`. If `skipped:true`, stop the imagery loop.

**Placement happens here, in Step 4** (the script patches the image directly). Do NOT re-post image
spend in Step 6 — the script already posts exactly one `{kind:'image'}` row per placed image (it runs
`generateImage` with internal cost-logging disabled so the row is not double-counted). Step 6 is for
**Max reasoning tokens only.**

## Step 5 — Write Sanity + Shopify (diff before write)

**Know your render surfaces (verified 2026-07-01 — do NOT write blind).** The live homepage is the
`variant b` storefront (`StorefrontHome.tsx`). It renders team content from ONLY these Sanity places:

| Lever | Where | Renders on |
|---|---|---|
| Hero copy | `singleton.emmaHero` (Sanity `emmaHeroSettings`): `eyebrow`, `headline`, `body`, `pullQuote`. The storefront hero reads these directly (PR #190), field-by-field fallback to hardcoded defaults when unset. The hero PRODUCT is pinned via `singleton.emmaHeroStorefront`, not set here. | storefront `/` |
| Hero product pin + CTA | `singleton.emmaHeroStorefront` (Sanity `emmaHeroStorefront`): `featuredProductHandle` pins the hero image and peek link to one product (bare Shopify handle, no `/products/` prefix); unset means the hero image rotates with the 60s discovery shuffle. `primaryCtaLabel` (whitelist only) + `primaryCtaLink` deep-link the primary CTA. | storefront `/` |
| Curated rails | `emmaCuratedRail` docs (`target:"homepage"`, `status:"live"`, `active:true`) **referenced** in `singleton.homepage.sections[]` as `emmaCuratedRailRef`. `buildHomeContentBlocks()` resolves `productHandles`. The storefront shows up to `MAX_TEAM_RAILS` (4); with zero refs it falls back to the algorithmic discovery rails. | storefront `/` |
| Notebook | `editorialTiles` block in `singleton.homepage.sections[]` (`tiles[]`: label/body/link/linkLabel/emoji/image). | storefront `/` |
| Wayfinder mosaic | `wayfinderMosaic` block in `singleton.homepage.sections[]` — the "Find your way in" tiles + "Discover You" promo. `tiles[]` (label/link/emmaAside/image, 3-4) + `promo` (eyebrow/heading/emphasis/body/cta/image). Empty/unset → the storefront renders its hardcoded fallback tiles (never blank). Place tile images via `--target tile --tile-key`, the promo via `--target promo`. | storefront `/` |
| Announcement ticker | `announcementBar` messages in `singleton.homepage` (the layout pins it site-wide). | all pages |

**Hero rule (updated for PR #190, pin added after run 10):** `singleton.emmaHero` IS the storefront
hero copy source. The storefront hero renders its `eyebrow`, `headline`, `body`, and `pullQuote`
fields, falling back field-by-field to hardcoded defaults when a field is unset. Refreshing that doc
is an explicit daily team lever: keep the hero copy in step with today's featured pick and calendar
theme, through the same Emma voice gate and diff-before-write rules as every other surface.

**The hero PRODUCT is pinned, not left to rotation.** Run 10 confirmed the failure mode: hero copy
targeted one product while the hero image reshuffled to unrelated products every 60 seconds, so copy
and image mismatched most of the time. Whenever you rotate the hero (new featured pick chosen in
Step 3), you MUST also set `featuredProductHandle` on `singleton.emmaHeroStorefront` to that pick's
Shopify handle (bare handle, no `/products/` prefix), and point `primaryCtaLink` at
`/products/{handle}` in the same patch. The pin makes the storefront's `featured[0]` (hero image,
LCP preload, peek link) that exact product. An unknown handle logs a warning and falls back to
rotation, so verify the handle resolves 200 before writing it. Leave the field unset ONLY when
there is deliberately no product-specific hero copy live.

**Do NOT** expect these to change the storefront: `productCarousel` / `promoBanner` / `categoryGrid`
/ `playTogetherBanner` / `testimonials` blocks (the storefront ignores them). **Those blocks DO
still render on `/discover` (variant A)**, so edit their copy if you want, but never delete them
without checking `/discover`. Never ship invented `testimonials` (FTC + brand).

To merchandise: create/refresh `emmaCuratedRail` docs (Emma heading/eyebrow/aside + valid Shopify
handles, verify each resolves 200), wire 2–4 into `singleton.homepage.sections`, refresh
`editorialTiles`, refresh `singleton.emmaHero` copy to match the day's slate, and pin the hero by
setting `featuredProductHandle` + `primaryCtaLink` on `singleton.emmaHeroStorefront` to today's
featured pick.

**Pairing merchandising is mandatory:**

- **Every `emmaCuratedRail` includes at least one accessory/pairing item**, chosen via the featured
  product's `accessory_product_ids` metafield, with its `pairing_why` copy as the Emma rationale
  (voice-gated like all copy). If a featured product has no accessories mapped, pick a catalog-level
  pairing (lube with a toy, cleaner with anything) and say why in the rail aside.
- **One rail per week is a taxonomy rail**, keyed off `mood_tags` or `matters_tags` rather than a
  product family, so the guided-selling taxonomy gets a standing homepage surface.

**Emma's Presets lineup (mission brief section 6):** the team owns `emmaPreset` publish state.
Whenever the theme or hero changes, re-curate: max 5 published, each matching the theme and landing
on 3+ live products (tags must come from the live vocab — `scripts/dump-discovery-vocab.ts`).
Unpublish everything else (unpublished docs keep their drafts, so this is reversible). If nothing
fits the theme, draft a new preset with emma-copywriter (label + narratorCopy voice-gated, tags from
live vocab only), verify matches, publish it in place of one of the 5.

**Snapshot the current doc revision first** (last-good for healthcheck rollback).
**Diff before write:** patch only changed fields; skip no-op publishes. **Content only** — never change
URLs, canonical, section structure, or components here (that is Routine B, PR-gated).

## Step 6 — Record spend

For any Max reasoning tokens (so the dashboard shows token counts at $0):

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/spend" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"kind":"tokens","source":"agent-sdk","model":"claude-sonnet-4-6","feature":"homepage-merchandise","inputTokens":12000,"outputTokens":3000,"caller":"homepage-orchestrator"}'
```

**Do not post image spend here.** `scripts/gen-homepage-image.ts` already posts exactly one
`{kind:"image", feature:"homepage-images", ...}` row per placed image in Step 4 (and disables
`generateImage`'s internal cost log so it is not double-counted). Re-posting here would double the
image spend and trip the $/day cap at half budget. For reference, the row the script sends:

```jsonc
// posted BY the script, not by you:
{"kind":"image","feature":"homepage-images","model":"fal/flux-dev","count":1,"caller":"merch-routine/<surface>"}
```

Token rows (above) and image rows (from Step 4) both land in `api_token_log` and surface on
`/admin/usage`. Image rows are what the $/day cap governs.

## Step 7 — Self-validate the render

Fetch `/` and assert: HTTP 200, the LCP hero image is present, and the homepage JSON-LD is valid and
contains **no "daily deal" framing**. If validation fails, do not leave a broken homepage live — note
it and let the healthcheck/rollback path restore the last-good Sanity revision; record a `failed`
status with the error.

## Step 8 — Finish + event trail

Before posting the final update, run the Definition of Done checks from mission brief section 10 and
fold the results into the summary:

- Count the live page's product/collection links versus /discover links. Report the ratio in the
  summary and flag it if under the 70 percent target.
- Confirm every image on the page passed the mission brief section 2 self-review or is Shopify
  product photography.
- The summary states: today's theme, the hero product and why, what changed versus yesterday, and
  what will change next run. On Mondays, include the recon memo.

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/run" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'"$RUN_ID"',"update":{"status":"succeeded","finished":true,"currentPhase":"done","summary":"Featured 4 top-100 picks; 1 image generated, 3 reused; ~$0.12 spend"}}'
```

Emit `/event` rows throughout (one per phase/decision at minimum) with `agentRole`, `phase`, and an
optional `transcriptRef` pointing at the full verbatim transcript in private Vercel Blob. The dashboard
reads these for the live status + conversation viewer.

---

## Run-update payload reference (`RunUpdate`)

`POST /run {op:'update', id, update:{ ... }}` accepts:

```jsonc
{
  "status": "running" | "succeeded" | "failed" | "skipped" | "rolled_back",
  "currentPhase": "read" | "pick" | "imagery" | "publish" | "validate" | "done",
  "currentAgent": "homepage-orchestrator" | "emma-copywriter" | "media-manager" | ...,
  "summary": "human-readable one-liner",
  "prUrl": "https://github.com/...",   // Routine B only
  "error": "message on failure",
  "finished": true,                     // sets finishedAt
  "incrementAttempt": true              // circuit-breaker counter
}
```

## Event payload reference (`TeamEvent`)

`POST /event`:

```jsonc
{
  "runId": 123,                         // required (number)
  "summary": "Emma picked the Coral wand as hero", // required (string)
  "eventType": "step" | "message" | "tool" | "decision" | "error", // default "step"
  "agentRole": "emma-copywriter",       // optional
  "phase": "pick",                      // optional
  "transcriptRef": "blob://runs/123/pick.json" // optional — full transcript in Blob
}
```

---

## Hard rules for this routine

- **Gate before every paid step; hard-stop at `remainingCents <= 0`.**
- **Reuse imagery before generating; respect `max_images`.**
- **Diff before write; skip no-op publishes.**
- **Content only — never code, never structure, never canonical/URLs.** Structural ideas → Routine B.
- **Reasoning stays on Max** — never call the site's Anthropic-keyed copy/enrich endpoints.
- **One run at a time** — the gate enforces it (`reason:'run_in_progress'`); exit if you slipped past.
- **Emma voice gate is mandatory** — all customer-facing copy passes `emma-empathy-reviewer` against
  `docs/emma-voice.md` (the canonical voice charter).
