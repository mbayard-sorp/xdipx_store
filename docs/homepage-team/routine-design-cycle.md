# Routine B — Design Cycle

The weekly / on-demand playbook for structural and visual change. Unlike Routine A (which
auto-publishes content), Routine B **never merges its own work**: it produces wireframes, builds a
prototype on a branch, runs the review gates, and **stops at an open PR**. The merge is the release
engine's, after CI is green, the linked ticket is QA-verified, and no changed file touches a
protected path; protected-path PRs stop and go to the owner by email. The Vercel preview URL is
the "designs on localhost before build" — a cloud routine can't drive your localhost, so the loop is:
routine pushes a branch → Vercel preview deploys → you (or `qa-reviewer`) review that URL, or
`git checkout` to run locally → the engine merges once the gates pass. Branch protection on `main`
still enforces the required CI check, and `release_engine_enabled` off puts the merge back in your
hands with no other change.

Entry agent: `homepage-orchestrator` (coordinator). Cadence: weekly, or on-demand from the dashboard.
This routine has its own turn cap and `homepage_team_build_cents` allowance (separate from the daily
$ cap).

---

## When to run it

- A new section type or layout is wanted (beyond what content merchandising can do in the stable shell).
- A visual redesign of the homepage or a section.
- Anything that requires new components, new Sanity blocks, or code changes.

If the change is "which products / which copy / which order / which image," that's **Routine A**, not
this one.

---

## Flow

### Before anything — voice charter (mandatory)

Read `docs/emma-voice.md`. All copy written or edited in this run must comply. If the charter is
missing from the checkout, STOP and report instead of writing copy.

### Also before anything: mission brief (mandatory, same as Routine A)

Read `docs/homepage-team/mission-brief.md` and treat it as binding for the run. It overrides older
routine framing where they conflict; the voice charter overrides everything, always. If the brief
is missing from the checkout, STOP and report.

### 0. Lifecycle start + gate

Start a run and check the gate, exactly as in Routine A but with `runType:'design'`:

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/run" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","runType":"design"}'      # → { "id": $RUN_ID }

