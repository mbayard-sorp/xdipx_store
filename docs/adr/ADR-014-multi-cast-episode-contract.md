# ADR-014: Multi-cast-member scenes — contract change and voice binding

Date: 2026-08-31
Status: Proposed
Author: tech-architect
Implementation owner: rr7-engineer (render/schema), sanity-content-builder (CastMember voiceId field)

## Context

Owner direction: episodes will move from one on-camera presenter per video to
multiple cast members interacting in the same episode, with product placement
drawing attention to the store. Owner asked two things: (1) does the pipeline
need validation to support multiple cast members interacting in scenes, and
(2) how do we ensure each cast member speaks in a distinct ElevenLabs voice.

**Ground truth verified in the tree before this ADR (not re-derived):**

- Every job carries exactly one `presenter: string` (`'none' | 'emma' |
  'friend:{slug}'`), validated by `PRESENTER_RE` at
  `app/routes/api.team.video-job.tsx:58`. There is no per-scene presenter.
- `VideoScriptJson.presenterLine` (`db/schema.ts:1617`) is a single string,
  one continuous spoken line for the whole job.
- `VideoSceneSpec` (`db/schema.ts:1563`) has `slug`, `framePrompt`,
  `motionPrompt`, `durationSeconds`, `continuity`, `reuseFrameAssetId`. No
  `presenter`, no `spokenLine`.
- `validateScenes` (`app/lib/video-pipeline.server.ts:118-153`) silently
  strips any field not in that list when it normalizes `scriptJson.scenes`
  into `video_jobs.scenes_json` — so even if an agent submitted a per-scene
  line today, it would not survive normalization.
- **Multi-scene explicitly refuses the audio-driven avatar tier**, in three
  places: `app/routes/api.team.video-job.tsx:105-107`,
  `video-pipeline.server.ts:203-204` (`dryRunEpisodeScript`), and
  `video-pipeline.server.ts:1407-1409` (`enqueueVideoJob`). "Avatar tier" here
  means `spec.audioDriven`: `omnihuman` and `wan22-s2v`
  (`app/lib/fal-video.server.ts:186-193, 249-259`).
- The **only** other talking path, the `lipsync` compound tier
  (`sync-lipsync`: silent `kling25-pro` base clip + one `fal-ai/sync-lipsync`
  perform pass, `fal-video.server.ts:195-211`), *does* support multi-scene in
  `advanceClipMultiScene` (`video-pipeline.server.ts:1394`) — but the lipsync
  pass runs **once, after concatenation, over the whole merged clip, with the
  job's single `presenterLine` and single voice** (`advanceLipsyncPerform`,
  `video-pipeline.server.ts:~1955-2010`). It is built for one narrator over
  cut-away B-roll, not per-scene dialogue.
- **Both talking-capable tiers are currently ineligible for new work,
  independent of anything in this ADR.** `omnihuman` and `sync-lipsync` are
  `legacy: true` (fal retired for video, owner direction 2026-08-26) →
  `tierIneligibility` returns `retired_provider`
  (`fal-video.server.ts:283-303`). `wan22-s2v` needs RunPod worker mode `s2v`,
  and `RUNPOD_WORKER_MODES` defaults to `i2v,t2v`
  (`app/lib/runpod-video.server.ts:67`) → `worker_mode_unavailable`. So
  **today, zero eligible tier can put synced speech on a face at all**, single
  scene or multi-scene. The only eligible tiers, `wan22-i2v` / `wan22-t2v`,
  are silent-clip RunPod tiers that support a non-lip-synced `voiceover`
  overdub (`scriptJson.voiceover`, muxed audio, mouth does not move) via the
  `'overdubbed'` audio path already in `advanceClip`.
- All TTS resolves one global voice via `getActiveIvrVoiceId()`
  (`app/lib/ivr-voice.server.ts`), a DB lookup against `ivr_voices` (`active`
  boolean, one active row), called from `video-pipeline.server.ts:1642, 1922,
  1972`. Sanity `CastMember` (`app/lib/sanity.server.ts:369-389`) has no
  `voiceId` field.
