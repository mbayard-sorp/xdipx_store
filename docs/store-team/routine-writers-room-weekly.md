# Routine: Weekly Writers Room (v2, product-talk clips)

Entry agent: `series-showrunner` (`.claude/agents/series-showrunner.md`). Weekly, Tuesday 17:00 UTC
(`0 17 * * 2`), the day after Monday's strategy run publishes the brief and its product shortlist.
PROPOSE-ONLY AND ZERO-SPEND: this routine pitches the week's product-talk clips as one owner batch
and stops. **It never approves, never enqueues, never spends, never publishes.** The render lane is
`docs/store-team/routine-video-render.md`; approval is the owner's alone, on
`/admin/video-studio/scripts`.

v2 replaces the serialized show. The Group Chat (`series-bible-the-group-chat.md`) is shelved for
season 1 (owner ruling 2026-09-23), so the bible and `social-video-viral-checklist.md` are no longer
run-start reads. Each clip is a 15 to 30 s product-talk clip: one cast member on camera holding one
product and telling a friend one true thing about it, with no serial state.

Money model: reasoning bills to the Max subscription (cost ~0). Nothing in this routine is metered.
The first metered cent for a clip is spent by the render routine, and only for a clip the owner
approved.

**The owner's live session.** `/video-room` (`.claude/commands/video-room.md`) is the owner's live
session on this batch, Tuesday evening or Wednesday, with the showrunner, writer and art director.
Its revisions arrive on the rows through `episode-revise` (PLANNED, Phase 2; not on
`/api/team/video-episode` today) or, until then, through the owner's own edits in the script
reader (`/admin/video-studio/scripts/<id>`, logged to `video_script_edits`). Both surface in next
week's `owner-edits` read. The room never approves either.

## Step 0: Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"video","runType":"writers-room"}'
# -> {"id": $RUN_ID}
```

## Step 1: Gate

```bash
curl -s "$BASE_URL/api/team/gate?team=video&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

`ok:false` -> record a `skipped` event with the reason, finish the run honestly
(`status:'skipped'`), exit. Never work around a closed gate.

**Enablement gate:** `POST /api/team/video-episode {"op":"episode-list"}` must answer. If the
episode API is not live (404 or unknown op), the batch has nowhere to land, and the run skips
honestly with reason `episode_api_not_live`. Never fall back to enqueueing renders directly; that
is the exact pre-approval spend this routine exists to prevent.

## Step 2: Read context (data only)

Binding docs, read in full before the first line is written or judged:

1. `docs/store-team/creative-platform.md`: the one idea, the voice brief, the example lines and
   banned phrases, the signature, the polish standard, and the proof points (§11) that are the only
   facts a clip may state.
2. `docs/store-team/video-clip-rules.md`: the seven formats and the script rules. Until it is on
   main, use `docs/store-team/video-content-strategy-2026-09-23.md` §4.2 and §4.3 and say so in
   the report.
3. `docs/store-team/video-realism-recipe.md`: the first-frame recipe (§1 to §4), motion routing
   (§6), cast continuity and rotation (§7), and the owner's approval sheet (§8).
4. `docs/store-team/video-owner-notes.md`: the numbered owner ledger. Its entries outrank any
   habit of the writers.
5. Voice: `docs/emma-voice.md` core plus the video addendum. Where the platform and the charter
   disagree before the Phase 1a charter PR merges, the charter wins.

Data reads:

6. The brief: `GET /api/team/brief` -> `brief.metricsJson.videoShortlist`, one object per product,
   `[{handle,title,format,reason,stockCheckedAt}]`. **PLANNED** until the strategy routine's Video
   Plan publishes it. The only accepted sources are `metricsJson.videoShortlist` or a doc on main
   whose path the brief names (a cloud routine cannot read a session scratchpad). With neither,
   **skip the pitch** (Step 2.5 reason `no_shortlist`) and say so in the report. Expect every
   Tuesday to skip on `no_shortlist` until the strategy Video Plan publishes. Never pick a product
   yourself: product selection belongs to `product-manager` and `inventory-sentinel`.
