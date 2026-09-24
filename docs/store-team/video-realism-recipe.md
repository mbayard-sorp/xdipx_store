# Video Realism Recipe: first frame and motion for product-talk clips

> Binding for `series-showrunner`, `episode-writer`, `social-art-director`, `media-manager` and
> `video-producer`. This is the first-frame and motion recipe for every product-talk clip: cap 30 s,
> aim 15 to 25, 9:16, one cast member on camera holding the product and telling a friend one true
> thing about it. It changes deliberately, by PR through the improvement bus, never mid-run.
>
> Owner rulings that bind this file (2026-09-23): the product may be in hand on camera; the spoken
> track runs at register 9, plain; the serialized show (`series-bible-the-group-chat.md`) is
> shelved for season 1. Script rules live in `docs/store-team/video-clip-rules.md`; standing owner
> complaints live in `docs/store-team/video-owner-notes.md`. Where this file and
> `instagram-campaigns.md` §3.2a disagree on the imagery ceiling, §3.2a wins.

## 1. Camera and light

- **Camera.** A phone propped at eye level. Field of view of a 28 to 35 mm lens, vertical.
  The crop is chest-up to mid-torso: the top of the frame just above the hair, the eyes at about 30%
  of frame height, the sternum at about 60%. Her eyes look straight into the lens. Depth of field is shallow but
  not creamy: the room behind her is soft and still legible as a room.
- **Ground lock.** A talking clip has a face and a room, so the backdrop stays inside the lock:
  coral-soft, plum-soft, or warm off-white linen, high-key daylight. Never write the word "paper" in
  a prompt; the model renders stationery.
- **Light.** One window key at about 45 degrees, bounce fill on the far side. One catchlight per
  eye. One side of the face is slightly darker than the other.
- **The first two slop tells.** Symmetric beauty light and the 85 mm studio portrait look. Either
  one reads as generated before she says a word. Reject the frame, do not grade it.

## 2. Skin, wardrobe, mouth

- **Skin language, in every frame prompt:** visible pores, fine facial hair, faint redness at the
  nose and cheeks, under-eye texture, a few loose hairs, lip texture.
- **Skin negatives:** airbrushed, porcelain, beauty filter, waxy, CGI.
- **Adult marker, in every frame prompt:** her age in words (a woman in her thirties), laugh lines,
  an adult hand. Never a youthful adjective. (`docs/design-doctrine.md` lines 269 to 278: generation
  drifts young unless told otherwise, and the gate rejects on ambiguity, not intent.)
- **Wardrobe.** Name the garment every time: a ribbed tank, an open linen shirt, a robe off one
  shoulder. Bare shoulders and collarbone are inside the ceiling. An unnamed garment becomes
  whatever the model defaults to, which is usually a studio.
- **Mouth.** Lips relaxed and slightly parted, no teeth. A closed-mouth grin hands the lipsync model
  teeth to invent, and invented teeth are the fastest way to lose the viewer.

## 3. The product and the hands

- **Placement and occlusion.** The product sits at the sternum: its top edge at least half a
  face-width below the chin, never crossing the jaw or mouth line, and its lowest point above 69% of
  frame height (y 1320 on a 1920 master), so the caption band at 1380 to 1500 never touches it. At
  that crop the product reads at roughly 250 to 400 px tall. Nothing sits between her face and the
  lens.
- **Grip per category** (from `instagram-campaigns.md` §3.2c, lines 656 to 667; the four marked (G)
  are still to be checked against the product pages):
  - Air-pulse or suction (G): palmed, thumb on the buttons, mouth of the head facing away from the
    palm.
  - Mini wand (G): fist on the handle, head down and forward.
  - G-spot or rabbit (G): held by the base, shaft curving up toward the body.
  - Bullet (G): pinched like a lipstick, tip forward.
  - Lube: bottle upright in the palm, cap closed, the manufacturer's mark to the lens is fine
    (licensed under §4 case 1); no barcode, ingredient panel or label text.
  - Glass: held by the base in a loose fist, tip up.
  - Plug and ring: the §3.2c treatments, in hand at chest height, never at the use zone.
