# New Sanity blocks for the homepage redesign

Additive only — new schema files in `studio/schemas/blocks/`, registered in the studio schema index,
typed in `app/types/cms.ts`, and given a case in `app/components/cms/ContentBlockRenderer.tsx`.
**Never modify existing schema.** See the additive-only rule in CLAUDE.md.

The locked design needs **one** genuinely new block (`emmaHeroStorefront`). A small `faq` block is
optional (section 10 can also be `richText` + the existing `FAQStructuredData` component).

---

## `emmaHeroStorefront` (required)

The hero + Emma introduction + the above-the-fold guided entry, in one SSR-visible section. Replaces
the hardcoded `Hero` function in `StorefrontHome.tsx`.

**v4 voice note (2026-07-02):** `docs/emma-voice.md` (the canonical voice charter) now demotes Emma
from hero top billing: no "Curated by Emma" eyebrow and no Emma aside above the fold. Populate
`eyebrow` with a non-Emma kicker and leave `emmaAside` unset in the hero unless the charter's
Emma-placement rule changes. Where this spec's examples disagree, the charter wins.

**Fields**
- `eyebrow` (string) — mono kicker, e.g. "Editorially picked. Discreetly shipped." (per the v4
  charter, not "Curated by Emma...").
- `headline` (text, ≤80 chars) — Newsreader; one word wrapped in `<em>` for the plum-italic treatment.
- `emmaAside` (text, ≤120 chars) — Emma first-person advisory per the charter (AI-guide voice, never
  lived experience); under v4 placement rules, leave unset in the hero.
- `featuredProductHandle` (string) — the hero product (LCP image). Resolved server-side. By rule this
  is the **top item of Emma's daily `emmaCuratedRail`**; the field lets the team pin an override.
- `primaryCtaLabel` (string, default "Take a peek →") / `primaryCtaLink` (string) — revenue CTA to
  `/products/{handle}`. The daily team's hero-product choice sets the link at SSR time.
- `secondaryCtaLabel` (string, default "Find your fit →") / `secondaryCtaLink` (string, default
  "/discover") — ghost CTA.
- `moodPills` (array of references to `emmaPreset` docs, ≤6) — the above-the-fold guided entry.
  Rendered as SSR `<a href="/discover?preset={slug}">` anchors (crawlable, work without JS) that
  **progressively enhance** to seed the Ask-Emma chat via the existing `xdipx:emma:openWith` event.
- `bgStyle` ('paper' | 'paper-2', default 'paper').

**Render contract**
- The featured image is the **LCP candidate**: server-rendered, `priority`, fixed-aspect box, **never
  wrapped in `<Reveal>`/motion** (zero CLS). The text column may stagger-reveal.
- `emmaAside` renders in `font-display` italic (sage `♥`), visually distinct from the headline.
- The pill click handler fires `xdipx:emma:openWith` on the **client** — the pill component (or an
  island) needs the `.client` boundary; the `<a href>` is the SSR/no-JS fallback.
- Shell = the two-column structure, byline, LCP slot, pill row. Content (daily-team-owned) = every
  field above.

**Owners:** schema → `sanity-content-builder`; component/layout → `homepage-designer` then
`rr7-engineer` (Routine B PR); daily copy/product/pills → `homepage-orchestrator`.

---

## `faq` (optional)

Section 10. If a dedicated block is preferred over `richText`:

**Fields**
- `heading` (string, default "Questions, answered.")
- `items` (array of `{ question: string, answer: text }`, 3–6) — e.g. "What is xdipx?", "How discreet
  is shipping?", "Who is Emma?", "What payment methods do you take?".

**Render contract:** renders the Q&A visibly AND emits `FAQPage` JSON-LD (reuse
`app/components/seo/FAQStructuredData.tsx`). Answer-shaped, citable copy for AEO. Voice per
`docs/emma-voice.md` (the canonical voice charter).

---

## Explicitly NOT new blocks

- Section 3 "Meet Emma" → reuse `editorBio` (reads `singleton.editor`).
- Section 8 "Tell Emma a mood" → reuse `promoBanner` with a dark `bgStyle` + CTA to `/discover`.
- Section 9 "From the Notebook" → reuse `editorialTiles`.
- The mood-pill onboarding → absorbed into `emmaHeroStorefront` (no separate `emmaOnboardingBand`).