7. The calendar: `GET /api/team/calendar?from=<this Monday>&to=<next Sunday>` (both
   `YYYY-MM-DD`, this week and next) -> `{events}` for theme and promo windows. The approved and
   scheduled clips on the calendar (`videoClips`) are PLANNED (Phase 2).
8. The ledger: `POST /api/team/video-episode {"op":"episode-list","status":"pending_approval"}`
   for the Step 2.5 guard, then `{"op":"episode-list"}` for the last batches, their statuses, and
   the owner's decisions and revision notes, verbatim.
9. Owner edits: `POST /api/team/video-episode {"op":"owner-edits","limit":50}` -> `{edits}`, the
   owner's before/after line diffs from the script reader. Line notes (`reviewNotesJson` entries
   shaped `{field, lineIdx, note}`) are **PLANNED** (Phase 2); until then read the revision notes
   on the `episode-list` rows.
10. Learn: `POST /api/team/video-episode {"op":"learn"}` -> `{episodes, rollups}`, medians only,
    each group with its n and underpowered flag. Today's rollup dimensions are `formula`,
    `hookPattern`, `castSlug`, `productHandle`, `placementRole`, `arcPosition`; keying on reach,
    `speaker` and `format` is PLANNED (Phase 2). Never read an underpowered group as a finding.
11. Config: `POST /api/team/video-job {"op":"config"}` -> the approved cast with `voiceId` per
    member, the eligible tiers in `models` with live rates, `maxCostCents`, and `formulas`.

## Step 2.5: Backlog guard (before any drafting)

If **3 or more clips are still at `pending_approval`** (Step 2 item 8), file **no** new batch. The
owner has not decided the last one; a second batch on top of it doubles his reading and teaches the
room nothing. Post one `phase:'slate'` event naming the count and the unblock (the owner decides the
pending clips on `/admin/video-studio/scripts`), then go to Step 5 and finish `succeeded`.

The same step ends the pitch, with the reason in the event, when there is no shortlist (Step 2
item 6). The retro in Step 5 still runs in both cases, because owner edits from the last batch are
still worth landing.

## Step 3: Pitch

Five clips: **3 slots plus 2 alternates**, every product taken from the shortlist and nowhere else.
Rotate across the seven formats in `video-clip-rules.md`; no format twice among the 3 slots; each
alternate covers the format of a slot it could replace. Three different speakers across the slots
(recipe §7).

Per clip, the showrunner fixes:

- **product**: the shortlist `handle`;
- **format**: one of the seven;
- **speaker**: an approved cast slug from `config.cast` (or `emma`);
- **listener**: a second cast slug if the format has a silent listener, else none;
- **fact**: exactly one, with its source class (from creative-platform §11 or the product's PDP
  spec only; never "reviewers say" until real reviews exist);
- **laugh**: exactly one;
- **first-frame concept**: per `video-realism-recipe.md` §1 to §4 (camera, ground lock, window
  key, named garment, the category grip at the sternum, the one story cue, the full §4 negatives);
- **est cost**: dollars, from the Step 2 item 11 rates for the tier the recipe routes it to
  (InfiniteTalk 720p by default, recipe §6), and under the per-video ceiling.

Then, per clip, in this order:

1. `episode-writer` writes the script on `video-clip-rules.md`. **Every spoken line is 12 words or
   fewer**, with a breath or comma at the line end (recipe §6: InfiniteTalk's sync drifts on fast
   line ends). Under 30 s spoken.
2. **The read.** After the writer returns the script, the showrunner (which has Bash; the writer
   never has API access) records an ElevenLabs read of the spoken track in the speaker's cast voice
   (`voiceId` from `config.cast`) and attaches it as `readAudioUrl`. **PLANNED** until a team-token
   path to generate the read exists and the field lands in Phase 2. Until then the clip ships
   without it and the report says so; never substitute another voice.
3. `script-doctor` verdicts the script (once across all five, so repetition across clips is
   visible), then `emma-empathy-reviewer` voice-gates every spoken line and caption. REVISE gets
   one rework and one re-gate; BLOCK drops the clip. A short batch is an honest outcome; a batch
   that lost a slot promotes an alternate and says so.
4. `social-art-director` signs the first-frame concept against the recipe and §3.2a. An unsigned
   concept does not enter the batch.

## Step 4: File the batch