- The story layer already models multiple people ahead of the render
  contract: `video_episodes.storyboardJson` beats carry `speaker?: string`
  (`db/schema.ts:1787`), `.claude/agents/episode-writer.md:109-114` writes
  `<speaker>: "<line>"` per beat, and the approval-safety comparator
  `spokenTextOf` (`app/lib/video-episodes.ts:51-71`) **already reads
  `scene[i].spokenLine`** when comparing an approved episode's spoken text to
  a submitted render payload — a field that does not exist yet on
  `VideoSceneSpec` and that `validateScenes` would currently discard. This
  looks like forward plumbing left by whoever wrote the approval guard, not
  dead code to remove.
- `composeSceneFrame` accepts `extraImageUrls` (`app/lib/fal-video.server.ts:764,
  911, 976`); `scripts/generate-slate-2026-08-24.ts` already uses multiple
  cast reference photos for social **stills**. No two-person **video**
  (motion or audio) precedent exists anywhere in the tree.
- `app/lib/team-keys.ts` is a protected path (`PROTECTED_GLOBS` §1 cost gate,
  `app/lib/github.server.ts:797`). `VIDEO_FORMULAS`, `VIDEO_TONES`,
  `SCENE_KIT`, `VIDEO_EXTRA_KEYS`, `VIDEO_MAX_COST_CENTS_DEFAULT` all live
  there.

## Decision

### 1. Contract shape: per-scene presenter + per-scene spoken line, not a
   multi-talk single-frame render

Two shapes were compared:

**(a) Shot/reverse-shot** — extend `VideoSceneSpec` with per-scene
`presenter?: string` (same `PRESENTER_RE` grammar) and `spokenLine?: string`.
Each own-frame scene composes its identity frame from *that scene's*
presenter (not the job-level one), gets its own TTS pass in *that
presenter's* voice, and gets its own lip-sync/audio-driven render — a Maya
scene and a Diego scene, each single-speaker, concatenated by the existing
`concatAndNormalize` primitive in `advanceClipMultiScene`.

**(b) True multi-speaker single render** — two people in one frame, both
talking, needs a MultiTalk-class engine (simultaneous multi-identity
audio-driven generation). No such model is registered in `VIDEO_MODELS`, no
adapter exists, and `docs/media-providers-atlascloud-spike.md` /
`docs/store-team/video-worker-runpod.md`'s bake-off (Wan2.2-S2V vs
InfiniteTalk vs LongCat-Video-Avatar) evaluated single-identity audio-driven
avatars only. This is a new provider integration from zero, not a contract
change.

**Recommendation: (a), with a correction to how "already exists" is being
read.** `advanceClipMultiScene`'s concat plumbing exists and is reusable, but
the claim that it already reaches a two-hander needs a caveat: it doesn't,
today, for either reason available in the tree —

- the audio-driven avatar tiers (`omnihuman`, `wan22-s2v`, the only tiers
  that put synced speech on an individual face) are barred from multi-scene
  outright, and
- the one multi-scene-eligible talking tier (`sync-lipsync`) performs lipsync
  **once, over the concatenated whole, in one voice** — restructuring it to
  per-scene-before-concat is real new code in `advanceLipsyncPerform`, not a
  flip of an existing path. And `sync-lipsync` is itself currently
  ineligible (`retired_provider`), same as `omnihuman`.

So (a) is right, but "the existing multi-scene concat path already reaches
this" undersells the change. What must actually be built, once a talking tier
is eligible again (see §4):

- `VideoSceneSpec`: add `presenter?: string` and `spokenLine?: string`
  (`db/schema.ts:1563`) — pure TypeScript, no SQL migration, since
  `scenes_json` is already `jsonb`.
- `validateScenes` (`video-pipeline.server.ts:118-153`): validate
  `scene.presenter` against `PRESENTER_RE` per own-frame scene (default to
  job-level `presenter` when absent, for backward compat with existing
  single-speaker multi-scene jobs), require `spokenLine` on talking scenes,
  and **stop dropping these fields** in the returned object literal.
- Scene-frame composition (`findReusableSceneFrame`, the scene-kit reuse
  lookup in `api.team.video-job.tsx:351-354`, and whatever composes the
  own-frame candidates) must key identity off the **scene's** presenter, not
  the job's. Today `findReusableSceneFrame(scene.slug, 'emma')` hardcodes
  `'emma'` in the `config` op — that hardcode has to become
  presenter-parameterized.
