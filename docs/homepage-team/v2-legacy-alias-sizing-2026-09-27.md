# v2 legacy color alias — sizing and decision (ticket #11070)

Run 1034 (2026-09-23) rejected a cheap-and-certain hygiene proposal (swap `bg-cream` to
`bg-paper` on `app/root.tsx`'s two call sites) because it hadn't sized the class the proposal
belonged to, and filed this ticket so the next run wouldn't have to re-decide from scratch. This
doc is that sizing, done 2026-09-27, plus the decision the ticket's DONE WHEN asked for.

## What "v2 legacy alias" actually means, per `app/app.css`

`app/app.css`'s own comments distinguish two different things that `CLAUDE.md` and
`docs/design-doctrine.md` used to lump together as one bucket ("v2 aliases, banned in new
work"), which is the real source of the repeated re-litigation:

| name | `app.css` says | v3 replacement | class |
|---|---|---|---|
| `cream` | `#FFFFFF` (was `#FAF4EA`) | `paper` | true compatibility alias |
| `cream-2` | `#FAFAF9` (was `#F2EADD`) | `paper-2` | true compatibility alias |
| `muted` | `#6B5F68` (was `#6F645C` → ink-3) | `ink-3` | true compatibility alias |
| `coral-deep` | `#5B1F8A` (was `#D93A15` → plum-2) | `plum-2` | true compatibility alias |
| `sun` | `#F5B841`, **"unchanged — used in editorial accents"** | none defined | live, distinct color |
| `butter` | `#FFE28C`, **"unchanged"** | none defined | live, distinct color |
| `font-script` | Caveat, "legacy accent, sparing use" per `CLAUDE.md` | n/a (not a color) | different problem entirely |

Only the first four are actually retired-and-remapped: every existing use of `cream`,
`cream-2`, `muted`, or `coral-deep` already renders its v3 replacement's exact hex, so migrating
them is a pure rename with **zero visual diff**. `sun` and `butter` are not that: `app.css`
explicitly marks them "unchanged," meaning nobody has defined what v3 color would replace them,
and they are still in active, intentional use.

## Sizing (2026-09-27, `grep -rn` against `app/`)

**144 distinct files** reference at least one of these names (Tailwind utility class or
`var(--color-*)`), spanning `app/root.tsx`, most of `app/routes/admin.*`, most of
`app/routes/_layout.account.*`, and the majority of `app/components/{store,account,reviews,cms,admin}/`.
This confirms run 1034's instinct: it is a cross-cutting program, not a two-file fix.

Approximate per-name magnitude (Tailwind-utility-class matches and `var(--color-*)` matches
counted separately; `cream` vs `cream-2` overlap slightly under a simple regex, so read these as
orders of magnitude, not exact-to-the-occurrence):

| name | Tailwind utility (`bg-`/`text-`/`border-`) | `var(--color-*)` | where |
|---|---|---|---|
| `cream` / `cream-2` | ~1,300 combined | ~3 | the overwhelming bulk — admin panels, account pages, reviews, cms, storefront routes |
| `muted` | ~260 | ~2 | scattered across the same set |
| `coral-deep` | 31 | 10 | scattered, no obvious concentration |
| `sun` | 21 | 0 | editorial/admin accents |
| `butter` | 0 | 16 | **only** three storefront hero components (below) |
| `font-script` | 0 | 0 | no live occurrence found under this name in `app/` |

**`butter` is a customer-facing finding worth flagging on its own.** All 16 occurrences are
inline `style={{ background: 'var(--color-butter)' }}` (and one linear-gradient variant) in
`app/components/store/EndorsementHero.tsx`, `PairBundleHero.tsx`, and
`PairBundleFullBleedHero.tsx` — three hero surfaces every visitor of those pages sees, styled as
a deliberate "butter→amber gradient" treatment (`PairBundleHero.tsx`'s own comment). Because
`bg-butter` (the Tailwind utility) has zero uses, a Tailwind-class-only grep — which is what a
quick sizing pass would naturally reach for — reports `butter` as unused. It is not; it just
isn't expressed as a utility class anywhere. Anyone sizing or auditing this class in the future
should grep for `var(--color-<name>)` as well as the utility classes, not the utility classes
alone.

## Classification

- **Mechanical, safe to codemod**: `cream`, `cream-2`, `muted`, `coral-deep`. Each is a pure
  rename to its documented v3 equivalent with no visual change, verifiable the same way
  `app/components/reviews/brand-token-drift.test.ts` already verifies the sage/coral/ink-4
  migration (source-text assertion, not a screenshot diff).
- **Judgment call, not a token-hygiene item**: `sun`, `butter`. Both are live, intentional
  colors with no defined v3 replacement. `butter` in particular is a customer-facing visual
  choice on three hero components; retiring or replacing it is a design decision about those
  components' visual language, not a rename. Nobody should "fix" these by pattern-matching them
  alongside `cream`/`muted`/`coral-deep`.
- **Not actually part of this problem**: `font-script`. `CLAUDE.md` already correctly scopes it
  ("legacy accent, sparing use," not "banned"), and no live occurrence surfaced under this name
  in `app/` during this sizing pass.

## Decision (ticket #11070 DONE WHEN: "either answer is fine")

1. **Schedule the mechanical migration (`cream`/`cream-2`/`muted`/`coral-deep`) as a
   directory-scoped codemod program, not one 144-file PR.** A single mega-PR touching nearly
   every route and component directory is unreviewable and high-risk to merge atomically; a
   scripted rename (not hand-edits) run and PR'd per directory group keeps each change small,
   revertable, and independently verifiable. Suggested sequencing, smallest/lowest-risk first:
   1. `coral-deep` alone (41 combined occurrences, no concentration) — proves the codemod script
      and the verification pattern before touching the big three.
   2. `app/components/reviews/*` (already has the `brand-token-drift.test.ts` guard to extend).
   3. `app/components/account/*` and `app/routes/_layout.account.*`.
   4. `app/routes/admin.*` and `app/components/admin/*`.
   5. Remaining storefront components + `app/root.tsx`.
   Each PR: run a scripted rename (utility class + `var(--color-*)` both), add or extend a
   source-text regression guard for that directory, confirm typecheck/tests/build green, no
   visual diff expected or needed since every replacement renders the identical hex.
2. **`sun` and `butter` are not scheduled.** They are correctly *not* "new-code violations" by
   existing, and are not legacy debt in the same sense as the other four — see the
   classification above. `CLAUDE.md` and `docs/design-doctrine.md` §3 have been corrected
   (2026-09-27) to stop calling them "banned" alongside the true aliases, which is what caused
   this ticket's underlying confusion in the first place. A future decision to retire the amber
   accent (replace `butter` with a v3 color, or keep it as a deliberate fourth accent) belongs to
   whoever owns the bundle-hero visual language, not to a token-hygiene ticket.
3. **`font-script` needs no decision here.** Its existing "sparing use" framing already matches
   reality.

No milestone table / RAG tracking is registered for this in `docs/store-team/trackers/`: that
directory's own README restricts writes there to `program-manager` via its own docs-only PR
lane. If the directory-scoped migration above is picked up as an active program, `program-manager`
should register it there from this doc's sizing and sequencing.
