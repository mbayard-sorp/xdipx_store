# Routine: Daily Content Writer (content-writer)

The playbook for the scheduled blog content routine. Entry agent: `content-writer`. One post per
run, drafted as a Sanity `blogPost` (`status:'draft'`), dual-gated through `emma-empathy-reviewer`
(voice) and `sex-wellness-reviewer` (subject-matter accuracy), and published live only on a clean
PASS from both, with a hero image attached, **and** the
`content_team_autopublish` valve being on. Every published post carries a hero image (owner
directive, 2026-07); heroless is not an accepted published state. Valve off = the post stays a
Sanity draft for the owner; the routine still runs and reports.

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
`valves.autopublish` from the response; it decides Step 6. Also capture
`contentSlot` (`{weekday, expectedCategory, fallbackCategory}`): the server
computes today's weekday in PT and the matching category slot; it is
authoritative for Step 3. Never compute the weekday yourself. The gate enforces the
`content_team_enabled` kill switch, `content_team_daily_cents` (500), and `content_team_max_runs`
(3; the extra runs are gate-retry headroom on double days (Sat trend-scout, Sun SEO curation,
Wed podcast review), never a second post; migration 068 versions both values).

## Step 2: Load doctrine + context (data only)

1. `docs/emma-voice.md` core + **blog addendum** (mandatory, before any words). Either missing →
   STOP and report.
2. `docs/store-team/mission-brief.md` (binding); the strategy brief (`GET /api/team/brief`); it may
   carry a per-team `content` section with the week's topic slate.
3. Calendar (`GET /api/team/calendar`) for campaign tie-ins.
4. Topic sources, in priority order: the `seoContentBrief` queue (primary — planned weekly by the
   seo-curator routine from the keyword bank), then `docs/store-team/content-plan.md` (the static
   backlog is the floor, still binding for slot themes and standing rules), then the strategy
   brief's content section. If content-plan.md is ever missing in your checkout, fall back
   gracefully and record a `step` event saying you did.

## Step 3: Topic selection + slug pre-check

Today's category is the gate response's `contentSlot.expectedCategory` (server-computed in PT;
use `contentSlot.fallbackCategory` only per the Thursday/Sunday rules below). The map mirrors
the weekly rhythm in content-plan.md §2 (Mon/Wed guides, Tue/Fri real-talk, Thu podcast-notes,
Sat care, Sun comparisons/wellness-basics flex); if the two ever disagree, trust the gate and
file a suggestion.

**Thursday first-check (podcast-notes):** query the pending podcast brief before anything else:

```groq
*[_type == "podcastReviewBrief" && status == "pending"] | order(publishedDate desc)[0]
```

Found → today's post is the podcast review (content-plan §8A shape): patch the brief
`status:'drafted'` immediately (idempotent claim), carry its takeaways, agree/pushback angles,
`productAngles` (stock-verified before embedding), `suggestedTitle`, and episode URL into Step 4,
and use category `blogCategory-podcast-notes`. None pending → fall back to a care post and note it
in the retro.

**Real Talk days (Tue/Fri):** pick the next unwritten topic from content-plan §8B (or a queued
brief that fits the problem→resolution shape), and write to the §8B structure — problem in the
reader's words, root cause plainly, resolution with products only in the "What helps" section.

Otherwise pick, in order, logging the source as a `step` event:

1. **Brief queue (primary):**

```groq
*[_type == "seoContentBrief" && status == "queued" && category == $todayCategory]
  | order(coalesce(plannedFor, "9999") asc, priority desc)[0]
```

2. Any queued brief regardless of category (a filled queue beats rhythm purity).
3. The next unwritten entry in the content-plan §3 backlog.
4. The strategy brief's content section.

When a brief is chosen: patch it `status:'drafted'` immediately (idempotent claim; a crashed run
leaves it drafted, and the curator re-queues stale drafted briefs weekly), and carry its
`targetQuery`, keyword refs, `embedHints`, and `internalLinks` into Step 4.

Before drafting anything, GROQ-check the slug:

```groq
*[_type == "blogPost" && slug.current == "<slug>"][0]._id
```

If it exists, take the next queued topic and re-check. One `step` event with the chosen topic,
slug, and source (brief / plan / strategy-brief fallback).

## Step 4: Draft the post (Sanity, status draft)

Create idempotently: doc `_id` is `blogPost-${slug}`, `createIfNotExists` then `patch`. Fields:

- `title`; `slug` (`{_type:'slug', current}`); `author` (reference to the Emma `blogAuthor` doc,
  `_ref:'blogAuthor-emma'`); `category` (reference to a `blogCategory`: `blogCategory-guides` |
  `blogCategory-comparisons` | `blogCategory-care` | `blogCategory-wellness-basics` |
  `blogCategory-podcast-notes` | `blogCategory-real-talk`; the first four are seeded and
  published — `createIfNotExists` the podcast-notes/real-talk docs on first use, title "Podcast
  Notes" / "Real Talk"); `tags[]`; `excerpt` (required); `publishedAt` (required, fresh ISO,
  today); `status:'draft'`.
- `body` (Portable Text): `normal`/`h2`/`h3`/`h4`/`blockquote` blocks plus `blogProductEmbed`
  (`{productHandle, ctaLabel, layout}`), `blogPullQuote`, `blogCta`.