- `advanceClipMultiScene` / `advanceLipsyncPerform`: move the TTS+lipsync
  pass **inside** the per-scene loop (own-frame or last-frame, each scene
  gets its own audio + performed clip) and concatenate *already-performed*
  clips, instead of concatenating silent clips and performing once at the
  end. This is the real render-stage-graph change.
- `dryRunEpisodeScript` / `estimateMultiSceneJobCostUsd`
  (`video-pipeline.server.ts:169-232`): the lipsync cost branch currently
  adds one TTS+lipsync pass over the *total* duration
  (`video-pipeline.server.ts:183-186`); it needs to become a per-scene sum,
  since each talking scene now pays its own TTS+lipsync cost.
- The approval-safety comparator (`spokenTextOf`,
  `app/lib/video-episodes.ts:51-71`) needs **no change** — it already reads
  `scene[i].spokenLine`. Naming the new `VideoSceneSpec` field `spokenLine`
  (not `presenterLine`) keeps that guard live with zero edits, which is why
  that's the field name in this decision rather than something new.
- `episode-writer.md`'s beat format (`<speaker>: "<line>"`) needs a
  downstream mapping step, wherever storyboard beats become
  `scriptJson.scenes`, from `speaker` (a cast slug/name in prose) to
  `presenter` (the `PRESENTER_RE`-shaped `friend:{slug}` string). That mapping
  doesn't exist yet; it's small but load-bearing — get it wrong and a scene
  silently renders in the wrong identity or wrong voice.

What breaks in (a): nothing existing, if additive as scoped above — old
single-`presenterLine` single-scene and single-speaker-multi-scene jobs stay
byte-identical (every new field is optional, default preserves current
behavior). What's added is genuinely new surface (render-stage-graph change,
frame-composition identity change, cost-estimate change), not a small patch.

What breaks in (b): everything is new — provider, model, cost model, content-
safety review (two people, one frame, one continuous talking render, is a
different risk shape than one presenter for the empathy/brand review that
gates cast content). Not recommended now; revisit only if reverse-shot cuts
prove creatively insufficient after (a) ships and is used.

### 2. Where the per-cast voice binding lives

**Sanity `castMember.voiceId` (new optional string field), not a DB table, not
team-keys.** Reasoning:

- Cast identity (photo, bio, persona notes, archetype, emotion tags) already
  lives in Sanity's `castMember` doc type (`app/lib/sanity.server.ts:369-389`).
  A voice is exactly the same *editorial casting decision* as a photo: it's
  who this recurring character is, decided once per character, not something
  that changes per run. Splitting "which face" (Sanity) from "which voice"
  (a new DB table) would violate single-responsibility for no benefit — two
  places to look up one casting fact.
- Per CLAUDE.md's Sanity rule, this is additive-only: a new field on the
  existing `castMember` schema, loader reads it with a fallback, no migration
  to Sanity's schema versioning, no protected path.
- **`getActiveIvrVoiceId()` being called from the video pipeline is a
  confirmed latent bug, not a hypothetical one.** `ivr_voices` (`db/schema.ts:
  579-590`) is IVR-scoped by name, purpose, and every doc comment in
  `ivr-voice.server.ts`; the video pipeline borrowing it means **every cast
  member today, including Emma, speaks in whatever voice IVR has active**,
  and flipping the IVR voice (an IVR-team decision) would silently reflow
  every video render. This is exactly the kind of cross-concern coupling the
  "one vendor per concern" principle exists to catch, except the violation
  isn't two vendors, it's two *unrelated features* sharing one DB row with no
  ownership boundary between them.

