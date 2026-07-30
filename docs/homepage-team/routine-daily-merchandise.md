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

1. **Competitor recon.** Gather positioning intel on Lovehoney, Spectrum Boutique, In The Groove,
   and Too Timid, plus one new competitor you have not reviewed before. **Default to `WebSearch`**
   and label the memo as search-sourced (not live-observed). DTC competitor homepages are typically
   bot-blocked: a `WebFetch` of a competitor homepage usually returns HTTP 403 (Lovehoney, Spectrum
   Boutique, Too Timid, Dame all 403'd run 53) or a DNS failure (inthegroove.co NXDOMAIN'd), so try
   a live fetch at most once per source and fall back to search immediately rather than burning
   turns retrying blocked fetches. Use any reachable source. Write a short recon memo into the run
   log (an `/event` row) per mission brief section 4: what each leads with, what they do badly, one
   idea worth adapting, and one thing we will do this week that none of them do. The memo must
   change something concrete this week (the theme, a rail concept, a tile, or a Routine B backlog
   item). Recon that changes nothing is a wasted step.
2. **Set the week's theme, and keep the runway stocked.** Invoke `merch-calendar` to set or confirm
   this week's theme in `marketing_calendar` per mission brief section 3. Themes are editorial
   curricula, not sales events; the recon memo from the previous step feeds this decision.

   Same step, before you finish: ensure at least **4 future weeks** of `planned` rows exist, and
   propose new ones if not. Nothing else refreshes this table — the last row was minted 2026-07-07
   and the runway ran to 2026-09-07, after which every routine that reads "today's theme" would have
   found nothing. Also close out past-dated rows still marked `active` so the calendar states what is
   true today.

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
- **Newest imports** — products tagged `new-arrival` (set automatically the moment the import
  pipeline activates a product; see `publishEnrichedProducts` in `app/lib/import-enrich.server.ts`)
  are a sourcing signal, not a standing feature. The routine may surface a handful of them in an
  OPPORTUNISTIC `emmaCuratedRail` ("New Arrivals", Nº06 slot) when the week's slate has room — it
  must never become a permanent fixture (it still counts against the 4-rail ceiling in Step 5), and
  its copy goes through the same Emma voice gate as every other rail.
- **Price drops (now cheaper)** — when `pricing_costsync_enabled` is on, a Nalpac supplier-cost drop
  auto-reprices carried SKUs via the v2 engine (see `nalpac_price_history.synced_at` for recently
  synced SKUs; `inventory-sentinel` surfaces the biggest margin gains in the brief). These are also
  a sourcing signal for an OPPORTUNISTIC "Now cheaper" `emmaCuratedRail` (Nº06, same 4-rail-ceiling
  and voice-gate rules as New Arrivals). **Hard MAP guard before any such SKU is eligible:** it must
  pass the same MAP rule below (never a MAP=MSRP product on a discount-styled surface) — check the
  live price against MAP (`mapAllowsAdvertisedDiscount` in `gmc-metafields.server.ts`) before you
  frame it as cheaper; and no urgency/countdown framing (voice charter). A real lower price is a
  fact you may state plainly, not a scarcity play.

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
This rule governs **metric-driven** swaps only: it exists so we do not optimize on noise. It is not
a reason to republish yesterday's page. See Step 2c.

## Step 2c — Sameness diff (before you publish anything)

Freshness is a per-run obligation, not a weekly one (mission brief section 10). Before writing to
Sanity, diff today's planned slate against yesterday's run summary, surface by surface:

| Surface | What to compare |
|---|---|
| Hero | pinned `featuredProductHandle` + hero headline |
| Rails | rail lineup: titles, order, and product handles |
| Wayfinder mosaic | tile art (asset ids), tile labels, and tile links |
| Discover You promo | promo image asset id + heading |
| Couples band | `playTogetherBanner` image + copy |
| Announcement | `announcementBar` messages |

**At least two surfaces must change every run, and copy alone does not satisfy it: at least one of
the two must be imagery or product selection.** Record the diff as a `decision` event and restate it
in the final summary. A run that publishes a page visually identical to yesterday is a FAILED run
unless the summary names an explicit hold reason (deliberate editorial hold, gate refusal, a named
supply or data problem). "Nothing scored well enough to swap" is not a hold reason.

