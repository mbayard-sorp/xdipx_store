# Arcads.ai Capability Assessment and Build Plan for the xdipx Video Toolset

Status: PROPOSAL — owner review requested. Authored 2026-08-09 from a web assessment of
Arcads.ai (direct site partially unreachable from the build environment; features cross-checked
across six independent 2026 reviews) and a full audit of the repo's video pipeline.

## 1. What Arcads.ai is

Arcads.ai is a script-to-video generator for UGC-style ad creative. The operator pastes a script
(or a product URL and lets the tool write one), picks an AI actor from a library of 300-1,000+
performers built from real human footage, and receives a finished talking-head vertical video in
about two minutes. Reported pricing: roughly $110/month for 10 videos (about $11 per video),
$220/month for 20, custom above that, no free tier.

Feature inventory (2026):

| # | Arcads feature | Notes |
|---|---|---|
| F1 | AI actor library (300-1,000+) | Demographic variety; realism is the headline claim |
| F2 | Custom avatar creation | Likeness cloning; extra time and fees |
| F3 | AI script generation + hook writer | From a pasted product URL; hook/body/CTA structure |
| F4 | Text-to-speech in 35+ languages | Localized variants of one ad |
| F5 | Speech-to-speech | Upload your own read; tone/cadence mapped onto the actor |
| F6 | Emotion and gesture control | Tone tags ("persuasive", "excited") change face + hands |
| F7 | Batch/bulk generation | Dozens-hundreds of variants: hooks × actors × backgrounds in one operation |
| F8 | Workflow canvas | Team-facing collaborative surface for assets and feedback |
| F9 | Multi-model generation | Sora 2 Pro, Kling, Seedance 2.0 under the hood |
| F10 | One-click B-roll / music / captions / transitions | Reviewers consistently call this thin; most users finish in CapCut/Premiere |
| F11 | Product-in-hand | Multi-step custom-actor flow, not a library default |
| F12 | MP4 export for TikTok/Meta/Shorts | Export only; no ad-platform integration, no analytics, no A/B infrastructure |

Consistently reported limitations: talking-head-only format, no real editing suite, no analytics or
posting integration, no free trial, and per-video cost around $11.

## 2. Where xdipx already stands

The repo has a production-grade, durable, cost-gated video pipeline. This is not a greenfield
comparison; roughly 70% of the Arcads loop already exists, and the governance layer is ahead of
anything Arcads offers.

Already built (with the Arcads feature it matches):

- **AI actors with governance (F1/F2).** Emma plus the "friends of Emma" cast in Sanity
  (`studio/schemas/castMember.js`), each with a reference photo and an `approvedForUse` gate that
  starts false. Identity drift is controlled by scene-frame reuse keyed on scene + presenter
  (`app/lib/video-pipeline.server.ts:265`).
- **Talking-head avatar generation (F1).** OmniHuman 1.5 audio-driven rendering with pre-TTS
  script splitting at beat boundaries, same-identity-frame joins, and a real-audio duration guard
  (`video-pipeline.server.ts:494-604`).
- **TTS (F4, partially).** ElevenLabs `eleven_multilingual_v2` with the store-consistent voice
  shared with the IVR (`app/lib/elevenlabs.server.ts`, `app/lib/ivr-voice.server.ts`). The model
  is multilingual-capable; the pipeline currently only produces English.
- **Multi-model generation (F9).** Five fal.ai models in the registry (`app/lib/fal-video.server.ts:62-113`):
  Veo 3.1 + Veo 3.1 fast (premium), Kling 2.5 Pro and Seedance 2.0 (standard), OmniHuman (avatar),
  plus nano-banana for scene-frame composition.
- **Product-in-frame (F11).** The nano-banana scene-frame step composes presenter photo + real
  product photo into a 9:16 still, with a 3-candidate human frame gate before any dollar spend.
- **Captions, music, post pass (F10).** Burned DM Sans captions, punch-in cuts every ~3.5s, an
  ElevenLabs music bed, -14 LUFS loudnorm, watermark, poster extraction
  (`app/lib/video-postpass.server.ts`, `app/lib/video-assembly.server.ts`). Every step degrades
  gracefully to its input on failure.
- **Script quality control (better than F3).** The video-producer agent writes scripts against an
  11-formula library and the 20-rule viral checklist, then a second agent
  (emma-empathy-reviewer) issues per-rule PASS/FAIL verdicts with BLOCK authority. Arcads has
  nothing equivalent; its script generator is generic ad copy.
