# Storefront Design Audit — Fixes Plan

Source: Frontend Design Skill audit run 2026-05-17 in worktree `trusting-chaum-8f796b`.
Stack: React Router v7 framework mode, Tailwind v4 CSS-first, Express. **Not Next.js.**

## Global rules (every phase)

- React Router v7 framework mode. **Never** add `useEffect` for data, **never** import `.server.ts` from client modules. Loader → `useLoaderData` only.
- Tailwind v4 `@theme` tokens live in `app/app.css`. Reference tokens (`bg-coral`, `text-ink`, `border-line`), not raw hex.
- Mobile-first; test at 375px before larger breakpoints.
- Voice: no "Buy now", no countdowns, no em-dashes in Emma copy.
- Targeted patches only. Do **not** rewrite components. Do **not** add new features.
- Ignore any Next.js / cache-components / next-cache hook suggestions — wrong stack.

## Phase 0 — Documentation Discovery

Confirmed before authoring this plan; no further discovery needed. Reference patterns:

- **Tailwind v4 `@theme`:** existing tokens at `app/app.css:8-44`. Add custom utility via `@utility` block (Tailwind v4 syntax) for the focus ring.
- **React Router v7 imports:** all client components currently import from `'react-router'` (see `Navbar.tsx:2`). Use that exact import path.
- **Existing a11y patterns to copy:** Navbar account menu at `Navbar.tsx:186-241` shows the correct `aria-haspopup="menu"` / `role="menu"` / `role="menuitem"` pattern. Copy this shape; do not invent.
- **Existing CircleOptionSelector ARIA:** `CircleOptionSelector.tsx:211-214` already sets `aria-haspopup="listbox"` and `aria-label` on the trigger. Swatch buttons inside the popover (`:303`) already have proper aria-labels. **Re-verify the audit's claim** before patching this one.

Anti-patterns to reject:
- Do not import `motion/react` where a native CSS `transition` works.
- Do not add `useEffect` for any data fetch.
- Do not use `<details>` for FAQ if you also want JS-controlled animation — pick one (native `<details>` is recommended).
- Do not change `--radius-*` token values (they are intentionally all 8px per `app/app.css:35`).

---

## Phase 1 — Tokens & global a11y (`app/app.css`)

**Goal:** central fixes that propagate site-wide. Independently shippable.

### Tasks

1. **Bump `--color-muted`** from `#6F645C` to `#5D5855` in `app/app.css:17`. Reason: AA contrast on `cream-2` at <14px.
2. **Add a focus-visible utility** in `app/app.css` so every interactive element can opt in with a single class. Append after the existing animation blocks (around line 219):

   ```css
   /* Standardized focus ring — opt in via `focus-ring` class on any
      interactive element. Always coral, two-pixel offset on cream. */
   @utility focus-ring {
     outline: none;
     &:focus-visible {
       outline: 2px solid var(--color-coral);
       outline-offset: 2px;
       border-radius: var(--radius);
     }
   }
   ```

3. **Verify the radii decision.** `app/app.css:35-43` deliberately sets every radius token to 8px. The audit flagged this as inconsistent with `rounded-2xl` / `rounded-3xl` usage in components. **Do not change the tokens.** Instead, leave a comment in `app.css` documenting the intent (already partially there at line 35) and defer the literal `rounded-*` cleanup to its own phase (out of scope for this plan).

### Verification

- `grep -n "color-muted" app/app.css` → shows `#5D5855`.
- `grep -rn "focus-ring" app/` → at this point only `app/app.css`; downstream phases will use it.
- Run `pnpm typecheck` (no TS impact expected).
- Visit `/`, `/vault`, `/faq` in dev — page bodies render unchanged (muted text slightly darker).

### Anti-pattern guards

- Do **not** redefine `@theme` tokens with `--radius-lg: 16px` etc. Token scale is intentionally flat.
- Do **not** add `:focus` (non-`-visible`) styles — they trigger on mouse click and feel buggy.

---

## Phase 2 — Shared chrome (AgeGate + Navbar focus return)

**Files:** `app/components/store/AgeGate.tsx`, `app/components/store/Navbar.tsx`

### Tasks

1. **AgeGate contrast (`AgeGate.tsx:33`).** "Not yet" link is `bg-white/20 text-white` over a gradient with mid-tones — fails AA. Change to `bg-white/40 hover:bg-white/55 border border-white/60`. Keep the rest of the className intact.

   Replace `AgeGate.tsx:31-37`:
   ```tsx
   <a
     href="https://google.com"
     className="flex-1 bg-white/40 hover:bg-white/55 border border-white/60 text-white font-semibold py-3 px-6 rounded-full text-lg text-center transition-all focus-ring"
     style={{ fontFamily: 'var(--font-display)' }}
   >
     Not yet
   </a>
   ```

2. **AgeGate DOB inputs (`AgeGate.tsx:81-92`).** Inputs lack accessible labels. Add `aria-label={placeholder === 'MM' ? 'Month' : placeholder === 'DD' ? 'Day' : 'Year'}` and replace `focus:outline-none focus:border-white` with `focus-ring`.

