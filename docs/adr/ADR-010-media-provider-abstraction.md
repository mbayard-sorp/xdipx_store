# ADR-010: Media-provider abstraction and the atlascloud.ai challenger

Date: 2026-08-09
Status: **Accepted 2026-08-15** (owner direction, all-hands: Atlas Cloud is the
PRIMARY still-image provider — beyond the spike's "additive" framing. fal remains
video, background removal, and the still-image fallback. See Decision outcome below.)
Author: rr7-engineer (SPIKE #2018); decision owner: tech-architect (superseded by owner direction)

## Context

Owner direction (all-hands 2026-08-08): evaluate atlascloud.ai, specifically
its Wan 2.7 Spicy image-to-video model (~$0.10/s, OpenAI-compatible REST), as an
alternative media provider that should reject fewer adult-product images than the
mainstream models the store uses. The full evaluation is in
`docs/media-providers-atlascloud-spike.md`. This ADR records the decision that
spike defers to the architect.

The store generates media through fal.ai from six call sites
(`generate-image.server.ts`, `ad-creative.server.ts`, `video-pipeline.server.ts`,
`api.fal-video.compose.tsx`, `api.fal-video.generate.tsx`,
`api.team.video-job.tsx`). A thin, provider-neutral seam is scaffolded at
`app/lib/media-providers/` (`types.ts`, `registry.server.ts`, `fal.server.ts`),
wrapping the incumbent with no behavior change. No atlascloud adapter, key, or
call path exists.

## Decision to be made

Choose one, and authorize (or not) the follow-up extraction + adapter build:

1. **Additive (recommended by the spike):** add atlascloud as a *second* provider
   for stills + generative image-to-video only, behind the existing video valves,
   with fal remaining default and the sole avatar-tier provider. Reason to do it:
   fewer safety-filter rejections on the most explicit product scenes.
2. **Challenger / replacement:** rejected by the spike. atlascloud has no verified
   OmniHuman-parity audio-driven avatar model and no surfaced background-removal
   equivalent, so fal cannot be fully retired.
3. **Rejected / hold:** do nothing beyond the scaffold.

## Hard gates on any option that spends money

Both must be cleared **before** a key is provisioned or the adapter is built:

1. **Adult-content ToS (owner action).** atlascloud.ai is egress-blocked from the
   cloud-routine network, so the spike could not capture the AUP first-party.
   Secondary search evidence suggests fictional-consenting-adult content is
   permitted while CSAM/NCII/deepfakes are prohibited, but a first-party written
   artifact (saved live AUP or sales/legal confirmation) is required and does not
   yet exist. See spike §2.
2. **Avatar-tier carve-out.** The `omnihuman` audio-driven tier stays on fal
   unless a separate atlascloud audio-driven model is verified to parity. Wan 2.7
   Spicy does not qualify. See spike §1.3.

## Consequences / staging (if Additive is chosen)

Per spike §4: add a `composeScene` seam method; migrate the six sites to the
registry with fal still the only provider (no behavior change, testable);
provider-scope cost keys and the model catalog; then, only after gate 1 clears,
build the atlascloud adapter and its key. Note the protected-path pieces
(`db/schema.ts`/migrations for a provider-scoped model id format; any team-valve
change) are owner-authored and are why the extraction is staged, not one PR.

## Decision outcome (2026-08-15)

Owner direction at the 2026-08-15 all-hands settled this ADR, overtaking the
tech-architect queue: **Atlas Cloud is the primary still-image provider for the
site**, not merely an additive challenger. Rationale: fal's aggregate failure
rate ("tons of failures and we rarely get what we want") made it unfit as the
site pipeline, independent of the two hosted-model rejections the routing doc
had traced. The owner provisioned `ATLAS_CLOUD_API_KEY` himself.

What shipped under this decision (same-day PR):

- `app/lib/atlas.server.ts` — the Atlas client (async generateImage/prediction
  REST, Seedream v4.5 default, 1-10 reference images in one stage).
- `generateImage()` order is now **Atlas → fal → Imagen**; `ad-creative` routes
  through the seam instead of calling fal directly.
- The seam registry gained the `atlascloud` ImageProvider;
  `DEFAULT_IMAGE_PROVIDER = 'atlascloud'`, `DEFAULT_VIDEO_PROVIDER = 'fal'`.
- POC evidence (2026-08-15): seedream-v4.5/edit passed the cast + insertable-toy
  reference pairing twice, held exact product geometry, honored true 4:5 pixel
  sizes; nano-banana blocked (same upstream Google filter as on fal);
  nano-banana-pro passed but invented the product.

What stays on fal, unchanged (the spike's carve-outs hold):

- The entire video pipeline, including the OmniHuman audio-driven avatar tier
  (§1.3 HARD blocker — no Atlas parity).
- BiRefNet background removal (no Atlas equivalent surfaced).
- The `composeSceneFrame` two-stage still path (qwen plate + FLUX.2 edit) until
  the phase-2 port lands (ticket filed 2026-08-15): one-stage seedream edit
  makes the plate pre-pass unnecessary for social/Notebook composites.

### Gate 1 (adult-content ToS) outcome

The first-party capture now exists: `docs/atlascloud-aup-capture-2026-08-15.md`.
It did not cleanly clear the gate — the full legal AUP (§7) prohibits
"illegal/adult content" while Atlas's own catalog sells "Spicy"/NSFW model
tiers. The owner accepted the operational risk by provisioning the key and
directing the migration. Residual owner action (open): obtain written
confirmation from Atlas (contact@atlascloud.ai) that tasteful, non-explicit
sexual-wellness product marketing imagery is permitted (contact address on
atlascloud.ai/docs — the docs obfuscate it from crawlers, so read it logged in),
and keep credit top-ups small until it arrives (credits are forfeitable on
termination without notice).
