# Routine A — Daily Merchandiser

The exact playbook the scheduled "Daily Merchandiser" cloud routine runs. Entry agent:
`homepage-orchestrator`. It **auto-publishes content** (products featured, copy, imagery, section
order within the stable shell) and **never touches code**. Code/layout changes are Routine B.

This routine runs on the **Max subscription** — it does its own reasoning and calls the site only for
**data** and **spend logging**. It must never call the site's Anthropic-keyed endpoints (that flips
free Max work to metered).

---

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

```bash
curl -s "$BASE_URL/api/homepage-team/gate" \
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

## Step 2 — Read context (data only)

Emit an event, then gather inputs:

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/event" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"runId":'"$RUN_ID"',"eventType":"step","phase":"read","agentRole":"homepage-orchestrator","summary":"Reading calendar + GA4 + Nalpac top-100 + catalog"}'
```

- **Marketing calendar** — today's theme / promo window / weekday-vs-weekend variant (`merch-calendar`
  rows in `marketing_calendar`).
- **GA4** — engagement/conversion via the `google-analytics` MCP. **Treat sparse early traffic as weak
  signal**; run heuristic/best-practice-led until volume is meaningful.
- **Nalpac top-100** — `fetchAllNalpacFeeds()` → `inTop100Feed` (`app/lib/nalpac-feeds.server.ts`).
  Run `cleanDescription()` for the `ft.`/`in.` encoding (don't strip `in.` after digits — those are
  inches). Cross-reference to Shopify by `nalpacSku`.

## Step 3 — Emma chooses the features

Run `emma-copywriter` (inside this routine, Max-billed — **not** via the site's copy endpoint) over
the cleaned top-100 list to pick the **brand-representative hero + featured products** and draft the
copy (taglines, hero asides, section blurbs). Gate the result through `emma-empathy-reviewer` (the
Emma voice gate). Emit a `decision` event recording which products Emma chose and why.

## Step 4 — Imagery (reuse or generate)

Hand the chosen products to `media-manager`. **Reuse-before-generate:** it checks Shopify Files for a
fitting asset first; only generates (fal.ai primary → Imagen → existing catalog photo) when none
exists. Before each generation, re-check the gate / your tracked `remainingCents`; respect
`homepage_team_max_images`. `generateImage()` logs image cost — but to keep the dashboard live, also
post the spend yourself (Step 6) when the routine drives generation.

## Step 5 — Write Sanity + Shopify (diff before write)

**Know your render surfaces (verified 2026-07-01 — do NOT write blind).** The live homepage is the
`variant b` storefront (`StorefrontHome.tsx`). It renders team content from ONLY these Sanity places:

| Lever | Where | Renders on |
|---|---|---|
| Curated rails | `emmaCuratedRail` docs (`target:"homepage"`, `status:"live"`, `active:true`) **referenced** in `singleton.homepage.sections[]` as `emmaCuratedRailRef`. `buildHomeContentBlocks()` resolves `productHandles`. The storefront shows up to `MAX_TEAM_RAILS` (4); with zero refs it falls back to the algorithmic discovery rails. | storefront `/` |
| Notebook | `editorialTiles` block in `singleton.homepage.sections[]` (`tiles[]`: label/body/link/linkLabel/emoji/image). | storefront `/` |
| Announcement ticker | `announcementBar` messages in `singleton.homepage` (the layout pins it site-wide). | all pages |

**Do NOT** expect these to change the storefront: the hero (derived from discovery `featured`, not
`singleton.emmaHero` — that hero doc is a legacy/variant-A lever), and `productCarousel` /
`promoBanner` / `categoryGrid` / `playTogetherBanner` / `testimonials` blocks (the storefront ignores
them). **Those blocks DO still render on `/discover` (variant A)** — so edit their copy if you want,
but never delete them without checking `/discover`. Never ship invented `testimonials` (FTC + brand).

To merchandise: create/refresh `emmaCuratedRail` docs (Emma heading/eyebrow/aside + valid Shopify
handles, verify each resolves 200), wire 2–4 into `singleton.homepage.sections`, and refresh
`editorialTiles`. **Snapshot the current doc revision first** (last-good for healthcheck rollback).
**Diff before write:** patch only changed fields; skip no-op publishes. **Content only** — never change
URLs, canonical, section structure, or components here (that is Routine B, PR-gated).

## Step 6 — Record spend

For any Max reasoning tokens (so the dashboard shows token counts at $0):

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/spend" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"kind":"tokens","source":"agent-sdk","model":"claude-sonnet-4-6","feature":"homepage-merchandise","inputTokens":12000,"outputTokens":3000,"caller":"homepage-orchestrator"}'
```

For each image generated (the real metered cost):

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/spend" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"kind":"image","feature":"homepage-images","model":"fal/flux-dev","count":1,"caller":"media-manager","productId":"<gid>","sku":"<nalpacSku>"}'
```

Both land in `api_token_log` and surface on `/admin/usage`. Image rows are what the $/day cap governs.

## Step 7 — Self-validate the render

Fetch `/` and assert: HTTP 200, the LCP hero image is present, and the homepage JSON-LD is valid and
contains **no "daily deal" framing**. If validation fails, do not leave a broken homepage live — note
it and let the healthcheck/rollback path restore the last-good Sanity revision; record a `failed`
status with the error.

## Step 8 — Finish + event trail

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
- **Emma voice gate is mandatory** — all customer-facing copy passes `emma-empathy-reviewer`.
