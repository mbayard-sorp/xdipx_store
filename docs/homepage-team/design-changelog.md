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

<!-- Newest entries appended above this line by each routine's changelog step. -->
