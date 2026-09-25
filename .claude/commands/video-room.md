---
description: Meet the video team live on this week's pitch batch. Showrunner, writer and art director argue each clip with the owner, revise lines on the spot, and land every standing lesson where the Writers Room reads it. The room never approves; the owner clicks.
argument-hint: [optional: episode ids, a theme to press on, or what is bothering you about the batch]
---

# /video-room

The owner said this on the way in:

> $ARGUMENTS

He wants every clip to sound like a person telling a friend one true thing about one product, with
the product in her hand, at the register the channel allows, and none of the robotic, timid, or
porn-copy failure modes. This room is where he gets that, before anything renders. Your job is to
run the meeting, make the lines better while he listens, and make sure nothing he says here has to
be said twice.

## What this room is and is not

It is the live half of the pitch loop. The Writers Room files a 5-clip batch on Tuesday (3 slots
plus 2 alternates) at `production_status: 'pending_approval'`; the owner meets the team here; he
approves on `/admin/video-studio/scripts`; the Thursday render routine only ever claims an
approved clip. Nothing in the loop spends before his script click.

**The room never approves, rejects, or marks `needs_changes`.** That is the owner's money gate.
`decideEpisode` (`app/lib/video-episodes.server.ts:278`) runs only from the admin session, and the
team API has deliberately no decide op (`app/routes/api.team.video-episode.tsx:46-50`). Do not look
for a workaround, do not ask for one, do not propose adding one. If he says "approve it" in the
chat, hand him the link.

Also out of bounds for this room: `episode-claim` and `episode-release` (render lane only),
`POST /api/team/video-job` `enqueue` or `enqueue-set` (real money), and any valve.

## Access

Team routes accept `Authorization: Bearer <token>` or `x-team-secret: <token>`
(`assertTeamAuth`, `app/lib/team.server.ts:83`). The server accepts the first of `TEAM_TOKEN`,
`HOMEPAGE_TEAM_TOKEN`, `CRON_SECRET` that is set in its env (`team.server.ts:84-88`). The local
`HOMEPAGE_TEAM_TOKEN` is stale and 401s; the working token is `CRON_SECRET` from the worktree's
`.env.local`, and it works only because neither of the first two is set in prod. Shell state does not
persist between calls, so set both on every call and post bodies from files in the scratchpad
(heredocs through pipes mangle JSON):

```bash
T=$(grep -m1 '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '"'); B=https://xdipx.com
curl -s -X POST "$B/api/team/suggestion" -H "Authorization: Bearer $T" \
  -H 'content-type: application/json' -d '{"op":"list","team":"video","limit":1}'
```

Test with that list call first. On 401, pull prod env from `~/Claude/xdipx-deploy`
(`npx vercel env pull <scratchpad>/prod.env --environment=production`) and use its `CRON_SECRET`.
A 401 after the pull means the deployment has gained `TEAM_TOKEN` (or `HOMEPAGE_TEAM_TOKEN`), which
now outranks `CRON_SECRET`; use that value from the same file. If all fail, say so and stop; a room run on remembered data is worse than no room.

## Open: load the room, live

Everything below is read now, from the API and the repo, never from memory or a previous session.
Run the independent reads in parallel.

**The batch and its history** (`POST /api/team/video-episode`):

- `{"op":"episode-list","status":"pending_approval"}`: the batch in front of him. Group by
  `batchId`; the newest batch is the agenda. Each row carries `concept`, `logline`, `formula`,
  `castSlugs`, `productPlacements`, `scriptJson`, `storyboardJson`, `gateVerdictsJson`,
  `estCostUsd`, `plannedSlotAt`, `isReserve`.
- `{"op":"episode-list","limit":200}`: the rest of the ledger. From it take the previous batch
  (the next-newest `batchId`) and quote its `reviewNotesJson` entries verbatim: every decision, tag
  and note the owner left. Those notes are the first thing the writer must answer to.
- `{"op":"owner-edits","limit":50}`: his before/after line diffs from the script reader. Group
  them by what changed (a cut carrier phrase, a softened euphemism made plain, a line shortened).
  A pattern that recurs is a standing rule he has not been asked to confirm yet.
