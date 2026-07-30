# Routine — Weekly Podcast Review (podcast-reviewer)

The playbook for the weekly podcast-review research step. Entry agent: `podcast-reviewer`. Output:
**one pending `podcastReviewBrief`** in Sanity, consumed by the daily content-writer on the
Thursday `podcast-notes` slot (see `docs/store-team/routine-content-daily.md` and
`docs/store-team/content-plan.md` §2). This routine writes no blog posts, publishes nothing, and
generates no images.

Runs on the **Max subscription** under the **content** team's gate and budget. Cadence: weekly,
**Wednesday**, so Thursday's content run finds a fresh brief.

## Step 0 — Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"content","runType":"manual"}'   # → $RUN_ID
```

## Step 1 — Gate

`GET /api/team/gate?team=content&excludeRun=$RUN_ID`. If `ok:false` → post skipped, stop.

## Step 2 — Load context

1. `docs/store-team/podcast-shortlist.md` — the owner-editable show list and rotation rules.
2. `docs/emma-voice.md` — editorial sensibility (the brief is internal, not voice-gated).
3. Existing briefs (Sanity GROQ): `*[_type=="podcastReviewBrief"]{showName, episodeTitle, episodeUrl, status}`.
   **A `pending` brief already waiting → stop honestly; never stack a second.**

## Step 3 — Pick the episode

Most recent unreviewed episode across the shortlist (WebSearch + WebFetch on show sites / major
platforms). Rotation rules from the shortlist are binding: no show two weeks running while another
has a fresh episode; skip promo-heavy, explicit-performance, or medical-advice-heavy episodes and
note the skip.

## Step 4 — Review honestly

Transcript when findable; otherwise show notes + reputable coverage, recorded as
`sourceQuality:'show-notes'` with claims kept modest. 3-8 `keyTakeaways`, each with Emma's
agree/pushback angle; medical claims are flagged in the angle, never restated as fact.
`productAngles` map episode themes to real catalog categories/handles (validate against live
collections; the writer verifies stock before embedding).

## Step 5 — Write the brief

One `podcastReviewBrief`, status `pending`, `createdBy` = run id, `_id` =
`podcastReviewBrief-<show-slug>-<episode-slug>`, `createIfNotExists` via the Sanity MCP tools.
Include `suggestedTitle` (answer-shaped) and a **verified episode-specific permalink** as
`episodeUrl` — the page for *this* episode, not the show-level feed or platform page. If only a
show-level URL exists, store it but say so in `sourceQuality`/notes; never pass a show page off as the
episode link.

## Step 6 — Finish

One `event` (phase `brief`), then the final run update (`status:'succeeded'`, summary = show +
episode + sourceQuality + takeaway count). If nothing was written, the summary says exactly why.