curl -s "$BASE_URL/api/homepage-team/gate?excludeRun=$RUN_ID" -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN"
```

`excludeRun=$RUN_ID` is required: your own just-started run row would otherwise trip the
one-run-at-a-time lock (`reason:'run_in_progress'`). The lock still blocks any other run.

If `gate.ok` is `false`, post a `skipped` status and stop (same as Routine A). Emit `/event` rows
through every phase below so the dashboard shows the design cycle live.

### 0.5. Weekly competitor/reference teardown (before wireframing)

`homepage-designer` (with `design-critic` as sparring partner) WebFetches 2-3 references from the
doctrine §7 bench plus any notable competitor launches, and writes a short "what they do better /
what we do better" note as a run event, logging adopted AND rejected ideas so taste compounds. The
current decision doc is `docs/homepage-team/competitor-teardown-2026-07-live.md` (the July 2026
live-capture teardown; it supersedes `competitor-teardown-2026-07.md`); append a dated delta
section to it rather than starting from scratch. Sourcing honesty is mandatory: only report what
was actually fetched, tag anything else as prior knowledge, and never quote competitor copy from
memory. The teardown output must respect the IA fence: proposals stay inside the locked Nº01–Nº11
shell, new section types need a named spec through IA review + additive Sanity schema before build,
any pattern implying a new URL/route goes to `tech-architect`, and the two-link cap on `/discover`
plus the retired-route denylist stand.

### 1. IA + design — wireframes

- `homepage-ia` defines or revises the section taxonomy and the shell-vs-content split (what's new,
  what it maps to, what stays frozen).
- `homepage-designer` produces wireframes + an art-direction doc using the **design capability stack**
  (`taste-skill` → matching style skill + shared components, `ui-ux-pro-max`, Emil Kowalski's
  animation skill) on top of the repo-native Motion primitives (`app/lib/use-reveal.ts`,
  `app/components/motion/Reveal.tsx`, `variants.ts`) and the v3 brand tokens in `app/app.css`.
- Hard constraints still bind: mobile-first @375px, zero-CLS (transform/opacity only, **never wrap the
  LCP hero**), SSR-visible content, brand palette + Emma voice.
- **Ambition mandate (mission brief section 9, Mike 2026-07-05):** every cycle carries at least one
  genuinely new exploration/self-discovery experience concept from the backlog to a wire or
  prototype — not just polish of existing sections. Judge concepts by whether a visitor learns
  something about what fits them while moving toward a product. Log rejected concepts + reasons so
  ambition compounds across cycles.
- **While traffic-gated, keep the cycle cheap: bank design capital, defer expensive builds.** With
  GA4 far below the 300-sessions/week weighting threshold, no shipped homepage change is currently
  GA4-measurable, so big asset-generation or new-machinery builds (generated-imagery waves, interactive
  finders, a reviews slot) would ship to almost no one. While sessions < 300/week the ambition
  mandate is satisfied by **wires / prototypes + cheap, certain real-defect fixes**; expensive
  asset-generation and new-machinery builds wait until either traffic returns or the change is
  cheap-and-certain. This is not a call to stop inventing — it is a call to bank ambition as design
  proposals now and spend build / image-generation budget (`generateImage()`, routing per
  `docs/media-model-routing.md`) when it can actually be seen.

### 2. Prototype on a branch

`rr7-engineer` cuts a feature branch and builds a prototype of the wireframes — idiomatic RR7
(`loader → useLoaderData`, `.server.ts` boundary, no Next.js patterns, no `useEffect` fetching).
`sanity-content-builder` adds any **additive** new blocks/fields (new files only, never modifying
existing schema). Commit to the branch; do not touch `main`.

### 3. Build the real thing

Finish the implementation on the branch: components wired to Sanity blocks, mobile-first responsive,
imagery via `media-manager` (reuse-first), copy via `emma-copywriter`.

### 4. Review gates (all must pass before the PR is opened for approval)

- `tech-architect` — coupling, layer, Oxygen-seam integrity, migration impact; writes/links an ADR if
  the change is non-trivial.
- `qa-reviewer` — typecheck, build, tests, and the prototype exercised in the preview MCP at 375px +
  desktop, with a CLS check and proof screenshots.
- **Variant-b quarantine audit (ticket #1450, mandatory whenever a legacy component is quarantined
  off the v3 storefront via an allow-list like `VARIANT_B_SECTION_TYPES`).** Grep every call site of
  the excluded COMPONENT (grep the component name, not just the block type) and confirm no wrapper
  re-introduces it. The section-type exclusion cannot see wrapper paths: `productCarousel` was
  correctly excluded, but the semantically equivalent `emmaCuratedRail` → `EmmaCuratedRail` →
  `ProductCarousel` wrapper path bypassed the guard and shipped stale v2 card chrome (rounded-2xl,
  drop-shadow, border-cream-2) on the team's main lever, undetected until run 183's live
  self-capture (PR #506). Any wrapper that must stay carries v3 chrome explicitly, and the
  quarantine's code comment should say so (that comment amendment is a code change and rides its
  own PR, not this checklist).
- **`design-critic` — mandatory design gate.** Reviews screenshots of every changed surface at
  375/768/1440 against `docs/design-doctrine.md` and scores its rubric (hierarchy, spacing rhythm,
  type, color, imagery, motion, overall). The PR does not open on a REVISE or BLOCK; fix and
  re-review. Record the verdict + scores as an `/event` row (`agentRole:'design-critic'`).
- **Emma voice gate** — `emma-empathy-reviewer` signs off on all customer-facing copy against
  `docs/emma-voice.md` (the canonical voice charter).
- `seo-pdp-auditor` + `aeo-geo-auditor` — when the change affects rendering, JSON-LD, canonical, the
  markdown/llms surface, or section structure.

### 5. Open a PR — the routine never merges

Push the branch and open a PR against `main`. Record the PR URL on the run:

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/run" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'"$RUN_ID"',"update":{"status":"succeeded","finished":true,"currentPhase":"pr-open","prUrl":"https://github.com/<org>/<repo>/pull/<n>","summary":"Design cycle: new hero block + category-nav block; preview deploy attached, awaiting approval"}}'
```