- `{"op":"learn"}`: the performance rollups. Every group carries its `n` and an `underpowered`
  flag; read it out that way. With few measured clips the honest reading is "no signal yet", and
  the room says exactly that rather than steering on a median of two.

**The rules the room argues from** (read in full; each binds a different voice):

- `docs/store-team/video-owner-notes.md`: the numbered owner ledger. Its entries outrank the
  writer's instincts.
- `docs/store-team/creative-platform.md` (Phase 1, lands with the docs PR): the thesis, the
  campaign signature, the polish standard.
- `docs/store-team/video-clip-rules.md` (Phase 1, lands with the docs PR): the rules, the
  named-acts fence, the AI label, the read-aloud gate.
- `docs/store-team/video-realism-recipe.md`: first frame, grip per category, occlusion, the
  four-panel sheet and its five reject conditions.
- `docs/store-team/instagram-campaigns.md` §3.2a (the ceiling) and §3.2c (on-skin), and the video
  addendum of `docs/emma-voice.md`.

Check each file exists at run time rather than trusting these labels. A missing file labelled
Phase 1 is a known gap, not a finding: mention it once in the opening, name the rules that are
therefore unenforced this session, and do not file anything about it. A missing file with no label
is a finding. Either way, never reconstruct a missing doc from memory.

**The week around the batch:**

- `GET /api/team/brief`: the active strategy brief, and `metricsJson.videoShortlist` in
  particular (strategy Video Plan rewrite, PLANNED). The showrunner pitches only from that
  shortlist. While the field is absent, say once that product choices this session are unanchored
  to a shortlist, as a known gap, not a finding. Once the Video Plan rewrite has shipped, an absent
  or empty shortlist is a finding.