- **Distribution fan-out (beyond F12).** One approval in `/admin/video-studio` fans out to social
  drafts per platform, Shopify product media or the `hero_video` metafield, and `ad_creatives`.
  Arcads ends at an MP4 download.
- **Cost control (no Arcads equivalent).** Three independent ceilings (enqueue-time hard ceiling,
  mid-job recheck on real TTS seconds, team daily budget gate) plus a per-job spend ledger.
  Realized cost per video is $1.80-$5.20 on the launch slate versus Arcads' ~$11 — and our $6
  per-video ceiling is a valve, not a plan tier.

## 3. Gap analysis — what Arcads has that we do not

| Gap | Arcads | xdipx today | Verdict |
|---|---|---|---|
| G1 Batch variations (F7) | Core pitch: hooks × actors × scenes in one operation | One script = one job = one video | **Build.** Highest-leverage gap; our frame-reuse mechanic makes it cheap |
| G2 Word-timed captions (F10) | Word-pop captions standard in the genre | Char-proportional phrase timing | **Build.** Already the documented upgrade path (ElevenLabs with-timestamps) |
| G3 Multi-format masters (F12) | 9:16 export; genre expectation is 9:16/1:1/4:5 | 9:16 hardcoded end to end | **Build.** Post-pass reframe step; static `ad_creatives` already defines the three ratios |
| G4 Emotion/tone control (F6) | Tone tags change face + gestures | Free-text motionPrompt only | **Build (cheap).** ElevenLabs v3 audio tags + a small tone vocabulary in scriptJson |
| G5 Self-serve compose UI (F8) | Whole product is the UI | Enqueue is agent-only; Video Studio is review-only | **Build (small).** An owner "compose" form on Video Studio posting the same enqueue op |
| G6 Lip-sync on standard tier | All actors speak | Kling tier is silent b-roll + dubbed VO; on-camera mouths banned there | **Build (wire-up).** `fal/sync-lipsync` is already priced, just not in the model registry |
| G7 Hook/script generator (F3) | Paste URL, get script | Agent writes scripts weekly | **Partial.** Add a hook-variant generator op for G1; keep the voice gate mandatory |
| G8 Speech-to-speech (F5) | Upload your own read | None | **Defer.** Owner-recorded reads are not part of the Emma model |
| G9 35-language localization (F4) | 35+ languages | English only | **Defer.** US-only store; revisit with market expansion |
| G10 Actor marketplace scale (F1) | 300-1,000+ actors | Emma + small approved cast | **Skip.** Brand runs on one persona; unmanaged likenesses are a liability here |
| G11 Text-to-video | Sora 2 direct | Image-to-video only | **Skip for now.** The frame gate is our identity + content-safety control point; text-to-video bypasses it |

Also absent on both sides: analytics, A/B measurement, auto-posting. We already have the better
foundation (owner-reported per-video scorecard, UTM wiring, GA4) and auto-posting stays behind the
existing owner-gated valves by policy.

## 4. Assessment

**Do not buy Arcads; build the four gaps that matter.** Rationale:

1. **Cost.** Arcads is ~$11/video with a $110/month floor. Our pipeline lands $1.80-$5.20/video
   on fal.ai retail rates, with reused scene frames zeroing the frame cost of every variant after
   the first (`estimateJobCostUsd` zeroes frame cost when `reuseFrame` is set).
2. **Category risk.** Arcads is built for mainstream DTC ad creative. Our survival rules (no
   product-on-body, most-revealing-frame judgment, register caps per platform, AI-content labels)
   are enforced by our own voice gate and frame gate; a third-party tool enforces none of that and
   its ToS may not welcome the category at all.
3. **Brand.** Emma is the asset. An actor library is a liability for a one-persona brand; our
   Sanity cast governance (approvedForUse, likeness rules) is the right shape already.
4. **The one thing Arcads truly has over us is volume** — batch variation across hooks, actors,
   and scenes. That is an orchestration feature, not a generation feature, and our architecture
   makes it a modest build.

## 5. Build plan

Sequenced by leverage per unit of build. Every phase keeps the existing gates untouched: voice
gate before enqueue, frame gate before spend, owner approval before distribution, budget valves on
everything. All work ships as reviewable PRs through the release engine; **Phase 1 touches
`db/schema.ts` and a migration, which are protected paths, so that PR stops and escalates to the
owner for merge by policy.**

### Phase 1 — Batch variation engine (the Arcads killer feature)

The unit changes from "a video" to "a creative set": one approved concept, N variants.

- Schema: add `variant_group_id` and `variant_axes` (JSON: hook text, presenter, scene, model
  tier) to `video_jobs`. One migration. **Protected path — owner merges.**