- **One hand, one job.** One hand holds the product, and the prompt names what every finger is
  doing so each is visible. The other hand rests on a named object (a mug, the edge of the sofa, her
  knee) or is out of frame. No gesturing hand in frame one.
- **The talking position is "showing you".** Chest height, turned slightly toward the lens, the way
  you show a friend something across a table. It is never a use zone.

## 4. Negatives, in full

Every frame prompt carries this list:

no text other than the manufacturer's mark on the body of a product we stock; no barcodes, cartons
or labels; no captions or invented words (`docs/design-doctrine.md` §4 case 1, owner ruling
2026-09-19); watermark, extra fingers, fused fingers, hand half behind the product, product floating,
product not held, product near the mouth, hair across the mouth, teeth, dead eyes, doubled
catchlights, symmetric studio light, plastic skin, waxy skin, dim light, candlelit.

## 5. What carries over from the §3.2c shot bank

- **Carries over:** "the only hand in frame is doing one thing." One prop and an hour of light tell
  the story; a mug going cold and 9 a.m. window light say more than a set dresser.
- **Does not carry over:** camera placement, for a `talking` clip. The §3.2c winners are shot from
  behind or below; a talking clip is face-forward, at eye level, by definition. A `voiceover` clip
  may use those angles (§6).
- **Portrait cap:** whether reels are exempt from the §3.2a one-portrait-per-seven cap is pending
  owner decision, recommended yes, codified in the Phase 1a charter PR when he rules. Until then the
  cap stands.
- **On-skin:** product in hand is not an on-skin frame; on-skin stays out of every video frame,
  talking or voiceover (2026-09-22 boundary).

## 6. Motion routing

**Two production modes, chosen by the writers per clip** (owner ruling 2026-09-23,
`video-owner-notes.md` entry 3). `episode-writer` proposes the mode with one reason and
`series-showrunner` ratifies it in the pitch (`video-clip-rules.md` §6). The render never changes it.

- **`talking`: InfiniteTalk at 720p** (tier `italk-atlas`; order the upscale). The cast member on
  camera speaking, driven by her ElevenLabs cast voice, product in hand per §3. It won lip sync and
  natural motion in the 2026-08-30 bake-off (`video-worker-runpod.md` lines 162 to 169) and it is
  the only option that covers the 30 s cap in one pass. Length: cap 30 s, aim 15 to 25.
- **`voiceover`: Wan 2.7** (tier `wan27-atlas`). No lips on camera: a motion clip of the product in
  the cast member's hands or on a named surface, with the same cast member's ElevenLabs voice laid
  over it in assembly. The first frame may use the §3.2c shot bank angles (behind, below, hands
  only), but on-skin stays out of the video lane per the 2026-09-22 boundary
  (`instagram-campaigns.md`, standing order: it does not reach the video lane).
- **Voice consistency.** Every spoken word in every clip, in either mode, is the speaker's Sanity
  `voiceId`. A clip with no assigned cast voice is refused, never substituted.
- **Control its line-end drift in the script, not the render.** The same bake-off recorded that
  InfiniteTalk's sync drifts slightly on fast speech at the end of a line; that datum is the reason
  for the 12-word rule. Lines of 12 words or fewer, a breath or comma at every line end, a slower
  ElevenLabs pace, stability turned down so the voice varies.
- **Grok Imagine is not routed in season 1.** It invents its own voice, and the owner requires
  consistent voices. It stays available only for an owner-run A/B from `/admin/video-studio`.
- **Demonstrations never happen while she is talking.** They are 3 to 5 second silent inserts from
  Wan 2.7 image-to-video (`wan27-atlas`), with her audio continuing over them. The Spicy ids are
  not callable on the Atlas key (`docs/media-model-routing.md`, Atlas video bake-off 2026-09-23),
  so Wan 2.7 is the silent tier. A demonstration insert shows the product in her hand or on the
  named surface, turned to show the head or the buttons, never switched on against skin and never
  against the body. Every insert prompt carries the full §4 negatives and the §3.2a ceiling, judged on the insert's most revealing
  frame.
