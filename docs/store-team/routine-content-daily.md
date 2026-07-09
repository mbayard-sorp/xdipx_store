# Routine: Daily Content Writer (content-writer)

The playbook for the scheduled blog content routine. Entry agent: `content-writer`. One post per
run, drafted as a Sanity `blogPost` (`status:'draft'`), voice-gated through `emma-empathy-reviewer`,
and published live only on a clean PASS **and** the `content_team_autopublish` valve being on.
Valve off = the post stays a Sanity draft for the owner; the routine still runs and reports.

Runs on the **Max subscription**. Recommended cadence: daily. Never call the site's Anthropic-keyed
endpoints (`app/lib/claude.server.ts`, `/api/generate-copy`, `/api/admin/blog/generate-outline|draft|seo`,
enricher, IVR); the site is for data reads and spend logging only. Sanity writes go through the
Sanity MCP tools.

Auth on every `/api/team/*` call and the revalidate endpoint: header `x-team-secret: $TEAM_TOKEN`
(falls back to `$HOMEPAGE_TEAM_TOKEN`, then `$CRON_SECRET`). `BASE_URL` = deployed origin.

## Step 0: Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"content","runType":"content"}'   # → $RUN_ID
```

## Step 1: Gate

```bash
curl -s "$BASE_URL/api/team/gate?team=content&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

If `ok:false`: post `{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}`
and **stop**: skip honestly, never work around the gate. If `ok:true`, capture
`valves.autopublish` from the response; it decides Step 6. The gate enforces the
`content_team_enabled` kill switch, `content_team_daily_cents` (300), and `content_team_max_runs`
(2; the second run exists only to retry a voice-gate REVISE, not to write a second post).

## Step 2: Load doctrine + context (data only)

1. `docs/emma-voice.md` core + **blog addendum** (mandatory, before any words). Either missing →
   STOP and report.
2. `docs/store-team/mission-brief.md` (binding); the strategy brief (`GET /api/team/brief`); it may
   carry a per-team `content` section with the week's topic slate.
3. Calendar (`GET /api/team/calendar`) for campaign tie-ins.
4. Topic queue: `docs/store-team/content-plan.md` (binding: weekly slot themes, the 30-day
   backlog, and standing rules). If the file is ever missing in your checkout, fall back
   gracefully: derive today's topic from the strategy brief's content section, and record a `step`
   event saying you did. A brief without a content section is also tolerated: derive from the
   brief's overall focus and say so.

## Step 3: Topic selection + slug pre-check

Pick the next unwritten topic. Before drafting anything, GROQ-check the slug:

```groq
*[_type == "blogPost" && slug.current == "<slug>"][0]._id
```

If it exists, take the next queued topic and re-check. One `step` event with the chosen topic,
slug, and source (plan / brief / fallback).

## Step 4: Draft the post (Sanity, status draft)

Create idempotently: doc `_id` is `blogPost-${slug}`, `createIfNotExists` then `patch`. Fields:

- `title`; `slug` (`{_type:'slug', current}`); `author` (reference to the Emma `blogAuthor` doc,
  `_ref:'blogAuthor-emma'`); `category` (reference to a `blogCategory`: `blogCategory-guides` |
  `blogCategory-comparisons` | `blogCategory-care` | `blogCategory-wellness-basics`; these docs are
  seeded and published); `tags[]`; `excerpt` (required); `publishedAt` (required, fresh ISO,
  today); `status:'draft'`.
- `body` (Portable Text): `normal`/`h2`/`h3`/`h4`/`blockquote` blocks plus `blogProductEmbed`
  (`{productHandle, ctaLabel, layout}`), `blogPullQuote`, `blogCta`.
- `seoTitle` (max 70 chars) and `seoDescription` (max 160 chars), both filled.
- `relatedPosts` (max 3, when relevant); `featured` and `noIndex` default off.
- `heroImage` + `heroImageAlt`: ask `media-manager` (reuse-first). If imagery fails or nothing
  fits, **publish without a hero rather than skipping the day**.

