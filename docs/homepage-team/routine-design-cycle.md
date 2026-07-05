# Routine B — Design Cycle

The weekly / on-demand playbook for structural and visual change. Unlike Routine A (which
auto-publishes content), Routine B **never auto-merges**: it produces wireframes, builds a prototype
on a branch, runs the review gates, and **opens a PR for human approval**. The Vercel preview URL is
the "designs on localhost before build" — a cloud routine can't drive your localhost, so the loop is:
routine pushes a branch → Vercel preview deploys → you review that URL (or `git checkout` to run
locally) → you approve the PR. Branch protection on `main` enforces approval.

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

curl -s "$BASE_URL/api/homepage-team/gate" -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN"
```

If `gate.ok` is `false`, post a `skipped` status and stop (same as Routine A). Emit `/event` rows
through every phase below so the dashboard shows the design cycle live.

### 1. IA + design — wireframes

- `homepage-ia` defines or revises the section taxonomy and the shell-vs-content split (what's new,
  what it maps to, what stays frozen).
- `homepage-designer` produces wireframes + an art-direction doc using the **design capability stack**
  (`taste-skill` → matching style skill + shared components, `ui-ux-pro-max`, Emil Kowalski's
  animation skill) on top of the repo-native Motion primitives (`app/lib/use-reveal.ts`,
  `app/components/motion/Reveal.tsx`, `variants.ts`) and the v3 brand tokens in `app/app.css`.
- Hard constraints still bind: mobile-first @375px, zero-CLS (transform/opacity only, **never wrap the
  LCP hero**), SSR-visible content, brand palette + Emma voice.

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
- **Emma voice gate** — `emma-empathy-reviewer` signs off on all customer-facing copy against
  `docs/emma-voice.md` (the canonical voice charter).
- `seo-pdp-auditor` + `aeo-geo-auditor` — when the change affects rendering, JSON-LD, canonical, the
  markdown/llms surface, or section structure.

### 5. Open a PR — never auto-merge

Push the branch and open a PR against `main`. Record the PR URL on the run:

```bash
curl -s -X POST "$BASE_URL/api/homepage-team/run" \
  -H "x-team-secret: $HOMEPAGE_TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'"$RUN_ID"',"update":{"status":"succeeded","finished":true,"currentPhase":"pr-open","prUrl":"https://github.com/<org>/<repo>/pull/<n>","summary":"Design cycle: new hero block + category-nav block; preview deploy attached, awaiting approval"}}'
```

The Vercel preview URL (auto-attached to the PR) is the human's review surface. **The routine stops
here.** A human reviews the preview, approves the PR, and merges. **Branch protection on `main`
requires that approval** — the team cannot merge its own code. That is the enforcement of the
"gate code" decision.

### 6. Spend

Log Max reasoning tokens via `POST /spend {kind:'tokens', source:'agent-sdk', feature:'homepage-design'}`
and any images via `POST /spend {kind:'image', feature:'homepage-images'}`, same shapes as Routine A.
The design cycle's allowance is `homepage_team_build_cents`, not the daily merchandising cap.

---

## Prioritized backlog

1. **Hero deep-link CTA: verify shipped, then use.** `primaryCtaLink` + `primaryCtaLabel` support
   on the storefront hero, so the hero CTA can deep-link to `/products/{handle}` (mission brief
   section 1). Implementation is landing in the same PR as this playbook edit, so the job here is
   to verify it is live in production, then have Routine A point the hero CTA at the featured
   product's page every run. If it turns out not to be live, finishing it is this routine's top
   item.

---

## Hard rules for this routine

- **Never auto-merge.** Always a PR; a human approves. Branch protection on `main` enforces it.
- **Never touch `main` directly.** All work on a feature branch.
- **Additive Sanity only** — new blocks/fields in new files; never modify existing schema.
- **Respect the repo-native Motion system + v3 tokens** — don't hand-roll IntersectionObserver or
  reintroduce orange/old-cream/gradients; never wrap the LCP hero.
- **Reasoning on Max** — no calls to the site's Anthropic-keyed endpoints.
- **Weekly, capped** — own turn cap + `build_cents`; one team run at a time (the gate enforces it).
- **Emit `/run` + `/event` updates** throughout so the dashboard shows the cycle and links the PR.
