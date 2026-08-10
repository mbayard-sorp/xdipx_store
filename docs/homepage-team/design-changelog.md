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

<!-- Newest entries appended above this line by each routine's changelog step. -->