- **The ceiling holds on every frame of the clip, not only the first.** This replaces the P2 clause
  of the superseded `social-video-viral-checklist.md`.
- **Silent b-roll** runs on Wan 2.7 (`wan27-atlas`), or Wan 2.2 Turbo (`wan22turbo-atlas`) for
  drafts only.
- **Set-down fallback.** When hands fuse on a candidate, re-brief with the product set down within
  reach on a named surface (the nightstand, the arm of the sofa) and her hand resting beside it.
- **Every motion prompt asks for:** minimal hand movement, natural blink, soft breathing.

## 7. Cast continuity

- **One talking plate per cast member:** chest-up to mid-torso per §1, eye level, window light, stored on the additive
  Sanity field `talkingPlatePhoto`. It never overwrites `referencePhoto`.
- **Each clip's first frame** is a Seedream edit from the talking plate plus `bodyReferencePhoto`
  plus the product image.
- **What changes per clip:** wardrobe, hour, set. **What stays fixed:** the face and the lighting
  logic.
- **Standing sets:** bible §2 (`series-bible-the-group-chat.md`), read as a location bank under
  §3.8, not as canon.
- **Voices:** the cast voice ids on each Sanity `castMember` doc (bible §3), unchanged; the
  ElevenLabs read on every pitch uses that id.
- **Rotation.** Reels keep their own `instagram-campaigns.md` §3.8 ledger, separate from the stills'
  ledger, so seven daily stills do not crowd out three reels. Inside it: no location repeats within
  8, and no cast member in more than 2 of 5. On top of that, this recipe chooses three different
  speakers a week, which is stricter than 2-of-5.
- **Plate refresh.** Generate 4 candidates per cast member from the existing `referencePhoto`; the
  owner picks one. Pilot 2 cast members first, then the rest.

## 8. The owner's first-frame approval sheet

One image, four panels: the full 9:16 render, a 2x face crop, a 2x hands crop, and the product crop
beside the bare-product reference walked from the Shopify media list (§3.2c), never the featured
image.

Five reject conditions, verbatim:

1. **Face:** no catchlight or two per eye, eyes that do not converge on the lens, waxy skin, wrong
   teeth, drift from the talking plate, which was picked against the referencePhoto, any doubt she
   is an adult.
2. **Hands:** wrong finger count, fused fingers, a hand half-hidden, a hand with no job.
3. **Product:** colour, silhouette or distinguishing feature differs from the packshot; floats with
   no fingers taking its weight; any text on it beyond the manufacturer's mark. The comparison is against the bare-product reference
   walked from the Shopify media list (§3.2c), never the featured image.
4. **Occlusion:** product, hand or hair within half a face-width of the mouth or jaw.
5. **Light and story:** symmetric studio light, a background off the lock, no story cue so it reads
   as a catalogue shot with a person attached. The brief carries one story cue (an object or the
   hour of light, per §3.2c), and the check is that it is visible in panel 1.

## 9. What the owner sees before any spend

- One approval sheet per clip (4 candidates, about $0.15), with the script lines under it and the
  ElevenLabs read attached.
- No motion spend until he says yes.
- After the first yes, one pilot clip on InfiniteTalk ($1 to $2) is the gate before volume.
- Do not pitch concept boards. He is judging realism, so show him the frame that will move.

## 10. The three slop risks and their controls

| Risk | Controls |
|---|---|
| Plastic face and dead eyes | Skin language (§2), the talking plate (§7), one catchlight per eye (§1), 720p (§6), reject condition 1 (§8) |
| Fused or melting hands | One hand one job, the other resting (§3), minimal hand movement (§6), demonstrations as silent inserts (§6), the set-down fallback (§6) |
| Robotic delivery | Lines of 12 words or fewer with a breath at the end, stability down (§6), lips slightly parted (§2), cut at line boundaries, the pilot clip gate (§9) |