- Enqueue: extend `POST /api/team/video-job` with an `enqueue-set` op taking a base scriptJson
  plus axes (up to N hooks × M presenters/scenes), expanding to individual jobs that share a
  `variant_group_id`. Set-level cost estimate checked against the ceiling before any job is
  created; per-job ceilings unchanged.
- Frame economics: variants reusing an approved scene frame skip frame composition and its cost
  entirely (mechanism already exists); only genuinely new presenter × scene combinations park at
  the frame gate.
- Video Studio: group by variant set; approve/reject per variant; "approve all in set" for fan-out.
- video-producer charter: allow one weekly slot to be a variant set (e.g. 1 concept × 4 hooks)
  instead of 4 unrelated videos; every hook variant still passes the voice gate individually.
- New valve: `video_variants_max_per_set` (seed 4) so a runaway matrix cannot exhaust the daily
  budget in one op.

DONE WHEN: one enqueue-set call with 3 hook variants off one approved frame produces 3 finished
videos whose total logged cost is under 1.4× a single equivalent video, and Video Studio shows
them as one reviewable group.

### Phase 2 — Post-pass quality parity (captions, formats, end card)

- Word-timed captions: request ElevenLabs `with-timestamps` at TTS time, store word timings in
  scriptJson, and drive `burnCaptions` from real timings; char-proportional stays as the fallback
  for the silent tier (already the documented upgrade in `video-postpass.server.ts:124-126`).
- Multi-format masters: add a reframe step to the post pass producing 1:1 and 4:5 crops from the
  9:16 master (face-biased crop logic already exists in `applyPunchIns`), stored as additional
  `media_assets` on the job; fan-out picks the right ratio per destination.
- End card: a 1.5s outro composited from the watermark logo + one whitelist CTA, behind a
  `video_endcard_enabled` valve (seed false until the owner approves the design).
- Wire `generateSoundEffect` (exists, uncalled) as an optional hook-moment accent, off by default.

DONE WHEN: an avatar video renders with word-pop captions matching the spoken audio within one
word, and the same job yields 9:16 + 1:1 + 4:5 masters and an end card when the valve is on.

### Phase 3 — Performance range (tone control + standard-tier lip-sync)

- Tone control: add an optional `tone` field to scriptJson beats (small vocabulary: warm,
  playful, direct, hushed), mapped to ElevenLabs v3 audio tags for delivery and appended to the
  avatar motion prompt for expression. Charter documents the vocabulary; voice gate checks tone
  against register caps.
- Lip-sync tier: register `fal/sync-lipsync` (already priced at $0.05/s in
  `model-pricing.server.ts`) in `VIDEO_MODELS`, creating a mid-price talking path: Kling clip +
  TTS + lipsync ≈ $0.12/s vs OmniHuman's $0.16/s, and lifting the "no on-camera mouths on the
  silent tier" restriction where the charter allows.

DONE WHEN: two renders of the same line with different tones are audibly and visibly distinct,
and a lipsync-tier video passes the frame gate and post pass end to end.

### Phase 4 — Self-serve compose surface (Arcads' UX, our gates)

- A "Compose" form on `/admin/video-studio`: pick product, formula, presenter, scene, hooks
  (or request AI hook variants), tier — posting the existing enqueue/enqueue-set op under the
  admin session. The owner gets the two-minute Arcads experience with every existing gate intact.
- Optional: expand the scene kit beyond the six fixed scenes via the existing Sanity-governed
  pattern (new scenes still require owner frame approval on first use).

DONE WHEN: the owner can go from product pick to a queued variant set in under two minutes
without touching the API, and nothing about the gate chain changed.

### Phase 5 — Multi-scene jobs (20-60s videos)

Shipped (branch `agents/video-multi-scene`, migration 083). A job may now describe 2-8 scenes,
each rendered as its own clip and concatenated into one longer video, instead of always one scene
frame + one clip. Single-scene jobs are untouched — the poller only takes the multi-scene branch
when `scriptJson.scenes` has 2+ entries.

**Payload.** `op:'enqueue'` on `POST /api/team/video-job` accepts `scriptJson.scenes`:

```ts
scenes: Array<{
  slug: string             // scene-kit style label, shown in Video Studio
  framePrompt: string      // only used for 'own-frame' scenes
  motionPrompt: string
  durationSeconds: number  // must be one of the rendering model's allowedDurations
  continuity?: 'own-frame' | 'last-frame'  // default: scene 0 own-frame, every later scene last-frame
}>
```

