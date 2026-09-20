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
| Video / Reels | **Owner question, open** | blocker #192 |
| Paid advertising | Exclude | `docs/ads-policy.md` |
| Support | n/a, no imagery surface | n/a |

## 4. Stated divergences, and why

- **TikTok** stays out because TikTok moderates harder than Meta and the charter
  already caps it at register 5. The look is not worth the account.
- **LinkedIn** runs no product imagery at all, so there is nothing for the
  treatment to apply to.
- **Paid advertising** is excluded because the processor and the ad platforms,
  not our taste, set that ceiling. `docs/ads-policy.md` wins there and always has.
- **Video** is excluded until the owner answers #192. A still frame and a moving
  frame are not moderated the same way, and we do not infer the answer.
- **Owned surfaces have no moderator.** On-site and in-inbox there is no platform
  classifier to stop a bad frame, so the §3.2a stop list is enforced by our own
  gate or not at all.

## 5. What the look needs that does not exist yet

- **Body reference photos.** Blocker #182. The owner is uploading them. Without
  references, on-skin briefs drift on body type and skin tone.
- **Sanity Studio deploy.** Blocker #155. Cast and reference assets cannot be
  managed until Studio is deployed.
- **Emma's own likeness in an implied-nude frame.** Blocker #193, open owner
  question. Until it is answered, Emma is not cast in an on-skin frame.
- **Caps: gate or report.** Blocker #194. Undecided whether the per-run on-skin
  caps are a hard gate or a reported number.

## 6. Changelog

- **2026-09-20**. Created. Records the on-skin treatment (owner 2026-09-19), the
  nudity definition (owner 2026-09-20), and the site-wide extension (owner
  2026-09-20, all-hands). Video (#192), Emma likeness (#193) and paid remain out.