**How this and the 300-sessions rule fit together, so they do not read as contradictory:** the
sparse-data rule blocks *optimizing on noise*: you may not swap a slot because yesterday's four
sessions said so. The sameness diff mandates *editorial cadence*: the page changes because a shop
window changes, decided on margin, theme, and judgment. Sparse traffic changes HOW you pick; it
never licenses shipping yesterday's page again.

## Step 2d — Inbound suggestions (read your own mail)

Other agents file findings *at* this team and, until 2026-07-29, nothing ever read them. This
playbook only ever wrote suggestions. inventory-sentinel's out-of-stock carousel findings (#52-54,
filed 07-20) sat approved and unexecuted for nine days while the routine ran daily.

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"list","targetTeam":"homepage","status":"approved","orderBy":"age"}'
```

Act on up to **3 per run**, oldest first, and only ones this run can actually do: a product swap, a
copy fix, an image change — content, within the gates that already govern Step 5. Anything needing
code or layout is not yours; leave it for the ticket lane.

**Close what you acted on.** A row you executed must not be re-read tomorrow:

```bash
-d '{"op":"transition","id":52,"to":"applied","actor":"agent:homepage-orchestrator","note":"swapped OOS SKU out of the Nº02 rail, replaced with <handle>"}'
```
Only `process` and `strategy` rows can be closed this way (`RUN_CLOSE_KINDS`). A `campaign`,
`promo`, `instructions`, or `code` row returns 409 — those have their own executor, or the owner's,
and are not yours to end. Note them instead.


If you looked at a row and are deliberately not acting (out of scope, no longer true, needs code),
post `{"op":"note", ...}` saying which and why, and leave the status alone. Never close a row you did
not actually execute: a false `applied` is worse than an aging row, because it looks handled.

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

## Step 3.5 — The day's visual scheme (`homepage-art-director`)

Between the picks and the imagery, invoke `homepage-art-director` with today's theme and the final
slate. It returns a one-page scheme for the day: the ground tint (rotating within the doctrine
ground lock), a per-slot image concept naming its doctrine §4 archetype and its
`docs/homepage-team/image-prompt-library.md` scaffold, a prop or color rhyme tying the slots
together, and an explicit statement of what changes visually today versus yesterday. It posts the
scheme as an `/event` row (`eventType:'decision'`, `agentRole:'homepage-art-director'`).

The scheme's prompt briefs are the starting point for every generation in Step 4, and `media-manager`
does not invent its own scenes on a merchandise run. The art director never picks products and
never publishes.

## Step 4 — Imagery (generate to the floor, place, reuse only as fallback)

Hand the art director's per-slot briefs to `media-manager`.

**Fresh-art floor (owner direction 2026-07-27, replaces reuse-before-generate on this step).** When
today's hero product or the calendar theme changed since yesterday, GENERATE new art for at least
three of the swappable slots: hero block art, the 3-4 wayfinder tiles, the Discover You promo, the
couples band. The Emma portrait is excluded. Reuse an existing **Sanity** asset for a slot only
after two failed vision-gate attempts on that slot (homepage art lives in Sanity, not Shopify
Files). **A run with a changed hero or theme that generated zero images is a definition-of-done
failure.** Reuse-before-generate stays correct for product packshots and PDP art.

Why the flip: reuse-first was written into six instruction layers, and the team generated zero
images in 15 consecutive merchandise runs, spending $0.43 in 11 days against a $600/day budget and a
100-image/day cap. The caps were never the problem, so they are unchanged: `homepage_team_max_images`
and the $/day cap are still hard ceilings, you still re-gate before every generation, and the vision
gate and the no-text-in-pixels rule still reject anything that fails them. The floor is a mandate to
try, never a licence to ship a bad image.

**Pick the archetype before prompting (doctrine §4, binding).** Every generation declares one
archetype and starts from that surface's scaffold in `docs/homepage-team/image-prompt-library.md`:

| Surface | Archetype | Scaffold |
|---|---|---|
| Hero (block image) | **C** in-situ bright scene of the pinned pick, or **A** hand-on-product | "Hero" |
| Wayfinder tiles + promo | **B** color-block still for product tiles (one color-rhyme echo); **C** for human-context tiles | "Wayfinder / editorial tile", "Promo image" |
| Mood / photo / couples band | **C** in-situ bright scene | "Mood band / photo band" |
| Editorial / Notebook tiles | **D** metaphor macro | "Notebook" scaffold family |
| PDP macro / in-hand scale | **A** hand-on-product | "PDP macro / in-hand scale" |

Curated rails (`emmaCuratedRail`) have **no image field** — they render each product's real
Shopify photo; never generate art for them. Grounds only from coral-soft / plum-soft / paper (the
doctrine ground lock; sage stays an accent, not a ground); `--ref-image` mandatory for every
product-linked surface; no text in pixels. Full rules: doctrine §4 — do not restate them in
prompts, follow them.

Imagery follows mission brief section 2: the product is the star — pass the product's real
Shopify photo as a Kontext reference (`--ref-image`) for every product-linked surface, or use sensual
human context (lingerie on a body, skin, playful tension) matched to what the surface sells. Housewares
still-lifes with no product are banned, and so are dark/moody/candlelit scenes: bright daylight or
high-key studio light, tinted color-block backdrops from the doctrine ground lock, the product bold and large in frame. Fun and
curiosity-inspiring is the target; exposed genitalia, nipples, and sex acts are the hard limit.

Run this as a loop, one image at a time, tracking a per-run `imagesSoFar` counter:

1. **Re-check the gate before each generation** (or decrement your tracked `remainingCents`). Hard-stop
   the loop when `remainingCents <= 0` OR `imagesSoFar >= homepage_team_max_images` (read the live
   value from the gate response, do not assume the old default of 12). The gate now
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
| Notebook | The "From the Notebook" section **auto-populates** with the latest 3 published posts (homepage loader `getBlogPosts`), so fresh content reaches the homepage with no action from you. An `editorialTiles` block in `singleton.homepage.sections[]` (`tiles[]`: label/body/link/linkLabel/emoji/image) is an **optional override** — publish one only for a deliberate editorial pick, never just to keep the section current. **Two hard rules (owner direction 2026-07-21, after run 8 shipped a defective override):** (1) an override must never link products already merchandised in another section of the same page render (the wayfinder, rails, or grid) — duplicating the page's own products reads as filler, delete the override instead; (2) never publish an override tile without an `image` — an imageless override renders as an empty tinted plate and reads broken; auto-populate is always the better fallback. Doctrine: `docs/store-team/internal-linking.md`. | storefront `/` |
| Wayfinder mosaic | `wayfinderMosaic` block in `singleton.homepage.sections[]` — the "Find your way in" tiles + "Discover You" promo. `tiles[]` (label/link/emmaAside/image, 3-4) + `promo` (eyebrow/heading/emphasis/body/cta/image). Empty/unset → the storefront renders its hardcoded fallback tiles (never blank). Place tile images via `--target tile --tile-key`, the promo via `--target promo`. | storefront `/` |
| Couples band | `playTogetherBanner` block in `singleton.homepage.sections[]` — the "Play intimately together" band (heading/body/cta/image). It **does** render on the storefront (it is whitelisted in `homepage-payload.server.ts`); an unset image renders an imageless plate, so always place art. Place it via `--target block --block-key` like any other block image. | storefront `/` |
| Announcement ticker | `announcementBar` messages in `singleton.homepage` (the layout pins it site-wide). | all pages |

**Incoming slots (design-elevation P1 — do NOT patch before the shell PR lands).** These surfaces
are on the Routine B backlog and activate one by one as their reviewed PRs merge; their
`gen-homepage-image.ts` targets ship with those PRs. Until a slot's block exists in the storefront,
attempting to place content for it is a defect, not initiative:

| Incoming slot | What it becomes | Status check |
|---|---|---|
| "The Ten" ranked franchise | Nº 03 reframed as the finite "The Ten. Most picked right now" with mono numerals | exists once the Nº 03 shell PR merges |
| PDP macro / in-hand image row | Archetype A macro shots render on PDPs; until then Wave-1 macro generations are pre-staged assets only | exists once the PDP evidence-surfaces PR merges |
| Reviews pull-quote band | Conditional band between Nº 06 and Nº 07, real reviews only, suppressed below threshold | exists once the reviews-slot PR merges; NEVER seed with placeholder quotes |
| Committed tinted band | One full-bleed plum-soft/coral-soft band carrying white cards | exists once its shell PR merges |

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

**`playTogetherBanner` DOES render on the storefront** (the couples band). The old line in this
playbook telling you the storefront ignores it was false, and it is why the couples band was never
part of the daily loop: place its image and copy every run like any other surface, through the same
voice gate and diff-before-write rules.

**Do NOT** expect these to change the storefront: `productCarousel` / `promoBanner` / `categoryGrid`
/ `testimonials` blocks (the storefront ignores them). **Those blocks DO still render on `/discover`
(variant A)**, so edit their copy if you want, but never delete them without checking `/discover`.
Never ship invented `testimonials` (FTC + brand).

### Mandatory per-run surfaces

Every merchandise run touches all of these, not just the hero and rails:

1. **Hero** — `singleton.emmaHero` copy refreshed to the day's slate, and the hero pinned by setting
   `featuredProductHandle` + `primaryCtaLink` on `singleton.emmaHeroStorefront` to today's featured
   pick (bare handle, verify it resolves 200).
2. **Curated rails** — create/refresh `emmaCuratedRail` docs (Emma heading/eyebrow/aside + valid
   Shopify handles, verify each resolves 200) and wire 2–4 into `singleton.homepage.sections`.
   **Every published rail MUST set `ctaLink` to a collection that matches its products.** A blank
   `ctaLink` silently falls back to `/collections/best-sellers`, which is why a lube rail's "See all"
   landed on best sellers on 2026-07-27. **A published rail with a blank `ctaLink` is a
   definition-of-done failure.**
3. **Wayfinder mosaic tiles** — refresh `tiles[]` (art, labels, links) every run. **At least two of
   the tiles target collections rather than individual products**: the page needs image-led entry
   doors into categories, not three deep links to single PDPs.
4. **Discover You promo** — refresh `promo` (image + copy) in the same block; it follows the week's
   theme.
5. **Couples band** — refresh `playTogetherBanner` (image + copy). It renders; see above.
6. **Notebook override** — `editorialTiles` only for a deliberate editorial pick, under the two hard
   rules in the table above. Auto-populate is the better default.
7. **Announcement** — `announcementBar` messages in step with today's theme.

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

## Step 5b: Merchandised pages (v2: category pages, drop pages, the panel deck)

The team now owns daily upkeep of the merchandised category and drop pages
(`categoryPage-{pleasure,play,body,wear,discover}`, `dropPage-{new,on-sale}`) and the homepage panel
deck (`singleton.panelDeck`), under the same gate, budget, and image caps as everything above. A
page renders its merchandised layer only while its doc is `status: 'live'`; flipping a doc back to
`'draft'` is the per-page rollback. Everything below is content-only, same as the rest of this
routine: structure and components stay Routine B.

### Tiered rotation (owner-locked cadence, replaces "refresh everything daily")

- **Health sweep, every run, all live pages, $0.** The existing `/cron/homepage-healthcheck` sweeps
  every live merchandised page daily (report-only, deterministic) and posts results to the
  "Merchandised pages" panel on `/admin/homepage-team`. The routine READS those verdicts; it does
  not re-run the sweep itself. A red verdict on any page is worked before new merchandising.
- **Deep content refresh: exactly 2 category pages per day, on a 3-day cycle.** Day 1:
  pleasure + play. Day 2: body + wear. Day 3: discover + the drop pages. Then repeat. A deep
  refresh is the full per-page pass (masthead, shelves, blocks, anchors) through the write recipe
  below. Pages not in today's pair get the health sweep only.
- **Monday adds the calendar-theme pass on ALL pages** (alongside the Step 1c recon + theme work):
  every live page's masthead and theme-carrying blocks get checked against this week's theme, with
  light copy touches where the theme changed. This is a theme-consistency pass, not a second deep
  refresh.
- **New and Sale populate themselves.** Both drop pages auto-populate from their `sourceRule`; the
  routine never hand-picks their product lists. Only their masthead copy refreshes, and only
  weekly (on their day-3 slot).
- **Art cadence:** category-page art refreshes weekly, drop-page art is event-driven (a real drop
  or sale change, never a schedule), and the homepage keeps its existing daily fresh-art floor from
  Step 4 unchanged. Category and deck generations use the same `gen-homepage-image.ts` gate, the
  same image cap, and the same single spend row (`feature: homepage-images`) as homepage art:
  deck tiles via `--target tile --block-key <rowKey> --tile-key <itemKey> --doc-id
  singleton.panelDeck`, category blocks via `--target block --block-key <blockKey> --doc-id
  categoryPage-<handle>`. `--ref-image` stays required (or `--no-ref --no-ref-reason`).

### Start-of-run assertion: did yesterday's publish land?

Before making today's changes, fetch ONE surface yesterday's run changed (per its run summary) and
confirm the served HTML shows that change. If it does not, the first job of today's run is filing
and fixing that, not adding new changes on top of a publish that never landed. Record the check as
a `decision` event either way.

### The write recipe: batch, warm, wait once, verify

Sanity writes for these pages go through `npx tsx scripts/sanity-content-cli.ts` (alias
`npm run sanity:content`; commands `query` / `get` / `create-if-not-exists` / `create-or-replace` /
`patch` / `publish`, all supporting `--dry-run`). Never the Sanity MCP in a cloud routine.

Per page:

1. **Batch every write for the page first.** All `sanity:content` patches and the publish for one
   page happen back-to-back, with no waits between writes.
2. **Warm once, wait once.** After the last write, fetch the page once to warm it, then wait
   **5 minutes**, then fetch again and verify the served HTML shows the change. Never a blind
   20-minute sleep, never a wait per write.
3. **Know the cache before you judge the fetch.** Pages cache ~300s plus the edge window, and the
   `cached()` helper stores NEGATIVE results for TTL+60s, so a just-published page can take about
   6 minutes to appear. An early fetch tells you nothing; do not retry-hammer it. One warm, one
   5-minute wait, one verify.

### Per-page transactional publish

Finish and verify one page completely before touching the next. When a page verifies, emit a
per-page verdict event to the run log before moving on:

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/event" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"runId":'"$RUN_ID"',"eventType":"decision","phase":"publish","agentRole":"homepage-orchestrator","summary":"categoryPage-pleasure: published + verified (masthead, 3 shelves, anchors OK)"}'
```

