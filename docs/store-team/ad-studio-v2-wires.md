# Ad Studio v2: art direction and wireframes

Status: design pass for PR-A (shell, nav, Ideas) and PR-C (Creatives), with Live (PR-G) and Spend
(PR-H) drawn now so the shell does not get rebuilt twice. Written 2026-10-03 by `homepage-designer`.
Nothing here is built. Builders: `rr7-engineer` per the plan's §6 PR split.

Inputs read: `docs/store-team/ad-studio-v2-plan.md` §4 to §6, `docs/audits/ad-platform-research-2026-10-03.md`
(A.2, A.3, E.2, "Patterns to copy"), `docs/audits/ad-studio-audit-2026-10-03.md` §7 and §8,
`app/components/admin/AdminNav.tsx`, `app/components/admin/ResponsiveTable.tsx`,
`app/components/admin/social/AssetFeedback.tsx`, `app/components/admin/social/StatusPill.tsx`,
`app/components/admin/social/LibraryGrid.tsx`, `app/routes/admin.socials.tsx`,
`app/routes/admin.socials.library.tsx`, `app/routes/admin.tsx`, `app/app.css`,
`app/components/motion/*`, the taste pack `dashboards` skill and its style recipe, and a
ui-ux-pro-max UX search (results applied in §2.6).

---

## 1. Style decision and rationale

**Taste pack: dashboards. Variance 4, motion 4, density 7.** Already decided; this section records
what it means on this surface.

Ad Studio is a review desk with a money gauge bolted to the top. The owner opens it on a phone,
answers "what is waiting on me and what is it costing", rates a batch, and leaves. So:

- **The first screen is work.** No intro paragraph, no stat-card row. The burn bar answers "what is
  it costing", the tab badges answer "what is waiting", and the feed starts directly under them.
- **Cards for judging, tables for comparing.** Ideas and Creatives are judged one at a time, so they
  are full-width cards (research pattern 1). Live and Spend compare numbers across rows, so at md and
  up they are tables inside `ResponsiveTable`. On a phone, Live rows become cards because nobody
  compares eight columns at 375px.
- **One instrument surface, not tiles.** Where metrics group (Live header, Spend header), they sit
  in one band with hairline dividers, never as separate floating cards.
- **It has to feel like Social Studio's sibling.** Same paper-on-paper-2 ground, same pill grammar
  (`StatusPill`: glyph plus word, never colour alone), same chip styling (`border-coral bg-coral-soft`
  when on), same heart and thumbs-down gesture, same `font-display text-2xl` page title, same mono
  metadata. A builder who has worked on `/admin/socials` should recognise every part.

**Brand tokens unchanged.** Paper, ink, coral as a sparse accent, plum for emphasis, sage for quiet
good states. No new fonts, no gradients, no emoji, icons from the existing admin set.

### 1.1 The coral budget

Inside Ad Studio, coral appears in exactly these places, and nowhere else:

1. The active heart (`bg-coral border-coral text-white`) and its sheet's "Done" button, both
   inherited unchanged from `AssetFeedback.tsx`.
2. A selected chip's border and fill (`border-coral bg-coral-soft text-ink`), inherited from the
   library filters and the reason chips.
3. The single primary submit on the Spend tab ("Save cap").
4. Focus rings (`focus:ring-2 focus:ring-coral/30`), inherited.

Not coral: the in-studio tab rail and bottom bar (the global `AdminNav` already paints "Ad Studio"
coral; a second coral nav would double it), tab badges, warnings, the recommended Live action, the
simulation badge. Warnings use the amber and red pairs that `StatusPill` already uses.

---

## 2. System

### 2.1 Page frame and the admin shell it lives in

`app/routes/admin.tsx` gives every admin page: a 52px sticky ink header on phones (`py-3` plus a
28px line), the `AdminNav` drawer (phones) or 224px rail (`md:w-56`), and a content column with
`p-4 md:p-8`. Ad Studio lives inside that column. Usable widths:

| Viewport | Content column | Ad Studio rail | Main column |
|---|---|---|---|
| 375 | 343 | none (bottom bar) | 343 |
| 768 (md) | 480 | 72 + 24 gap | 384 |
| 1024 (lg) | 736 | 72 + 24 gap | 640 |
| 1280 (xl) | 992 | 72 + 24 gap | 896 |

So md still composes like a phone (one column). Two-column layouts begin at lg.

**Shell precondition for sticky (verify in preview before building).** The content column in
`admin.tsx` is `overflow-auto` at every width. An `overflow: auto` ancestor becomes the sticky
containing scroller, and since that column never scrolls itself (the window does), `position:
sticky` inside it will not stick. This probably already affects the library's sticky toolbar. Fix
options for `rr7-engineer`: change that column to `overflow-x-clip` (keeps the no-sideways-scroll
guarantee without creating a scroll container), or render the burn bar `fixed` with a spacer of the
same height. The first is cleaner and fixes Social Studio's toolbar too. QA must confirm the burn bar
sticks at 375, 768 and 1024.

### 2.2 Routes, not tabs

Copy Social Studio's decision (ADR-013 decision 12): the four tabs are child routes, each with its
own loader and action, so the back button works and each tab can fail alone.

```
app/routes/admin.ad-studio.tsx            layout: burn bar, StudioTabs, <Outlet/>
app/routes/admin.ad-studio._index.tsx     redirect to /ideas (or /creatives when ideas are empty and creatives await rating)
app/routes/admin.ad-studio.ideas.tsx
app/routes/admin.ad-studio.creatives.tsx
app/routes/admin.ad-studio.live.tsx
app/routes/admin.ad-studio.spend.tsx
```

The current batch generator in `admin.ad-studio.tsx` moves out of the way when the file becomes a
layout. Where it goes (a `/legacy` child until PR-C retires it, or straight deletion) is the
engineer's call against plan §5; it is not drawn here.

Each child route exports an `ErrorBoundary` so a failed loader renders the error slab (§8.3) inside
the shell, with the burn bar and tabs still working.

### 2.3 Type roles

| Role | Classes | Used for |
|---|---|---|
| Page title | `font-display text-2xl text-ink` (`text-xl` under md) | "Ad Studio", matches Social Studio's h1 |
| Card title | `font-display text-lg leading-snug text-ink` | Idea title |
| Kicker | `.kicker` (mono uppercase, from `app.css`) | Concept name on idea and creative cards, section labels |
| Body | `text-sm text-ink-2` | First headline, slogan, rule sentences |
| Meta | `text-xs text-ink-3` | Products, timestamps in prose |
| Data | `font-mono text-[11px] tabular-nums text-ink-3` | Break-even line, ids, formats, lookback chips |
| Data, strong | `font-mono text-sm font-semibold tabular-nums text-ink` | Burn bar figures, table numbers |
| Figure | `font-mono text-3xl tabular-nums text-ink` | Spend cap value only |
| Pill and chip label | `text-[11px] font-semibold leading-none` | Status, lane, gate, export pills |

Newsreader carries only the page title and idea titles. Everything operational is DM Sans or
JetBrains Mono. Every number on the surface is `tabular-nums`.

### 2.4 Color roles

