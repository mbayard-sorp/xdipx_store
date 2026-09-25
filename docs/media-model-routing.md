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
| Video / cast scene frame, primary | one shot | atlas `bytedance/seedream-v4.5/edit` | `atlas/seedream-4.5-edit` | phase-2 port (ticket #3570, 2026-08-15): seedream holds product geometry from the ref AND composites the presenter in one call, so the two-stage plate + FLUX.2 route collapses to one `composeSceneFrame` → `atlasGenerate`. No plate pre-pass; the no-packshot-carton rule moves into the prompt (`ATLAS_NO_CARTON_CLAUSE`). Consumers unchanged (`composeSceneFrame` signature + `SceneFrameResult` identical; `plate` absent) |
| Video scene frame, fallback stage 1 (product plate) | plate | `fal-ai/qwen-image-edit-2511` | `fal/qwen-image-edit` | fal two-stage fallback, used when Atlas is unconfigured or the Atlas call errors |
| Video scene frame, fallback stage 2 (composite) | composite | `fal-ai/flux-2/lora/edit` | `fal/flux-2-edit` | same fallback path as above |

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

## Three rules that came out of the run

**Never composite straight from a Shopify packshot.** Packshots routinely include the retail
carton. A one-shot composite puts the BOX in the presenter's hand with the manufacturer's brand
name legible on it, which breaks the no-text-in-pixels rule and ships a competitor's logo.
Stage 1 exists solely to remove that failure class, and it removed it completely.

Three cases were being conflated under that one rule and are now distinct
(`docs/design-doctrine.md` §4 item 4 carries the same split):

- **The retail carton in frame.** `ATLAS_NO_CARTON_CLAUSE` addresses this: keep the box out of
  the shot entirely. Unchanged.
- **The manufacturer's brand mark on the product body itself.** Now allowed, owner ruling
  2026-09-19 ("Showing brand names is OK when we are placing actual products"). This is not a
  new mitigation, it is the edit endpoint doing what it already does: seedream-v4.5/edit holds
  reference-image text faithfully, and a wordmark molded or printed onto the product we are
  featuring is part of that same faithfulness. Nothing in the routing changes for this case.
- **Packaging junk** (barcodes, shipping labels, batch codes, ingredient paragraphs). Still
  unwanted. Proven NOT stoppable via the prompt negative alone: three of eight frames in the
  2026-09 run reproduced this kind of text with the negative present (atlas ids
  `0f66b19b24cb4608953df7ef547f0169`, `102469c103154c179d1dcc4fdc24824b`,
  `cff6ca1cab404e27b3a85cd4a5b6c5dd`). The control is not a better negative prompt, it is the
  legible-text report in the vision gate (PR #1226, ticket #10268): the gate transcribes any
  legible text/wordmark/barcode/label it finds and the caller decides, rather than the gate
  passing or failing on a fixed policy.

**A Shopify `featuredMedia` reference is sometimes the retail box, not the product.** Measured
2026-09-19: SKU 96203 (Lilac Licks) has the carton as media image A and the bare product as
image B. `featuredMedia` returned A. Using A as the `--ref-image` made the model reconstruct the
toy from box art and invent a stalk-and-club shape at the tip that does not exist on the real
product, a geometry hallucination downstream of a reference-selection bug, not a prompting
failure. Rule: never assume `featuredMedia` is a product shot. Walk the product's media list for
a text-free bare-product frame before using it as a reference.

**A cast member's reference photo propagates into every downstream frame.** Maya's canonical
`referencePhoto` is a deep-V cleavage shot, and the compositor faithfully carried that neckline
into scenes briefed as "elevated loungewear". Wardrobe register is fixed by re-shooting the
`castMember.referencePhoto`, not by fighting it in the scene prompt.

**Anchor product scale to a ratio between two things visible in frame.** A packshot carries no
scale reference, so "render at true real-world size" alone (`PRODUCT_SCALE_CUE`) left a palm-sized
product rendering at roughly twice life size in the 2026-08-17 run. The fix is a ratio the model
can measure inside the frame: the product is no wider than one third the presenter's face and
clearly smaller than their hand (`PRODUCT_SCALE_RATIO_ANCHOR`). It lives in the composite prompt
itself, emitted by `compositeProductClauses()` on both the fal two-stage and Atlas one-stage paths
so no script has to remember it, and it is phrased presenter-neutral (cast can be any gender).

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

## Atlas video bake-off 2026-09-23

Phase 0 items 5 and 6 of the video plan. Standalone script against Atlas REST, no pipeline, no
fal, no RunPod. Two cast members (`sofia`, `maya`), one in-stock product: Le Wand Mini Micro
(`le-wand-mini-micro-wand`, 69 in stock, bare frame `96384B.jpg`). Line, read by each cast
member's Sanity `voiceId`: "This is the mini wand. Reviewers keep saying the rumble is deep, not
buzzy. It fits in a coat pocket, and it does not care what time of day it is." The line reads in
8.7 s at a natural pace, not 15 to 20 s, so the audio was padded to about 9.9 s (0.4 s head, 0.8 s
tail) rather than slowed down. Every clip is downloaded; nothing below is claimed without the file.
Exact request and response bodies: `atlas-video-api.json` in the session scratchpad (Phase 2 adapter source).

**Shared shape.** Submit `POST https://api.atlascloud.ai/api/v1/model/generateVideo` with flat
JSON `{model, ...params}`. The response is `{code:200, data:{id, model, status:"processing",
outputs:null, urls:{get}, has_nsfw_contents:null, error:""}}`. Poll `GET /api/v1/model/prediction/{id}`
until `data.status` is `completed|succeeded|failed`. `pending` shows up after `processing`
(InfiniteTalk), so anything else counts as running. `data.outputs[0]` is an aliyuncs mp4, so download it
in the same tick. `data.price` comes back on some models and not others, so price from the rate table.
Upload inputs with `POST /api/v1/model/uploadMedia` (multipart `file`), which returns
`data.download_url`. An unknown model id returns `400 {"code":400,"msg":"not found"}` with no charge.
Cloudflare returns 403 `error code: 1010` for a default Python-urllib User-Agent.

| Model | Model id | Request body | Seconds (wall) | Dollars | Pass/block | Grade (face / hands / lipsync / product) | Notes |
|---|---|---|---|---|---|---|---|
| InfiniteTalk | `atlascloud/infinitetalk` | `{model, image, audio, prompt, resolution:"720p", seed}` | 237 (sofia), 203 (maya) | ~$0.60 each (list $0.03/s base, 720p assumed 2x; no `price` in response) | Pass, both | Maya A- / A / A (mouth settles closed on tail pad) / A. Sofia B / A / B- (over-articulated pursing, a wink, mouth held open with teeth through the 0.8 s silent tail) / A | 704x1280 25 fps, length = audio. Cast voice kept. Hand and product locked for the whole clip |
| Grok Imagine v1.5 i2v | `xai/grok-imagine-video-v1.5/image-to-video` | `{model, prompt, image_url, duration:10, resolution:"720p", aspect_ratio:"9:16"}` | 53, 53 | $1.41 each (`data.price`, = $0.141/s at 720p; the "from $0.08/s" list is the floor) | Pass, both | Sofia A- / A / A / A. Maya A / A / A / A | No dialogue field: the line goes in `prompt` as `She looks into the lens and says ...: "<line>"`. Spoken verbatim both times (whisper), ends at 9.5 s of 10. **Voice is Grok's, not the cast's ElevenLabs voice.** The model page says xAI bills ToS-blocked requests in full |
| Wan 2.7 i2v (silent insert) | `alibaba/wan-2.7/image-to-video` | `{model, image, prompt, negative_prompt, resolution:"720P", duration:5, prompt_extend:false, seed}` | 27, 27 | $0.50 each (`data.price`) | Pass, both | Maya A- (does the brief: turns the wand to show the head, grip changes cleanly). Sofia C (pushes the wand at the lens until the head is face-sized, a product-scale break) | Uppercase `720P`. Returns a -69 dB near-silent audio track, strip it |
| Wan 2.2 Turbo i2v (silent insert) | `atlascloud/wan-2.2-turbo/image-to-video` | `{model, image, prompt, negative_prompt, resolution:"720p", duration:5, seed}` | 44 (maya), ~60 (sofia) | $0.10 each (list $0.02/s) | Pass, both | B-: product and hand stable, but both break into a toothy laugh and turn the head, off-brief, with mild identity drift | 728x1264, not 720x1280, so rescale. Duration is 5 only |
| Wan 2.2 / 2.7 **Spicy** | `alibaba/wan-2.2-spicy/image-to-video` (schema exists on static.atlascloud.ai) | same as Turbo | n/a | $0 | **Not available**: `400 not found` for every spicy id tried | n/a | Spicy tiers are not in `GET /api/v1/models` (513 models) and not callable on this key. Wan 2.7 and Wan 2.2 Turbo were run as the silent tier instead |

No clip was content-blocked (`has_nsfw_contents: null` on all eight). A cast member holding a real
catalog vibrator at the sternum passed on every model tried.

**Talking plates (item 6).** 12 Seedream v4.5 edit candidates (4 sofia; 8 maya, because the first 4
all showed a full-teeth grin and failed the teeth check). Best per person for the bake-off: `sofia-2`
(plum-soft, diagonal head-forward grip, clean hand) and `maya-6` (warm off-white linen, slight teeth,
curls pulled back so the hair differs from `referencePhoto`). The owner makes the final pick. Known recipe
failures: the "head down and forward" grip mostly came back head-up, and when the r2 prompt forced the
head down (maya 5, 7, 8), the head landed against the cleavage, a §3.2c press or depicted-use risk. The
embossed "le WAND" on the real product renders as faint text, which is the product and not an invented label.

**Recommendation.**
- Default talking tier: **InfiniteTalk 720p** from the cast plate plus the ElevenLabs read. It
  keeps the cast voice, keeps hand and product still, and runs about $0.06/s. Budget 3 to 4 min per
  10 s clip, and gate on the tail: when the mouth stays open through the silent pad, trim to the
  last word and re-roll that cast plate, not the audio.
- Fallback talking tier: **Grok Imagine v1.5**, 10 s or less, only where voice continuity does not
  matter or after an owner A/B. It had the best motion realism of the run, but it is about 2.3x the
  price and speaks in its own voice.
- Silent insert tier: **Wan 2.7 i2v at 720P, 5 s** ($0.50). The motion prompt needs a
  "keep the product at the same distance from the camera" clause, since Sofia's run failed on scale. Wan 2.2 Turbo
  ($0.10) is the cheap draft tier only. Spicy is not reachable on this account, so ask Atlas whether it needs
  enabling, bundled with the open AUP confirmation.
- Bake-off spend: about $5.65 (plates $0.43, InfiniteTalk about $1.20 estimated, Grok $2.82, Wan 2.7 $1.00,
  Wan 2.2 Turbo $0.20).