One call, one batch: `POST /api/team/video-episode {"op":"episode-propose", ...}` with all
surviving clips in one `episodes` array. The server validates every clip before writing any row and
inserts them in one statement, so the batch lands whole under one `batchId` or not at all. A 400
names the defect; fix it and resend the whole batch, never a partial one.

```json
{"op":"episode-propose","seriesSlug":"product-talk","seriesTitle":"Product talk","createdBy":"series-showrunner",
 "episodes":[{
   "logline":"<one sentence, 240 chars max>",
   "formula":"<a live formula from config.formulas>",
   "concept":"<format, fact with source class, laugh, first-frame concept>",
   "castSlugs":["<speaker>","<listener if any>"],
   "productPlacements":[{"handle":"<shortlist handle>","role":"considered","mentionType":"spec_cited"}],
   "scriptJson":{ "...": "the script as written and gated" },
   "plannedSlotAt":"<ISO, the render Thursday 13:00 UTC>",
   "isReserve":false,
   "gateVerdicts":{"doctor":"<verdict>","voice":"<verdict>"},
   "format":"...","speaker":"...","listener":"...","fact":"...","factSource":"...",
   "laugh":"...","firstFrameConcept":"...","estCostUsd":0,"readAudioUrl":"...",
   "productHandle":"...","alternate":false
 }]}
```

Live today on main: `logline`, `formula` (required, validated against `config.formulas`),
`concept`, `castSlugs`, `productPlacements` (`role` one of `considered|compared|gifted|rejected`,
`mentionType` one of `spec_cited|review_pattern|price|category`), `scriptJson`, `modelTier`,
`plannedSlotAt`, `isReserve`, `gateVerdicts`. **PLANNED (Phase 2):** `format`, `speaker`,
`listener`, `fact`, `factSource`, `laugh`, `firstFrameConcept`, `estCostUsd`, `readAudioUrl`,
`productHandle`, `alternate`. Until they land the server ignores them, so every load-bearing value
is also carried in a live field: the product in `productPlacements`, speaker and listener in
`castSlugs`, the format, fact, laugh and first-frame concept in `concept`, and each alternate as
`isReserve:true` (the render claim only reaches a reserve after every claimable slot).

**Format to formula.** Both `episode-propose` and the render's `enqueue` validate `formula` against
`VIDEO_FORMULAS` (`myth-busting|unboxing|before-after|hook-problem-payoff|three-things|grwm|
pov-testimonial|ten-second-fix|the-one-thing|translate-the-feeling|brand-tentpole`). The seven clip
formats are not in that list, so map each one, and put the format's own name in `concept`:

- "The spec nobody reads" -> `the-one-thing`
- "Ask Emma" -> `hook-problem-payoff`
- "Two on the counter" -> `three-things`
- "Gift math" -> `the-one-thing`
- "Material class" -> `translate-the-feeling`
- "Vivian's verdict" -> `the-one-thing`
- "Sofia dares you" -> `hook-problem-payoff`

If `video-clip-rules.md` renames a format, map it to the closest formula above and say so in the
report.

**Other live constraints:**

- `castSlugs[0]` is the speaker; the listener, if any, is `castSlugs[1]`. The render builds
  `presenter` from `castSlugs[0]`.
- Omit `modelTier` unless the tier appears in `config.models` (propose refuses an ineligible tier,
  and the Atlas tiers land in Phase 2). With `modelTier` omitted the server cannot dry-run the
  script, `estCostUsd` comes back null, and it **skips the per-video ceiling check**. Your hand
  estimate against `config.maxCostCents` is then the only ceiling check before the owner reads the
  batch; a clip over it does not file.
- Pass `seriesTitle` on the first product-talk propose so the server can create the
  `product-talk` series (it is created on first use; later calls may pass it again harmlessly).
- `plannedSlotAt`: set it to the **render Thursday 13:00 UTC**, and carry the intended post date in
  `concept`. Today the field does two jobs: `episode-claim` only serves a row whose
  `plannedSlotAt` is now or past, and the fanout (`fanOutVideoToSocialDrafts` in
  `app/lib/video-pipeline.server.ts`) uses it as the Social Studio draft's `scheduledAt`. The owner
  sets the real post date in Social Studio. A separate `postSlotAt` is a follow-up ticket (see the
  render playbook).