The Vercel preview URL (auto-attached to the PR) is the review surface. **The routine stops here.**
Review happens on that preview (`qa-reviewer` on the daily QA pass, or you), and the release engine
squash-merges once CI is green, the linked ticket is `verified`, and the protected-path classifier
finds nothing sensitive in the diff. Anything touching checkout and payment, cart, migrations and
schema, auth and session, team valves and spend controls, CI and deploy config, or the release
engine itself stops and emails you; only you merge those. **The team still cannot merge its own
code.** That remains the enforcement of the "gate code" decision, and `release_engine_enabled` off
restores owner-merges-everything.

### 6. Spend

Log Max reasoning tokens via `POST /spend {kind:'tokens', source:'agent-sdk', feature:'homepage-design'}`
and any images via `POST /spend {kind:'image', feature:'homepage-images'}`, same shapes as Routine A.
The design cycle's allowance is `homepage_team_build_cents`, not the daily merchandising cap.

---

## Prioritized backlog

Items 2 onward index the live teardown's elevation plan; the full spec for each is that doc's
"The plan" section (`competitor-teardown-2026-07-live.md`) — where this list and the teardown
disagree, the teardown wins. **That tiebreaker never applies to the IA fence in §0.5 above**
(locked Nº01–Nº11 shell, two-link `/discover` cap, retired-route denylist, additive-only Sanity):
the fence governs regardless of what the teardown says or omits, since the teardown does not
restate it. All copy quoted in the items below is illustrative only and must clear
`emma-empathy-reviewer` before ship, like every other customer-facing string. Tags: `[shell-PR]`
reviewed PR required; `[content-only]` team auto-publish authority; `[asset-generation]`
media-manager pipeline. Work them in order.

1. **Hero deep-link CTA: verify shipped, then use.** `primaryCtaLink` + `primaryCtaLabel` support
   on the storefront hero, so the hero CTA can deep-link to `/products/{handle}` (mission brief
   section 1). Implementation is landing in the same PR as this playbook edit, so the job here is
   to verify it is live in production, then have Routine A point the hero CTA at the featured
   product's page every run. If it turns out not to be live, finishing it is this routine's top
   item.

**P0 (first-impression fixes)**

2. **Meet Emma photo fix** — render `singleton.editor.photo` (photorealistic) through
   `assembleStorefrontHome()`, `/emma.webp` becomes the outage fallback; delete `public/emma.png`;
   set `photo.alt`. `[shell-PR]` `rr7-engineer` + `[content-only]` `sanity-content-builder`.
3. **Imagery Wave 1: kill every placeholder** — ~20 gated images per the teardown shot list.
   Generate-and-place only where a placement path exists today (`gen-homepage-image.ts` targets
   `block|tile|promo`): wayfinder tiles (B), hero (C/A), photo-band block images (C). The 3 PDP
   macro shots (A) and any surface without a live target are **pre-staged assets** (uploaded and
   tagged, not placed) that go live with their owning shell PR (items 4 and 9) — a run must not
   report them as visible surfaces. `[asset-generation]` `media-manager`.
4. **Hero as an art-directed frame** — replace the coral-soft box around a bare packshot with an
   Archetype C/A treatment of the pinned pick; LCP stays unwrapped, fixed 4/5.
   `[asset-generation]` + `[shell-PR]` if frame markup changes.
5. **Discretion rewrite + named guarantee** — dreaded-moments trust-strip copy; guarantee coined
   as a proper noun with sage ♥ mark (trust strip + FAQ now, buy box in P1). **Owner approves the
   name and terms before publish.** `[content-only]` `emma-copywriter`, gated by
   `emma-empathy-reviewer`.
6. **Brand eyebrow on cards** — render `p.brand` as mono ink-4 eyebrow on `StorefrontProductCard`
   everywhere. `[shell-PR]` `rr7-engineer`.
7. **Footer legitimacy pass** — payment marks, policy links (returns/privacy/shipping/18+/
   accessibility), "reach a human at hello@xdipx.com," quiet brands-we-carry row. `[shell-PR]`
   `rr7-engineer`; owner supplies processor mark assets.

**P1 (trust architecture that converts bought traffic)**

8. **Reviews slot, real data only** — card stars+count above threshold, hard-suppressed below;
   conditional pull-quote band between Nº 06 and Nº 07, each quote deep-linking its PDP; additive
   Sanity block. `[shell-PR]` + `sanity-content-builder`.
