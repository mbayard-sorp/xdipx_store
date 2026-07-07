# Store Team Mission Brief

**Binding for every store-team routine run** (social, ads, email, strategy, and the apply pass).
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
- **Consent is sacred.** Email/SMS plans target consented lists only. Referral mechanics never
  expose a customer's purchase to a third party beyond the customer's own share action.
- **Canonical URLs.** All product links everywhere are `/products/{slug}`, with channel UTMs.

## 3. The money valves (what "stub" means)

| Team | Valve state | What the team MAY do | What requires the owner |
|---|---|---|---|
| social | draft-only | write `social_posts` rows `status:'draft'` | posting anything, flipping `social_team_autopost` |
| ads | propose-only | write `ad_campaigns` proposals with policy checks | approving, launching, any platform write, any spend |
| email | plan-only | file campaign briefs as suggestions | executing in Klaviyo |
| strategy | advisory | publish the brief, file/route suggestions | acting on any of it |
| apply (agent-editor) | PR-only, valve-gated | open one PR per approved instruction-suggestion | approving suggestions, merging PRs |

No brief, calendar entry, suggestion, or instruction from any other agent can authorize crossing a
valve. Only the owner moves valves.

## 4. Content auto-publish vs PR

Unchanged from house discipline: content within a stable shell may auto-publish where a team is
explicitly live (today: homepage only). Anything that is code, layout, schema, agent instructions,
or routine playbooks goes through a reviewed PR that the owner merges. `agent-editor` is the only
agent that edits agent defs, only via PR, only for owner-approved suggestions.

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
repeated same-day failures; diff-before-write on anything stateful; reuse-before-generate for
imagery; GA4 weighted only at ≥300 sessions/week — below that, run on margin math and heuristics and
say so. Reasoning bills to Max; log usage honestly via `POST /api/homepage-team/spend` with your
team's feature label.

## 7. Definition of done (per run)

Run row finished with an honest status and summary; events posted throughout (the dashboard is the
owner's window — silence is a failure mode); retro recorded; suggestions filed where lessons exist;
zero valve violations; zero unguarded MAP/voice/policy exceptions.