Post a run event (`phase:'slate'`) summarizing the batch: `batchId`, each clip's product, format,
speaker and est cost, and the batch total.

## Step 5: Retro

1. **Group the owner's signal by theme.** Read the Step 2 item 9 `owner-edits`, the revision notes
   on the last batches, and line notes once they exist. Group by theme (a carrier phrase, a timid
   noun, a line over 12 words, a fact he struck), never by clip.
2. **File one ledger row per repeating theme.** When a theme appears in 2 scripts or in 2 batches,
   file ONE `instructions` row for it that appends to `docs/store-team/video-owner-notes.md`. The
   convention matches `.claude/commands/video-room.md`. List first:
   `POST /api/team/suggestion {"op":"list","team":"video","kind":"instructions"}` and collect every
   `dedupeKey` that starts with the slugged form `video-owner-note-<theme-slug>` (the server
   canonicalizes `video:owner-note:<theme-slug>` to it). A create against a live key does nothing
   and returns the old row (partial-unique index, migration 070), so never re-file the same key to
   change a rule:
   - no row on the theme: file `video:owner-note:<theme-slug>`;
   - rows exist: take the highest N (the bare key counts as 1) and file
     `video:owner-note:<theme-slug>-r<N+1>`, with `supersedesId` set to the live row among them
     and that row named in the text. If none is live because the last one is already `applied`,
     still file `-r<N+1>`, with no `supersedesId`, as an entry that names the one it supersedes;
   - the same rule with the same text already live: leave it alone.

   Read every create response: `{"deduped":true,"id":...}` means nothing was written.

```json
{"op":"create","team":"video","targetTeam":"video","kind":"instructions",
 "category":"video-owner-note","priority":3,
 "dedupeKey":"video:owner-note:<theme-slug>",
 "suggestion":"Append to docs/store-team/video-owner-notes.md as the next numbered entry (take the next free number at apply time, never renumber): N. (YYYY-MM-DD) Owner said: '<his exact words>'. Rule: <the rule in one sentence>. Source: Writers Room retro, run <RUN_ID>, episodes <ids>. DONE WHEN the entry is on main."}
```

   Keep the theme slug short and dateless. Quote the owner verbatim; never paraphrase his words
   into the ledger.
3. Record one `phase:'retro'` event per theme filed or superseded, plus the batch's filed versus
   dropped count with drop reasons, the last batch's approval rate, and the learn read with its n.

## Step 6: Report and finish

The last retro event carries the report and closes the run in the same call: the batch (`batchId`,
clips, alternates), the batch cost estimate, and what was skipped and why (guard, no shortlist, a
dropped clip, a missing read, a PLANNED field the server ignored).

**Close the run on the LAST event, in the same call, via `finish`, never as a separate
`/api/team/run` call afterward (ticket #8027).** Runs #633 and #654 each posted a full retro trail
and then died before a separate finish call, and sat idle until the reaper marked them
`'auto-expired'`.

```bash
curl -s -X POST "$BASE_URL/api/team/event" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"record","runId":'$RUN_ID',"phase":"retro",
       "summary":"batch <batchId>: 3 slots + 2 alternates, est $X; skipped: ...",
       "finish":{"status":"succeeded","summary":"..."}}'
```

Do not follow it with a separate `POST /api/team/run {op:'update', finished:true, ...}`; that
reintroduces the gap this fixes.

## Enablement runbook (owner)

1. Merge this playbook and `video-clip-rules.md` (ordinary lane).
2. Re-point `trig_01AMt6ARtfgT44EvFy287ESn` (row 15, `0 17 * * 2`, stays on Opus) at this playbook
   and the rules file; see `routine-schedule.md` §Re-pointing the video triggers.
3. `video_team_max_runs` at 3 on the Video tab of `/admin/homepage-team` (the cap counts run rows,
   skips included).
4. The shortlist comes from the strategy routine's Video Plan; until it publishes
   `metricsJson.videoShortlist` (or names a doc on main), this routine skips on `no_shortlist`.
5. Decide the batch on `/admin/video-studio/scripts`, after `/video-room` if you want the argument
   first.
