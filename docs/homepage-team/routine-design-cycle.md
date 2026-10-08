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
- **Banked-concept ceiling (ticket #11085): more than five wires with zero prototypes is a stated
  decision, not a silent default.** Nine cycles running the wire option in a row (2026-07-15 through
  2026-09-23: sensation-map, either-or, how-you-arrive, the-next-step, first-tap, curiosity-echo,
  nothing-in-the-way, whos-holding-it, plus the shipped Compass) converts ambition into paper at
  about one per cycle and into product at zero. The traffic gate is a reason not to ship an
  *expensive* build; it is not a reason the *cheapest* banked concept has never been costed against
  it. Once the banked-concept count exceeds five, the cycle must either prototype the cheapest banked
  concept, or record, in one line each, why each of the top three is not the cheapest thing available
  this cycle. This does not force a build and does not override the traffic gate below.
- **While traffic-gated, keep the cycle cheap: bank design capital, defer expensive builds.** With
  GA4 far below the 300-sessions/week weighting threshold, no shipped homepage change is currently
  GA4-measurable, so big asset-generation or new-machinery builds (generated-imagery waves, interactive
  finders, a reviews slot) would ship to almost no one. While sessions < 300/week the ambition
  mandate is satisfied by **wires / prototypes + cheap, certain real-defect fixes**; expensive
  asset-generation and new-machinery builds wait until either traffic returns or the change is
  cheap-and-certain. This is not a call to stop inventing — it is a call to bank ambition as design
  proposals now and spend build / image-generation budget (`generateImage()`, routing per
  `docs/media-model-routing.md`) when it can actually be seen.
- **The live-page design-critic spot-check is independent of the traffic gate and of whether this
  cycle ships code (p4-retro, run 646).** A docs-only or held cycle (banking design capital per the
  bullet above) still owes a critic verdict: `design-critic` scores a rendered screenshot, not a
  shipped change, and Routine A's Step 7.5 post-publish spot-check (`docs/homepage-team/
  routine-daily-merchandise.md`) already proves this needs no PR, no build, and no traffic — it runs
  against the live page every day regardless of what that day shipped. Run the equivalent live-page
  spot-check this cycle even when the rest of the run is docs-only, and post the verdict as an
  `/event` row (`eventType:'decision'`, `agentRole:'design-critic'`) so the milestone tracker sees a
  data point instead of a silent gap. If "design-critic skipped at the turn cap" happens, that is a
  **named failure**: state why in the run summary (turn budget, tooling blocker, etc.) rather than
  letting the skip pass silently — three unexplained skips in a row read as a milestone with no
  owner, not as a traffic problem.
- **Standing step: a `/admin/socials` design-critic pass every 4 weeks (replaces #5232), owner-run
  capture — corrected 2026-10-07 (ticket #14120).** #5232 asked for a one-time design-critic *run*
  against the Social Studio v2 Composer/Analytics/Calendar screens, which is not a docs edit and so
  could never be implemented by the apply pass; it sat approved for six weeks before being dismissed
  in favor of this standing instruction. The instruction as first written told a cloud routine to run
  `scripts/design-snapshots.ts --routes /admin/socials` directly, and that cannot work: every
  `/admin/socials*` route is gated by `requireAdmin` (session cookie), never a team-token path
  (`app/routes/admin.socials.library.$assetId.tsx`'s `#11551` comment is the standing decision —
  admin routes do not get a team-token bypass, and building one here would be exactly that). A cloud
  routine holds a team token, not an admin session, so every attempt 302-redirected to
  `/admin/login` and the capture script dutifully screenshotted the login page three times — worse
  than failing loud, because the PNGs look plausible. Run 1298 found this is the mechanical reason
  milestone `p7-design` (`docs/store-team/trackers/social-studio-v2.md`) has carried a verdict-less
  AMBER since 2026-08-24: the step asked for something no cloud routine could ever produce, silently.

  The corrected step is an owner-attended capture, not a cloud-routine one. Once every 4 weeks:

  1. **An owner-attended session** (not a scheduled cloud routine) logs into `/admin` and runs the
     same recipe locally against the live session, or simply opens `/admin/socials` (index, compose,
     analytics) in a browser at 375px and at desktop width and saves three screenshots.
  2. Hand those three screenshots to `design-critic` for the same scored rubric (hierarchy, spacing
     rhythm, type, color, imagery, motion, overall) against `docs/design-doctrine.md` and the design
     direction in `docs/store-team/social-studio-plan.md` §4, exactly as the per-defect flow above
     does for homepage screenshots it was handed.
  3. Post the verdict as an `/event` row (`eventType:'decision'`, `agentRole:'design-critic'`)
     referencing `/admin/socials`, so the milestone probe (`p7-design`) passes on live evidence
     instead of staying perpetually unactionable. A REVISE or BLOCK verdict files its own follow-up
     ticket rather than blocking this routine's own PR.

  A cloud-routine pass over this step still has a job: check whether 4 weeks have elapsed since the
  last `agent_role='design-critic'` event referencing `/admin/socials`, and if so, file (or renew) an
  owner blocker asking for the three screenshots, rather than attempting the capture itself.
