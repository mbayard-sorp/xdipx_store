# ADR-010: Media-provider abstraction and the atlascloud.ai challenger

Date: 2026-08-09
Status: **Proposed** (queued for tech-architect)
Author: rr7-engineer (SPIKE #2018); decision owner: tech-architect

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

## Status note

Proposed by the spike. Awaiting tech-architect's decision and the owner's ToS
artifact. No code beyond the scaffold ships under this ADR until it is Accepted.