3. **AgeGate "Not old enough" link (`AgeGate.tsx:105-107`).** `text-white/50` on the gradient is ~2.3:1. Bump to `text-white/80`.

4. **Navbar focus return (`Navbar.tsx:39-45`).** When the account menu closes, focus is lost. Add a trigger ref and restore focus.

   Add near the existing refs at line 40-44:
   ```tsx
   const accountTriggerRef = useRef<HTMLButtonElement>(null)
   ```

   Attach to the trigger button (`Navbar.tsx:187`):
   ```tsx
   <button
     ref={accountTriggerRef}
     onClick={() => setAccountMenuOpen(o => !o)}
     ...
   ```

   In the existing close-on-outside-click effect (`Navbar.tsx:68-84`), after `setAccountMenuOpen(false)` in **both** the click and escape handlers, add:
   ```tsx
   accountTriggerRef.current?.focus()
   ```

5. **Navbar logo focus (`Navbar.tsx:139-165`).** Add `focus-ring` to the className list.

### Verification

- Tab through age gate at `/` with no cookie → focus ring visible on every control.
- Open account menu with keyboard, press Esc → focus returns to the trigger button.
- Pa11y/axe quick check on `/` shows no contrast failures under "Age verification" region.

### Anti-pattern guards

- Do **not** wrap the `<a>` in a `<button>` — keep semantics.
- Do **not** add `tabIndex={-1}` anywhere — natural tab order should hold.
- Do **not** rewrite the gradient to flat coral — the gate's intentional brand moment.

---

## Phase 3 — Component a11y (CircleOptionSelector + FAQ)

**Files:** `app/components/store/CircleOptionSelector.tsx`, `app/routes/_layout.faq.tsx`

### Tasks

1. **Re-verify CircleOptionSelector audit claim first.** The audit said swatches lack labels, but `CircleOptionSelector.tsx:303` already has `aria-label={\`${val}${available ? '' : exists ? ' (out of stock)' : ' (unavailable)'}\`}`. The actual gap is the **trigger button** swatch (`:208-223`) which has `aria-label={\`${optionName}: ${selected ?? 'choose'}\`}` — readable but does not announce selection state to AT users.

   Patch `CircleOptionSelector.tsx:208-223` — add `aria-pressed={!!selected}` (since the trigger toggles a popover, `aria-expanded` is already there at `:212`; adding `aria-pressed` is wrong for a popover trigger). **Better fix:** change the dynamic `aria-label` to include current selection prominence:

   ```tsx
   aria-label={selected
     ? `${optionName}: ${selected}. Change selection.`
     : `Select ${optionName}`}
   ```

2. **Replace existing focus ring in CircleOptionSelector trigger (`:217`)** with the new `focus-ring` utility:

   Before: `'focus:outline-none focus:ring-2 focus:ring-coral/40 focus:ring-offset-2 focus:ring-offset-paper',`
   After:  `'focus-ring',`

3. **FAQ accordion → native `<details>` (`_layout.faq.tsx:115-144`).** The controlled `useState(open)` pattern blocks deep-linking and keyboard nav. Replace `FAQItem` body with native disclosure:

   ```tsx
   function FAQItem({ q, a }: { q: string; a: string }) {
     return (
       <details className="group bg-white rounded-xl overflow-hidden shadow-sm">
         <summary className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer list-none focus-ring [&::-webkit-details-marker]:hidden">
           <span
             className="font-semibold text-ink text-sm"
             style={{ fontFamily: 'var(--font-display)' }}
           >
             {q}
           </span>
           <span
             className="text-sage text-lg transition-transform group-open:rotate-45"
             aria-hidden="true"
           >
             +
           </span>
         </summary>
         <div className="px-5 pb-4 text-sm text-ink/70 leading-relaxed border-t border-cream-2 pt-3">
           {a}
         </div>
       </details>
     )
   }
   ```

   Remove the now-unused `import { useState } from 'react'` (check whether anything else in the file still uses it — it does not).

### Verification

- Tab to FAQ items at `/faq` — Enter toggles, screen reader announces "expanded/collapsed".
- `grep -n "useState" app/routes/_layout.faq.tsx` → no matches.
- Open PDP with a color-variant product, tab to swatch → screen reader announces "Color: [name]. Change selection." when one is picked.

### Anti-pattern guards

- Do **not** keep both `<details>` and the `open` useState — pick one.
- Do **not** add `aria-controls` to the `<summary>` — browsers handle disclosure semantics natively.
- Do **not** animate `details` height with framer-motion. If animation is wanted, defer to a later phase.

---

## Phase 4 — Consistency (button hover + vault pagination hierarchy)

**Files:** `app/components/store/AgeGate.tsx`, `app/routes/_layout.vault.tsx`, plus any other primary buttons that use `hover:scale-105 hover:shadow-lg` or `hover:opacity-90`.

### Tasks