Content quality bar (all mandatory, from `.claude/agents/content-writer.md`):

- Question-form H2s; each section leads with the direct answer.
- A `## Frequently asked questions` section in every post.
- At least one honest `blogProductEmbed` where it genuinely helps (in-stock products only,
  verified first). CTAs from the charter whitelist.
- Ranked buying guides use category `guides` (guides posts get ItemList JSON-LD generated from
  their blogProductEmbed blocks automatically).
- Emma authorship with AI-guide honesty (never "I tried/tested/own it"); no medical claims; no
  prices or discount claims in body text (MAP-safe, evergreen); internal links to relevant
  collections and `/products/{slug}` PDPs; no em dashes; no countdowns or urgency.

One `step` event (`phase:'draft'`) with title, slug, category, embed handles.

## Step 5: Voice gate (mandatory, no publish path without it)

Run the full draft (title, excerpt, body, SEO fields, embed CTA labels) through
`emma-empathy-reviewer` against the charter + blog addendum.

- **PASS** → proceed to Step 6.
- **REVISE** → exactly one rewrite cycle, then re-review. A second non-PASS is treated as BLOCK.
- **BLOCK** → the post stays `status:'draft'`, and you file a suggestion row
  (`team:'content'`, kind `process`) with the reviewer's reasons.

One `step` event (`phase:'voice-gate'`) with the verdict and cycle count.

## Step 6: Publish (only if PASS and the valve is open)

Only when Step 5 ended in PASS **and** Step 1's `valves.autopublish` is `true`:

1. Patch the doc: `status` → `'published'` (keep `publishedAt` as set in Step 4).
2. Flush the blog caches:

```bash
curl -s -X POST "$BASE_URL/api/revalidate/blog" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"slug":"<slug>"}'
```

Valve off (or verdict not PASS) → leave the post as a Sanity draft, post an event saying exactly
that, and finish the run as succeeded. Draft-only is a valid, honest outcome, not a failure.

## Step 7: Retro + finish

Compare against the plan and last run's post (published? still draft? which gate verdict?). One
`decision` event (`phase:'retro'`); real lessons → suggestion rows via:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"content","targetTeam":"<team-or-omit>","category":"other","kind":"process","suggestion":"<lesson>","cxRisk":"low"}'
```

Blog-surface component/layout ideas → suggestion with `targetTeam:'homepage'` (code is always a
reviewed PR, never this routine's). Log spend
(`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"content-blog",...}`),
then finish:

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<slug + gate verdict + published|draft + retro note>"}}'
```

## Appendix: Enablement runbook

The routine ships inert. To turn it on, in order:

1. **Apply migration 054 in prod:** `npx tsx scripts/apply-migrations.ts --from 054` (seeds the
   `content_team_*` keys in `pipeline_settings`).
2. **Flip the kill switch:** `content_team_enabled` → on, in the Content tab of
   `/admin/homepage-team`.
3. **Open the autopublish valve:** `content_team_autopublish` → on (owner approved day-one
   auto-publish for this team; leave off if you want a draft-review period instead).
4. **One supervised manual run:** fire the routine by hand, watch the run row and events on
   `/admin/homepage-team?team=content`, verify the post lands in Sanity (and live, if the valve is
   on) and the revalidate call returned ok.
5. **Confirm the schedule** (routine #9 in `docs/store-team/routine-schedule.md`): the desktop
   scheduled task `xdipx-daily-content-writer` already exists on the owner's machine and fires
   daily at 8am local Pacific (approx 15:00 UTC) from the `~/Claude/xdipx-deploy` checkout. It
   runs only while the Claude app is open, unlike the cloud triggers for routines 1-8, and until
   steps 1-2 are done every fire no-ops honestly at the gate.

**Kill-switch drill:** flipping `content_team_enabled` off stops runs at the gate (Step 1 skips
honestly). Flipping `content_team_autopublish` off degrades to draft-only without stopping the
routine: posts keep landing in Sanity as drafts for the owner to publish.