- `seoTitle` (max 70 chars) and `seoDescription` (max 160 chars), both filled.
- `relatedPosts` (max 3, when relevant); `featured` and `noIndex` default off.
- `heroImage` + `heroImageAlt`: ask `media-manager` (reuse-first). The request MUST (a) name the
  post's `blogProductEmbed` handles as the mandatory subject pool and (b) point at §0 "Daily post
  hero" of `docs/notebook-team/image-brief.md`, which is binding: the hero's subject is one of the
  post's embedded products placed via its real Shopify photo as the ref image — never a domestic
  metaphor object (mugs, blankets, towels, candles, decor). Do not invent ad-hoc scene subjects in
  the request; setting ideas are fine, subjects are not. **A hero image is mandatory on every
  published post** (owner directive, 2026-07). If imagery genuinely cannot be produced, hold the
  post as a Sanity `status:'draft'` for the owner and say so in the retro; do not publish it
  heroless. Heroless is no longer an accepted published state, and a houseware/domestic-metaphor
  subject never is either.

Content quality bar (all mandatory, from `.claude/agents/content-writer.md`):

- Question-form H2s; each section leads with the direct answer.
- A `## Frequently asked questions` section in every post.
- At least one honest `blogProductEmbed` where it genuinely helps (in-stock products only,
  verified first). CTAs from the charter whitelist.
- Ranked buying guides use category `guides` (guides posts get ItemList JSON-LD generated from
  their blogProductEmbed blocks automatically).
- Emma authorship in the first person ("I") or editorial "we", never third person about Emma:
  the copy never refers to her by name or narrates her as a character (no "Where does Emma add
  nuance?", "Emma's take"); name a section by its substance instead. AI-guide honesty (never
  "I tried/tested/own it"); no medical claims; no
  prices or discount claims in body text (MAP-safe, evergreen); internal links to relevant
  collections and `/products/{slug}` PDPs (the embedded `productHandle` also drives the inbound
  PDP/collection backlinks — verify it resolves 200 and is in stock; doctrine in
  `docs/store-team/internal-linking.md`); no em dashes; no countdowns or urgency.

**Keyword weaving (when the topic came from a brief):** the brief's `primaryKeyword` term shapes
the title/H1; its 3-5 `secondaryKeywords` land naturally in H2s and body copy (never stuffed);
every `questionKeywords` term becomes a question-form H2 or an FAQ entry; the brief's cluster's
rejected/flagged terms are the avoid list:

```groq
*[_type == "seoKeyword" && cluster._ref == $clusterId && (status == "rejected" || flagged == true)].term
```

Use `embedHints` only after verifying the handles are in stock; use `internalLinks` where natural.

One `step` event (`phase:'draft'`) with title, slug, category, embed handles.

## Step 5: Dual gate (voice + accuracy; mandatory, no publish path without both)

Two reviewers, both binding, sequenced so a cheap voice failure never spends the accuracy pass:

1. **Voice gate first.** Run the full draft (title, excerpt, body, SEO fields, embed CTA labels)
   through `emma-empathy-reviewer` against the charter + blog addendum. A voice **BLOCK** on
   sight → the post stays `status:'draft'`, file the suggestion row, skip the accuracy gate
   entirely, and go to Step 7.
2. **Accuracy gate.** Otherwise run the same draft through `sex-wellness-reviewer` (it
   web-verifies external claims: anatomy/physiology, "research shows" statistics, materials and
   safety, realistic expectations, terminology).
3. **One shared rewrite cycle.** Merge BOTH gates' REVISE feedback into exactly one rewrite,
   then re-run both gates once. A second non-PASS from either is treated as BLOCK.
4. **BLOCK** (from either gate, either cycle) → the post stays `status:'draft'`, and you file a
   suggestion row (`team:'content'`, kind `process`) with the reviewer's reasons.
5. **Sources insertion (mechanical, after the final PASS).** The accuracy gate returns 0-2
   citations it actually resolved. Append them as a `## Sources` section (source name + link,
   no new prose claims). This insertion is exempt from re-gating. If the gate reported
   `[web: degraded]`, follow its strip/soften instructions and ship without a Sources section;
   zero citations is a valid outcome.

Two `step` events: `phase:'voice-gate'` and `phase:'accuracy-gate'`, each with the verdict and
cycle count (the accuracy event also records citation count and `web: ok|degraded`).

## Step 6: Publish (only if both gates PASS, a hero is attached, and the valve is open)

Only when Step 5 ended in PASS from BOTH gates, a `heroImage` is attached (Step 4; mandatory on
every published post), **and** Step 1's `valves.autopublish` is `true`:

1. Patch the doc: `status` → `'published'` (keep `publishedAt` as set in Step 4).
2. Flush the blog caches:

```bash
curl -s -X POST "$BASE_URL/api/revalidate/blog" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"slug":"<slug>"}'
```

3. If the topic came from a brief: patch the brief `status` → `'published'` and set
   `publishedPost` to a reference to the blogPost doc. A `podcastReviewBrief` gets
   `status` → `'published'` and `blogPostRef` set to the post's slug.

Valve off, either verdict not PASS, or no hero image could be produced → leave the post as a Sanity
draft, post an event saying exactly that, re-queue the brief if one was claimed
(`seoContentBrief` → `'queued'`, `podcastReviewBrief` → `'pending'`), and finish the run as
succeeded. Draft-only is a valid, honest outcome, not a failure; publishing a post with no hero
image is not.

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