1. **Standardize primary coral button hover.** Define the canonical pattern as:

   ```
   bg-coral hover:bg-coral-deep active:scale-[.98] transition-colors focus-ring
   ```

   Apply to:
   - `AgeGate.tsx:26` ("Yes, let me in ♥") — replace `transition-all hover:scale-105 hover:shadow-lg` with `transition-colors hover:bg-coral-deep` (note: button bg is currently `bg-white text-coral` — this is the *inverse* of primary coral. **Leave as-is** since the gate uses a white-on-gradient palette. Only standardize the visual feedback: replace `hover:scale-105 hover:shadow-lg` with `hover:bg-cream transition-colors`.)
   - `AgeGate.tsx:99` ("Enter ♥") — same treatment.
   - `_layout.vault.tsx:188` Next-page button — change `hover:opacity-90 transition-opacity` to `hover:bg-coral-deep transition-colors`.

2. **Vault pagination hierarchy (`_layout.vault.tsx:177-193`).** The current treatment is correct: "Previous" outline, "Next" solid coral. The audit's "inversion" claim was wrong. **No change** — but verify by re-reading the file and confirming Next is `bg-coral`.

3. **Search for other `hover:opacity-90` on primary CTAs** and convert each: `grep -rn "hover:opacity-90" app/ --include="*.tsx"`. Apply judgment — only swap on coral primary buttons, leave links/icons alone.

### Verification

- `grep -rn "hover:scale-105" app/components/store/AgeGate.tsx` → no matches.
- Visual smoke at `/vault?page=2` — Next button darkens on hover (no opacity fade).
- All primary CTAs feel uniform on hover.

### Anti-pattern guards

- Do **not** add `transition-all` — name the property (`transition-colors`).
- Do **not** modify secondary/tertiary buttons in this phase. Scope is primary coral only.

---

## Phase 5 — Responsive & empty/disabled states

**Files:** `app/routes/_layout.vault.tsx`, plus any homepage carousels that render unconditionally on empty data.

### Tasks

1. **Vault grid breakpoints (`_layout.vault.tsx:166`).** Add `sm:grid-cols-3` and `lg:grid-cols-5` to widen the breathing room:

   Before: `className="grid grid-cols-2 md:grid-cols-4 gap-4"`
   After:  `className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4"`

2. **Tab strip scroll snap (`_layout.vault.tsx:148-162`).** Add `scroll-smooth snap-x snap-mandatory` to the strip and `snap-start` to each tab Link so active tab stays in view on mobile.

3. **Carousel empty-state audit.** `grep -rn "ProductCarousel" app/routes/_layout._index.tsx` and check whether each instance renders a "See all →" link when `products.length === 0`. If so, wrap the carousel + CTA in a `{products.length > 0 && (...)}` guard. **Confirm with a Read first** before editing — the home page may already handle this.

4. **Add-to-cart loading/disabled state.** Locate the primary buy button (likely in `app/components/store/BundleHero.tsx` or `BuyBundleButton.tsx`) via `grep -rn "add.*cart\|addToCart" app/components/store/`. If the button lacks `disabled:opacity-50 disabled:cursor-not-allowed aria-busy`, add it. **Confirm scope** before editing — only the primary PDP add-to-cart.

### Verification

- DevTools mobile 375px → `/vault` shows 2 columns with comfortable gutters; 1024px → 5 columns.
- Tab to last filter chip on mobile → it stays in viewport.
- Visit a sold-out product → add-to-cart button is visibly disabled with cursor change.

### Anti-pattern guards

- Do **not** introduce CSS `@media` queries — use Tailwind responsive utilities.
- Do **not** add a JS scroll-into-view effect for the active tab. CSS scroll-snap is enough.
- Do **not** disable add-to-cart based on cart fetcher state without checking the existing pattern in the component first.

---

## Final phase — Verification sweep

1. `pnpm typecheck` — must pass.
2. `pnpm build` — must pass.
3. `grep -rn "hover:scale-105\|hover:opacity-90" app/components/store/AgeGate.tsx app/routes/_layout.vault.tsx` → no matches in changed lines.
4. `grep -rn "useState" app/routes/_layout.faq.tsx` → no matches.
5. `grep -n "focus-ring" app/app.css` → utility defined.
6. `grep -n "#5D5855" app/app.css` → muted color updated.
7. Manual a11y smoke: tab through `/`, `/vault`, `/faq`, age gate — every interactive element shows the coral focus ring.
8. Contrast check on muted text in a vault card metadata line — `#5D5855` on `#F2EADD` ≥ 5.7:1.
9. Visual smoke at 375px on `/vault` — 2 cols, comfortable gutters.

## Out of scope (do not do)

- Token radii cleanup (literal `rounded-2xl` → `rounded-[var(--radius)]` sweep).
- Heading-hierarchy refactor on category pages.
- AskEmmaRail filter-chip overflow fix on category pages.
- New PDP gallery responsive work.
- Any rewrites or new features.
- Any Next.js / cache-components advice — wrong stack.
