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
  -d '{"op":"start","team":"content","runType":"podcast"}'   # → $RUN_ID
```

## Step 1 — Gate

`GET /api/team/gate?team=content&excludeRun=$RUN_ID`. If `ok:false` → post skipped, stop.

## Step 2 — Load context

1. `docs/store-team/podcast-shortlist.md` — the owner-editable show list and rotation rules.
2. `docs/emma-voice.md` — editorial sensibility (the brief is internal, not voice-gated).
3. Existing briefs (Sanity GROQ, **raw perspective** — this must be able to see a brief that was
   patched but never published, which is exactly what a stranded brief looks like):
   `*[_type=="podcastReviewBrief"]{showName, episodeTitle, episodeUrl, status}`.
   **A `pending` brief already waiting (on raw) → stop honestly; never stack a second.**

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

**When `sourceQuality` is `'show-notes'`, every claim must trace to the fetched page (ticket
#14308).** `podcastReviewBrief-shameless-sex-506-pucker-up-kissing` declared `sourceQuality:
'show-notes'` and its own summary said it was built from the episode description and topic list
only, not a full listen-through, yet it asserted takeaways and a whole `productAngle` ("Taste as
part of kissing") the fetched show-notes page never mentioned — cost content run 1318 four gate
cycles trimming nine unsourced attributions back to the page. Because the brief claims the same
narrow source as the eventual post, there is no richer source to appeal to once a writer inherits
it: the over-reach has to be caught here, not downstream. So before writing the brief: every
`keyTakeaway` and every `productAngle` theme must be traceable to a phrase actually present on the
fetched page; quote the page's own wording for any superlative or ordering claim rather than
paraphrasing it into a stronger one; and an inference worth adding that the page does not state
goes in its own field or is explicitly marked as the reviewer's own extrapolation, never attributed
to the episode. A claim that cannot be sourced this way is dropped, not softened.

## Step 5 — Write the brief

One `podcastReviewBrief`, status `pending`, `createdBy` = run id, `_id` =
`podcastReviewBrief-<show-slug>-<episode-slug>`, `createIfNotExists` via the Sanity MCP tools,
**then `publish_documents` on that same id.** A patch with no publish writes only to
`drafts.<id>` and is invisible to anything reading the published perspective — this stranded a
complete, high-quality brief for a full day (ticket #9934) because the Thursday content run's
first-check reads the published perspective and found nothing pending.
Include `suggestedTitle` (answer-shaped) and a **verified episode-specific permalink** as
`episodeUrl` — the page for *this* episode, not the show-level feed or platform page. If only a
show-level URL exists, store it but say so in `sourceQuality`/notes; never pass a show page off as the
episode link. **Verify after publishing:** `*[_id == '<briefId>'][0].status` read on the published
perspective must return `'pending'` before the run finishes.

## Step 6 — Finish

One `event` (phase `brief`), then the final run update (`status:'succeeded'`, summary = show +
episode + sourceQuality + takeaway count). If nothing was written, the summary says exactly why.