- `GET /api/team/calendar?from=<Monday>&to=<Monday+13>` (YYYY-MM-DD, this week's Monday UTC):
  what the rest of the company is running this week and next. Always pass both bounds; the bare
  route returns the oldest 200 rows ascending (`listCalendar`, `team.server.ts:3277-3285`), which
  is history, not this week.
- `POST /api/team/suggestion {"op":"list","targetTeam":"video"}` plus
  `{"op":"list","team":"video"}`: open bus rows aimed at or filed by the video lane. Note each
  row's `id`, `kind`, `status` and `dedupeKey`; you will check against them before filing anything.

Before speaking as anyone, read their definitions in `.claude/agents/` (`series-showrunner.md`,
`episode-writer.md`, `social-art-director.md`) so the voices are theirs and not an imitation.

### If there is no pending batch

Say so in one line, then offer a **standup of the video lane** instead, gathered live:

- Episodes by `productionStatus` (count each from the full ledger), and anything sitting in
  `needs_changes`, `failed` or `rendering` with its age
- Last render: `POST /api/team/video-job {"op":"list","limit":100}` (default 40, max 100,
  `api.team.video-job.tsx:270`), the newest job, its `status` (including any park at
  `awaiting_frame_approval` on `/admin/video-studio/render`) and `costUsd`
- Last post: `POST /api/team/social-post {"op":"list","status":"posted"}`, the newest row carrying
  video media, meaning `mediaKind === 'video'` (`db/schema.ts:248`, nullable, so older rows lack
  it), falling back to `videoJobId != null` or an `.mp4` in `mediaUrls`. If none has ever posted,
  say that plainly; it is the headline
- Spend this week: the sum of `costUsd` across video jobs created since Monday 00:00 UTC, from the
  same list. If it came back full (100 rows) and the oldest row was created after Monday 00:00
  UTC, the list was truncated and the sum is a floor; say so
- When the next Writers Room and render runs fire, and whether the last run of each succeeded
  (`POST /api/team/run {"op":"list","team":"video","limit":10}`)

Lead with what he would most regret not knowing, then ask whether he wants to direct anything. If
he does, treat it the way `/all-hands` does and land it through the write-back rules below.

## The agenda: one clip at a time

Open with a one-paragraph read of the batch: how many clips, how many are alternates, the total
`estCostUsd`, which previous-batch notes it claims to answer, and any file or shortlist gap from
the load. Then take the clips in `plannedSlotAt` order, slots before alternates.

For each clip, put this in front of him before anyone argues:

| | |
|---|---|
| Episode | id, `episodeUid`, slot or alternate |
| Product | handle and name; on the shortlist or not |
| Format | `formula` and the format name from `video-clip-rules.md` |
| Speaker | cast slug; silent listener if any |
| The one fact | the claim, and its source type (spec sheet, enriched story, review pattern, manufacturer) |
| The one laugh | the beat meant to land, quoted |
| First frame | the concept from `storyboardJson` or `concept`, in one sentence |
| Est. cost | `estCostUsd` and the tier (`modelTier`) it assumes |
| Gates | `gateVerdictsJson` doctor and voice verdicts, verbatim |

If a field is missing from the pitch, write "not pitched" in the cell. A pitch without a fact
source or a first-frame concept is incomplete, and the showrunner owns saying so.

Then **read the script aloud in prose**: the spoken lines as one short paragraph in the speaker's
voice, then the IG and X captions beneath. `scriptJson.readAudioUrl` is Phase 2, not on main
yet. Until it ships, say "no audio read on this pitch" and read it at 2.5 to 3 words per second in
your head; flag any line that runs long at that pace or needs a second parse. Once it ships and
the field is present, give him the ElevenLabs read link first and let him listen before the room
talks.

## Running the room

The three voices speak in turn, in this order, each in two to five sentences. They talk to him,
not to each other, and each one ends on a clear position.

1. **series-showrunner.** Why this product (its shortlist rank, stock, never-posted status, margin
   or deal score, whatever the shortlist gave). Why this format for this product. What the clip
   does for the week's calendar. If the product is not on the shortlist, it says so first.
2. **episode-writer.** Defends or concedes each line against the rules and the owner-notes ledger.
   When he gives a note, it rewrites the line on the spot and reads the new version back, spoken
   line first, then the captions if they change. One rewrite per note; if he says "closer", it
   tries again. Every rewrite respects the rules: 12 words or fewer per line, a breath at each
   end, the named-acts fence, no carrier phrase repeated in the batch, the CTA from the whitelist.
3. **social-art-director.** Holds the first-frame concept against §3.2a, §3.2c and the realism
   recipe: product at the sternum, nothing within a face-width of the mouth, one hand with one
   job, one window key, and which of the five reject conditions the concept is most at risk of.
   It proposes the fix in the same breath as the objection.

Let him interrupt anywhere. The voices take his note, not the other way round, unless a note
breaks a charter rule; then the relevant voice says which rule and offers the nearest version that
keeps his intent.

**Revised lines get one check.** Any line the writer rewrote in the room was not seen by the
Tuesday gates. Before the clip closes, send the revised script to a `script-doctor` subagent, and
to `emma-empathy-reviewer` when the rewrite touches the acts fence, the register, or anything a
customer reads. Report the verdict in one line. A FAIL or BLOCK goes back to the writer while he
is still in the room; do not hand him a revision that has not passed.

**Convene the bench only on a contested item.** When a clip is disputed in a way the three voices
cannot settle, spawn the specialists whose read would change the outcome, **in parallel**, with
the owner's actual words and the clip's card:

- `tech-architect`: can the tier render this (duration, audio-driven versus native audio, the
  product-in-hand motion), and at what cost
- `product-manager` (with `inventory-sentinel` for stock): is this the right product this week
- `emma-empathy-reviewer`: register, the acts fence, the no-lived-experience rule
- `media-manager` after `social-art-director`: whether the frame can be produced as briefed

A specialist that disagrees is doing its job. Surface the disagreement with both positions and
your recommendation; never average it away. An item still unresolved at the end goes on the
decision list as an open question, not a guess.

Close each clip with its recommendation in one line (approve as revised, needs changes with the
note he should type, reject with the reason, or swap to an alternate) and move on. **The note
matters**: `decideEpisode` refuses `needs_changes` without one, so write the exact text he should
paste into the note field.

## Write back

Direction that does not land in a document the Writers Room reads at run start did not happen. Do
the reads first, then land each thing once.

**Revised scripts.** Once `episode-revise` exists on `/api/team/video-episode` (Phase 2 adds it;
check the op list in the route's header doc before trying), post each revision through it with
`editedBy:'video-room'`; it versions the script, logs `video_script_edits`, and leaves the row at
`pending_approval`. Until it exists, there is no team-token write path to a script and there must
not be one. Record the final text in the minutes, and tell him to paste it into the script reader
at `/admin/video-studio/scripts/<id>`, whose `edit` intent calls `editEpisodeScript` and logs the
diff to `video_script_edits`. Give it to him field by field as the reader lays it out:
`voiceover`, `presenterLine`, `cta`, `shareLine`, one `caption_<platform>` box per platform key
already on `scriptJson.captions`, and the site cut if it changed. Edits are refused once a clip is `rendering` or later
(`SCRIPT_LOCKED_STATUSES`), so this happens before he approves.

**Standing lessons.** Every theme he states as a rule, or that shows up in two clips or two
batches, becomes ONE `instructions` row per theme, never one per clip:

```json
{"op":"create","team":"video","targetTeam":"video","kind":"instructions",
 "category":"video-owner-note","priority":3,
 "dedupeKey":"video:owner-note:<theme-slug>",
 "suggestion":"Append to docs/store-team/video-owner-notes.md as the next numbered entry (N as of today; take the next free number at apply time, never renumber): N. (YYYY-MM-DD) Owner said: '<his exact words>'. Rule: <the rule in one sentence>. Source: /video-room on episode <ids>. DONE WHEN the entry is on main."}
```

Dedupe is opt-in and the key is canonicalized server-side (slugged, date stamps stripped, 64-char
cap), so `video:owner-note:<theme-slug>` is stored as `video-owner-note-<theme-slug>`. Keep the
theme slug short and dateless, and match against the slugged form when you scan the list. A repeat
create against a live row with the same key returns that row and does **not** update its text.

So when he sharpens a theme, first list the video rows and collect every `dedupeKey` that starts
with `video-owner-note-<theme-slug>` (the bare key and any `-rN` revisions). Take the highest N
(the bare key counts as 1), file under `video:owner-note:<theme-slug>-r<N+1>`, set `supersedesId`
to the live row among them, and name that row in the text; the old row is dismissed with a
pointer. If none is live because the last one is already `applied`, the rule is in the ledger:
still file `-r<N+1>`, with no `supersedesId`, as a new entry that names the one it supersedes, per
the ledger's own header.

Read every create response. `{"deduped":true,"id":…}` means nothing was written and you hit an
existing live row: do not report it as filed; report it as "already tracked on #id". After a real
filing, `{"op":"get","id":N}` and report the row's real status. Do not assume auto-approve: the routing card says the video valve is off, the
live valve has been seen on, and a row that sits at `proposed` needs his triage click, which goes
in "Needs you".

**Owner-only asks** (money, brand, likeness, valves): file each on the blocker list, never leave it
in the thread. `POST /api/team/blocker`:

```json
{"op":"file","dedupeKey":"video-room:<slug>","title":"<answerable question>",
 "detail":"<context and options>","unblocks":"<which clip or lane>",
 "whereToGo":"<exact admin URL>","category":"decision","source":"session",
 "evidence":"<what the room read that raised it>"}
```

Use `category:"decision"` for brand, likeness and spend judgments (no probe needed). A valve ask
uses `category:"valve"` and needs a `verifyProbe` from `{"op":"probes"}` or a non-empty
`overrideNoProbeReason`; the API 400s otherwise. Never file a valve change as a `config` ticket.

**Minutes.** Minutes are run events, and an event needs only a `runId` (`recordEvent`,
`team.server.ts:765`). A new run is the expensive part. `getTodayRunCount`
(`team.server.ts:391-400`) counts every `video` run started today (UTC), whatever its `runType`,
against `video_team_max_runs`. So a room run opened before Tuesday's 17:00 Writers Room or
Thursday's 13:00 render can make that scheduled routine skip with `over_run_cap`. A `running` row
also holds the video lane's lock (`isRunInProgress`, `:461-475`). Stale runs are reaped only inside
`gate()` (`:626`), so a room run whose session dies can block the lane for up to 240 minutes.

So decide where the minutes go before any `start`:

1. `POST /api/team/run {"op":"list","team":"video","sinceDays":1}`.
2. **Default: attach to the batch's own run.** Find the Writers Room run that filed this batch
   (from the same list, widened with `"sinceDays":8` if needed: the newest video run whose
   `runType` is `writers-room` or `video-writers-room`, both spellings appear in the docs, started
   before the batch's `createdAt`). Record the minutes against its `runId`. A finished
   (`succeeded`) run cannot hold the lock, and recording events on it opens no new row. Do not
   pass `finish` on these events; that run is already closed.
3. **Open a fresh room run only when** no video run has started today (UTC) and no scheduled video
   routine is still due today. Read the video rows of `docs/store-team/routine-schedule.md` for
   the live crons rather than trusting this line: today that is the Writers Room Tuesday 17:00
   and the render at 13:00, which still fires Monday and Thursday until its trigger is re-pointed
   to Thursday only. Then open it with
   `POST /api/team/run {"op":"start","team":"video","runType":"room","phase":"room"}` and close it
   on the last event with `"finish":{"status":"succeeded","summary":"…"}` in the same call, never
   as a separate update; the gap between two calls is how runs expire.
4. If neither is possible (no findable writers-room run and the cap window is live), do not open a
   run. Put the minutes in the report and say why they were not recorded.

Record each event as `POST /api/team/event` `{"op":"record","runId":…,"phase":"room",
"eventType":"decision","agentRole":"video-room","summary":…}`: one per clip (card, the arguments,
revised text, recommendation, gate verdicts) plus one for filings. State in the report which run
the minutes landed on and why.

## Close

End with the decision list, one line per clip: episode id, the room's recommendation, the note to
paste if it is `needs_changes`, and whether a revision is waiting in the reader. Then the link:

**Approve at `/admin/video-studio/scripts`.** Per-clip reader: `/admin/video-studio/scripts/<id>`.

Say plainly, every time: the room did not approve, reject, or mark anything; the clips are exactly
where they were until he clicks.

Bus hygiene before you finish: every row you filed was checked against the open list first, no
theme got two rows, and every replacement carries `supersedesId`.

## Hard rules

- **Never weaken a gate or a valve** to get a clip through, not the frame gate, not the render
  gate, not `video_team_autopublish`, not the doctor or voice verdicts. If a note seems to ask for
  that, say so and offer the safe version.
- **Protected paths escalate**: valves and spend controls (`app/lib/team-keys.ts`,
  `app/lib/team.server.ts`), the release engine, migrations, CI, secrets. The room proposes,
  never merges.
- **The charter binds.** `docs/emma-voice.md`, `docs/design-doctrine.md`, and the §3.2a ceiling
  win over anything said in the room. If his direction conflicts with them, flag the conflict,
  record his words in the minutes, and wait for an explicit "codify" before any charter edit.
  Standing rules that fit inside the charter go to the owner-notes ledger as above.
- **Emma and the cast have no lived experience.** No line says or implies anyone on camera tried,
  tested or owns the product.
- **No em-dashes** in anything you write, spoken lines and captions included.
- **Every claim needs evidence.** A product fact cites its source type; a cost cites
  `estCostUsd`; a performance read cites its `n`. "It should render" is not a verdict.
- **Never silently drop a clip or a note.** Every clip and every note he gave appears in the report
  with an outcome.

## Report back

| Clip | Owner decision | What changed | Standing rule filed? |
|---|---|---|---|

"Owner decision" is what he said he will click, or "open" if he did not say. "What changed" names
the revised lines and whether they passed the check. "Standing rule filed?" gives the row id and
dedupe key, or "no" with the reason.

Then, briefly:

- **Landed**: each row actually filed, with its id, canonical `dedupeKey`, and real status from
  `get`; each blocker id; any create that came back `deduped:true`, marked "already tracked on
  #id"; and the run id the minutes landed on.
- **Queued**: which rows wait on which executor (agent-editor's weekly pass for `instructions`
  rows, or his triage click for a row at `proposed`) and when that runs.
- **Done now**: revisions that passed the check, with the verdict, and any revision written back
  through `episode-revise`, with the evidence.
- **Needs you**: the approve link with the clip ids ready to go, any `needs_changes` note to paste,
  any `proposed` row that needs triage, and each blocker filed, as answerable questions.
- **Pushback**: anything a voice or a specialist disagreed with, anything in the batch the room
  thinks is a mistake, and any rule that made a line sound less like a person. Say it now.

Keep it short. He is reading this to find out which buttons to press and whether the next batch
will be better.
