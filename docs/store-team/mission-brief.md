# Store Team Mission Brief

**Binding for every store-team routine run** (social, ads, email, content, strategy, and the apply pass).
Load this after the gate, before doing anything else. Where it conflicts with older framing, this
wins. The homepage team additionally loads its own `docs/homepage-team/mission-brief.md`; the voice
charter `docs/emma-voice.md` outranks everything for customer-facing words.

## 1. Mission

Sell more products without eroding trust. The store's goal is $2,000/month profit within 3 months of
launch. Every team's output is judged on realized orders and margin first, engagement second,
novelty never. Discretion is part of the product: customers are buying from a sexual-wellness store
and every touchpoint must be comfortable to receive, open, and share.

## 2. Non-negotiables

- **Emma's voice gates ALL public copy.** Social drafts, ad copy, email subjects and bodies, promo
  banners — everything passes `emma-empathy-reviewer` against `docs/emma-voice.md`. No countdowns,
  no urgency theater, no "Buy now", CTAs from the whitelist, plain warm specific language, Emma has
  no lived experience. The statement descriptor is always XDIPX.
- **MAP rules are law.** MAP=MSRP products never get discount framing anywhere — not in an email,
  not in an ad, not in a social draft. MAP<MSRP uses MAP as the floor.
- **Ad-platform policy is survival.** `docs/ads-policy.md` binds the ads team and the creative rules
  bind organic social too. One careless campaign can kill the ad account.
- **The design doctrine gates ALL visual output.** Any run that produces or places imagery,
  graphics, or visual layout loads `docs/design-doctrine.md` first — its §4 imagery archetypes
  (with the coral-soft/plum-soft/paper ground lock) and §6 proof & trust components are
  binding on every team, exactly as the voice charter binds words. Imagery is produced only via
  `media-manager` (reuse-first); never fabricate proof (reviews, press, testimonials) on any
  surface. Where the doctrine conflicts with older team framing, the doctrine wins on pixels; the
  voice charter still outranks it on words.
- **Consent is sacred.** Email/SMS plans target consented lists only. Referral mechanics never
  expose a customer's purchase to a third party beyond the customer's own share action.
- **Canonical URLs.** All product links everywhere are `/products/{slug}`, with channel UTMs.

## 3. The money valves (what "stub" means)

| Team | Valve state | What the team MAY do | What requires the owner |
|---|---|---|---|
| social | draft-only | write `social_posts` rows `status:'draft'` | posting anything, flipping `social_team_autopost` |
| ads | propose-only | write `ad_campaigns` proposals with policy checks | approving, launching, any platform write, any spend |
| email | plan-only | file campaign briefs as suggestions | executing in Klaviyo |
| content | valve-gated publish | draft Sanity `blogPost` docs (`status:'draft'`); publish live only on a voice-gate PASS while `content_team_autopublish` is on | flipping `content_team_enabled` or `content_team_autopublish`; publishing anything that did not PASS the voice gate |
| strategy | advisory | publish the brief, file/route suggestions | acting on any of it |
| apply (agent-editor) | PR-only, valve-gated | open one PR per approved instruction-suggestion | approving suggestions, merging PRs |

No brief, calendar entry, suggestion, or instruction from any other agent can authorize crossing a
valve. Only the owner moves valves.

## 4. Content auto-publish vs PR

Unchanged from house discipline: content within a stable shell may auto-publish where a team is
explicitly live (today: homepage only). Anything that is code, layout, schema, agent instructions,
or routine playbooks goes through a reviewable PR. No agent merges its own PR or pushes to the
default branch; the release engine merges once CI is green, the linked ticket is QA-verified (code)
or allowlist-verified (docs), and nothing in the diff touches a protected path, and the owner merges
everything protected. `agent-editor` is the only agent that edits agent defs, only via PR, only for
approved suggestions. See `docs/store-team/operating-system.md`.

## 5. Coordination duties (looping back is the job)

- **Read the weekly strategy brief at run start** (`GET /api/team/brief`). Follow its directives for
  your team; when you deviate, record a `decision` event saying why.