| Role | Token classes |
|---|---|
| Ground | `bg-paper-2` (the shell's `bg-cream-2` is the same value; new code uses the v3 name) |
| Surface (cards, bars, sheets) | `bg-paper border border-line` |
| Inset (media wells, skeletons, tracks) | `bg-paper-3` |
| Hairline | `border-line`, stronger `border-line-2`, drop zone dashes `border-line-3` |
| Text | `text-ink`, secondary `text-ink-2`, meta `text-ink-3`, fine `text-ink-4` |
| Good / pass | `border-sage/40 bg-sage/10 text-[#4F6150]` (from `GatePill`) |
| Warn / revise | `border-amber-300 bg-amber-50 text-amber-800` |
| Bad / block / error | `border-red-300 bg-red-50 text-red-800`, inline error text `text-red-700` |
| Emphasis / in progress | `border-plum/20 bg-plum-soft text-plum-2` (simulation badge, "building") |
| Selected | `border-coral bg-coral-soft text-ink` |
| Dark (toast, recommended action) | `bg-ink text-white` |

### 2.5 Spacing rhythm

4px base. One rhythm, applied everywhere:

- Card padding `p-4`, `lg:p-5`. Card body internal stack `space-y-2`.
- Between cards `gap-3` (12) on phones, `lg:gap-4` (16).
- Between page sections `space-y-6` (24).
- Chip rows `gap-1.5`; button clusters `gap-2` (8px minimum between touch targets, per the UX search).
- Burn bar height 48 (`h-12`). Bottom tab bar 56 plus safe area. Rail item 64 x 56.
- Page bottom padding under md: `pb-[calc(56px+env(safe-area-inset-bottom)+24px)]` so the last card
  clears the tab bar.

Radii: cards and sheets `rounded-2xl` (22). Pills and chips `rounded-full`. Inputs `rounded-xl` (22,
matching the library search input). Media wells sit flush at the top of their card and inherit its
radius through `overflow-hidden`, so there is never a radius inside a radius.

### 2.6 Touch and input rules

- Every tappable thing is at least 44 x 44 on phones: `min-h-11 min-w-11`. Filter and reason chips
  use `min-h-11 md:min-h-9` (the library's chips are `min-h-9` at all widths; ours are not).
- Rating buttons use `AssetFeedbackControls size="md"` (`w-11 h-11`), never `size="sm"`, which is
  36px on phones.
- Money and count inputs: `inputMode="decimal"` (cap) or `inputMode="numeric"` (rule thresholds).
- Bottom-fixed bars and sheets get `pb-[env(safe-area-inset-bottom)]`.
- Interactive surfaces get `touch-action: manipulation` (`touch-manipulation`).
- Feed containers do not hijack pull-to-refresh; the sheets get `overscroll-contain`.
- Back works: tab changes and filter changes are URL changes (`setSearchParams`, `preventScrollReset`),
  not local state.

---

## 3. Chrome: burn bar, tabs, rail

### 3.1 Sticky burn bar (research pattern 12)

The single most-checked number. One row, 48px, sticky under the phone's ink header
(`sticky top-[52px] md:top-0 z-20`), full bleed on phones (`-mx-4 px-4`), `bg-paper/95 backdrop-blur
border-b border-line`.

Contents, left to right:

1. **Today**: `$0.00 / $20.00` in data-strong mono. The cap shown is the daily guard R7 reads.
2. **Burn track**: 4px tall, `bg-paper-3`, fill `bg-ink-2` drawn with `transform: scaleX()` from the
   left (transform only, zero CLS). At 80% of cap the fill turns `bg-amber-500` and the figure gets the
   amber pill pair; at 100% it turns `bg-red-700` and the figure reads "R7 paused all".
3. **Orders today**: `2 orders` mono.
4. **Simulation badge** (right-aligned): a button, `h-7 px-2.5 rounded-full border-plum/20
   bg-plum-soft text-plum-2 font-mono text-[11px] uppercase tracking-wide`, label "Simulation". Its
   44px hit area comes from a transparent `-inset-2` pseudo-element. Tap opens the simulation sheet
   (§3.4). When `ads_spend_enabled` is on, the badge becomes `border-ink bg-ink text-white` "Spend on".

375px:
```
┌ ink admin header (52px, from admin.tsx) ┐
│ ≡  xdipx  ADMIN                         │
├─────────────────────────────────────────┤  sticky top-[52px]
│ TODAY $0.00/$20.00  ▕▔▔▔▔▔▔▏ 2 ord [SIM]│  h-12, bg-paper/95
└─────────────────────────────────────────┘
```

1024px (spans rail plus main, sticky `md:top-0`):
```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Ad Studio      TODAY $0.00 / $20.00  ▕██░░░░░░░░░░░░░░▏ 0%    ORDERS TODAY 2     [SIMULATION] │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```
At md and up the page title shares the bar (left), so the bar is the page header. Under md the
title is dropped from the bar; the tab's own heading carries orientation.

States: loading shows the figures as `bg-paper-3` bars of the final width (`w-24 h-4 rounded`); if
metrics failed to load, the figure reads "spend unknown" in amber with a retry icon button
(`RefreshIcon`, 44px). Never show `$0.00` when the number is unknown.

### 3.2 Phone bottom tab bar (under md)

`fixed bottom-0 inset-x-0 z-20 bg-paper border-t border-line pb-[env(safe-area-inset-bottom)]
md:hidden`. Four equal `NavLink`s, each `min-h-14 flex flex-col items-center justify-center gap-0.5`,
icon 20px over an 11px label. Active: `text-ink` with a 2px ink bar on the item's top edge. Inactive:
`text-ink-4`. Badge: `font-mono text-[10px] bg-ink text-white rounded-full px-1.5` top-right of the
icon, only for Ideas and Creatives (count awaiting rating), capped "99+".

```
├─────────────────────────────────────────┤
│  ▔▔▔▔                                   │
│ [pen]⁽¹²⁾  [image]⁽⁸⁾  [chart]  [$]     │
│  Ideas     Creatives    Live    Spend   │
└─────────────────────────────────────────┘
   56px + safe area, z-20 (AdminNav drawer z-40 and sheets z-40 cover it)
```

Icons, all from `app/components/admin/social/icons.tsx` except one move:

| Tab | Icon |
|---|---|
| Ideas | `PenIcon` |
| Creatives | `ImageIcon` |
| Live | `ChartIcon` |
| Spend | `DollarIcon`: the existing `PricingIcon` path from `AdminNav.tsx`, exported into `icons.tsx` under that name. No new icon art |

### 3.3 Side rail (md and up)

Same four items from the same `StudioTabs` component, so the two navs cannot drift. Layout:
`md:grid md:grid-cols-[72px_minmax(0,1fr)] md:gap-6`. Rail: `md:sticky md:top-16 self-start
flex flex-col gap-1`, items `w-[72px] min-h-14 rounded-xl flex flex-col items-center justify-center
gap-1 text-[11px]`, icon over label (the bottom bar turned on its side). Active:
`bg-paper border border-line-2 text-ink shadow-sm`; inactive `text-ink-3 hover:bg-paper-3`.
Badge as on the phone. The rail never expands to a labelled-row sidebar: next to the 224px
`AdminNav`, a second wide rail would leave 512px for the work at 1024.

```
1024:
┌──────────┐┌ burn bar ...................................................................┐
│ AdminNav ││┌────┐ ┌──────────────────────────────────────────────────────────────────┐ │
│ 224px    │││pen │ │ main column, 640px                                               │ │
│ (global) │││Ideas│ │                                                                  │ │
│          ││├────┤ │                                                                  │ │
│ Ad Studio│││img │ │                                                                  │ │
│ = coral  │││Crea│ │                                                                  │ │
│          ││├────┤ │                                                                  │ │
│          │││chrt│ │                                                                  │ │
│          │││Live│ │                                                                  │ │
│          ││├────┤ │                                                                  │ │
│          │││ $  │ │                                                                  │ │
│          │││Spnd│ │                                                                  │ │
│          ││└────┘ └──────────────────────────────────────────────────────────────────┘ │
└──────────┘└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Simulation sheet

Opened from the badge. Same container geometry as the `AssetFeedback` sheet (bottom sheet
`fixed inset-x-2 bottom-2 z-40 rounded-2xl` on phones, popover `md:absolute md:top-full md:right-0
md:w-80` anchored under the badge). Read-only. It shows the plan §2 exit criteria as four progress
lines, each `font-mono text-xs` with a thin track:

```
┌─────────────────────────────────────────┐
│ Simulation mode                         │
│ Ideas and creatives run daily. Exports  │
│ are built and stored. Nothing uploads   │
│ and no money moves.                     │
│                                         │
│ ROUTINE STREAK      4 / 10 days ▕██░░▏  │
│ HEARTED CREATIVES  12 / 30      ▕█░░░▏  │
│ LANES WITH HEARTS   2 / 3       ▕██▒░▏  │
│ BRIDGE PAGE LIVE    no                  │
│ OWNER SAYS GO       not yet             │
│                                         │
│ The spend valve is flipped from the     │
│ owner valve surface, per the Phase 5    │
│ runbook. It is not on this screen.      │
│                                  [Done] │
└─────────────────────────────────────────┘
```

Design rule: the `ads_spend_enabled` valve is never a toggle inside Ad Studio. Flipping real money on
should not sit one thumb away from a rating button.

---

## 4. Ideas tab

### 4.1 Idea card

One full-width card per `ad_ideas` row. No image (ideas have none until rendered).

```
┌─────────────────────────────────────────┐  rounded-2xl border-line bg-paper p-4
│ SPEC SHEET                  [META 3-4]  │  .kicker concept · LaneBadge
│ Water-based or aloe, side by side       │  card title, font-display text-lg
│ "Water-Based or Aloe? Compared"         │  first headline, text-sm text-ink-2
│ Sliquid H2O · LELO moisturizer          │  products, text-xs text-ink-3, each a link
│ BE CPA $15 · BE ROAS 2.2x · policy pass │  data mono 11px
├─────────────────────────────────────────┤  border-t border-line
│ #4182 · run 0412            [heart][dn] │  id mono · AssetFeedbackControls size=md
└─────────────────────────────────────────┘
```
(Placeholder words in every wire are quoted from `docs/store-team/ad-creative-concept-bank-2026-10-03.md`.
Real idea text comes from the routine through the voice gate and humanizer.)

Anatomy rules:
- Concept kicker uses the concept's display name, not its slug.
- Lane badge (§6.1) sits top-right, never wraps under the kicker; the kicker truncates first.
- Title clamps at 2 lines, headline at 3 (`line-clamp-*`). The full idea opens in place: tapping the
  card body toggles an expanded section (all headlines, body lines, audience, destination URL in
  mono, the full `policy_check` text). It expands in the flow (auto height, `layout` allowed since this
  is a filtered list), never in a nested card or a modal.
- Break-even line is always mono and always present. If `break_even_json` is missing it reads
  "BE not computed" in amber rather than disappearing.
- `policy_check` summary: "policy pass" in the data line; a revise or block verdict turns the line's
  last segment into the matching pill and the card's left edge gets a 2px amber or red inset
  (`shadow-[inset_2px_0_0_theme(colors.amber.500)]`), so a risky idea is findable while scrolling.
- The card has no hover lift and no shadow. `border-line` only. Hover at md+: `border-line-2`.

Card states:

| State (`status`) | Footer reads | Visual |
|---|---|---|
| proposed | rating controls | default |
| hearted | "Queued for the next render pass, 13:30 PT" plus rating controls (filled heart) | `StatusPill` pending style, word "Queued" |
| hearted, render running | "Rendering 3 of 6 sizes" with `ElapsedTimer` | plum-soft pill with `animate-pulse motion-reduce:animate-none`, word "Rendering" |
| rendered | "6 creatives →" link to `/admin/ad-studio/creatives?idea=4182` | sage pill "Rendered" |
| rejected | reasons listed as small ink-3 text | `StatusPill rejected` (line-through), card `opacity-70` |
| archived | none | only visible under the Archived filter |

The pass times come from plan §5 (14:30 and 20:30 UTC). Showing the next pass time is fine on an
admin surface; it is not customer-facing.

### 4.2 Ideas, 375px

```
┌ ink header ─────────────────────────────┐
├ burn bar ───────────────────────────────┤
│ Ideas                       12 to rate  │  text-xl font-display · mono count
│ ┌─────────┬─────────┬────────┬────────┐ │  segmented: status filter, h-11
│ │ To rate │ Hearted │Rejected│  All   │ │
│ └─────────┴─────────┴────────┴────────┘ │
│ (Lane v)(Concept v)(Product v)(Archived)│  FilterSelect chips, overflow-x-auto
│                                         │  inside -mx-4 px-4 (never the body)
│ ┌ idea card ──────────────────────────┐ │
│ │ ...                                 │ │
│ └─────────────────────────────────────┘ │  gap-3
│ ┌ idea card ──────────────────────────┐ │
│ │ ...                                 │ │
│ └─────────────────────────────────────┘ │
│ ┌ idea card ──────────────────────────┐ │
│                                         │
│        [ Show 10 more ]                 │  cursor pagination, h-11, outline
├─────────────────────────────────────────┤
│ Ideas⁽¹²⁾  Creatives⁽⁸⁾  Live  Spend    │  bottom tab bar
└─────────────────────────────────────────┘
```
Sort: proposed first, then by created_at descending. In "To rate", rated cards leave the list once
the reason sheet closes (§9.2), so the count in the header and the badge tick down.

### 4.3 Ideas, 1024px

Main column 640. One column of horizontal idea cards: text left, data and rating right.

```
┌ burn bar (spans rail + main) ─────────────────────────────────────────────────────────────┐
│ Ad Studio   TODAY $0.00 / $20.00 ▕░░░░░░░░░░░░▏   ORDERS TODAY 2              [SIMULATION] │
└───────────────────────────────────────────────────────────────────────────────────────────┘
┌────┐ Ideas                                                                    12 to rate
│Idea│ [ To rate | Hearted | Rejected | All ]   (Lane v)(Concept v)(Product v)(Archived)
├────┤
│Crea│ ┌──────────────────────────────────────────────────────────────────────────────────┐
├────┤ │ SPEC SHEET                                   [META 3-4]                           │
│Live│ │ Water-based or aloe, side by side            BE CPA $15 · BE ROAS 2.2x            │
├────┤ │ "Water-Based or Aloe? Compared"              policy pass                          │
│Spnd│ │ Sliquid H2O · LELO moisturizer               #4182 · run 0412     [heart][down]   │
└────┘ └──────────────────────────────────────────────────────────────────────────────────┘
       ┌──────────────────────────────────────────────────────────────────────────────────┐
       │ STATEMENT READS XDIPX                        [GOOGLE 4-5]                         │
       │ The bank line, as the whole ad               BE CPA $15 · BE ROAS 2.2x            │
       │ "Billing Reads XDIPX"                        policy pass                          │
       │ (no product in frame)                        #4183 · run 0412     [heart][down]   │
       └──────────────────────────────────────────────────────────────────────────────────┘
```
Card grid: `lg:grid lg:grid-cols-[minmax(0,1fr)_200px] lg:gap-4`. Right column holds the lane
badge, data lines and rating controls, right-aligned. At xl (896 main), ideas go two-up
(`xl:grid-cols-2` on the list) using the phone card anatomy.

### 4.4 Ideas chip vocabulary

New file `app/lib/ad-idea-feedback-reasons.ts`, same shape as `social-asset-feedback-reasons.ts`
(values plus labels, exported verdict map, filter values, `isReasonFor`), not server-only, shared
by UI, write path and the team read endpoint. From plan §5:

| Verdict | value | label |
|---|---|---|
| up | `on-brand` | On brand |
| up | `strong-hook` | Strong hook |
| up | `product-fit` | Product fit |
| up | `lane-fit` | Lane fit |
| down | `off-policy` | Off policy |
| down | `too-tame` | Too tame |
| down | `weak-hook` | Weak hook |
| down | `wrong-product` | Wrong product |
| down | `duplicate` | Duplicate |

Recommended additions (not in plan §5; the plan owner decides): `more-like-this` (up) because the
social routine's read-back rule (routine-social-daily Step 7b) keys positive precedent on it, and
`other` (down) for parity with social.

---

## 5. Creatives tab

### 5.1 Creative card

One card per `ad_creatives` row, media at its real aspect, flush at the top.

```
┌─────────────────────────────────────────┐  rounded-2xl border-line bg-paper overflow-hidden
│┌───────────────────────────────────────┐│
││ [4:5 · 1080x1350]                     ││  format chip: mono 10px bg-ink/70 text-white
││                                       ││  (same as the library's overlay chip)
││         media well, aspect-[4/5]      ││
││         bg-paper-3, img object-contain││
││                                       ││
│└───────────────────────────────────────┘│
│ "The box is boring on purpose."         │  slogan, text-sm font-medium text-ink, clamp 2
│ STATEMENT READS XDIPX · [ADULT 9]       │  .kicker concept · LaneBadge
│ Le Wand Petite                          │  product, text-xs text-ink-3
│ [✓Vision][✓Product][✓Voice][!Policy][✓Text]  gate chips, one 44px-tall button row
│ Export  [Ready, not uploaded] [Download]│  ExportState
├─────────────────────────────────────────┤
│ #9921 · idea #4183          [heart][dn] │
└─────────────────────────────────────────┘
```

### 5.2 Formats at real aspect

Every media well declares its aspect in CSS so the feed never shifts while images load; the `<img>`
also carries `width` and `height`. `object-contain` everywhere, so nothing is ever cropped in review:
the owner rates exactly the pixels that would ship. The matrix lives in one file,
`app/components/admin/ads/ad-formats.ts`, consumed by `CreativeMedia`.

| Format | Native px | Well classes | Phone (343 wide) | 1024 grid |
|---|---|---|---|---|
| 1:1 | 1080 x 1080 | `aspect-square w-full` | 343 x 343 | one column |
| 4:5 | 1080 x 1350 | `aspect-[4/5] w-full` | 343 x 429 | one column |
| 9:16 | 1080 x 1920 | `aspect-[9/16] h-[min(70dvh,560px)] mx-auto` on a full-width `bg-paper-3` band | 315 x 560 centred | one column, height-capped the same way |
| 1200 x 628 | 1200 x 628 | `aspect-[1200/628] w-full` | 343 x 180 | `lg:col-span-2` |
| 300 x 250 | 300 x 250 | well `aspect-[6/5] w-full max-w-[300px] mx-auto` on a `bg-paper-3` band `py-4` | 300 x 250, native | one column, native |
| 728 x 90 | 728 x 90 | `aspect-[728/90] w-full max-w-[728px]` on a band `py-4` | 343 x 42, scaled | `lg:col-span-2`, scaled to 640 x 79 |
| 300 x 100, 900 x 250 (adult lane) | as named | same banner rule: native up to the column, scaled below it | | 900 spans 2 |

Banner rule: show banners at native CSS size whenever the column allows, and never upscale past
native. A 728 x 90 at 343 wide is 42px tall and its text is unreadable, so any banner shown below
native gets a "View at 1:1" text button (44px) under the well. It opens `BannerViewer`, a full-screen
sheet (`fixed inset-0 z-40 bg-paper`) where the banner sits at native size inside that sheet's own
`overflow-x-auto` row. The page body never scrolls sideways, and there is no scrolling box inside a
card.

9:16 rule: a full-width 9:16 at 343 would be 610px tall and push everything else below the fold. It
is height-capped and centred on a full-width inset band so the card keeps its rhythm and the ratio
stays true.

### 5.3 Gate chips

Order fixed: Vision, Product, Voice, Policy, Text. Each is a `GateChip`: `h-6 px-2 rounded-full
border text-[11px] font-semibold` with a 12px glyph plus a word. Never colour alone.

| Verdict | Glyph | Classes |
|---|---|---|
| pass | `CheckIcon` | sage pair |
| revise | `AlertIcon` | amber pair |
| block | `CloseIcon` | red pair |
| not run (for example Product on a product-free typographic card) | `MinusIcon` | `border-line bg-paper text-ink-4` dashed border |

The five chips sit inside one `<button>` row (`min-h-11 flex flex-wrap items-center gap-1.5`). Tap
expands the verdicts in place (each gate's one-line reason, provider request id in mono). Reuse the
`GateVerdictPanel` styling from Social Studio for the expanded body.

Blocked creatives are hidden from the default feed and appear only under Status: Blocked. A creative
never reaches the owner's default view with a red chip on it.

Gate sources (plan §5 and audit §8): Vision = `social-vision-gate`, Product = product-fidelity gate,
Voice = voice gate verdict on slogan and copy, Policy = the lane's `policy_check`, Text = the publish
gate's `classifyLegibleText` for legibility.

### 5.4 Export state

The "approve is not launch" rule (research pattern 10), made visible. One row: label "Export", a
state pill, at most one action.

| State | Pill | Action | When |
|---|---|---|---|
| none | `border-line text-ink-4` "No exporter for this lane yet" | none | lane has no exporter |
| not built | `border-line text-ink-3` "Not built" | none (builds after a heart) | unrated or rejected |
| building | plum-soft "Building" `animate-pulse motion-reduce:animate-none` | none | fetcher or routine running |
| ready (CSV or zip lanes) | sage outline "Ready, not uploaded" | `Download` (text button with the `ExternalIcon` glyph) | stored file exists |
| ready (Meta lane) | sage outline "Paused draft ready, not uploaded" | `View payload` | payload stored |
| failed | red "Export failed" | `Retry` | builder error, message in a line under it |
| in platform, paused | ink outline "In Meta, paused" | `Open in Ads Manager` (`ExternalIcon`) | only when `ads_spend_enabled` is on |
| live | sage solid "Live since Oct 12" | link to Live row | `launched_at` set |

Hard rule from plan §5: a platform push button never renders while `ads_spend_enabled` is off, and
never renders for a lane whose exporter cannot push. In simulation the most an export row ever
offers is Download or View payload.

### 5.5 Creatives, 375px

```
┌ ink header ─────────────────────────────┐
├ burn bar ───────────────────────────────┤
│ Creatives                    8 to rate  │
│ ┌─────────┬─────────┬────────┬────────┐ │
│ │ To rate │ Hearted │Exported│  All   │ │  status segmented
│ └─────────┴─────────┴────────┴────────┘ │
│ (Lane v)(Concept v)(Product v)(Rating v)│  FilterSelect chips, scroll in -mx-4 px-4
│ (Format v)(Group by idea)(Blocked)      │
│ [idea #4183 x] [lane: adult x]          │  active filter chips, removable, 44px
│                                         │
│ ┌ creative card, 4:5 ─────────────────┐ │  first two cards: no Reveal, eager img
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│ ┌ creative card, 9:16 capped ─────────┐ │
│ │░░░░░░░░┌──────────┐░░░░░░░░░░░░░░░░│ │  inset band, true ratio, centred
│ │░░░░░░░░│          │░░░░░░░░░░░░░░░░│ │
│ │░░░░░░░░└──────────┘░░░░░░░░░░░░░░░░│ │
│ └─────────────────────────────────────┘ │
│ ┌ creative card, 728x90 ──────────────┐ │
│ │ ░[======= banner 343x42 =======]░   │ │
│ │ View at 1:1                         │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ Ideas⁽¹²⁾  Creatives⁽⁸⁾  Live  Spend    │
└─────────────────────────────────────────┘
```
"Group by idea" (mirrors the library's "Group by batch") inserts a mono subheading per idea
(`font-mono text-[11px] text-ink-3`, "idea #4183 · Statement Reads XDIPX · 6 sizes") above that
idea's cards. It is a heading in the flow, not a wrapping card.

### 5.6 Creatives, 1024px

Main 640. `lg:grid lg:grid-cols-2 lg:items-start lg:gap-4`; wide formats (1200 x 628, 728 x 90,
900 x 250) take `lg:col-span-2`. Rows have uneven bottoms on purpose; `items-start` keeps each card
at its own height instead of stretching media wells. xl: `xl:grid-cols-3`.

```
┌────┐ Creatives                                                                   8 to rate
│Idea│ [ To rate | Hearted | Exported | All ]  (Lane v)(Concept v)(Product v)(Rating v)(Format v)
├────┤ (Group by idea)(Blocked)   [idea #4183 x]
│Crea│ ┌───────────────────────────────────┐ ┌──────────────────────────────────────┐
├────┤ │┌─────────────────────────────────┐│ │┌────────────────────────────────────┐│
│Live│ ││ [1:1 · 1080x1080]               ││ ││ [4:5 · 1080x1350]                  ││
├────┤ ││                                 ││ ││                                    ││
│Spnd│ ││        aspect-square            ││ ││        aspect-[4/5]                ││
└────┘ ││                                 ││ ││                                    ││
       │└─────────────────────────────────┘│ ││                                    ││
       │ "Billing Reads XDIPX"             │ │└────────────────────────────────────┘│
       │ STATEMENT READS XDIPX [GOOGLE 4-5]│ │ "Water-Based or Aloe? Compared"      │
       │ [✓Vis][-Prod][✓Voice][✓Pol][✓Txt] │ │ SPEC SHEET [META 3-4]                │
       │ Export [Ready, not uploaded][Dl]  │ │ [✓Vis][✓Prod][✓Voice][✓Pol][✓Txt]    │
       │ #9921 · idea #4183  [heart][down] │ │ Export [Paused draft ready][Payload] │
       └───────────────────────────────────┘ │ #9930 · idea #4182   [heart][down]   │
                                             └──────────────────────────────────────┘
       ┌──────────────────────────────────────────────────────────────────────────────┐
       │┌────────────────────────────────────────────────────────────────────────────┐│
       ││ [1200x628]                aspect-[1200/628], col-span-2                    ││
       │└────────────────────────────────────────────────────────────────────────────┘│
       │ slogan · concept · lane · gates · export · rating (one row each, as above)   │
       └──────────────────────────────────────────────────────────────────────────────┘
       ┌──────────────────────────────────────────────────────────────────────────────┐
       │ ░░[============== 728x90 scaled to 640x79 ==============]░░  View at 1:1     │
       │ ...                                                                          │
       └──────────────────────────────────────────────────────────────────────────────┘
```

### 5.7 Creatives chip vocabulary

New file `app/lib/ad-creative-feedback-reasons.ts`, same shape as the social file. Plan §5 says "the
ads chip set" without listing it; this is the set from audit §7, which the plan cites:

| Verdict | value | label |
|---|---|---|
| up | `on-policy` | On policy |
| up | `scroll-stopping` | Scroll-stopping |
| up | `hook-lands` | Hook lands |
| up | `product-faithful` | Product faithful |
| down | `off-policy` | Off policy |
| down | `too-tame` | Too tame |
| down | `weak-hook` | Weak hook |
| down | `product-drift` | Product drift |
| down | `text-legibility` | Text legibility |
| down | `wrong-format` | Wrong format |

Decided 2026-10-03: `more-like-this` (up) and `other` (down) are added here too, as in §4.4.

Filters (plan §5): lane, concept, product, rating (`loved | rejected | unrated`, same values as the
library's `?feedback=`), status. Format is added because a 728 x 90 problem is a different fix from a
9:16 one.

---

## 6. Shared small parts

### 6.1 Lane badge

`h-6 px-2 rounded-full border border-line bg-paper font-mono text-[11px] uppercase tracking-wide
text-ink-2`, text is lane plus register: `META 3-4`, `GOOGLE 4-5`, `MSFT 4-5`, `SNAP 6-7`,
`NEWSLETTER 7-9`, `OWNED 9`. All lanes share one neutral style: seven colours would read as a legend
nobody learns. The one exception is the adult-network lane while register 10 is uncodified: it reads
`ADULT 9` with a dashed amber border and a `title` and expanded-view note "10 pending codify" (plan
§1 decision 1). When codified it becomes `ADULT 10` in the neutral style.

### 6.2 Status pills

Reuse `StatusPill`'s shape and palette. Ads-specific words map onto its existing styles: Queued uses
pending, Rendering and Building use publishing, Rendered and Exported use approved, Live uses
published, Rejected uses rejected, Failed uses failed. If the engineer prefers, add an `AdStatus`
union to a local `AdStatusPill` that imports the same class strings rather than redefining colours.

---

## 7. The rating gesture

**Mirror `AssetFeedback.tsx` exactly.** Same glyphs (`HeartGlyph`, `ThumbDownGlyph`), same pick
logic (first tap sets the verdict and opens the reasons; tapping the active verdict toggles the
sheet; switching verdict drops reasons and keeps the note), same immediate save on every chip
toggle, note saved on close, same "Remove rating", same "Saving" / "Saved" readout, same inline
error under the controls, same copy ("What works here ♥", "What missed", "Anything else
(optional)", "Done").

Preferred build: add an optional `reasons` vocabulary prop (and a `subjectField` name, default
`assetId`) to `AssetFeedbackControls`, defaulting to the social set, and pass the idea or creative
vocabulary from Ad Studio. One component, so the two surfaces cannot drift. Fallback if the engineer
will not touch the social component: `app/components/admin/ads/AdFeedback.tsx` as a line-for-line
copy with the vocabulary injected. Either way the write path is an admin route action (`intent=
feedback`) behind `requireAdmin`, with no team-token write op, per audit §7.

Phone, bottom sheet (existing geometry: `fixed inset-x-2 bottom-2 z-40 rounded-2xl border-line
bg-paper p-3 shadow-lg`, scrim `bg-ink/20`):
```
│ ┌ idea card ──────────────────────────┐ │
│ │ ...                     [♥][dn]     │ │  heart now filled coral
│ └─────────────────────────────────────┘ │
│░░░░░░░░░░░░░░ scrim bg-ink/20 ░░░░░░░░░░│
│┌───────────────────────────────────────┐│
││ What works here ♥                     ││
││ (On brand)(Strong hook)(Product fit)  ││  chips min-h-11 on phones
││ (Lane fit)(More like this)            ││
││ ┌───────────────────────────────────┐ ││
││ │ Anything else (optional)          │ ││
││ └───────────────────────────────────┘ ││
││ Remove rating          Saved  [Done]  ││
│└───────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

Desktop, popover anchored to the controls (existing: `md:absolute md:top-full md:right-0 md:mt-1
md:w-72`, transparent scrim):
```
                       ... #4182 · run 0412   [♥][dn]
                                  ┌──────────────────────────────┐
                                  │ What missed                  │
                                  │ (Off policy)(Too tame)       │
                                  │ (Weak hook)(Wrong product)   │
                                  │ (Duplicate)                  │
                                  │ [Anything else (optional)  ] │
                                  │ Remove rating   Saving [Done]│
                                  └──────────────────────────────┘
```

Two deltas from the social component, both about size, neither about behaviour:
- Ad Studio always uses `size="md"` (44px buttons).
- Reason chips get `min-h-11 md:min-h-9` instead of `min-h-9`. If the shared component is
  generalised, apply this to social too; it is a straight accessibility fix.

One addition: when the heart turns filled, play the one-shot `heartbeat` variant from
`app/components/motion/variants.ts` on the glyph. Reduced motion skips it.

---

## 8. Live tab

### 8.1 Live row

Each row is a creative with metrics, the rule that fired in plain words, and one-tap actions
(research patterns 7, 9). Every metric carries its lookback.

Recommendation label vocabulary (from rules R1 to R8, plan §5 and research E.2):

| Label | Fired by | Pill | Recommended action |
|---|---|---|---|
| Pause | R1, R2, R3 | red pair | Pause |
| Paused | R7 auto-applied, or owner | `rejected`-style ink-3 | Resume |
| Scale | R5 | sage solid | Scale +20% |
| Brake | R6 | amber pair | Scale -30% (labelled "Brake -30%") |
| Refresh | R8 | plum-soft | Refresh |
| Revive | R4 | sage outline | Resume |
| Healthy | none | `border-line text-ink-3` | none recommended |

Rule sentence: one line, `text-sm text-ink-2`, built from the `ad_rule_events` row, for example
"Paused: $31 spent, 0 orders, R1" or "Scale: 3.1x net ROAS on 4 orders over 7d, R5". Numbers in mono.
Paired rules show together: an R1 pause with an R4 revive window open reads "R1 pause. R4 can revive
it once if a late order lands by Oct 19."

Actions: three buttons, always in the same order (Pause or Resume, Scale, Refresh), `min-h-11 px-3
rounded-full text-sm font-medium`. The recommended one is `bg-ink text-white` and carries the rule id
("Pause · R1"); the others are `border border-line bg-paper text-ink`. Actions that make no sense
for the row are disabled with a `title`, not hidden, so the row's shape never changes.

One tap applies; there is no confirm dialog. Every action shows an Undo toast for 6 seconds
(§10.4). In simulation every action writes the `ad_rule_events` row with `applied_by` set and no
platform call, and the toast says so. R7's auto-pause appears with label Paused and the sentence
"R7 paused all: today's spend passed the $20 cap".

### 8.2 Live, 375px (cards, no table)

```
├ burn bar ───────────────────────────────┤
│ Live                         sample data│  mono chip: "sample data" or "Shop history"
│ ┌─────────────────────────────────────┐ │  instrument band (one surface)
│ │ SPEND 7D  ORDERS 7D  NET ROAS 7D    │ │
│ │ $84.20    5          1.9x  (BE 2.2x)│ │
│ │ ▁▂▃▂▅▃▆ sparkline (MetricSparkline) │ │
│ └─────────────────────────────────────┘ │
│ [ Needs action 3 | All 14 ]             │  segmented, h-11
│ ┌─────────────────────────────────────┐ │
│ │ [thumb] #9921 "Billing Reads XDIPX" │ │  48px thumb, slogan truncate
│ │         GOOGLE 4-5        [Pause]   │ │  lane · recommendation pill
│ │ $31.40 7d · 1,920 impr 7d · 0.4% CTR│ │  data mono, lookback on each
│ │ 0 orders 7d · ROAS n/a              │ │
│ │ Paused: $31 spent, 0 orders, R1     │ │  rule sentence
│ │ [Pause · R1] [Scale] [Refresh]      │ │  44px, recommended is ink solid
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ [thumb] #9930 "Water-Based or ..."  │ │
│ │         META 3-4          [Scale]   │ │
│ │ ...                                 │ │
│ │ [Pause] [Scale +20% · R5] [Refresh] │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ Ideas  Creatives  Live  Spend           │
└─────────────────────────────────────────┘
```
Sort: recommended actions first (Pause, Brake, Scale, Refresh, Revive), then spend descending.

### 8.3 Live, 1024px (table inside ResponsiveTable)

Instrument band across the top, then the table. `<ResponsiveTable><table className="min-w-[720px]
w-full text-sm">`. At 640 main the table scrolls inside its wrapper by 80px; at xl it fits. Sticky
first column (`sticky left-0 bg-paper`) so the creative stays visible while scrolling.

```
┌────┐ Live                                                          Shop history · sample data
│Idea│ ┌──────────────────────────────────────────────────────────────────────────────────────┐
├────┤ │ SPEND 7D $84.20 │ ORDERS 7D 5 │ NET ROAS 7D 1.9x  BE 2.2x │ ▁▂▃▂▅▃▆  RULES TODAY 3   │
│Crea│ └──────────────────────────────────────────────────────────────────────────────────────┘
├────┤ [ Needs action 3 | All 14 ]                                         (Lane v)(Platform v)
│Live│ ┌──────────────────────────────────────────────────────────────────────────────────────┐
├────┤ │ CREATIVE             LANE    SPEND 7D  IMPR 7D  CTR 7D  ORD 7D  ROAS 7D  RULE   ACTION│
│Spnd│ ├──────────────────────────────────────────────────────────────────────────────────────┤
└────┘ │ [th] #9921 Billing.. GOOGLE   $31.40    1,920   0.4%     0      n/a     Pause  [P·R1]│
       │      Paused: $31 spent, 0 orders, R1                                       [S] [R]   │
       ├──────────────────────────────────────────────────────────────────────────────────────┤
       │ [th] #9930 Water-B.. META     $22.10    3,400   1.8%     3      3.1x    Scale  [P]   │
       │      Scale: 3.1x net ROAS on 3 orders over 7d, R5                     [S+20·R5] [R] │
       └──────────────────────────────────────────────────────────────────────────────────────┘
```
The rule sentence sits as a second line inside the row (a `colSpan` sub-row with `text-ink-2`),
not a tooltip, so the reason is always read before the button is pressed. Rows that fired a rule
today get a one-time row highlight on load (§9.3).

### 8.4 Live empty state (simulation)

```
┌─────────────────────────────────────────┐  rounded-2xl border-line bg-paper p-6, text-left
│ SIMULATION                              │  .kicker
│ Nothing is live, and that is on purpose.│  font-display text-lg
│ For the first two weeks ads run with    │  text-sm text-ink-2, max-w-[60ch]
│ spend off. Rules R1 to R8 run against   │
│ imported Shop Campaigns history and a   │
│ seeded sample, so you can watch them    │
│ fire before real money is behind them.  │
│                                         │
│ [Import a CSV]  [Show the sample]       │  Spend tab link · ?source=sample
└─────────────────────────────────────────┘
```
When sample or imported rows exist, the page renders them with a persistent `sample data` or
`Shop history` mono chip by the title, so simulated numbers are never mistaken for live ones.

---

## 9. Spend tab

### 9.1 Contents (plan §5)

1. **Cap control**, owner-only (`adminUser.role === 'owner'`; admins see the value and the line
   "Owner only" with no edit button).
2. **Media versus compute**, two separate bands: media (ad platforms) against
   `ads_media_monthly_cap_cents`, compute (image renders) against `ads_team_daily_cents`. Never summed
   into one number.
3. **Planned versus actual** per campaign and lane.
4. **CSV import drop zone** (Google Ads, Shop Campaigns).
5. **Rules** (placement proposal, plan does not place them): R1 to R8 as sentences with editable
   numbers, each kill rule with its revive partner directly under it (research pattern 8). Owner-only.
   Collapsed by default.

### 9.2 Cap control

```
┌─────────────────────────────────────────┐
│ MEDIA CAP, OCTOBER                      │  .kicker
│ $600                         [Edit]     │  figure mono text-3xl · outline 44px
│ ▕████░░░░░░░░░░░░░░░░░▏ $84 spent (14%) │  transform-scaled track
│ At this pace: $186 by Oct 31            │  data mono
└─────────────────────────────────────────┘

editing:
┌─────────────────────────────────────────┐
│ MEDIA CAP, OCTOBER                      │
│ ┌──────────────────────┐                │
│ │ $ 600                │ inputmode=decimal, min-h-11 rounded-xl font-mono
│ └──────────────────────┘                │
│ Below this month's spend? R7 will pause │  amber line, only when value < MTD spend
│ everything at the next check.           │
│              [Cancel]  [Save cap]       │  Save is the page's one coral button
└─────────────────────────────────────────┘
```
Pending: Save shows "Saving" and is disabled; the input is `readOnly`. Success: the form closes and
a toast confirms "Monthly cap set to $600." Error: the form stays open with the message in
`text-red-700` under the input and Save re-enabled.

### 9.3 CSV drop zone

```
idle (md+):
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐  border-2 border-dashed border-line-3 rounded-2xl
╎  Drop a Google Ads or Shop Campaigns CSV  ╎  min-h-[120px], text-sm text-ink-3
╎  Source (Shop Campaigns v)  [Choose file] ╎  select + 44px button
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘

phone: no drop affordance (there is no drag on a phone). Same box, copy reads
"Import a Google Ads or Shop Campaigns CSV", with the source select and [Choose file].

drag over: border-ink bg-paper-3, copy "Drop to read it".

reading (fetcher pending): "Reading shop-campaigns-oct.csv" with ElapsedTimer, box aria-busy.

parsed preview (nothing written yet):
┌─────────────────────────────────────────┐
│ shop-campaigns-oct.csv                  │
│ 412 rows · Sep 1 to Oct 2               │  mono
│ 388 matched to creatives · 24 unmatched │  unmatched is a link to the row list
│ Spend $412.30 · 7 orders                │
│              [Cancel]  [Import 388 rows]│  Import is ink solid (coral stays on Save cap)
└─────────────────────────────────────────┘

error: red slab, "Row 14: no date column found. Expected the Google Ads Editor export." plus
[Choose another file].
```

### 9.4 Spend, 375px

```
├ burn bar ───────────────────────────────┤
│ Spend                                   │
│ ┌ cap control (§9.2) ─────────────────┐ │
│ └─────────────────────────────────────┘ │
│ ┌ instrument band ────────────────────┐ │  one surface, two rows, hairline between
│ │ MEDIA TODAY  $0.00 / $20.00         │ │
│ │ COMPUTE TODAY $0.84 / $3.00 renders │ │
│ └─────────────────────────────────────┘ │
│ PLANNED VS ACTUAL, 7D                   │  .kicker
│ META 3-4     ▕▓▓▓▓▓░░░░▏ $22 / $40      │  outline track = planned, ink fill = actual
│ GOOGLE 4-5   ▕▓▓▓▓▓▓▓▓░▏ $31 / $35      │  data mono, one line per lane
│ ADULT 9      ▕░░░░░░░░░▏ $0 / $0        │
│ ┌ CSV import (§9.3) ──────────────────┐ │
│ └─────────────────────────────────────┘ │
│ Rules  (8)                          [v] │  collapsed disclosure, 44px
├─────────────────────────────────────────┤
│ Ideas  Creatives  Live  Spend           │
└─────────────────────────────────────────┘
```

### 9.5 Spend, 1024px

```
┌────┐ Spend
│Idea│ ┌ cap control ────────────────────────┐ ┌ CSV import ─────────────────────────────┐
├────┤ │ MEDIA CAP, OCTOBER                  │ │╌ Drop a Google Ads or Shop Campaigns ╌╌╌│
│Crea│ │ $600                      [Edit]    │ │╌ CSV   Source (Shop v)  [Choose file] ╌╌│
├────┤ │ ▕████░░░░░░░░░░▏ $84 spent (14%)    │ │╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│
│Live│ └─────────────────────────────────────┘ └─────────────────────────────────────────┘
├────┤ ┌ instrument band ─────────────────────────────────────────────────────────────────┐
│Spnd│ │ MEDIA TODAY $0.00 / $20.00  │  COMPUTE TODAY $0.84 / $3.00  │  MONTH $84 / $600  │
└────┘ └──────────────────────────────────────────────────────────────────────────────────┘
       PLANNED VS ACTUAL                                                     [ 7d | 30d ]
       ┌ ResponsiveTable, table min-w-[600px] ────────────────────────────────────────────┐
       │ CAMPAIGN / LANE       PLANNED   ACTUAL   ORDERS   NET ROAS   DELTA                │
       │ Meta bridge  META 3-4   $40.00   $22.10       3      3.1x     -$17.90             │
       │ Google RSA   GOOGLE 4-5 $35.00   $31.40       0      n/a      -$3.60              │
       └──────────────────────────────────────────────────────────────────────────────────┘
       Rules (8)                                                                      [v]
       ┌──────────────────────────────────────────────────────────────────────────────────┐
       │ R1  Pause when spend passes [2] x break-even with [0] orders after [48]h  [Save] │
       │     R4  Revive once if a late order brings ROAS to break-even within [7]d        │
       │ R3  Pause when spend passes [3] x BE and 7d ROAS is under [0.8] x BE     [Save] │
       │ ...                                                                              │
       └──────────────────────────────────────────────────────────────────────────────────┘
```
Top pair: `lg:grid lg:grid-cols-2 lg:gap-4`. The rules block is a plain list inside one surface
(rows separated by `divide-y divide-line`), not eight cards. The compute cap figure ($3.00) is a
placeholder until Phase 0 sizes `ads_team_daily_cents`.

---

## 10. States, every tab

### 10.1 Loading skeletons

Two cases. First load is SSR, so the loader's data is there on arrival and there is no skeleton.
Skeletons appear on client navigation between tabs (`useNavigation().state === 'loading'` with a
`location.pathname` under `/admin/ad-studio`) and on "Show more".

Each skeleton is the final component's exact box with `bg-paper-3` blocks and
`animate-pulse motion-reduce:animate-none`. No shimmer gradient (`ImageManager.tsx` has one; do not
copy it). Skeletons keep the real aspect classes, so swapping in content moves nothing.

```
IdeaCardSkeleton                     CreativeCardSkeleton (4:5)        LiveRowSkeleton
┌─────────────────────────────┐      ┌───────────────────────┐        ┌─────────────────────────┐
│ ▆▆▆▆▆▆▆▆          ▆▆▆▆▆▆   │      │                       │        │ ▆▆ ▆▆▆▆▆▆▆▆▆▆   ▆▆▆▆   │
│ ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆        │      │   bg-paper-3 well     │        │    ▆▆▆▆▆ ▆▆▆▆▆ ▆▆▆▆   │
│ ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆   │      │   aspect-[4/5]        │        │    ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆   │
│ ▆▆▆▆▆▆▆▆▆▆▆▆▆               │      │                       │        │    (▆▆▆▆) (▆▆▆) (▆▆▆)   │
├─────────────────────────────┤      ├───────────────────────┤        └─────────────────────────┘
│ ▆▆▆▆▆▆            (  )(  )  │      │ ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆      │
└─────────────────────────────┘      │ ▆▆▆▆▆▆ ▆▆▆▆           │
                                     └───────────────────────┘
```
Count: Ideas 3, Creatives 2 (one square, one 4:5), Live 3, Spend renders the cap and band
skeletons only. The burn bar and the tabs never skeleton during tab changes; they belong to the
layout route and stay live.

### 10.2 Empty states

Text-only surfaces (`rounded-2xl border border-line bg-paper p-6`), left-aligned, `.kicker` plus a
one-line display heading plus at most two sentences, plus one action. No illustrations, no icons the
size of a fist. Simulation mode is explained where it changes what "empty" means.

| Tab | Kicker | Heading | Body | Action |
|---|---|---|---|---|
| Ideas, none today | SIMULATION | No ideas yet today. | The ads routine files 10 to 20 ideas at 14:30 UTC. Ratings you leave now shape tomorrow's batch. | "See rated ideas" (switches to All) |
| Ideas, all rated | ALL CAUGHT UP | Every idea is rated. | Hearted ones render on the next pass. | "Go to Creatives" |
| Creatives, none | SIMULATION | Nothing rendered yet. | Creatives appear after you heart an idea and a render pass runs. | "Rate ideas" |
| Creatives, filters empty | NO MATCH | No creatives match these filters. | | "Clear filters" |
| Live | see §8.4 | | | |
| Spend, no data | SIMULATION | No spend recorded. | Spend stays off in simulation. Import Shop Campaigns history to watch the rules on real numbers. | focuses the CSV box |

### 10.3 Error with retry

Loader failure (route `ErrorBoundary`) or fetcher failure. Slab: `rounded-2xl border border-red-300
bg-red-50 p-4 text-sm text-red-800`, `AlertIcon`, a plain message naming what failed, and one
"Try again" button (`min-h-11 px-4 rounded-full border border-red-300 bg-paper text-red-800`).
Loader errors retry with `useRevalidator().revalidate()`; fetcher errors resubmit the same
`FormData`.

```
┌─────────────────────────────────────────┐
│ (!) Couldn't load ideas.                │
│     The database didn't answer in time. │
│                          [Try again]    │
└─────────────────────────────────────────┘
```
Fetcher errors on a card render inline under the control that failed (rating keeps the existing
`role="alert"` line from `AssetFeedback`; Live actions show the line under the button row). Plan §5:
no silent failures anywhere.

### 10.4 Success toast

`AdsToast`, one region per layout route: `fixed z-30 inset-x-4 bottom-[calc(56px+env(safe-area-inset-bottom)+12px)]
md:inset-x-auto md:right-8 md:bottom-8 md:w-80`, `rounded-2xl bg-ink text-white text-sm px-4
py-3 shadow-lg`, `role="status" aria-live="polite"`. Optional action on the right: "Undo"
(`min-h-11 px-3 font-semibold text-white underline-offset-2 hover:underline`). Auto-dismiss 4s, 6s
when it carries Undo. One toast at a time; a new one replaces the old.

```
│ ┌─────────────────────────────────────┐ │
│ │ Paused #9921 in simulation.   Undo  │ │  sits above the tab bar
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ Ideas  Creatives  Live  Spend           │
```
Toast copy: "Paused #9921 in simulation. Nothing was live." / "Scaled #9930 budget 20%." /
"Refresh queued for the next render pass." / "Monthly cap set to $600." / "Imported 388 rows."
Ratings do not toast; the sheet's "Saved" readout already confirms them, and a toast per heart would
be noise.

### 10.5 Pending fetcher

- Ratings: optimistic, exactly as `AssetFeedback` (state updates on tap, "Saving" then "Saved").
- Live actions: the tapped button shows its pending verb ("Pausing", "Scaling", "Queuing") and is
  `disabled`; the other two buttons in the row disable too. The row pill switches optimistically
  (Pause becomes Paused) and reverts on error.
- Cap save and CSV import: as in §9.2 and §9.3.
- Exports: the pill reads "Building" with the pulse until the fetcher returns.
- No full-page spinners and no blocking overlays. `aria-busy="true"` on the busy region.

---

## 11. Motion

Motion explains state; it never decorates. All of it goes through the repo's primitives:
`<Reveal>` from `app/components/motion/Reveal.tsx`, presets from `app/components/motion/variants.ts`
(`springEntrance`, `revealVariants`, `STAGGER_STEP`, `heartbeat`), and the CSS tokens
`--ease-entrance`, `--ease-standard`, `--ease-exit`, `--duration-fast`, `--duration-base`,
`--duration-slow`. No hand-rolled IntersectionObserver, no per-component `whileInView`.

| Where | Treatment |
|---|---|
| Burn bar, tabs, rail, instrument bands, tables | Static. Never wrapped |
| Burn and cap tracks | `transform: scaleX()` with `transition-transform duration-[var(--duration-slow)] ease-[var(--ease-standard)]`, origin left |
| Idea cards, first render | `<Reveal variant="fade" index={i}>` for the first 8 (the stagger clamp), plain render after |
| Creative cards, first render | Cards 0 and 1 unwrapped (they hold the route's largest image, see §12). Cards 2 to 7 `<Reveal variant="fade" index={i - 2}>` |
| Live and Spend | No reveal. Numbers do not fade in |
| Rated card leaving "To rate" | `motion` `layout` on the Ideas and Creatives lists (both are filter lists, the one place CLAUDE.md allows `layout`). Exit: opacity to 0 and scale to 0.98, `--duration-base`, `--ease-exit`. Fires when the reason sheet closes, never under an open sheet |
| Filter change on Creatives | `layout` reflow of remaining cards, same timing |
| Heart turning filled | one-shot `heartbeat` on the glyph |
| Live rows that fired a rule today | one-time background fade from `bg-amber-50` (Pause, Brake) or `bg-sage/10` (Scale) to `bg-paper` over `--duration-slow`. Colour fade only, no movement |
| Toast | enters with `revealVariants.up` and `springEntrance`, exits opacity over `--duration-fast` with `--ease-exit` |
| Bottom sheet and popover | No animation, matching `AssetFeedback` as it stands |
| In-progress pills | `animate-pulse motion-reduce:animate-none` |

Reduced motion: `Reveal` already renders the final state; the `layout` exit becomes an instant
removal; the heartbeat, row highlight and pulse are skipped. SSR markup is always the visible final
state.

---

## 12. LCP, CLS and SSR

- **There is no LCP hero image on this surface.** Ad Studio is an admin page with no hero. The
  largest contentful element on `/creatives` is the first creative's media well, so it is treated as
  the LCP candidate: card 0 is never wrapped in `Reveal`, its `<img>` is `loading="eager"` with
  `fetchPriority="high"`, card 1 is eager without priority, the rest `loading="lazy"`. Confirmed
  unwrapped by design. On `/ideas` the LCP is text, which is never hidden on the server.
- **Zero CLS.** Media wells declare aspect classes plus `width`/`height`. Skeletons match final
  boxes. The burn bar reserves its height whether figures are loading or not. Expanding an idea or a
  gate row pushes content below it on purpose, after a tap, which is user-initiated and does not count
  as layout shift. Live action buttons disable rather than disappear.
- **SSR-visible.** Every tab renders its real content from its loader. Nothing is fetched in
  `useEffect`. Reveal is visible on the server by construction.

---

## 13. Component list

All new files under `app/components/admin/ads/` unless noted. None is a `.server.ts` file; none may
import one.

| File | What it is | PR |
|---|---|---|
| `app/routes/admin.ad-studio.tsx` (rewrite as layout) | Burn bar, `StudioTabs`, `AdsToast` region, `<Outlet/>` | A |
| `app/routes/admin.ad-studio._index.tsx` | Redirect | A |
| `app/routes/admin.ad-studio.ideas.tsx` | Ideas loader, feedback action, ErrorBoundary | A |
| `app/routes/admin.ad-studio.creatives.tsx` | Creatives loader, feedback and export actions | C |
| `app/routes/admin.ad-studio.live.tsx` | Live loader, pause, scale, refresh actions | G, H |
| `app/routes/admin.ad-studio.spend.tsx` | Spend loader, cap, CSV, rules actions | H |
| `BurnBar.tsx` | Sticky top bar: today's spend against cap, orders, badge slot | A |
| `SimulationBadge.tsx` | Badge plus the read-only exit-criteria sheet | A |
| `StudioTabs.tsx` | One item list; renders the phone bottom bar and the md+ rail | A |
| `IdeaCard.tsx` | Idea card with expand-in-place and status footer | A |
| `CreativeCard.tsx` | Creative card composition | C |
| `CreativeMedia.tsx` | Aspect-true media well, banner native-size rule, "View at 1:1" | C |
| `BannerViewer.tsx` | Full-screen sheet showing a banner at native size | C |
| `ad-formats.ts` | Format matrix: native sizes, aspect classes, span rules | C |
| `LaneBadge.tsx` | Lane plus register badge, pending-codify variant | A |
| `GateChips.tsx` | Five gate chips as one expandable button row | C |
| `ExportState.tsx` | Export pill plus the single allowed action, valve-aware | C (states), E (real exports) |
| `AdStatusPill.tsx` | Ads words mapped onto `StatusPill` classes | A |
| `FilterBar.tsx` | Segmented status control plus `FilterSelect` chips plus active chips (pattern lifted from the library route) | A |
| `AdFeedback.tsx` (fallback only) | Copy of `AssetFeedbackControls` with injected vocabulary. Preferred: generalise the social component instead | A |
| `app/lib/ad-idea-feedback-reasons.ts` | Idea chip vocabulary, shared UI and server | A |
| `app/lib/ad-creative-feedback-reasons.ts` | Creative chip vocabulary | C |
| `InstrumentBand.tsx` | One-surface metric band with lookback chips, optional `MetricSparkline` | G |
| `LiveRowCard.tsx` | Phone Live row | G |
| `LiveTable.tsx` | md+ Live table inside `ResponsiveTable`, rule sub-row | G |
| `RuleSentence.tsx` | Recommendation pill plus plain-words rule line | H |
| `LiveActions.tsx` | Pause or Resume, Scale, Refresh with pending and Undo | H |
| `CapControl.tsx` | Owner-only monthly cap view and edit | H |
| `PlanVsActual.tsx` | Phone track list, md+ table | H |
| `CsvDropZone.tsx` | Drop and choose, parsed preview, import | G (Shop history import), H |
| `RuleRecipes.tsx` | R1 to R8 sentences with inline numeric inputs, kill and revive paired | H |
| `AdsToast.tsx` | Toast region plus `useAdsToast()` | A |
| `StateSlabs.tsx` | `EmptySlab`, `ErrorSlab`, `IdeaCardSkeleton`, `CreativeCardSkeleton`, `LiveRowSkeleton` | A, C, G |
| `app/components/admin/social/icons.tsx` (edit) | Export `DollarIcon`, the existing `PricingIcon` path | A |

Reused unchanged: `ResponsiveTable`, `StatusPill` classes, `GatePill`/`GateVerdictPanel` styling,
`ElapsedTimer`, `MetricSparkline`, `HeartGlyph`, `ThumbDownGlyph`, `Reveal`, `variants.ts`.

---

## 14. Do not

- No nested cards. A card never contains a bordered card. Expanded detail, grouped headings and
  gate verdicts render in the card's flow or as plain headings.
- No card spam. No KPI-card rows; metrics go in one instrument band. No card per rule; rules are rows
  in one surface.
- No horizontal body scroll at any width. Wide content scrolls inside `ResponsiveTable`, the filter
  chip row (`overflow-x-auto -mx-4 px-4`), or `BannerViewer`. QA checks 375, 768 and 1024.
- Tables only inside `ResponsiveTable`, each with a `min-w-[…]` floor. No table on a phone review
  flow (Ideas, Creatives, Live under md).
- No scrolling boxes inside cards.
- No coral outside the budget in §1.1. No coral nav, coral badges or coral warnings.
- No gradients (including skeleton shimmer), no glows, no new fonts, no emoji, no new icon art, no
  third-party icon packs.
- No colour-only status. Every pill is glyph plus word.
- No platform push or launch button while `ads_spend_enabled` is off, and never for a lane whose
  exporter cannot push.
- No `ads_spend_enabled` toggle anywhere in Ad Studio.
- No touch target under 44px on phones, and no `AssetFeedbackControls size="sm"`.
- No hand-rolled IntersectionObserver or `whileInView`; no `layout` prop outside the Ideas and
  Creatives lists; no motion on numbers; never wrap creative card 0.
- No `useEffect` data fetching. Loaders and fetchers only.
- No cropping in review. Media wells are aspect-true and `object-contain`; banners never upscale.
- No simulated number without a "sample data" or "Shop history" label next to it.
- No em dashes in UI copy, comments or docs.

---

## 15. Handoffs

| Who | What |
|---|---|
| `rr7-engineer` | Builds everything in §13 on the plan's PR split (A, C, G, H; E for real export actions). Precondition: resolve the sticky containing-scroller issue in `admin.tsx` (§2.1). Decide where the legacy batch generator goes (§2.2). Chooses between generalising `AssetFeedbackControls` (preferred) and the `AdFeedback.tsx` copy. Each PR files its ticket with the PR link, per CLAUDE.md |
| `sanity-content-builder` | Nothing for these wires. The `adBridgePage` doc type is PR-D and out of scope here |
| `media-manager` | No imagery brief. Ad Studio has no editorial imagery; creative plates come from the ads routine's render lane (`ad-render.server.ts`). Empty states are text-only by design |
| `emma-copywriter`, gated by `emma-empathy-reviewer` | Placeholder slogans in the wires are concept-bank lines for layout only. Real slogans come through the routine's voice gate and humanizer. Admin microcopy here is owner-facing (not customer-facing) and plain; it still ran a humanizer pass |
| Plan owner | Decided 2026-10-03: both chip additions are in (§4.4, §5.7); the Rules block lives on Spend, collapsed by default (§9.1); no agent score badge in v2, `ad_ideas` has no score column |
| `qa-reviewer` | Preview at 375, 768, 1024: burn bar sticks under the ink header; no body sideways scroll; every target at least 44px; Creatives CLS 0 with card 0 eager and unwrapped; reduced-motion renders final states; push buttons absent with the valve off; sample data labelled; error slab and retry work on a forced loader failure |