9. **PDP evidence surfaces** — buy-box trust duo (guarantee + discretion beside the CTA);
   "How it Feels" from existing `sensation_dial`/`feature_bullets`; macro detail row (A).
   `[shell-PR]` + `[asset-generation]`.
10. **Wayfinder intent tiles + "The Ten"** — 5-6 tiles labeled by intent/anxiety ("First toy,"
    "Quiet ones," "Small & discreet," "For two"; Archetype B for product tiles, C for
    human-context tiles), one ink tile per row; Nº 03 becomes the finite ranked "The Ten. Most
    picked right now." `[content-only]` labels + `[asset-generation]` tiles + `[shell-PR]`
    structure (IA confirms taxonomy).
11. **Compass to nav-level billing** — persistent header entry for `/discover` ("Find your fit →").
    `[shell-PR]` (respects the two-link cap: nav entry replaces one of the existing links if needed;
    IA rules).
12. **Benefit line on cards** — one Emma-voice sentence from the `tagline` metafield between name
    and price. `[content-only]` + `[shell-PR]` card render.
13. **One committed tinted band** — a single full-bleed plum-soft/coral-soft band carrying white
    cards, within the coral budget. `[shell-PR]` + `homepage-designer`.
14. **Homepage FAQ: scary questions first** — discretion and billing lead, phrased in the
    customer's words; guarantee entry added. `[content-only]` `emma-copywriter`.

**P2 (depth)**

15. **Per-PDP motion loops** — 3-5s image-to-video from the gated still into the `hero_video`
    metafield, top 5 picks first; never the homepage hero. `[asset-generation]`.
16. **Two-frame card image flip** — still → Archetype A frame on hover/swipe, transform/opacity
    only, LCP frame never wrapped. `[shell-PR]`.
17. **Closing proof act** — once reviews/brands/guarantee/payment marks exist, sequence them as a
    pre-exit band before email capture. `[shell-PR]` after `homepage-ia`.
18. **Membership-framed email capture** — curiosity-framed Emma list copy + one privacy line at
    the capture moment. `[content-only]`.
19. **Shoppable flat-lay hotspots + real-packaging texture band.** `[asset-generation]` +
    `[shell-PR]`.
20. **Press logo slot, built empty** — renders only when offsite/PR earns a real placement.
    `[shell-PR]`.

---

## Retro step (before the final run update)

Close the cycle with a retro (`phase:'retro'` events): did last cycle's shipped PR move the
conversion/engagement numbers it promised (GA4-weighted only at ≥300 sessions/week)? Did any review
gate reject work that better instructions would have prevented? Compare against the active weekly
strategy brief (`GET /api/team/brief`). Real lessons go on the improvement bus via
`POST /api/team/suggestion {op:'create', team:'homepage', kind:'instructions'|'process', ...}` —
see `docs/store-team/improvement-loop.md`.

**Append the design changelog.** When a design/shell PR ships this cycle (or is opened for the
release engine), append one dated entry to `docs/homepage-team/design-changelog.md` in that file's
entry format (Routine B, what changed, why, and the evidence probe touched — the PR number and the
signal or directive that drove the change). **Append at the BOTTOM of the file, directly above the
end-of-file append marker (after the most recent existing entry), and rebase onto latest
`origin/main` immediately before opening the PR** (ticket #2878): the old fixed anchor right after
`## Entries` made every concurrent changelog PR conflict on the same line. It may ride the
same shell PR or, when the cycle produced only content-label work, a small docs append; either way the
changelog is on the agent-editor allowlist and gates nothing.

## Hard rules for this routine

- **Never merge your own work.** Always a PR; the release engine merges it after CI, QA verification,
  and the protected-path check, and the owner merges anything protected. Branch protection on `main`
  keeps the CI check required.
- **Never touch `main` directly.** All work on a feature branch.
- **Additive Sanity only** — new blocks/fields in new files; never modify existing schema.
- **Respect the repo-native Motion system + v3 tokens** — don't hand-roll IntersectionObserver or
  reintroduce orange/old-cream/gradients; never wrap the LCP hero.
- **Reasoning on Max** — no calls to the site's Anthropic-keyed endpoints.
- **Weekly, capped** — own turn cap + `build_cents`; one team run at a time (the gate enforces it).
- **Emit `/run` + `/event` updates** throughout so the dashboard shows the cycle and links the PR.