A page that fails verification gets its verdict recorded honestly (what was written, what the
served HTML showed) and does not block the next page in the rotation, but the run summary must name
it and the failure is filed, same as Step 7's rules for the homepage.

### Per-page definition of done

A deep-refreshed category page is done when it has, verified in the served HTML:

- a masthead (voice-gated copy in step with the week's theme),
- populated shelves (real products, no empty shelf sections),
- working anchors (every block's `anchorId` resolves on the page),
- one FAQ block, and
- the trust block.

Never fabricate dial data (dial cards render only where `xdipx.sensation_dial` exists) and never
fabricate proof (reviews, counts, claims). A missing dial or an empty proof surface is correct
rendering, not a gap to fill with invented content.

### Seeding (one-time, reference only)

`npx tsx scripts/seed-category-pages.ts` (supports `--dry-run`) creates the page docs idempotently
via createIfNotExists, all in `draft`. The routine never re-seeds; going live is publishing a doc
to `status: 'live'` deliberately, one page at a time per the Phase E plan.

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

## Step 7 — Render-truth gate (does the published work actually appear?)

**Propagation window (corrected 2026-07-27; the old 60-second claim in this playbook was wrong).**
After the last Sanity patch the page needs roughly **15 minutes of blob warm, plus a 900-second edge
window, plus stale-while-revalidate** before a fetch reliably reflects the write. So either:

- **wait at least 20 minutes** after the last Sanity patch before fetching `/`, or
- `POST /cron/warm-homepage-b` (with the cron secret) and then **wait 5 minutes**.

A fetch made earlier than that reads stale HTML and tells you nothing. Do not treat an early fetch
as either a pass or a failure.

**Then run the gate. This is an assertion on content, not on status codes.** Fetch
`https://xdipx.com/` and assert, against what this run actually published:

1. HTTP 200, the LCP hero image is present, and the homepage JSON-LD is valid and contains **no
   "daily deal" framing**.
2. The **published hero product handle** appears in the returned HTML.
3. **Every published rail title** appears in the returned HTML.
4. **At least one published wayfinder tile headline** appears in the returned HTML.

**If fallback content renders where team content was published (hardcoded mosaic tiles, algorithmic
discovery rails, an imageless couples band), the run status is `failed`.** File a suggestion
(`POST /api/team/suggestion`, team `homepage`) describing which surface fell back and what was
published, let the healthcheck/rollback path restore the last-good Sanity revision if the page is
broken, and **do not report success**. A run that published invisible work is a failed run.

Why this replaced the old check: from 2026-07-24 to 2026-07-26 one malformed `emmaCuratedRail`
document rejected the whole `contentBlocks` promise, so every Sanity-driven section on the storefront
rendered its hardcoded fallback. The old gate ("HTTP 200 plus the hero renders") passed anyway,
because the hero is not deferred. Three consecutive days of published merchandising were invisible to
every visitor while the team reported success, and the owner found it before the team did.

**Hero check specifically:** confirm the hero against the Sanity source of truth
(`singleton.emmaHero` / `singleton.emmaHeroStorefront`) as well as the rendered page. If Sanity
reflects this run's hero copy/pin, the assertions above pass, and only ordering or a single copy
field lags, that is propagation, not a failed publish. Note it in the summary
("published; propagation pending, blob warm + 900s edge + SWR"). Propagation lag is never an excuse
for a missing rail title or a fallback section: those are content failures, and the wait rules above
exist precisely so you can tell the two apart.

## Step 7.5 — Post-publish design spot-check (`design-critic`)

After self-validation passes, run `design-critic` once against the live homepage: capture a 375px
screenshot (768/1440 optional on content-only runs), score the rubric against
`docs/design-doctrine.md`, and post the verdict + scores as an `/event` row
(`eventType:'decision'`, `agentRole:'design-critic'`).

- **PASS** — proceed to Step 8.
- **REVISE** — proceed, but file the defects as a suggestion
  (`POST /api/team/suggestion {op:'create', team:'homepage', kind:'process', ...}`).
- **BLOCK** — a doctrine hard rule is broken on the live page: trigger the existing Sanity
  last-good rollback path (same as a failed Step 7 validation), record status `rolled_back`.

Until the critic's calibration run is recorded (see its agent definition), treat any BLOCK as a
REVISE + suggestion instead of rolling back.

## Step 8 — Finish + event trail

Before posting the final update, run the Definition of Done checks from mission brief section 10 and
fold the results into the summary:

- Count the live page's product/collection links versus /discover links. Report the ratio in the
  summary and flag it if under the 70 percent target.
- Confirm every image on the page passed the mission brief section 2 self-review or is Shopify
  product photography.
- **Theme mapping:** state which hero, which rail, and which wayfinder tile carry this week's theme,
  one line each. A theme week without a stateable mapping is a failed run.
- **Sameness diff:** state the two-plus surfaces that changed versus yesterday (Step 2c), and confirm
  at least one of them is imagery or product selection rather than copy.
- **Fresh-art count:** state images generated this run. On a changed-hero or changed-theme day, fewer
  than three is a failure, not a saving.
- **Rail `ctaLink` audit:** confirm every published rail has a `ctaLink` matching its products, and
  that at least two wayfinder tiles point at collections.
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

## Retro step (before the final run update)

Close every run with a retro so the store-wide improvement loop has fuel
(see `docs/store-team/improvement-loop.md`):

1. Compare this run's picks against yesterday's scoreboard and the active weekly strategy brief's
   homepage directives (`GET /api/team/brief`; the gate's `activeBriefId` says one exists).
2. Record the verdicts as `phase:'retro'` events (`eventType:'decision'`).
3. When there's a real, repeatable lesson (a pick pattern that keeps underperforming, a step that
   keeps burning turns), file it on the improvement bus:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"homepage","category":"prompt","kind":"instructions","suggestion":"<concrete change + run examples>","cxRisk":"low","runId":'$RUN_ID'}'
```

The owner approves/dismisses from the dashboard; approved instruction-kind rows become
`agent-editor` PRs. Below 300 sessions/week, retro verdicts are recorded but never auto-trigger
swaps — same sparse-data rule as the scoreboard.

## Hard rules for this routine

- **Gate before every paid step; hard-stop at `remainingCents <= 0`.**
- **Meet the fresh-art floor on changed-hero / changed-theme days; respect `max_images` and the $/day
  cap as hard ceilings.** Reuse is the per-slot fallback after two failed vision-gate attempts, and
  stays the default only for product packshots and PDP art.
- **Diff before write; skip no-op publishes.** A no-op publish is not a no-op run: Step 2c still
  requires two changed surfaces or a stated hold reason.
- **Content only — never code, never structure, never canonical/URLs.** Structural ideas → Routine B.
- **Reasoning stays on Max** — never call the site's Anthropic-keyed copy/enrich endpoints.
- **One run at a time** — the gate enforces it (`reason:'run_in_progress'`); exit if you slipped past.
- **Emma voice gate is mandatory** — all customer-facing copy passes `emma-empathy-reviewer` against
  `docs/emma-voice.md` (the canonical voice charter).
