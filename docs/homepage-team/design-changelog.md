# Homepage Design Changelog

An append-only, dated log of every content or design change the homepage team ships, so the visual
history of the storefront is auditable in one place instead of reconstructed from run events. Both
homepage routines append here as their last content/design step:

- **Routine A — Daily Merchandiser** (`routine-daily-merchandise.md`) appends an entry on every run
  that changes what the page shows (hero, rails, wayfinder tiles, imagery, copy, section order).
- **Routine B — Design Cycle** (`routine-design-cycle.md`) appends an entry when a design/shell PR
  ships (or is opened for the release engine).

## Entry format

One dated entry per change, newest first. Each entry names **what changed**, **why**, and the
**evidence probe touched** (the run/PR/event or GA4/GSC signal that motivated or verifies it):

```
### YYYY-MM-DD — [Routine A|Routine B] — <one-line what changed>
- **What:** <the concrete surfaces that changed — hero/rail/tile/section/PR>
- **Why:** <theme, signal, or directive that drove it>
- **Evidence:** <run id / PR # / event / GA4 or GSC probe touched>
```

Keep entries terse and factual. This file is content/documentation on the agent-editor allowlist
(`docs/homepage-team/*.md`); it carries no code and gates nothing.

## Entries

### 2026-08-12 — Routine B — Harden the /social IG-arrival surface (in-stock pin, attributed primary link, fresh hero copy)
- **What:** `app/routes/_layout.social.tsx` — (1) the pinned featured product now requires an in-stock match (falls through / hides rather than sending IG traffic to a dead PDP); (2) the primary featured PDP link now carries the social UTM via `pdpHref`, matching the recent grid, so IG→PDP is measured on the highest-intent click; (3) hero copy retired-tic fix ("point you at" → "find you"). No shell/section/schema change. Ambition-mandate concept wire `docs/homepage-team/concepts/first-tap.md` banked (design-only, not built).
- **Why:** Strategy brief #5 names /social the priority IG→landing→PDP surface and "measure each hop honestly" as the month's job; the primary click was the one hop we could not attribute, and the pin had no stock guard (same failure class that pulled a live IG post on 08-09). "point you to/at" is retired by mission brief §8.
- **Evidence:** run #282; brief #5 (IG live, GA4-blind); WebFetch egress blocked for competitors this run (self-capture only); voice gate PASS; typecheck/build/1788 tests green; PR link on the run row.

### 2026-08-12 — Routine A — Hero + couples-rail copy refresh (Weekend In); #1785 declined
- **What:** `singleton.emmaHero` copy fully refreshed (eyebrow/headline/body/pullQuote) for the held We-Vibe "Moving as One" couples-kit hero; couples rail (`emmaRail-augreset-couples-20260801`) eyebrow/heading refreshed and a pairing aside added. No product-selection or imagery change this run (named supply hold).
- **Why:** Active theme "Weekend In, Not Out" (marketing_calendar #6). Per-run freshness cadence (Step 2c) plus a voice cleanup (removed the borderline-dare "make them beg" from the hero body). Suggestion #1785's fresh candidates declined — Moxie+ has a packaging-only primary with no clean sibling, Biird glass plug is off-theme for the couples/wearable week, Gush 2 is 404.
- **Evidence:** run 280; sameness-diff surfaces Hero (copy) + Rails (copy); Sanity revisions Aq77mZkFsuxXAoKZNDfL22 (hero), Aq77mZkFsuxXAoKZNDfNHU (rail); health sweep GREEN on all 8 live pages.

### 2026-08-11 — Routine A — Weekend-In-Not-Out theme refresh (completed #248's deferred slate)
- **What:** Regenerated the "Discover You" promo image (fresh archetype-C product-forward scene: We-Vibe couples kit on a plum-soft ground with linen throw, warm daylight); rethemed promo copy off the August-Reset "give yourself the month" line to a Weekend-In staycation frame; refreshed both wired rail eyebrows + asides (couples rail "A weekend, the two of you"; on-ramp rail "Easy to start, under $30") in fresh dial-9 voice; refreshed the couples wayfinder tile aside. Hero held (We-Vibe kit, rotated yesterday). Flipped the "Weekend In, Not Out" calendar row planned→active.
- **Why:** Monday changeover run #248 shipped only the hero + announcement and explicitly deferred the theme's art floor, rail re-copy, wayfinder/promo, and calendar flip to the next non-changeover run (today). Theme = "Weekend In, Not Out" (couples wellness + wearables, staycation).
- **Evidence:** run 264. Sameness-diff surfaces vs #248: promo imagery (new asset), promo copy, both rail eyebrows/asides, couples tile aside (≥2 surfaces, one imagery). Step 5b health sweep GREEN (8/8 surfaces 200, one H1). Promo image gen attempt 1 (no-ref human-context) blackened by fal NSFW filter → retried with product ref (Kontext), passed.

<!-- Newest entries appended above this line by each routine's changelog step. -->
