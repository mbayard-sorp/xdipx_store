# Routine — Weekly Business Research (adult-business-researcher)

The playbook for the weekly adult-business research step. Entry agent: `adult-business-researcher`.
Output: **up to 3 pending `researchBrief` docs** in Sanity, consumed by the daily social routine's
LinkedIn drafting step (see `docs/store-team/routine-social-daily.md`). This routine writes no
posts, publishes nothing, and generates no images. RESEARCH-ONLY.

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
targetPlatform: 'linkedin'   // open for reuse by other channels later
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
3. Existing briefs (Sanity GROQ): `*[_type=="researchBrief"]{topic, status, createdAt}`.
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
`targetPlatform:'linkedin'`, `createdBy` = run id, `createIfNotExists`. Max 3 briefs, hard cap.

## Step 5 — Finish

One `event` per brief (phase `brief`), spend log (`feature:'social-research'`), then the final run
update (`status:'succeeded'`, summary = topics + claim counts + confidence mix + key sources). If
nothing was written, the summary says exactly why.
