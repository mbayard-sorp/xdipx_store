# Routine: Weekly Writers Room

Entry agent: `series-showrunner` (`.claude/agents/series-showrunner.md`). Weekly, Tuesday, after
Monday's strategy run publishes a fresh brief. PROPOSE-ONLY AND ZERO-SPEND: this routine writes
and gates the week's episodes and files them as one owner batch; it never enqueues a render and
never spends a cent. The render lane is `docs/store-team/routine-video-render.md`.

Supersedes the enqueue half of the retired `routine-video-weekly.md` (kept as a pointer). The
scripting brain moved here; the spending hand moved to the render routine; the owner's script
approval now sits between them, before any money.

Money model: reasoning bills to the Max subscription (cost ~0). Nothing in this routine is
metered. The first metered cent for an episode is spent by the render routine, and only for an
episode the owner approved.

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
episode API is not live yet (404 or unknown op), the ledger does not exist, the batch has nowhere
to land, and the run skips honestly with reason `episode_api_not_live`. Never fall back to
enqueueing renders directly; that is the exact pre-approval spend this routine exists to end.

## Step 2: Read context (data only)

1. The show bible: `docs/store-team/series-bible-the-group-chat.md` (binding).
2. The rule set: `docs/store-team/social-video-viral-checklist.md`, all 38 rules.
3. Voice: `docs/emma-voice.md` core + video addendum (register table, craft rules).
4. The brief: `GET /api/team/brief`. The calendar: `GET /api/team/calendar`.
5. Config: `POST /api/team/video-job {"op":"config"}` -> approved cast, sceneKit with
   `approvedFrameAssetId` per scene, tiers with live rates.
6. The ledger: `POST /api/team/video-episode {"op":"episode-list"}` -> aired numbers, open
   loops, character beats, owner decisions and revision notes on the last batch, verbatim.
7. Render-side training data: `POST /api/team/video-job {"op":"list"}` -> frame retries, regen
   feedback, rejections, owner caption edits on fanned-out drafts.
8. Owner script edits: `POST /api/team/video-episode {"op":"owner-edits"}` -> recent before->after
   line diffs. Read alongside the ledger's revision notes (item 6) so the room closes the learning
   loop instead of only reading which episodes the owner rejected (#7562).

## Step 2.5: Backlog guard (before any new drafting)

The room cannot serialize past episodes that have never aired: character state and the open-loop
ledger derive only from AIRED episodes, so with 0 aired the arc has nothing to advance and any new
loop-dependent episode is built on continuity the owner has not ratified and could still revise (as
he revised E1/E2). Runs 633/654 filed S1E3-E4 into an unapproved queue on 2026-09-04 anyway, and
this pattern would have stacked S1E5-E6 on top of those same two still-pending scripts.

After Step 2 item 6 (`episode-list`): if **0 aired episodes AND >=2 episodes at
`pending_approval`**, file **no** new serialized slate. Post one `phase:'slate'` event stating the
backlog block and the owner-approval unblock (blocker #57), then finish the run `succeeded` —
skip Step 3 entirely. Evergreen reserve top-up is likewise skipped while 0 aired: the reserve is a
safety net for a live cadence and must itself be owner-approved first. The guard lifts
automatically once the owner approves the first episode (`aired>0` or pending backlog drops below
the render cadence). This keeps the room zero-spend and honest without churning the owner queue.

## Step 3: The room

Run the writers room exactly as `series-showrunner`'s workflow specifies:

1. Arc pass and slate loglines (2 episodes at the learn-mode cadence, plus top the evergreen
   reserve to 1 if it was consumed).
2. `episode-writer` per episode.
3. `script-doctor` once over the whole slate (cross-episode repetition must be visible).
4. `emma-empathy-reviewer` voice gate on every script: spoken lines, captions, and the site cut
   together. REVISE gets one rework and one re-gate; BLOCK drops the episode. A short slate is
   an honest outcome.
5. `social-art-director` visual scheme per surviving episode.

## Step 4: File the batch

`POST /api/team/video-episode {"op":"episode-propose", ...}` per episode, sharing one batch id,
carrying the full script, storyboard beats, cast, product placement (roles from the licensed
vocabulary only), planned slot date, estimated cost, and both gate verdicts. Post a run event
(`phase:'slate'`) summarizing the batch for the dashboard.

The owner reviews in `/admin/video-studio`. Approve, revise with notes, or reject; notes persist
on the episode row and are next week's Step 2.6 reading.

## Step 5: Retro + finish

Post `phase:'retro'` events: slate vs filed with drop reasons; last batch's approval rate and the
owner's note themes quoted verbatim; open-loop depth; next week's estimated cost. At week 4 and
every 4 weeks after: state plainly whether `script-doctor`'s findings duplicate the voice gate's,
and file a retire suggestion if over 80% duplicative. File suggestions (acting team `video`) for
structural findings.

**Close the run on the LAST retro event, in the same call, via `finish` — never as a separate
`/api/team/run` call afterward (ticket #8027).** Runs #633 and #654 each posted a full retro event
trail and then never made that separate finish call: the session died (turn/token budget,
container teardown) in the gap between the two calls, and the run sat idle for hours until the
reaper marked it `'auto-expired'` even though the retro event trail showed completed work.
`POST /api/team/event {op:'record', ...}` now accepts an optional `finish` object that closes the
run atomically with that same event:

```bash
curl -s -X POST "$BASE_URL/api/team/event" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"record","runId":'$RUN_ID',"phase":"retro",
       "summary":"slate: 2 filed, next week est $X",
       "finish":{"status":"succeeded","summary":"..."}}'
```

Nothing else needs to happen after this request for the run to close. Do not follow it with a
separate `POST /api/team/run {op:'update', finished:true, ...}` — that reintroduces the exact gap
this fixes.

## Enablement runbook (owner)

1. Merge the writers-room launch bundle PR (agents + docs; ordinary release lane).
2. Wait for the episode ledger to be live: migration 086 applied plus the episode API ticket
   merged (the run skips honestly until then).
3. Raise `video_team_max_runs` from 1 to 3 on the Video tab of `/admin/homepage-team` (two
   scheduled video runs on the busiest week plus skip/retry headroom; the cap counts run rows,
   skips included).
4. DONE 2026-08-27. The prompt could not be reissued in place: `trig_01QBLBTi9sS7X7FjFXAvPfkw`
   was created via `http_api`, and an agent may only update triggers it created itself. The
   cutover instead created `trig_01AMt6ARtfgT44EvFy287ESn` (row 15, same cron `0 17 * * 2`, entry
   agent `series-showrunner`, this playbook, git source attached, model `claude-opus-4-8`) and the
   owner disabled the old trigger. First fire 2026-09-01.
5. Approve the first slate in `/admin/video-studio`. The first slate also pitches the season-one
   wants and the relationship grid; approving it ratifies them into the bible.
