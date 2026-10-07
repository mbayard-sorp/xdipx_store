# Routine — Weekly Business Research (adult-business-researcher)

The playbook for the weekly adult-business research step. Entry agent: `adult-business-researcher`.
Output: **up to 3 pending `researchBrief` docs** in Sanity, consumed by `store-strategist`'s weekly
brief (see `docs/store-team/routine-weekly-strategy.md`). This routine writes no posts, publishes
nothing, and generates no images. RESEARCH-ONLY.

**Retargeted off LinkedIn 2026-08-25 (ticket #5432). The research is not the problem; keep it.**
LinkedIn has no publisher and has never published a post, so the three briefs this routine had
produced (ids 37, 38, 69) sat `pending` against a `social_freq_linkedin` of 1/day, approved research
with nowhere to go. `targetPlatform` below now points pending briefs at `store-strategist`'s weekly
brief instead of the dead social step, so the work keeps flowing rather than aging in Sanity.
LinkedIn drafting is off pending a publisher; the lane reopens on one config flip the day a
publisher exists, and this retarget is a routing fix, not a cancellation of LinkedIn or of the
research itself.

Runs on the **Max subscription** under the **social** team's gate and budget. Cadence: weekly,
**Thursday 16:00 UTC** (after the daily 14:00 social run; `social_team_max_runs` must be ≥2 for
Thursdays to carry both).

## The researchBrief doc shape

```
_id:           researchBrief-<topic-slug>-<YYYY-MM-DD>
_type:         'researchBrief'
topic:         string
suggestedAngle: text        // one-sentence thesis for the post; not final copy
whyItMatters:  text          // who the reader is and why they'd care
targetPlatform: 'strategy'   // retargeted 2026-08-25, ticket #5432 (was 'linkedin', dead lane)
claims: [{
  claim:       text
  sourceUrl:   url
  sourceName:  string        // publication/report, for the owner's quick scan
  retrievedAt: date          // when the agent read it, NOT the source's publish date
  confidence:  'high' | 'medium' | 'low'
}]
status:        'pending' | 'used' | 'expired'
usedByPostId:  number | null // social_posts.id once drafted from, for traceability
createdBy:     string        // run id
createdAt:     datetime
```

Enablement note: the doc type must exist in the Studio schema before briefs render nicely there
(additive-only, via the Sanity workspace — same path `podcastReviewBrief` took). The write path
itself works regardless; the Studio schema is a rendering concern.

## Step 0 — Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"social","runType":"research"}'   # → $RUN_ID
```

## Step 1 — Gate

`GET /api/team/gate?team=social&excludeRun=$RUN_ID`. If `ok:false` → post skipped, stop.

## Step 2 — Load context

1. `docs/store-team/mission-brief.md` and the strategy brief (`GET /api/team/brief`).
2. The LinkedIn addendum in `docs/emma-voice.md` — it defines what a usable angle looks like
   (industry-first, brand byline, professional register) — and `docs/ads-policy.md` (binding
   creative rules, most conservative setting).
3. **Before counting pending briefs, mark consumed ones `used`.** Read the latest strategy brief's
   `Research briefs consumed` line (`docs/store-team/routine-weekly-strategy.md` §"Marking a brief
   consumed") and, for every `_id` it lists that is still `status:'pending'` in Sanity, patch that
   doc to `status:'used'`. store-strategist has no Sanity write tool and can only *list* a brief as
   consumed; this routine has write access and is the only actor that can turn that list into the
   status flip. A brief listed as consumed in a published strategy brief is consumed — do not wait
   for further confirmation. Skipping this step is exactly how the queue deadlocks: six already-read
   briefs sat `pending` for three straight weeks (2026-09-24) because nothing ever flipped their
   status, so the cap below could never fall and this routine could never file another brief.
4. Existing briefs (Sanity GROQ): `*[_type=="researchBrief"]{topic, status, createdAt}`, read AFTER
   the consumed-marking above so the count reflects genuinely unread briefs only.
   **More than 5 already `pending` → stop honestly; the queue is ahead of the posting cadence.**
   Never re-cover a topic that is `pending` or was `used` in the last 60 days.

## Step 3 — Research honestly

1-3 topics per run (WebSearch + WebFetch): market-size reports, retail and category trends,
consumer-behavior surveys, credible trade press. Prefer primary sources; a claim cites what was
actually read (abstract ≠ report). Lane discipline: business and commerce data only — no medical
or therapeutic claims as a brief's thesis, no product-mechanics framing, nothing that couldn't sit
under a professional lens.

## Step 4 — Write the briefs

Per topic: 2-4 claims, each with `sourceUrl`, `sourceName`, `retrievedAt` (today), and an honest
`confidence` flag; a one-sentence `suggestedAngle`; a `whyItMatters` reader note. Status `pending`,
`targetPlatform:'strategy'`, `createdBy` = run id, `createIfNotExists`.

**Publish every brief — a draft is invisible to the only reader.** (ticket #13669) `status:'pending'`
is this doc type's entire approval gate; there is no owner review step for a research brief, so a
brief that lands as a Sanity *draft* (the default write shape unless the publish step is taken
explicitly) is not "pending", it is unreadable. `routine-weekly-strategy.md`'s Step 2 query runs
against the published perspective on purpose — store-strategist has no Sanity write access and no
way to tell a draft from a real doc, so a draft silently never reaches it. Two 2026-10-01 briefs
(`researchBrief-halloween-record-spending-adult-costumes-2026-10-01`,
`researchBrief-sexual-wellness-retail-consolidation-2026-10-01`) sat as drafts for a week this way,
one of them load-bearing on the store's one dated seasonal opportunity. After `createIfNotExists`,
publish the document (`npx tsx scripts/sanity-content-cli.ts publish --id <id>` is the sanctioned
HTTP-transport path for a scheduled run; the Sanity MCP connector's own publish call works the same
way when available) so it exists only at its real `_id`, never at `drafts.<_id>`. Max 3 briefs, hard
cap, same as before — this changes how a brief is written, not how many.

**Catch up any already-stuck draft before writing new ones.** Query
`*[_type=="researchBrief" && _id in path("drafts.**")]{_id}` (the drafts perspective). Publish every
result the same way. This is a one-time repair for briefs written before this fix landed; once every
brief this routine writes is published at creation, the query should always return empty, and an
empty result is the expected steady state, not a sign anything is wrong.

## Step 5 — Finish

One `event` per brief (phase `brief`), spend log (`feature:'social-research'`), then the final run
update (`status:'succeeded'`, summary = topics + claim counts + confidence mix + key sources). If
nothing was written, the summary says exactly why.
