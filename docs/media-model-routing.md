# Media model routing

Which model generates what, and why. Binding on `media-manager`, `homepage-art-director`,
and `video-producer`: read this before changing an endpoint constant.

**Provider change 2026-08-15 (owner direction, all-hands): Atlas Cloud
(api.atlascloud.ai) is the primary still-image provider.** fal's failure rate on this
vertical made it unfit as the site pipeline; it remains the video pipeline, BiRefNet
background removal, and the still-image fallback. `generateImage()` order is now
Atlas → fal → Imagen. POC evidence 2026-08-15: `bytedance/seedream-v4.5/edit` on Atlas
passed the cast-presenter + insertable-toy reference pairing twice (Marcus studio,
Maya bed scene), held exact product geometry, honored exact 1728x2160 (true 4:5), at
$0.036/image in 22-31s. The same Seedream model on FAL was unusable (fal's own input
checker 422'd the packshot, see Rejected below) — the block was the host platform,
not the model. Earlier evidence: bake-off run 2026-08-10 against the FemmeFunn Booster
Rabbit with Maya as the presenter.

## The routing table

| Surface | Stage | Endpoint | Cost key | Why |
|---|---|---|---|---|
| Any still, no product ref | one shot | atlas `bytedance/seedream-v4.5` | `atlas/seedream-4.5` | primary since 2026-08-15 |
| Any still, with 1-10 refs (product, cast, both) | one shot | atlas `bytedance/seedream-v4.5/edit` | `atlas/seedream-4.5-edit` | one-stage composite passes the pairings fal-hosted models block; exact free-form sizes |
| Still fallback, no product ref | one shot | `fal-ai/flux/dev` | `fal/flux-dev` | fallback when Atlas unconfigured/errors |
| Still fallback, with product ref | one shot | `fal-ai/flux-kontext/dev` | `fal/flux-kontext-dev` | fallback; best fal-side product fidelity, ~25s |
| Admin + Sanity Studio hand-driven generation | one shot | via `generateImage()` | as above | was Imagen-only; now Atlas first, fal then Imagen fallback |
| Video scene frame, stage 1 (product plate) | plate | `fal-ai/qwen-image-edit-2511` | `fal/qwen-image-edit` | still on fal pending the phase-2 composite port to Atlas (one-stage seedream edit makes the plate pre-pass unnecessary; ticket filed 2026-08-15) |
| Video scene frame, stage 2 (composite) | composite | `fal-ai/flux-2/lora/edit` | `fal/flux-2-edit` | same as above |

## Rejected, with reasons

**`fal-ai/nano-banana/edit` — removed from the scene-frame path.** It is Gemini Flash Image
behind a fal wrapper and carries Google's non-configurable `IMAGE_SAFETY` output filter. It
returned `422 content_policy` for an ordinary catalog vibrator on every attempt, at every
`safety_tolerance` from 6 down to 3, against both the raw packshot and a clean AI-generated
plate. The block is on `body.prompt`, so no asset change rescues it. This was not a quality
preference: a large part of the catalog could not produce a scene frame at all.

**`fal-ai/bytedance/seedream/v4.5/edit` — not adopted ON FAL.** Blocked with `422
content_policy` on `body.image`, meaning fal's checker rejected the Shopify packshot on the
way in, with `enable_safety_checker: false` set. **2026-08-15 update: the identical model on
Atlas Cloud (`bytedance/seedream-v4.5/edit`) composites the same class of packshot with a
cast presenter cleanly — the 422 was fal's platform-level input filter, not the model.** Its
character-consistency lock is exactly as useful as advertised, and it is now the primary
edit endpoint (see the routing table).

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
- ~~**Block telemetry.**~~ **Landed.** Refused generations are now classified (refusal vs
  outage, and prompt-side vs image-side) and recorded, surfacing under **Refused generations**
  on `/admin/usage`. A model refusing repeatedly is a routing decision and belongs in the table
  above; an outage is a retry. See `app/lib/media-block.ts`. Note the rows live in
  `api_token_log` at zero cost under feature `media-blocks`, because a dedicated table needs a
  migration and `db/schema.ts` is a protected path.
- ~~**ADR-010.**~~ **Decided 2026-08-15.** Owner direction made Atlas Cloud the primary
  still-image provider (fal's aggregate failure rate, not just the two hosted-model
  rejections, drove the call). ADR-010 is Accepted with that scope; the remaining fal
  surfaces are video, background removal, and the still fallback. Residual owner item: the
  Atlas AUP contradiction recorded in `docs/atlascloud-aup-capture-2026-08-15.md`.
