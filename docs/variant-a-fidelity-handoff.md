# Variant A "The Compass" — Design Fidelity Handoff

Handoff for a fresh session to do the **design-fidelity polish** pass on the
Variant A discovery home page. The page is now functional and on-brand; this is
the "tighten it against the prototype" pass, not a rebuild.

## The task

Diff the live Variant A surface against the design source of truth and tighten
spacing, type scale, interaction states, and empty states to match. Stay within
the v3 brand tokens (Newsreader display, DM Sans body, JetBrains Mono kickers,
coral accent, plum emphasis) — do not introduce new colors or fonts.

**Design source of truth:** `docs/discovery-prototype/concepts/concept-a.html`
(open directly in a browser to compare side by side).

> Note: the prototype `README.md` "Deviations" section is **stale**. It claims
> the brand is locked on Archivo/Inter and forbids purple. The current v3 Style
> Guide Nº 01 (see `CLAUDE.md`) adopted Newsreader + plum, which is exactly what
> the components already use. Match the prototype's visual intent; the font/color
> "deviations" no longer apply.

## Files in scope

- `app/components/discovery/HomeA.tsx` — page composition (hero, filter blocks, budget, rails grid)
- `app/components/discovery/ChipGroup.tsx`, `Chip.tsx` — chip filters
- `app/components/discovery/BudgetSlider.tsx`
- `app/components/discovery/Rail.tsx`, `ProductCard.tsx`
- `app/components/discovery/EmmaSidekick.tsx` — desktop sidebar + mobile pill
- `app/components/discovery/DailyDealStrip.tsx`, `WelcomeBackBanner.tsx`
- `app/app.css` — `@theme` tokens (reference only; prefer token utilities over raw values)

## How to view it

Make the server default to Variant A so `/` renders it directly:

- Run the dev server with the env var: `HOME_VARIANT=a npm run dev` (binds :3000), then open `http://localhost:3000/`. (A local, gitignored `.claude/launch.json` entry named "xdipx-store (Variant A default)" does this for the Preview MCP — add one in your worktree if you want it.)
- Or, on any running server: pin the cookie `xdipx_home_variant=a` (path=/), then load `/`.

Caveat: `?variant=a` works for the first paint but the discovery store rewrites
the URL to `/` on hydration (it only persists `m/a/k/b` params), dropping the
variant param — so a reload falls back to the resolver default (`legacy`). Use
the cookie or the `HOME_VARIANT=a` launch config for stable viewing.

## Known polish notes (observed during QA)

- **Mobile bottom crowding (375px):** three Emma touchpoints stack at the bottom
  — the global `AskEmmaWidget` chat FAB (bottom-right), the `EmmaSidekick` mobile
  pill (bottom), and the storefront bottom nav bar. They visually compete. Consider
  hiding the sidekick mobile pill when the chat FAB is the better entry point, or
  repositioning so they don't overlap.
- **Hero squiggle + wrap:** verify the coral underline squiggle under "you" and the
  "Find you in / a product." line break against the prototype on both breakpoints.
- **Empty/loading states:** rail empty state copy comes from `getRailEmptyLine`;
  verify the SSR-empty → hydrated transition has no layout shift.

## What's already done (do NOT redo)

- **Ask Emma CTA** is wired: `EmmaSidekick` dispatches `xdipx:emma:openWith` with a
  prompt from `getAskEmmaSeedPrompt(state)` (in `discovery-emma.ts`), which the
  globally-mounted `AskEmmaWidget` opens and auto-sends. Covered by unit tests.
- **Empty-vocab cache fix:** `getDiscoveryVocab` no longer serves/caches an empty
  vocab (was hiding all chip filters for 24h after a cold-start). Chips render.
- **Dev default:** server defaults to Variant A via the launch config above.
- **Resolver default decision:** code keeps `legacy` as the safe fallback; the
  go-live flip is via Sanity (below), not a code-default change.

## Go-live (Sanity flip) — sequencing matters

1. **Ship this branch first.** The resolver already reads `homeConfig.activeVariant`
   in production, so publishing the flip takes effect immediately — but the Ask
   Emma CTA fix and the vocab fix must be deployed first, or prod Variant A would
   show the old disabled button / empty chips.
2. In Sanity Studio, open the **Home Config** singleton → set **Active variant =
   "Variant A - The Compass"** → **Publish**. (The singleton did not exist yet; the
   schema is `studio/schemas/homeConfig.js`. The MCP can't pin a singleton `_id`,
   so create+publish it in Studio.)
3. Prod KV may hold a poisoned empty vocab from before the fix; the deployed fix
   self-heals on the next request (treats an empty cache as a miss and rebuilds).

## Verification status

- `npm run typecheck` — clean.
- `npx vitest run app/lib/discovery-emma.test.ts app/lib/discovery-rules.test.ts app/lib/discovery-tags.test.ts app/lib/home-variant.server.test.ts` — 114 passing.
- Ask Emma open → seeded-prompt flow verified in-browser; chips render; 375px checked.