- **Multi-axis discovery instrument build-readiness is gated on the CROSS-PRODUCT of its options,
  not the options themselves (run 646, `concepts/either-or.md`).** A concept with N binary/multi-way
  axes is not buildable just because every individual pole clears the `>=2` product-count floor:
  disjoint tag sets are not independent co-occurrence, so a reachable *combination* of poles across
  axes can still return zero even when each pole alone passes by orders of magnitude. Before calling
  a multi-axis concept buildable, measure every reachable pole COMBINATION against the same `>=2`
  floor, not just each option in isolation, and record the combination matrix in the concept doc
  (`docs/homepage-team/concepts/<slug>.md`).
- **Credential-free probes available to cloud routines — check this list before recording a
  deferral.** A build-readiness check that looks like it needs owner/admin credentials sometimes
  already has a credential-free equivalent shipped for cloud routines: `GET
  /api/team/discovery-vocab` (#5631) serves live **per-tag** product counts without needing Shopify
  or Sanity session credentials. Deferring a check as "needs credentials this cloud routine lacks"
  without checking this list first costs a full cycle of delay for no reason (run 520 deferred
  exactly this check, which run 646 then ran credential-free).
  - **It does NOT serve per-combination counts, whatever an earlier version of this line said
    (corrected run 905).** `computeVocabCounts()` in `app/lib/discovery.server.ts` tallies each
    mood/audience/matters tag independently, so one call cannot satisfy the cross-product gate above
    it. Combinations are measured with the scoring endpoint, credential-free as well: `GET
    /api/discovery?variant=a&budget=300&matters=<TAG>&mood=<TAG>`, counting items at the maximum
    score (`SCORE_MOOD` 3 + `SCORE_MATTERS` 2 = 5), the method `concepts/either-or.md` documents and
    `concepts/nothing-in-the-way.md` used for 30 combinations. Always pass the **storage** tag form
    (`normalizeTag()`), never a rendered chip label; run 520 shipped two dead poles on display
    strings.
  - **Homepage singleton diagnosis (`storefrontHome`, `panelDeck`) has no credential-free path yet
    (ticket #8424, run 778).** Findings worth knowing before re-deriving them: (1) the Sanity
    dataset IS publicly readable without a token at
    `https://0nlwk8cf.apicdn.sanity.io/v2023-05-03/data/query/production?query=<groq>`; (2) but the
    published perspective exposes only 28 doc types (`blogPost`, `categoryPage`, `emmaCuratedRail`,
    `product`, `trustItem`, and so on) and **zero** `singleton.*` documents, so a query for any
    homepage singleton reads back `null` indistinguishably from "the doc does not exist"; (3)
    `scripts/rails-fingerprint.ts` reads exactly these docs but needs a Sanity token, so it is
    unavailable to a cloud routine. Net effect: a cloud routine can prove WHAT the page rendered
    (fetch the HTML) but not WHY the homepage singletons produced it — half a diagnosis. Until a
    small team-token endpoint closes this gap (e.g. `GET /api/team/homepage-payload` returning
    `layout.sections` plus panel-deck row/item counts, no product data — a `code` ticket, not this
    routine's to build), stop at the HTML and say so honestly rather than re-discovering the above.

### 2. Prototype on a branch

`rr7-engineer` cuts a feature branch and builds a prototype of the wireframes — idiomatic RR7
(`loader → useLoaderData`, `.server.ts` boundary, no Next.js patterns, no `useEffect` fetching).
`sanity-content-builder` adds any **additive** new blocks/fields (new files only, never modifying
existing schema). Commit to the branch; do not touch `main`.

### 3. Build the real thing

Finish the implementation on the branch: components wired to Sanity blocks, mobile-first responsive,
imagery via `media-manager` (reuse-first), copy via `emma-copywriter`.

### 4. Review gates (all must pass before the PR is opened for approval)

**Commit before dispatching any gate (ticket #8423).** A review gate and the build step share one
working tree, and a gate legitimately asked to mutate it (`qa-reviewer`'s revert-to-prove-the-test
check: temporarily revert the fix, observe the test fail, restore it) runs `git checkout -- <file>`.
Run 778 hit this collision twice: the gate correctly refused to evaluate foreign uncommitted content
it found in the tree and discarded it, silently destroying the orchestrator's own in-flight work (a
race-guard helper plus tests, and two nit fixes) — and a verification run afterward reported "10
passed" for tests that were no longer on disk, which reads as a pass and is not one. The gate behaved
exactly right; the collision was the playbook's to prevent. Three rules:

1. **Commit before dispatching any review gate**, so the gate has an immutable target and the
   orchestrator has nothing uncommitted left to lose.
2. **Any gate asked to mutate the tree runs in an isolated git worktree, not the shared checkout** —
   `scripts/setup-worktree.sh` already exists for exactly this.
3. **After any gate that reports touching the tree, re-verify your own work is still present**
   (grep for a distinctive symbol from your change) before trusting a green test run. This is the
   cheap check and catches the silent case even if 1 or 2 is skipped.

The same hazard applies to Routine A whenever it dispatches a gate agent mid-edit. Keep the
revert-to-prove-the-test instruction itself — it is genuinely valuable — these three rules stop it
from colliding with uncommitted work, they do not remove it.

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
- **A guard spans every file the surface spans, not just the file you edited (run 1298 retro).** A
  fix that removes a pattern across a surface, verified by a regression test, can still ship wrong if
  the test only reads the file that changed. Run 1298 moved the primary nav off the display serif in
  `MegaMenu.tsx` and added a source-text guard against it there; `Navbar.tsx` renders two more
  nav-adjacent elements (the mobile drawer's category accordion and its search row) that kept the
  serif, so the drawer went from consistently wrong to inconsistent, and the guard could not see it
  because it only read one file. When a fix removes a pattern, grep the WHOLE surface for that
  pattern, not just the file you edited, and make the guard span every file the surface spans — and
  pin the count of any deliberate remaining instances (e.g. a logo wordmark) so a later sweep does not
  strip those as though they were part of the fix.
- **A claim that a product, label, or price is invented is checked against the live catalog, never
  against the repo (run 1298 retro).** CLAUDE.md keeps no product data in the repo by design (Shopify
  is source of truth, nothing hardcoded outside `db/seed.ts`), so grepping the repo for a product name
  returns zero for every real product, not just a fabricated one. A zero result from an instrument
  that always returns zero is not evidence of absence. `GET /collections/<handle>` or the product page
  is the instrument; one fetch settles it.
- **See-all destination cross-check (ticket #4270, mandatory whenever a module ships an
  auto-generated or backfilled product set with a "See all" affordance).** Every See-all on an
  auto-generated or backfilled module must resolve to a collection that CONTAINS the module's set,
  or render no link at all — and it must NEVER fall back to `/collections/best-sellers`. This is
  binding mission-brief §1 (no silent best-sellers fallback for auto-generated modules; ship NO
  See-all instead). The gate is spec-and-code, not screenshot: read the module's design spec and its
  See-all/href code path and confirm neither encodes a best-sellers fallback as an acceptance
  criterion. The Curiosity Shelf (PR #750, #3532) shipped a `/collections/best-sellers` See-all in
  both its code AND its own spec §j item 10, and no gate caught it because the spec itself encoded
  the anti-pattern. The reviewer flags any new module code path that emits `/collections/best-sellers`
  as a fallback destination; a lint/test guard is the stronger version of this check and may ride its
  own code PR, but the review note here is mandatory and does not wait on it.
- **`design-critic` — mandatory design gate.** Reviews screenshots of every changed surface at
  375/768/1440 against `docs/design-doctrine.md` and scores its rubric (hierarchy, spacing rhythm,
  type, color, imagery, motion, overall). The PR does not open on a REVISE or BLOCK; fix and
  re-review. Record the verdict + scores as an `/event` row (`agentRole:'design-critic'`).
  **When this cycle is working a filed defect ticket (ticket #12615):** before any fix is written,
  dispatch `design-critic` for a per-defect CONFIRMED / REFUTED verdict against a fresh capture and
  a stated measurement, not a re-score of the whole surface. Run 1162 wrote exactly that fix-first
  sequence by accident and caught two of four filed defects materially wrong on the fresh look (one
  refuted outright — the claimed clip did not reproduce at measurement — one understated, one broader
  than filed), any of which a build-then-re-score order would have shipped a wrong or incomplete fix
  for. Record each verdict as its own `/event` row before `rr7-engineer` starts; a REFUTED defect is
  closed on its ticket with the measurement as evidence, never silently dropped.
  **Capture the screenshots with the repo CLI (ticket #8421, run 905).** One command, and it carries
  the cloud-routine accommodations itself:

  ```bash
  npx tsx scripts/design-snapshots.ts --base https://xdipx.com --routes / --viewport doctrine
  ```

  `--viewport doctrine` is exactly the 375/768/1440 set this gate scores. Do **not** hand-roll the
  capture and do **not** run `playwright install` — the sandbox forbids it and the script does not
  need it. Routine A's Step 7.5 post-publish spot-check uses the same command with `--viewport mobile`.

  **Before scoring, confirm the capture is the storefront (run 1298 retro).** A capture that silently
  returns the wrong page is worse than one that fails, and it has happened: Vercel's bot protection
  403'd the transport, chromium rendered the 403 page perfectly happily, the CLI wrote three PNGs and
  printed `done`, and the gate scored three Vercel bot-wall pages before noticing (caught only by
  measuring the images rather than trusting them — 98.5-99.6% white, mean luminance 253-254). One
  glance at the file, or one check that it is not near-uniformly white, is the whole cost. A verdict
  that runs clean against the wrong input is a silent wrong answer, which costs more than an absent
  one.

  What the script now handles for you, and why it is worth knowing when it misbehaves: chromium
  cannot reach `xdipx.com` through the agent proxy (`page.goto()` fails at the TLS handshake with
  `ERR_CERT_AUTHORITY_INVALID`, and has also presented as `ERR_CONNECTION_RESET`; neither
  `--proxy-server` nor `--disable-http2` fixes it), so `--via-fetch` intercepts every request with
  `context.route()` and fulfils it from Node `fetch`, which does trust the proxy CA. It auto-enables
  only when an HTTPS proxy is present and the base is not loopback, so local runs are unchanged;
  `--no-via-fetch` opts out. Separately, the image pre-installs one chromium build under
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and the pinned Playwright often wants a different build
  number, so the script falls back to the pre-installed binary after its own resolution fails
  (`--executable-path` forces it). **This recipe lived in prose here until run 905, and the cost was
  real:** run 778 re-implemented it by hand and run 899 skipped the gate outright at the turn cap. If
  you find yourself hand-rolling a capture again, that is a code ticket against this script, not a
  longer paragraph here.
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

The Vercel preview URL (auto-attached to the PR) is the **human** review surface. It is
SSO-gated (Vercel Deployment Protection) and unreachable from a cloud routine: fetching it returns a
302 to `vercel.com/login`, not the storefront (confirmed against PR #1301's own preview, ticket
#11087). **A cloud routine cannot self-verify its own change on the branch this way.** Its substitute
is typecheck + the full local test suite on the branch, plus reading the served **production** HTML
where the change is a fix to something already live (never claim you verified against "the preview"
when you read production instead); state in the run summary which of these you did. **The routine
stops here.** Human review happens on the actual preview (`qa-reviewer` on the daily QA pass, or you),
and the release engine squash-merges once CI is green, the linked ticket is `verified`, and the
protected-path classifier finds nothing sensitive in the diff. The protected-path list is **cost-only**
(owner direction 2026-08-19): team valves and spend controls, the enforcement core (`github.server.ts`,
`release-engine.server.ts`, `migration-classify.server.ts`, `.github/**`), secrets, the checkout
probe, the deploy-critical build scripts, and non-additive `db/migrations/**`. Checkout and cart
code, auth and session, `db/schema.ts`, `vercel.json`, and `package.json` are no longer protected —
they are ordinary code PRs covered by CI, the QA verdict, and post-deploy smoke with automatic
revert. Anything on the cost-only list stops and emails you; only you merge those. **The team still
cannot merge its own code.** That remains the enforcement of the "gate code" decision, and
`release_engine_enabled` off restores owner-merges-everything. Full detail:
`docs/store-team/operating-system.md` §4.

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

**A rebase right before opening is not enough on its own (ticket #14193).** The file has a single
end-of-file insertion point and more than one lane writes to it, so a second append PR can merge at
that exact same hunk after yours opens even though yours was clean when you rebased. Re-check
`GET /api/team/pr?number=<n>` reports `mergeable:true` right before you consider the PR done (and
again if another changelog-append PR merges while yours is still open); a dirty pure end-of-file
append resolves by keeping both blocks, ordered by date.

**When the changelog append is its own PR (not riding a shell PR), the run that made the change opens
it and files its ticket as `kind:'instructions'`, never `kind:'code'`.** (#4758) Only this run holds
the Evidence data the entry format requires (the PR number and the signal or directive that drove the
change), so write the Evidence line from your own run data. Per ADR-008 step 3 / filing convention 4,
file the tracking ticket as `kind:'instructions'` with `category:'docs'`, landed at `pr_open` with the
`pr` link — never a bare `kind:'code'` row, which drops into R-DEV's claim queue where R-DEV can only
block it (#4114, #4660). The PR still merges through the release engine once QA verifies; only the lane
changes.

**After filing, read each row back by its id before citing it anywhere (run 1298 retro, ticket
#14191).** A batched `POST /api/team/suggestion` call can return no id and fail silently; a run that
noticed two such failures in a batch of fourteen still missed a third, and the PR body it opened
confidently cited an id for a ticket that had never actually been filed. A create that returns no id
is indistinguishable from one that worked until you look. Call `{"op":"get","id":<id>}` and confirm
the row persisted before citing that id in a PR body, a decision event, or anywhere else — this bites
hardest on a batched filing, because one silent failure shifts every later id in the batch.

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
- **A content field must never be able to silently delete a doctrine requirement.** (#12616) When a
  renderer's content input fails validation or is missing a value a doctrine rule depends on, it
  degrades **toward** the rule, not away from it — fall back to the same compliant default an unset
  field already gets, never to omitting the doctrine element entirely. Found live in run 1162:
  `EmphasizedHeading` rendered a heading entirely plain whenever the supplied emphasis word was
  absent from the text, which was correct in intent (stop a stray unspaced `<em>`) but meant an
  independently-edited `emmaHero.headline` with a stale `emmaHero.emphasisWord` silently shipped the
  live hero H1 with zero plum emphasis against design-doctrine.md section 2's "exactly one per
  headline" — and nothing caught it, because the component behaved exactly as written and the page
  looked fine to anything not counting `<em>` elements. Audit any renderer whose content input gates
  a doctrine requirement against this lens before shipping it, in particular `mood_image_url` behind
  `card_art_blocked` and any additive block field whose absence is a fallback path rather than a hard
  requirement.