**Resolution order:** `castMember.voiceId` (Sanity, this scene's presenter) →
`ELEVENLABS_VOICE_ID_EMMA` or equivalent per-presenter env/setting for the
`emma` presenter specifically, since Emma isn't a `castMember` doc → hard
failure, not a silent fallback to the IVR voice. A cast member with no
`voiceId` assigned should **fail the enqueue** (`validateEnqueueCommon` /
`validateScenes`, same posture as a missing `presenterLine` today) rather
than render in the wrong voice or borrow IVR's. Two people accidentally
sharing a voice, or a cast member speaking in the support line's voice, is a
brand-identity defect a human won't necessarily catch on first watch; refuse
at enqueue time, the same way an unrenderable script is refused today
(`dryRunEpisodeScript`'s whole design principle).

**This is an owner brand decision, not an agent decision**, for the same
reason cast approval (`approvedForUse`) already gates `getApprovedCastMembers`
(`sanity.server.ts:366-367`) — a character's voice is as much a likeness
decision as their face. Voice assignment should happen at the same
Sanity-editor step as photo/persona approval, by the owner or whoever the
owner delegates likeness judgment to, not autonomously by video-producer.
video-producer should be able to *read* `castMember.voiceId` in the `config`
op response (`api.team.video-job.tsx:317-368`) so it knows a cast member is
enqueue-ready, but never write it.

### 3. Protected-path classification

Precise, against `PROTECTED_GLOBS` (`app/lib/github.server.ts:794-831`):

| Change | Protected? | Why |
|---|---|---|
| `db/schema.ts` (`VideoSceneSpec` + `CastMember`-adjacent types) | No | Not in `PROTECTED_GLOBS`. Ordinary reviewable PR. |
| `app/lib/video-pipeline.server.ts` (validateScenes, advanceClipMultiScene, advanceLipsyncPerform, cost estimate) | No | Not listed. |
| `app/lib/sanity.server.ts` (`CastMember.voiceId`) | No | Not listed. |
| `app/routes/api.team.video-job.tsx` (per-scene presenter validation) | No | Not listed. |
| Sanity `castMember` schema field addition | No | Sanity schema changes aren't in the git-file protected-glob mechanism at all; governed instead by CLAUDE.md's "additive only" rule, enforced by review, not by the release engine. |
| **New DB migration** (e.g. `db/migrations/087_*.sql`) IF this surface needed one | **Yes, `db/migrations/**`, but refined by content.** A migration that is *only* `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` clears via `refineMigrationProtection` and merges on the ordinary lane once `migration-dry-run` is green. This ADR's recommendation needs **no migration at all** (Sanity field + jsonb-typed columns already exist), so this row is moot for the recommended design — flagging it because if a future iteration needed a dedicated video-voice table instead of the Sanity field, that table-create would still be additive-only and still clear the ordinary lane. |
| Any new `team-keys.ts` constant (e.g. a new `VIDEO_EXTRA_KEYS` entry, a new `SCENE_KIT` requirement, a new cost-ceiling knob) | **Yes.** `app/lib/team-keys.ts` is explicitly listed (`github.server.ts:797`, "cost gate: valves, budget ceilings"). Escalates to the owner, no exception. |
| `app/lib/team.server.ts` (if the money-gate logic itself needs touching, e.g. per-scene cost-ceiling re-check ordering) | **Yes.** Listed directly. |

Net: the render-contract and voice-binding work described in §1-2 touches
**zero** protected paths as scoped. The one place this plan is likely to
brush a protected path is if per-scene talking cost estimation needs a new
`team-keys.ts` constant (e.g. a per-scene-lipsync cost cap distinct from the
existing per-video ceiling) — call that out explicitly to rr7-engineer before
it's discovered mid-PR, so the ticket carries the right escalation
expectation from the start rather than surprising the release engine.

### 4. Ordering against the pending s2v enablement

**Split into buildable-now and blocked-on-s2v. Do not treat this as one
monolithic blocked item.**

**Buildable and testable now, independent of `video-worker-runpod.md` steps
2-4:**

- `CastMember.voiceId` in Sanity, the resolution-order function, and the
  refusal-on-missing-voice behavior. This has zero rendering dependency; it's
  data model plus a pure function, unit-testable today.
- `VideoSceneSpec.presenter` / `.spokenLine` additive fields, and
  `validateScenes` accepting and preserving them (not dropping them). Also
  testable on paper against `video-multi-scene.test.ts` /
  `video-tier-eligibility.test.ts`-style unit tests without any live render,
  same pattern those existing test files already use (mocked worker modes).
- The `episode-writer.md` beat → `presenter` mapping step.
- **A genuinely shippable stepping stone that needs no talking tier at all:**
  per-scene `voiceover` (narration, not lip-synced) using a different
  ElevenLabs voice per scene/speaker, muxed via the existing `'overdubbed'`
  path onto `wan22-i2v`/`wan22-t2v` — both eligible today. This gets "Maya's
  voice, then Diego's voice, over scenes that show Maya and Diego" shipping
  now, with the honest caveat that mouths won't move in sync. Whether that's
  an acceptable interim product depends on the owner's tolerance for
  narration-style delivery vs. visible on-camera dialogue; flag it as an
  option rather than assuming it satisfies "cast members interacting."

**Hard-blocked until `wan22-s2v` is live (owner steps 2-4) AND the
multi-scene-audioDriven barrier is deliberately lifted in code:**

- Any render where a face's mouth visibly speaks in sync, for more than one
  identity, in the same episode. This needs both the worker mode deployed
  (owner-gated infra step, outside this ADR) and the three explicit
  multi-scene refusals removed (`api.team.video-job.tsx:105-107`,
  `video-pipeline.server.ts:203-204, 1407-1409`) — refusals that exist for a
  real reason (no per-scene motion-prompt concept on the audio-driven tier
  today) and must be replaced with real per-scene handling, not just deleted.

Recommended sequencing: build and merge the Sanity voice field + contract
additions now (unblocked, low-risk, no protected path), so that the day
`wan22-s2v` goes live, the only remaining work is the render-stage-graph
change in `advanceClipMultiScene`/`advanceLipsyncPerform` plus removing the
three refusals — not a redesign done under time pressure once the worker is
hot.

## Consequences

- Two-person dialogue with visible lip sync is farther out than "flip s2v on"
  implies: it needs the worker mode **and** a real render-stage-graph change,
  because the multi-scene path was built for one narrator, not a two-hander.
- The IVR-voice-borrowing bug becomes visible and fixable as part of this
  work rather than staying latent; worth fixing even if multi-cast slips,
  since it currently means every cast member (not just future multi-cast
  scenes) speaks in whatever voice IVR support has active.
- Voice casting becomes an explicit owner/likeness gate, matching photo
  casting, rather than something video-producer decides — consistent with
  the existing `approvedForUse` gate and with CLAUDE.md's "Admin = approval
  only" posture for anything touching brand/likeness.
- No protected-path escalation is required for the recommended design; a
  new `team-keys.ts` cost knob, if one turns out to be needed for per-scene
  talking cost estimation, will be.

## Addendum: two cost facts measured after the bake-off

Added 2026-08-31 from the render-operator review, both verified against the
tree and against the bake-off table in `docs/store-team/video-worker-runpod.md`.

**1. Splitting a line across speakers is close to cost-neutral; the 1800s
timeout forces splitting anyway.** S2V bills per second of *speech*, so a 36s
two-hander split across N single-speaker renders costs about the same render
dollars as one 36s single-speaker render. The genuine added costs of multi-cast
are frame compositions (each one an owner click) and per-render cold starts,
not GPU seconds. Separately, the fast8 bake-off measured 19.3 min of render for
14.2s of clip, about 81.5 render-seconds per clip-second, which puts the ceiling
of a single render at roughly 22 seconds of speech before the 1800s serverless
execution timeout. A 60-second episode therefore has to be split across renders
whatever its cast size. Shot/reverse-shot is not an extra cost imposed by
multi-cast; it is the shape the timeout already requires.

**2. The pre-flight s2v cost estimate under-prices by about 1.81x.**
`model-pricing.server.ts:218` maps `runpod/wan22-s2v` to
`estimateRunpodRatePerSecondUsd()`, the same estimate as the i2v/t2v tiers,
whose `RUNPOD_RENDER_SECONDS_PER_CLIP_SECOND = 45` (`:157`) was derived from an
i2v fast-path run. The bake-off has now measured s2v at about 81.5. At the
shipped defaults that is $0.0358 estimated against $0.0648 actual per
clip-second. `computeRunpodActualCostUsd()` corrects the ledger after the fact,
but the *estimate* is what the per-video ceiling and the daily budget gate read
before spending, so both gates currently admit roughly twice the work they
believe they are admitting. This is a cost-correctness defect that goes live the
moment `RUNPOD_WORKER_MODES` is widened, independent of multi-cast. Tracked
separately so it is not coupled to this ADR's schedule.

Note for whoever implements the frame work: the compositor can already place
two named cast members in one frame. `composeSceneFrame` takes `extraImageUrls`
(`fal-video.server.ts:764, 911, 976`) and
`scripts/generate-slate-2026-08-24.ts:65-67` already passes multiple cast
canonical photos this way for the owner social slate. `video-pipeline.server.ts`
is simply the one caller that never passes it. Two-named-cast composition is a
wiring gap on the video path, not a model limitation, and the stills path is
existing evidence that it holds.