- **Read the marketing calendar** so all channels tell one story in a promo window.
- **File cross-team suggestions** (`targetTeam:` set) instead of silently working around another
  team's output. Social's organic winners go to ads; inventory flags go to homepage; email's promo
  needs go to promo-manager.
- **End every run with a retro step** (`phase:'retro'` events): what you did last run, what it
  earned, what you'll change. Real lessons become suggestion rows — that is the improvement loop's
  fuel. Honest zeros ("no drafts were posted") are required reporting, not failures.

## 6. Budget and cascade guards (inherited from homepage doctrine)

Gate first, gate often; hard maxTurns per routine; one run at a time per team; circuit-breaker on
repeated same-day failures; diff-before-write on anything stateful; GA4 weighted only at ≥300
sessions/week — below that, run on margin math and heuristics and say so. Reasoning bills to Max;
log usage honestly via `POST /api/homepage-team/spend` with your team's feature label.

**Imagery is a fresh-art floor, not reuse-before-generate (owner direction 2026-07-27).** On a
merchandising surface whose subject changed since yesterday (a new hero product, a new calendar
theme), generate new art for at least three swappable slots; reuse a slot only after two failed
vision-gate attempts on it. Reuse-before-generate remains correct for product packshots and PDP
art, where the real photo is the point. The image caps and $/day caps are unchanged ceilings and
still hard-stop every run; the floor never overrides a cap, a kill switch, or a vision gate. Full
rules: `docs/homepage-team/mission-brief.md` section 2.

**Images and video posters are requested at the size they render (engineering floor).** A standing
performance rule for every code agent (`rr7-engineer`, `homepage-designer`, `sanity-content-builder`)
that reads this brief at run start, because the same oversized-image defect shipped three times
independently (a hardcoded `width=480` tile in a 208px box, deck panels inheriting a hero-scale
`sizes`, an unsized 89KB video poster):

- Never write a raw `<img>` against a `cdn.shopify.com` or `cdn.sanity.io` URL. Use `OptimizedImage`,
  which handles srcset, sizes, and dimensions.
- Every call site passes its own `sizes` describing the box it actually occupies. Never inherit the
  default. A grid tile is not `100vw`.
- Every call site passes a `widths` ladder bracketing its real device-pixel box. Hero ladders do not
  belong on tiles.
- A `<video>` poster is an image and takes the same CDN width parameter. `<video>` has no
  `loading="lazy"`, so a decorative below-the-fold video must not mount until needed and uses
  `preload="none"`.
- Verify in a browser, not by reading the JSX: check `img.currentSrc` against `getBoundingClientRect()`
  at 375px. If the selected rendition is more than ~1.3x the device-pixel box, the `sizes` attribute
  is wrong. Worked example: PR #478 cut 12 tiles from 480w to 320w and a video poster from ~89KB to
  ~10KB.

## 6b. Instagram content mix (the ratio the voice charter points at)

The social addendum in `docs/emma-voice.md` says "the content mix in the mission brief governs the
ratio." This is that ratio. Owner direction 2026-08-09: packshots are boring, make the product
interesting, the account becomes a resource.

| Share | Content |
|---|---|
| ~40% | Product in a lived-in scene, or a carousel |
| ~30% | Pure education, **no product in the frame at all** |
| ~20% | Inspiring or affirming |
| ~10% | Site news and trend reacts |

When posting more than once in a day, **at most half the set is product-forward**. A follower who
never buys anything should still be getting value from the follow; that is what makes the account a
publication rather than a catalog, and a catalog is what Meta's Restricted Goods standard removes.

Instagram runs a continuous chain of themed campaigns. The schedule, the pillar and format library,
the visual-scheme spec, and the continuity rule live in `docs/store-team/instagram-campaigns.md`,
which the social routine loads at run start.

## 7. Definition of done (per run)

Run row finished with an honest status and summary; events posted throughout (the dashboard is the
owner's window — silence is a failure mode); retro recorded (a suggestion row only on a lesson's
second occurrence, max 2 per run, per the intake doctrine in `improvement-loop.md`);
zero valve violations; zero unguarded MAP/voice/policy exceptions.