Validated at enqueue (`video-pipeline.server.ts`'s `validateScenes`): 2-8 scenes, each duration in
the rendering model's `allowedDurations` (the lipsync compound tier's BASE CLIP model, same
resolution `advanceClip` already used), total duration <= 90s, `scenes[0]` cannot be `last-frame`
(nothing precedes it). The top-level `durationSeconds` field is ignored once `scenes` is present —
the real total is the scene-duration sum. The avatar tier (OmniHuman) is not supported for
multi-scene: it has no per-scene motion-prompt concept at all (duration derives from one spoken
line). `enqueue-set` does not support scenes.

**Continuity.** `'own-frame'` scenes go through the normal scene-frame gate (composed, and — with
`video_frame_review` ON — parked for the owner's pick) exactly like a single-scene job. `'last-frame'`
scenes skip frame composition entirely: the clip stage animates the PREVIOUS scene's rendered clip's
final frame instead, so motion reads as one continuous shot across the cut. RunPod's worker returns
that last frame directly in its result; fal providers get it via a new `extractLastFrame` ffmpeg
helper in `video-assembly.server.ts`.

**Approval.** `approveSceneFrame` takes an optional `sceneIndex` — for a multi-scene job it approves
ONLY that scene; the poller composes the next pending own-frame scene's candidates on its own, and
advances to the clip stage once every own-frame scene has a pick. `/admin/video-studio` shows a
per-scene frame picker (`MultiSceneFramePicker`) instead of the single flat grid when a job has
scenes. Per-scene frame candidates are correlated by parsing the scene index out of the blob path
(`video/<jobId>/scene-<idx>-frame-<i>.jpg`) rather than a new media_assets column.

**Cost.** Sum over scenes of (frame cost for own-frame scenes only, skipped on scene 0 when the job
reuses an existing approved frame + clip cost at that scene's duration); the per-video ceiling check
uses that sum, same as every other tier.

**Render + assembly.** The clip stage renders scenes strictly in order, one scene per poller tick
(same submit-or-poll discipline as everywhere else in the pipeline). Once every scene's clip is
recorded, the clip stage concatenates all of them (`concatAndNormalize`, already existed as a
fast-follow surface) into ONE new `'clip'`-purpose `media_assets` row — the newest such row — and
hands off to `stage: 'lipsync'` exactly like a single-scene job. Because `advanceLipsync` /
`advanceLipsyncPerform` / `advanceAssembly` / `advancePoster` already resolve "the clip" as the
newest `'clip'`-purpose asset, none of those four stages needed a multi-scene branch of their own —
multi-scene jobs converge back onto the byte-for-byte single-clip path from the lipsync stage on.

DONE WHEN: a 3-scene job (own-frame, last-frame, last-frame) enqueues under the 90s ceiling, parks
once per own-frame scene for approval, renders scenes in order using the right frame source each
time, and produces one finished video whose duration is the sum of its scenes.

### Explicitly not building

- Speech-to-speech, 35-language localization (defer; no current market need).
- Actor marketplace scale, text-to-video, auto-posting (skip; each undermines a control we rely
  on — likeness governance, the frame gate, and the owner-gated posting valves respectively).

## 6. Cost model

| | Arcads | xdipx after Phase 1 |
|---|---|---|
| Talking-head 30s | ~$11 | ~$5 (OmniHuman $0.16/s + TTS + post) |
| Each additional hook variant | ~$11 | ~$1-3 (frame reused; clip + TTS only) |
| B-roll 8s | ~$11 | ~$0.60-1.80 (Kling $0.07/s) |
| Monthly floor | $110 | $0 (valves; $20/day cap already seeded) |
| 4-variant creative set | ~$44 | ~$9-12 |

At the strategy doc's launch cadence the entire pipeline runs ~$35-40/month — under half of one
month of Arcads' entry tier, with variants nearly free at the margin.

## 7. Sources

Arcads.ai feature and pricing claims cross-checked across: eesel.ai review and pricing analyses,
EzUGC review, AI Creative review, Filmora review, dupple.com, aigearbase.com, wireflow.ai
(Arcads vs Creatify), fluxnote.io, rankdots.com, airpost.ai, novoads.ai, and lensgo.ai
(Seedance 2.0 comparison), all 2025-2026 editions; arcads.ai feature pages for speech-to-speech
and text-to-speech (titles via search; site blocked from this environment). fal.ai model pricing
from fal.ai model pages and wavespeed.ai comparisons. Repo facts from the 2026-08-09 pipeline
audit (files cited inline).
