# Media model routing

Which model generates what, and why. Binding on `media-manager`, `homepage-art-director`,
and `video-producer`: read this before changing an endpoint constant.

Evidence: bake-off run 2026-08-10 against the FemmeFunn Booster Rabbit
(`femmefunn-vortex-booster-rabbit-...-pink`), chosen as the hardest realistic case in the
catalog (phallic geometry plus heavy packaging text), with Maya as the presenter. Prompts
came from the scaffolds in `docs/homepage-team/image-prompt-library.md`.

## The routing table

| Surface | Stage | Endpoint | Cost key | Why |
|---|---|---|---|---|
| Homepage / rail / promo still, no product ref | one shot | `fal-ai/flux/dev` | `fal/flux-dev` | incumbent, unchanged |
| Homepage / rail / promo still, with product ref | one shot | `fal-ai/flux-kontext/dev` | `fal/flux-kontext-dev` | incumbent, unchanged. Best product fidelity, but ~25s |
| Admin + Sanity Studio hand-driven generation | one shot | via `generateImage()` | as above | was Imagen-only; now fal first, Imagen fallback |
| Video scene frame, stage 1 (product plate) | plate | `fal-ai/qwen-image-edit-2511` | `fal/qwen-image-edit` | product fidelity equal to Kontext at ~7s instead of ~25s |
| Video scene frame, stage 2 (composite) | composite | `fal-ai/flux-2/lora/edit` | `fal/flux-2-edit` | only surviving model that held presenter identity |

## Rejected, with reasons

**`fal-ai/nano-banana/edit` — removed from the scene-frame path.** It is Gemini Flash Image
behind a fal wrapper and carries Google's non-configurable `IMAGE_SAFETY` output filter. It
returned `422 content_policy` for an ordinary catalog vibrator on every attempt, at every
`safety_tolerance` from 6 down to 3, against both the raw packshot and a clean AI-generated
plate. The block is on `body.prompt`, so no asset change rescues it. This was not a quality
preference: a large part of the catalog could not produce a scene frame at all.

**`fal-ai/bytedance/seedream/v4.5/edit` — not adopted.** Blocked with `422 content_policy` on
`body.image`, meaning its checker rejected the Shopify packshot on the way in, with
`enable_safety_checker: false` set. Its advertised character-consistency lock is the single
most useful capability in the catalog for our cast, and it is unreachable for this vertical.

**`fal-ai/flux-2/lora/edit` for product plates — not adopted.** It invented a different product
(merged rabbit ears, a fabricated three-button control panel). Good scenes, wrong product. It
is the compositor, never the plate.

## Two rules that came out of the run

**Never composite straight from a Shopify packshot.** Packshots routinely include the retail
carton. A one-shot composite puts the BOX in the presenter's hand with the manufacturer's brand
name legible on it, which breaks the no-text-in-pixels rule and ships a competitor's logo.
Stage 1 exists solely to remove that failure class, and it removed it completely.

**A cast member's reference photo propagates into every downstream frame.** Maya's canonical
`referencePhoto` is a deep-V cleavage shot, and the compositor faithfully carried that neckline
into scenes briefed as "elevated loungewear". Wardrobe register is fixed by re-shooting the
`castMember.referencePhoto`, not by fighting it in the scene prompt.

## Open

- **LoRA.** FLUX.2 held Maya's identity from a single reference, so per-character LoRAs are an
  optimisation rather than the fix they looked like before the run. A house-style LoRA is still
  worth testing. Training was not attempted: `rest.alpha.fal.ai` (fal storage, where the
  trainer wants its dataset zip) is outside the cloud-routine egress allowlist.
- **Block telemetry.** Every 422 above was invisible to our logs.
  `generate-image.server.ts` swallows a provider failure into a `console.warn` and falls
  through, so the rejection rate is unmeasured. Until that lands, changes here are judged by
  hand-run bake-offs rather than by trend.
- **ADR-010.** The atlascloud spike was premised on needing an uncensored provider. Open-weight
  FLUX and Qwen on fal already generate this vertical unfiltered, and the rejections traced to
  two specific hosted models. That weakens the case for a second provider; the ADR should be
  revisited with this evidence.
