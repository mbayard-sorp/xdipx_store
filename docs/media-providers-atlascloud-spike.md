# SPIKE: atlascloud.ai as an alternative media-generation provider

Date: 2026-08-09
Owner direction: all-hands 2026-08-08 (evaluate atlascloud.ai; tech-architect seam spec)
Ticket: #2018 (kind: code, strategy team)
Author: rr7-engineer (SPIKE, evaluation only)
Status: **Superseded 2026-08-15.** Owner direction (all-hands) made atlascloud the
PRIMARY still-image provider; ADR-010 is Accepted with that scope and records what
shipped. The ToS gate's first-party artifact now exists
(`docs/atlascloud-aup-capture-2026-08-15.md`) and did not cleanly clear — the owner
accepted the residual risk; see the capture doc's owner actions. The §1.3 avatar
carve-out and §1.2 background-removal findings still hold: video and BiRefNet stay
on fal.

## What this is and is not

This is a read-only evaluation plus three thin scaffold files. It changes no
production call path, uses no atlascloud API key, and adds no DB or VIDEO_MODELS
change (the ticket's NON-GOALS, restated and honored). The scaffold proves the
media seam wraps the incumbent (fal.ai) cleanly; the real extraction of the six
call sites is a separate, ADR-gated follow-up.

**Bottom line up front.** Wan 2.7 Spicy is a plausible *additive* provider for
the still-image and generative image-to-video workloads, where mainstream
models' safety filters reject sexual-wellness product imagery. It is **not** a
wholesale fal replacement: it does not cover the OmniHuman audio-driven avatar
tier (§1.3, HARD blocker), and the adult-content ToS gate is **not cleared from
this environment** (§2, HARD gate). Recommendation to the architect: **additive
challenger for stills + generative i2v only, gated**. Details queued as
`docs/adr/ADR-010-media-provider-abstraction.md` (Status: Proposed).

---

## 1. Capability / cost / latency comparison vs fal.ai

Figures for atlascloud are from public marketing/model pages surfaced via web
search on 2026-08-09; **the atlascloud.ai domain is egress-blocked from the
cloud-routine network, so none of it is a first-party verbatim capture** (this
matters most in §2). fal figures are the store's own configured rates
(`app/lib/fal-video.server.ts` `VIDEO_MODELS`) plus public 2026 fal pricing.

### 1.1 Still image generation

| | fal.ai (incumbent) | atlascloud.ai |
|---|---|---|
| Workload | `falGenerate` (FLUX dev / FLUX Kontext for ref-image), stills for homepage, ads, scene frames | Wan/FLUX-family image models, "40+ image models", OpenAI-compatible REST |
| Adult-product rejection | The store already routes here *because* Imagen refuses this vertical (see `fal.server.ts` header, `enable_safety_checker:false` on open FLUX) | Markets "uncensored" image models with no prompt filter, the specific value proposition the owner is chasing |
| Cost | flux-dev / nano-banana per-image (see `model-pricing` FAL rates) | pay-per-use; spicy image tiers advertised very low |
| Reference-to-image | FLUX Kontext (`refImageUrl` -> real product in scene) | Wan reference-to-video implies a reference path; **image ref parity unverified** |

Read: atlascloud is a **credible additive** here. fal already works for stills;
the reason to add atlascloud is fewer rejections on the most explicit product
scenes, not cost.

### 1.2 Background removal

| | fal.ai | atlascloud.ai |
|---|---|---|
| Workload | `removeBackground` (BiRefNet), used in the still pipeline | **No BiRefNet-equivalent surfaced.** Unverified. |

Read: **no evidence atlascloud covers background removal.** Even a full video
swap would leave `removeBackground` on fal, so the seam must keep fal available
regardless. Not a blocker (fal stays), but a fact against "replace fal".

### 1.3 Video: the five VIDEO_MODELS, and the OmniHuman parity HARD blocker

The store's five configured models and what a challenger must match:

| Store model (`VIDEO_MODELS`) | Tier | Rate/s (fal) | Kind | atlascloud parity |
|---|---|---|---|---|
| `veo31` | premium | $0.40 | generative i2v, native audio | Wan 2.7 Spicy i2v is a plausible *creative* substitute (not Veo), 1080p, ~$0.10/s |
| `veo31-fast` | premium-fast | $0.15 | generative i2v | same as above |
| `kling25-pro` | standard | $0.07 | generative i2v | Wan spicy i2v substitutes; fal Kling ~$0.03 to $0.07/s is already cheap |
| `seedance2` | standard | $0.31 | generative i2v, audio | Wan spicy i2v substitutes; atlascloud also lists Seedance spicy tiers |
| `omnihuman` | avatar | $0.16 | **audio-driven talking head** (TTS track + 1 identity frame) | **NO Wan 2.7 Spicy parity** |

**The HARD blocker.** `omnihuman` is audio-first: video length = audio length,
no prompt, no duration (`fal-video.server.ts` `buildInput` case `omnihuman`;
`audioDriven:true`). Wan 2.7 Spicy is image/reference-to-video. It animates a
first frame from a prompt; it does **not** consume a speech track and perform
lip-synced dialogue. So Wan 2.7 Spicy cannot replace the avatar tier. atlascloud
*does* list separate avatar/lipsync models in its catalog, but **OmniHuman-1.5
parity there is unverified** and out of scope for the owner's actual problem
(explicit product imagery getting rejected, which is stills + generative i2v).

Conclusion: **the avatar tier stays on fal/OmniHuman** in every scenario short
of a separately-verified audio-driven parity model. Any "replace fal" framing is
wrong; the live question is "add atlascloud for stills + generative i2v".

### 1.4 Latency

Not first-party measurable without a key (a NON-GOAL). Wan spicy i2v is queue-
based like fal's video queue; the seam's async submit/status/result shape (§3)
already models this, so latency differences are an adapter concern, not a seam
concern. Flagged for the adapter build, not resolved here.

---

## 2. Adult-content ToS: the HARD gate (NOT cleared here)

The ticket sets a hard acceptance criterion: **written confirmation of
atlascloud's adult-content ToS before any spend.** Findings:

1. **Contrary to the ticket's premise, a policy page IS discoverable:**
   `https://www.atlascloud.ai/acceptable-use`. atlascloud also publicly markets
   an "uncensored" API ("15+/18 NSFW video models", "40+ image models",
   "built for professional adult content creators … without content moderation
   barriers"). So the earlier "no discoverable content policy" note is stale.

2. **Search-surfaced AUP substance** (secondary, not verbatim): prohibits CSAM,
   non-consensual intimate imagery / deepfakes, and right-of-publicity /
   unauthorized-likeness violations; requires all users 18+; and treats
   AI-generated adult content between fictional consenting adults as permitted.
   On its face this is *compatible* with xdipx's use (marketing imagery of
   sexual-wellness products, suggestive, never pornographic, never a real
   person's likeness without consent).

3. **The gate is still NOT cleared, for a concrete environmental reason:** the
   atlascloud.ai domain is **egress-blocked from the cloud-routine network**, so
   this spike could not capture the verbatim AUP text first-party. Everything in
   point 2 is a third-hand search summary. "Written confirmation before spend"
   means a first-party artifact, and there is a real tension to resolve. A
   summary line reading "prohibits … adult content" sitting next to a storefront
   selling 18 NSFW models is exactly the kind of contradiction that a screenshot
   of the live AUP, or an email from atlascloud, must settle before money moves.

**Required to clear the gate (owner action, not agent):** obtain and file a
first-party artifact (a saved copy/screenshot of the live AUP, or written
sales/legal confirmation from atlascloud) that explicitly permits AI-generated
adult imagery of the kind xdipx would generate. Until that artifact exists, the
gate is **red** and no key is provisioned and no spend occurs. This is the same
posture as the store's other money valves: capability first, written approval,
then spend.

---

## 3. Interface sketch, cross-checked against all six fal call sites

The seam (scaffolded in `app/lib/media-providers/`):

- `types.ts`: `ImageProvider` (`generate`), `VideoProvider` (`submit`/`status`/
  `result` + `supportsAudioDriven`), provider-neutral input/output shapes, and
  `ProviderId = 'fal' | 'atlascloud'`.
- `registry.server.ts`: `getImageProvider(id)` / `getVideoProvider(id)`,
  mirroring `social-publish/registry.server.ts`. Only `fal` registered.
- `fal.server.ts`: thin wrapper delegating to the unchanged fal modules.

The ticket named "six fal call sites"; the actual importers of
`fal.server`/`fal-video.server` are the six below. Note: the ticket said
`homepage-media`, but the homepage/media path's fal seam is
`generate-image.server.ts`. Corrected here.

| # | Call site | fal symbols used | Seam method it maps to | Fits the sketch? |
|---|---|---|---|---|
| 1 | `app/lib/generate-image.server.ts` | `falConfigured`, `falGenerate` | `ImageProvider.configured` / `.generate` | ✅ (this is the homepage/media still path) |
| 2 | `app/lib/ad-creative.server.ts` | `falConfigured`, `falGenerate` | `ImageProvider.configured` / `.generate` | ✅ |
| 3 | `app/lib/video-pipeline.server.ts` | `VIDEO_MODELS`, `isVideoModelId`, `composeSceneFrame`, `submitVideoRequest`, `getVideoRequestStatus`, `getVideoRequestResult`, `downloadFalAsset`, `uploadToFalStorage`, `SCENE_FRAME_COST_KEY` | `VideoProvider.submit/status/result` **plus** two seam gaps below | ⚠️ partial |
| 4 | `app/routes/api.fal-video.compose.tsx` | `composeSceneFrame`, `falVideoConfigured` | scene-frame compose (gap) | ⚠️ not in v1 sketch |
| 5 | `app/routes/api.fal-video.generate.tsx` | `falVideoConfigured`, `submitVideoRequest`, `getVideoRequestStatus`, `getVideoRequestResult` | `VideoProvider.configured/submit/status/result` | ✅ |
| 6 | `app/routes/api.team.video-job.tsx` | `VIDEO_MODELS`, `isVideoModelId` | model catalog (gap) | ⚠️ metadata, not a call |

**Two deliberate seam gaps the v1 sketch does not yet cover** (flagged, not
silently omitted):

- **`composeSceneFrame`** (scene-frame kitbash: presenter + product photo -> 9:16
  candidate frames) is its own image op distinct from `generate`. The seam needs
  a third `ImageProvider` method (e.g. `composeScene`) or a separate
  `SceneFrameProvider`. Left out of v1 to keep the wrapper thin; called out for
  the adapter ADR.
- **Model catalog + asset I/O** (`VIDEO_MODELS`, `isVideoModelId`,
  `downloadFalAsset`, `uploadToFalStorage`, `SCENE_FRAME_COST_KEY`) are shared
  utilities, not per-provider calls. `download`/`upload` are fal-storage-specific
  and will need provider-neutral blob handling (the store already has
  `blob.server.ts`); the model catalog must become provider-scoped
  (`{provider}:{modelId}`) so `VIDEO_MODELS` isn't a fal-only global.

---

## 4. Blast-radius inventory for the real extraction refactor (follow-up)

The extraction (a separate ticket, ADR-gated) touches:

- **6 call-site files** (§3). Each swaps a direct fal import for a
  `getImageProvider()` / `getVideoProvider()` lookup. Sites 1, 2, 5 are clean;
  sites 3, 4 need the `composeScene` seam method first.
- **`model-pricing.server.ts` / `token-log.server.ts`**: cost keys are
  fal-scoped today. A second provider means provider-scoped cost keys and
  `VIDEO_RATES`/FAL-rate additions. **Touches cost logging, review carefully,
  though not a protected path.**
- **`fal-video.server.ts` `VIDEO_MODELS`**: becomes one provider's slice of a
  provider-scoped catalog. NON-GOAL for this spike (no VIDEO_MODELS change now).
- **DB**: `video_jobs` stores model ids; a provider-scoped id format may need a
  column or a value-format migration. **`db/schema.ts` + `db/migrations/**` are
  PROTECTED**. That piece is owner-authored, and is a reason the extraction is
  staged, not one PR.
- **Valves**: video spend already gates on `video_frame_review` and the video
  team budget. A new provider does NOT get a new valve; it inherits the same
  gates. Any change here is a protected team-valve change (owner-only).
- **Asset persistence**: `downloadFalAsset`/`uploadToFalStorage` are
  fal-storage calls; a provider-neutral path routes returned URLs through
  `blob.server.ts` instead.

Staging implied: (a) add `composeScene` to the seam; (b) migrate the 6 sites to
the registry with fal still the only provider (no behavior change, fully
testable); (c) provider-scoped cost keys + model catalog; (d) only after §2
clears and ADR-010 says "additive", the atlascloud adapter and its own key.

---

## 5. NON-GOALS honored

- No atlascloud API key used or provisioned.
- No production call path touched (the six sites are unchanged; the scaffold is
  imported by nothing).
- No `VIDEO_MODELS` change, no DB change.

## 6. ADR queued for the architect

`docs/adr/ADR-010-media-provider-abstraction.md` (Status: **Proposed**) records
the decision the architect owns: additive vs challenger vs rejected, contingent
on the §2 ToS gate clearing and the §1.3 avatar-tier carve-out.
