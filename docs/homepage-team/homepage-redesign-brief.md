# Homepage Redesign Brief — "Emma's Edit"

Canonical, owner-approved design for the new xdipx storefront homepage (`/`, variant `b`).
Produced by the homepage team across three design passes + a team critique round; the lo-fi
wireframe was approved 2026-06-17. This is the source of truth the hi-fi pass and the build work
from. The paste-ready visual prompt is in [`claude-design-prompt.md`](./claude-design-prompt.md);
the two new Sanity blocks are specced in [`new-blocks.md`](./new-blocks.md).

## Concept

An **editorial magazine front door**, not a generic product grid. It personifies **Emma** (the
brand's AI wellness guide), leads a cold visitor into a low-friction **guided path**, and front-loads
trust — while keeping high-intent products and the team's experiment surface prominent. North star:
**drive sales.** Brand: tasteful editorial, never explicit, age-gated, discreet (billed `XDIPX`),
v3 tokens (white paper, coral accent, plum emphasis, Newsreader / DM Sans / JetBrains-Mono kickers,
22px radii, editorial reveal motion). Voice: all copy follows `docs/emma-voice.md` (the canonical
voice charter). Note the v4 charter changes (2026-07-02): "sex toy" is a normal noun, "sexy" as a
branding adjective is banned, the house tics ("keep(s) coming back to", "the one I'd..." aside
openers) are retired, and Emma no longer gets hero top billing (no "Curated by Emma" eyebrow, no
Emma aside above the fold; she lives in the mid-page intro and guided entries). Where this brief's
copy or hero framing disagrees, the charter wins.

## Locked section order (mobile-first)

| # | Section | Block | Shell / Content | Route | Notes |
|---|---|---|---|---|---|
| 0 | Announcement bar | `announcementBar` (reuse) | shell pos / content msgs | — | Rendered in `_layout.tsx`. |
| 1 | Hero | **`emmaHeroStorefront` (NEW)** | shell structure / content | `/products/{slug}` + `/discover` | Emma byline + ONE featured product (LCP, static, unwrapped). Primary CTA `Take a peek →` (revenue, to the product). A **mood-pill row lives in the hero** (guided entry, above the fold) → `/discover?preset={slug}`. Ghost CTA `Find your fit →`. **Hero product = top item of Emma's daily `emmaCuratedRail`** (team-controlled, no deal-approval gate); deduped from the rails below. |
| 2 | Trust strip | `trustBar` (reuse) | shell pos (LOCKED) | — | Raised above the fold. Plain packaging · billed as XDIPX · 30-day returns · vetted by humans. |
| 3 | Meet Emma | `editorBio` (reuse) or small new band | content | `/about` | Who she is + curator bio MERGED into one Emma moment. AI-guide voice, E-E-A-T. |
| 4 | Find your way in | `categoryGrid` (reuse) | shell grid / content tiles | `/for-her`, `/for-him`, `/collections/first-time`, `/discover` | Image mosaic; "Discover You" is the larger tile. |
| 5 | Rotating rails | `productCarousel` / `emmaCuratedRail` (reuse) | **TEAM-MANAGED** | collections / tags | The experiment surface. Guardrails below. |
| 6 | Social proof | `testimonials` (reuse) | content | — | FULL section (heading + 3–4 cards). Owner kept this AND Couples. |
| 7 | Couples | `playTogetherBanner` (reuse) + a rail | content | `/collections/couples` | Banner + couples rail. |
| 8 | Tell Emma a mood | `promoBanner` (reuse, dark `bgStyle`) | content | `/discover` | Second guided entry; full-width ink band. |
| 9 | From the Notebook | `editorialTiles` (reuse) | content | `/notebook` | 3 reads; each card should also link a relevant product/collection. |
| 10 | FAQ | new small `faq` block or `richText` + `FAQStructuredData` | content | — | "What is xdipx / how discreet / who's Emma / payments." FAQPage JSON-LD (AEO). |
| 11 | Email capture | `EmailSubscribe` (existing component) | shell (LOCKED last) | — | "Good taste, delivered quietly." → Klaviyo. No discount/countdown. |
| F | Footer | `siteSettings.footerColumns` | content | — | Shop / Discover / About / Discreet. "Discover You", never "Vault". |

## Rotating-rails guardrails (section 5)

- The rail set, count, and order are the **daily team's content lane** (no PR) — this is where they
  experiment to drive sales.
- **Always-on best-seller anchor** rail (the team may reorder around it but not remove it).
- **Cap: 2–4 rails** (prevents experimenting the page into a wall of carousels or into zero product
  exposure between the mosaic and Couples).
- **No A/B infra at launch.** Reorder-as-content + read GA4 next day + reorder again. A real
  per-section experiment surface (a `variantGroup` field on the rail blocks + sticky assignment +
  GA4 dimension) is a later Routine B item, not launch scope.
- The hero product is **deduped** out of the rails.

## Component plan (reuse vs net-new)

- **Reuse (no schema change):** `announcementBar`, `trustBar`, `categoryGrid`, `productCarousel`,
  `emmaCuratedRail`, `editorBio`, `testimonials`, `playTogetherBanner`, `promoBanner` (dark band),
  `editorialTiles` (notebook). `EmailSubscribe` component as-is.
- **Net-new (additive only — see [`new-blocks.md`](./new-blocks.md)):** `emmaHeroStorefront` only.
  The mood-pill onboarding is **absorbed into the hero block** (so no separate `emmaOnboardingBand`
  is needed), and section 3 "Meet Emma" reuses `editorBio`. A small `faq` block is optional —
  `richText` + the existing `FAQStructuredData` component can cover section 10. Earlier-proposed
  `discoverYouBand` and `notebookTeaser` were dropped — `promoBanner` and `editorialTiles` already
  do the job.

## Shell vs content lane (daily-routine rules)

- **LOCKED (position fixed):** announcement bar (first), hero (second), trust strip (third), email
  capture (last). The team cannot move these.
- **TEAM-MANAGED:** the rotating-rails zone — any rails, any order, within the guardrails.
- **TEAM-REORDERABLE (within the middle band):** all other sections — the team may reorder and
  toggle active/inactive, but not change routes, the shell, or component structure.
- **Routine B (gated PR):** adding/removing a section type, new blocks, route/canonical changes,
  component or loader changes, the future A/B `variantGroup` field.

## Plumbing / build prerequisites

- 301 redirect `/vault` (and `/vault/*`) → `/discover`; remove all "Vault" labels (nav, footer,
  tiles) in favor of "Discover You". The `/discover` route + 30 `emmaPreset` docs already exist
  (publish the preset drafts).
- Confirm a Shopify collection with handle `first-time` exists (category tile target), or add it.
- Add a homepage **FAQ** with `FAQStructuredData` (FAQPage JSON-LD); keep stable crawlable editorial
  text + a clear H1/H2 hierarchy so the rotating rails don't erode index stability. Advertise the
  `/index.md` twin (already present). Collection `.md` mirrors are a separate SEO task.
- Extend `getHomepageSignals()` (or the GA4 read) with per-rail add-to-cart + scroll-depth past the
  Emma band so the team can tell a winning change from a losing one.
- The Ask-Emma chat widget currently uses a coral→orange gradient — a v3 brand violation. Re-spec to
  flat coral / plum as part of this work.
- Go live by flipping `HOME_VARIANT=b` (or Sanity `homeConfig.activeVariant='b'`) after QA.

## Process / ownership

- Hi-fi visual: owner runs [`claude-design-prompt.md`](./claude-design-prompt.md) through
  claude.ai/design, OR the team prototypes; result is a visual reference, not shipped code.
- Build: `sanity-content-builder` (new blocks, additive) + `rr7-engineer` (`StorefrontHome` relayout,
  loader, the dedupe rule) via a **gated PR** (never auto-merged); `tech-architect` review;
  `seo-pdp-auditor` + `aeo-geo-auditor` acceptance; `qa-reviewer` (preview MCP, CLS/LCP, 375px).
- Daily operation thereafter: `homepage-orchestrator` runs the merchandising loop; the new
  `homepage-cro` agent (`.claude/agents/homepage-cro.md`) carries the conversion lens.
