# Campaign look, the router

> One page. This document does not define the look. It says what the look is right
> now, where its specification lives, which surfaces have adopted it, and what is
> still missing. If you want the rules, follow the pointer. A second copy of a
> ceiling is a copy that goes stale, and that is how an explicit frame reached the
> live feed on 2026-08-16.

## 1. The active look, in three sentences

The active treatment is **on-skin**, set by the owner on 2026-09-19: "products
against skin on the body. I want to see the edges of breasts, the pubic mounds,
bellies, backs, butt cheeks. No full nudity, but the suggestion that the subject
is nude is what I want". On 2026-09-20 the owner defined the one hard word in
that sentence: nudity means visible nipples, labia, penis, or anus, and
everything else is allowed. At the same all-hands the owner extended the
treatment past social: "On-skin extends to all areas of the site".

## 2. Where the specification lives

`docs/store-team/instagram-campaigns.md` **§3.2c**, inside the §3.2a ceiling.
That is the only place the treatment is written down: the crop language, the cast
body references, the no-clothing rule, the implied-nude framing, and the stop
list. Every other document in this repo, including this one, points at it.

## 3. Per-surface status

| Surface | Status | Doc carrying that surface's ceiling |
|---|---|---|
| Homepage (hero, rails, tiles) | Adopt | `docs/design-doctrine.md` §4.3 → §3.2a/§3.2c |
| PLP cards | Adopt | `docs/design-doctrine.md` §4.3 → §3.2a/§3.2c |
| PDP (mood images, hero-video stills) | Adopt | `docs/design-doctrine.md` §4.3 → §3.2a/§3.2c |
| Discovery / The Compass | Adopt | `docs/design-doctrine.md` §4.3 → §3.2a/§3.2c |
| Notebook heroes | Adopt | `docs/notebook-team/image-brief.md` (tracks §4.3) |
| Email and SMS art | Adopt | `.claude/agents/email-marketing-manager.md` → §3.2a/§3.2c |
| Instagram | Adopt (origin surface) | `docs/store-team/instagram-campaigns.md` §3.2a/§3.2c |
| X | Adopt, platform policy outranks | `docs/emma-voice.md` social addendum |
| TikTok | Exclude | `docs/ads-policy.md` §Organic social |
| LinkedIn | Exclude, no product imagery at all | `docs/ads-policy.md` §Organic social |
| Video / Reels | Adopt, motion clause applies | `docs/store-team/social-video-viral-checklist.md` P2 → §3.2a/§3.2c |
| Paid advertising | Exclude | `docs/ads-policy.md` |
| Support | n/a, no imagery surface | n/a |

## 4. Stated divergences, and why

- **TikTok** stays out because TikTok moderates harder than Meta and the charter
  already caps it at register 5. The look is not worth the account.
- **LinkedIn** runs no product imagery at all, so there is nothing for the
  treatment to apply to.
- **Paid advertising** is excluded because the processor and the ad platforms,
  not our taste, set that ceiling. `docs/ads-policy.md` wins there and always has.
- **Video** adopted the treatment on 2026-09-20 (owner answer to blocker #192,
  "Yes"). A still frame and a moving frame are still not moderated the same
  way, so video carries one extra rule the stills surfaces do not: the motion
  clause in `social-video-viral-checklist.md` P2, the ceiling on every frame
  rather than the seed frame. On-skin runs on b-roll cutaways and never on the
  talking tier, because a talking-head frame carries no product and an on-skin
  frame is a product-contact frame by definition.
- **Owned surfaces have no moderator.** On-site and in-inbox there is no platform
  classifier to stop a bad frame, so the §3.2a stop list is enforced by our own
  gate or not at all.

## 5. What the look needs that does not exist yet

Every owner question this section opened was answered on 2026-09-20. Blocker
#182 (body references) is cleared: all eight cast members carry an approved
`bodyReferencePhoto` and a `skinToneNote`. #155 (Studio deploy) is cleared.
#193 is answered yes. #194 is answered "report only (no hold)", and §3.2c now
records the narrow reading: the caps report, the §3.2a stop list still BLOCKs.
#192 is answered yes.

What remains is code, not judgment, and all of it is on the bus:

- **The scheduled image path does not use the body references.**
  `scripts/gen-social-image.ts` never reaches `resolveCastReference`, so
  `skinToneNote` reaches no prompt and the bare-product picker never runs.
  Ticket #10475.
- **Nothing populates the variety axes.** 281 rows, none carrying
  `body_zone`, `contact_mode`, `crop_scale` or `scene_location`, so every cap
  in the mix report reads UNKNOWN and the report is clean by construction.
  Tickets #10479 and #10478.
- **The video path cannot read a body reference**, and there is no way to
  declare a crop scale on a scene. A close on-skin video frame would animate an
  invented body. Ticket #10484, and it is a hard blocker on on-skin video.
- **Video is gated on the seed still only.** No automated vision check runs on
  a rendered clip or its poster. The ban that P2 replaced was covering that
  hole. Ticket #10485.
- **Owned surfaces other than Notebook have no imagery gate.** The homepage
  image path runs a budget gate and nothing else. Ticket #10483.

## 6. Changelog

- **2026-09-20, morning.** Created. Records the on-skin treatment (owner
  2026-09-19), the nudity definition (owner 2026-09-20), and the site-wide
  extension (owner 2026-09-20, all-hands). Video (#192), Emma likeness (#193)
  and paid remain out. **Superseded on video and Emma by the entry below, filed
  the same day; read both before quoting either.**
- **2026-09-20, later the same day.** Owner answered every open question at the
  readiness all-hands. #182 body references uploaded and approved for all eight
  cast members. #155 Studio deployed. #193 "Yes, Emma can and she has a body
  reference": Emma moves into the on-skin rotation. #194 "report only (no
  hold)": the caps report and never block, with the narrow reading written into
  §3.2c so the §3.2a stop list is not demoted with them. #192 "Yes": video moves
  from Exclude to Adopt, carrying the motion clause in
  `social-video-viral-checklist.md` P2 that stills do not. Paid stays out.
