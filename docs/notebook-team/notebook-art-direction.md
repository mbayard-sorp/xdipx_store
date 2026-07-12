# The Notebook — Art Direction (Phase 0, binding)

> Binding art direction for the redesign of xdipx.com's editorial blog, "The Notebook"
> (`/notebook` index + `/notebook/:slug` posts + category and series landings). This document
> governs look, type, color, spacing, imagery direction, and motion for every build phase.
> It sits under `docs/emma-voice.md` (voice wins on any word) and the v3 tokens in `app/app.css`
> (tokens win on any value). Where an agent-def summary disagrees with this file, this file wins
> on visuals. Companion files: `hifi-reference.html` (visual north star) and `image-brief.md`
> (media-manager generation brief).

---

## 1. Editorial identity statement

The Notebook is a warm-paper magazine, not a wellness clinic and not a lifestyle-minimalist
catalog. The reference points are Maude-grade art direction, Glossier-grade named editorial
franchises, and Hims-grade trust surface, run through a plain-spoken voice that says the normal
thing and explains it better than anyone. We take the parts of those brands worth taking and
reject the part that reads as cold.

Maude's design language is beautiful and deliberately chilly: near-white greys, tiny type,
enormous negative space, everything held at arm's length. That distance is exactly the shame-
adjacent register xdipx exists to remove. Our answer is the same magazine discipline delivered
warm: pure white paper (`paper`), a real serif with personality (Newsreader) set large and
confident, one living accent (coral) spent carefully, plum reserved for the single emphasized
word, and generous but human spacing that invites you in rather than keeping you out. The page
should feel like a well-made print field guide a friend handed you, annotated in the margin,
not a pharmacy pamphlet and not a mood board.

Three words hold the whole system: **White paper. Coral for life. Plum for emphasis.** Everything
below is that sentence, made buildable.

Non-negotiables inherited from the house craft rules, restated so no build phase can drift:
mobile-first at 375px (design the phone, enhance to desktop), zero CLS (transform and opacity
only), the LCP image is never wrapped in a motion component, the server renders the final visible
state, reduced-motion renders the final state, coral is the accent and plum is emphasis, no brand
gradient, no reintroduced orange, no old cream backgrounds. Every specimen and UI word in this
document already passes the voice charter (no em-dashes, CTA whitelist only).

---

## 2. Type scale (per breakpoint)

Newsreader (`font-display`) for every headline and for editorial body serif; DM Sans
(`font-body`) for UI, labels, captions, metadata, and the newsletter form; JetBrains Mono
(`font-mono`, via `.kicker`) for kickers and edition marks; Caveat (`font-script`) is legacy and
does not appear in the Notebook. Breakpoints map to Tailwind: base = 375px, `md:` ≈ 768px,
`xl:`/`2xl:` ≈ 1440px. Values are given as px with the rem equivalent (÷16) so they drop straight
into Tailwind v4 arbitrary values, e.g. `text-[2.5rem]`.

Leading is expressed as a unitless multiplier. Display headlines set tight; body sets open for
reading comfort. All display type uses Newsreader weight 500 (medium) as the editorial default,
600 for card and section titles that need to punch, and italic 500 only where the charter's
italic-plum emphasis is earned (one word, via `.em`). Do not set Newsreader at 700+; the face
gets heavy and loses its editorial warmth. The old code's `fontWeight: 800` masthead is retired.

| Role | 375 (base) | 768 (`md:`) | 1440 (`xl:`) | Leading | Notes |
|---|---|---|---|---|---|
| Masthead wordmark ("The Notebook") | 40px / 2.5rem | 60px / 3.75rem | 80px / 5rem | 0.95 | Newsreader 500, `-0.02em` tracking. Static, part of LCP. |
| Featured lockup title | 30px / 1.875rem | 42px / 2.625rem | 54px / 3.375rem | 1.03 | Newsreader 500. One `.em` word max. |
| Card title (grid + related) | 20px / 1.25rem | 22px / 1.375rem | 24px / 1.5rem | 1.12 | Newsreader 600. Clamp 3 lines. |
| Post H1 (`<h1>`) | 32px / 2rem | 44px / 2.75rem | 56px / 3.5rem | 1.04 | Newsreader 500. Measure capped at reading column. |
| Section H2 (question-form) | 24px / 1.5rem | 28px / 1.75rem | 32px / 2rem | 1.15 | Newsreader 600. Paired with the H2 rule (§4). `scroll-mt-24`. |
| H3 | 20px / 1.25rem | 22px / 1.375rem | 24px / 1.5rem | 1.2 | Newsreader 600. |
| H4 / inline label head | 17px / 1.0625rem | 18px / 1.125rem | 18px / 1.125rem | 1.3 | Newsreader 600. |
| Body (editorial serif) | 17px / 1.0625rem | 18px / 1.125rem | 19px / 1.1875rem | 1.7 | Newsreader 400. Measure ~65ch (§4). |
| Body (UI / metadata sans) | 14px / 0.875rem | 14px / 0.875rem | 15px / 0.9375rem | 1.55 | DM Sans 400/500. |
| Lead / standfirst (dek) | 18px / 1.125rem | 20px / 1.25rem | 22px / 1.375rem | 1.45 | Newsreader 400, `ink-3`. Sits under H1. |
| Pull-quote (margin aside) | 20px / 1.25rem | 22px / 1.375rem | 24px / 1.5rem | 1.3 | Newsreader 500 italic, `plum` (§4). |
| Caption / figcaption | 13px / 0.8125rem | 13px / 0.8125rem | 14px / 0.875rem | 1.5 | DM Sans, `ink-3`. |
| Kicker / edition mark | 10px / 0.625rem | 10px / 0.625rem | 11px / 0.6875rem | 1 | `.kicker` (mono, `0.18em`, uppercase). |

Body-serif decision: the reading column uses **Newsreader at 400** for running body, not DM Sans.
This is the single biggest lever separating us from every sans-set wellness blog and is what makes
the page read as a magazine. DM Sans stays for anything that is furniture (nav, chips, form
fields, captions, bylines, spec lines), so the two faces never fight inside a paragraph.

---

## 3. Spacing rhythm and rule usage

Base unit is 4px; everything lands on the 4/8 grid. Vertical rhythm is the quiet backbone of the
magazine feel, so it is specified, not eyeballed.

**Section rhythm (space between major page sections):**

| Gap | 375 | 768 | 1440 |
|---|---|---|---|
| Between major sections (masthead → featured → grid → newsletter) | 48px | 72px | 96px |
| Within a section (heading → content) | 20px | 24px | 28px |
| Card grid gap | 24px | 28px | 32px |
| Paragraph spacing (body) | 16px (1em at body size) | 16px | 18px |
| H2 top margin (breathing above a new question) | 40px | 48px | 56px |
| H2 bottom margin (to first paragraph) | 16px | 18px | 20px |

**Content widths.** Index and landing shells cap at 1200px (`max-w-[75rem]`) with a 16px gutter
at 375 growing to 24px at 768 and 32px at 1440. The post reading column caps at **65ch**
(`max-w-[65ch]`, roughly 640px at 19px body) and centers within the shell on mobile, then sits
left with the sticky TOC rail on the right at ≥1024px. Figures, the FAQ wash, the product embed,
and the newsletter band may break past 65ch to the full text-column width (up to ~720px) but never
past the shell.

**Hairlines and rules.** The `line` token (`rgba(26,20,24,0.08)`) is the default divider: 1px, used
for card borders, the byline block frame, between FAQ items, and above the next/prev footer. Step
up to `line-2` only for a rule that must read as structural (the base of the masthead). The old
`border-b-2 border-ink` heavy black underlines are **retired** everywhere; the masthead base is now
a single `line-2` hairline plus a 40px coral tick (a short 2px coral segment under the wordmark),
not a full-width black bar. Never use pure `ink` for a full-width rule. Category accents use the
category color at hairline weight, never a heavy band.

---

## 4. Reading polish specs

### Drop cap
First paragraph of post body only. Newsreader 500, `initial-letter: 3` (3-line cap) with a
`float`-based fallback sized `~3.4em` / `line-height: 0.82`, color `plum`, `margin-right: 0.08em`,
`padding-top: 0.02em`. One per post, never on H2-led sections, never in the FAQ. Reduced-motion
and print unaffected (it is static). Suppress the drop cap if the first block is not a paragraph
(e.g. a post that opens on a list).

### Pull-quote as margin aside (≥1024px)
A `blogPullQuote` renders as a hanging margin note, not a centered banner. At ≥1024px it sits in
the right margin of the reading column: `position` out of flow via a negative right margin
(`margin-right: -240px; width: 220px; float: right`) so text wraps to its left, Newsreader 500
italic, `plum`, 22–24px, leading 1.3, with a 24px coral tick above it (2px × 24px) instead of a
left bar. No quotation marks in the display glyph run; the italic-plum already signals voice.
Attribution (rare; usually none since Emma does not self-quote) sets in `.kicker` beneath. Below
1024px it collapses inline to a full-width block: Newsreader italic `plum`, a 2px coral left rule,
28px vertical margin. The current `border-l-4 border-sage` treatment is retired.

### FAQ section wash
The mandatory FAQ block renders as one contained wash panel: background `paper-2`
(`#FAFAF9`), `--radius-lg` (22px) corners, 24px inner padding (32px at ≥768), full text-column
width. A `.kicker` label reads `COMMON QUESTIONS`. Each question is an H3-scale Newsreader 600
`ink`, answer in body serif `ink-2`, items separated by a 1px `line` divider with 20px padding
above and below. No accordion by default (answer-first and crawlable), open on the page. The panel
carries no category color; it is the calm, neutral rest stop of every post.

### Product embed — "Featured in this piece"
The single most important anti-pattern to kill: the embed must read as an editorial recommendation,
never a banner ad. Retire the `bg-coral` white-on-coral banner and the pill/inline variants for
in-body use. New default card:

- White (`paper`) card, 1px `line` border, `--radius-lg` corners, 20px padding (24px ≥768), 28px
  vertical margin, full text-column width.
- A `.kicker` eyebrow reads `FEATURED IN THIS PIECE` in `ink-3`.
- Layout: product image left, 88×88 (`--radius` corners, `object-cover`, `paper-3` backing so
  cutout PNGs sit cleanly), text block right. Stacks on 375 (image top-left, text below).
- Product title: Newsreader 600, 18–20px, `ink`, links to `/products/{slug}`.
- One honest why-line in body serif `ink-2`, ≤120 chars, Emma-voice, spec-anchored
  (e.g. "Reviewers rate this one highest for how quiet it stays on the lowest setting.").
- A material/spec line in DM Sans `ink-3` mono-adjacent (e.g. "Medical-grade silicone · rechargeable").
- CTA is a coral hairline link (`.link-coral`) reading **"Take a peek →"**, not a filled button.
  The whole card is not a button; only the title and the CTA are links, so it reads as a citation.
- Optional right-edge coral tick (2px × full card height) as the only coral fill, signaling
  "this is a pick" without shouting. Budget: coral appears here as one hairline, nothing more.

### Newsletter band (inline value exchange, never a popup)
A calm full-text-column band, not a modal and never a scroll-triggered overlay. Background
`coral-soft` (`#FFE6DD`) on the index and series landings; `paper-3` inside a post so it does not
fight the reading flow. `--radius-lg` corners, 24px padding (32px ≥768). Newsreader 500 headline
(the value, e.g. "The Notebook, in your inbox. One send, once-ish a week."), a one-line DM Sans dek
stating the exchange plainly ("Only the ones worth reading. Unsubscribe anytime, we're not needy."),
then an inline email field + submit button labeled **"Show me"** (whitelist). On 375 the field and
button stack full-width; at ≥768 they sit inline right. One optional Emma aside in `ink-3` with the
single-page ♥ (see motion). No coral fill on the button on the `coral-soft` band (use `ink` fill or
a coral hairline outline for contrast); on the `paper-3` in-post band the button may be solid coral.

### Next/prev "keep reading" footer
Above the related row, a two-up "keep reading" band separated by a top `line` hairline. Each side
is a text link group: a `.kicker` direction label (`PREVIOUS` / `NEXT`, the NEXT side right-aligned),
the destination's category chip (§5), and the destination title in Newsreader 600 (2-line clamp).
Prev on the left, next on the right; on 375 they stack (next first, since forward is the default
intent). No thumbnails required here (keeps it light and avoids the algorithmic-rec look); the
related row below carries the imagery.

### Reading-progress bar
A 2px bar fixed to the very top of the viewport (`position: fixed; top: 0; height: 2px`),
`coral` fill on a transparent track, driven by `transform: scaleX()` with `transform-origin: left`
tied to article scroll depth (transform-only, zero CLS). Hidden until the reader passes the H1,
hidden again in the footer. Respects reduced-motion by simply tracking scroll without easing (it is
positional, not decorative). This is the only always-on coral element on a post page, which is why
the in-body coral budget elsewhere stays at hairlines.

---

## 5. Category color identity map

Four categories, four identities, drawn only from v3 tokens. The logic: **guides** are the
majority and the front door, so they carry the living accent (coral); **comparisons** are decisions,
so they carry emphasis (plum); **care** is calm maintenance, so it carries the quiet botanical
(sage); **wellness-basics** is foundational and evergreen, so it carries the neutral paper tone
(no chroma), reading as the steady base of the library.

| Category | Wash (headers / chips bg) | Ink/accent | Chip | Card accent | Kicker color |
|---|---|---|---|---|---|
| `guides` | `coral-soft` `#FFE6DD` | `coral` `#FF5A36` | coral-soft bg, coral text | 2px coral top tick | coral |
| `comparisons` | `plum-soft` `#F3E8FB` | `plum` `#7A2BB8` | plum-soft bg, plum text | 2px plum top tick | plum |
| `care` | sage tint `~#ECF0EA` (derive from `sage`) | `sage` `#7C8F78` | sage-tint bg, sage text | 2px sage top tick | sage |
| `wellness-basics` | `paper-3` `#F4F3F1` | `ink-3` `#6B5F68` | paper-3 bg, ink-2 text, `line` border | 2px `ink-3` top tick | ink-3 |

**Derived sage tint.** There is no `sage-soft` token. Do not invent one in `@theme`; build it at
call site with `bg-sage/10` (Tailwind opacity) or `color-mix(in srgb, var(--color-sage) 12%, white)`
≈ `#ECF0EA`. Chip text stays full `sage` for contrast. If AA contrast on the tint is ever marginal,
darken chip text toward `#5F7059` rather than deepening the wash.

**Usage rules (all categories):**

- **Kicker color.** The post/card kicker (category name in `.kicker`) takes the category accent
  color. This is the primary way the reader learns the category system; keep it consistent.
- **Chip style.** Pill, DM Sans 500, 11px, uppercase, `0.06em` tracking (softer than the mono
  kicker), tint background + accent text, no border except `wellness-basics` which gets a 1px
  `line` border so the neutral chip still reads as a chip. Radius `--radius-sm` reads too tight;
  use a full pill (`rounded-full`). Retire the current solid `bg-coral text-white` chip, which
  spends the coral budget and flattens the category system to one color.
- **Card accent.** A 2px top tick in the category accent color, 32px wide, sitting flush at the
  card's top-left inside the padding, is the whole accent. No full-width colored header bar, no
  colored border on the card body (the card border stays `line`).
- **Category page header wash.** The dedicated `/notebook/category/{slug}` header renders a wash
  panel in the category wash color, full shell width, `--radius-lg`, with the category name as an
  H1-scale Newsreader title in the accent color, a one-line DM Sans dek in `ink-2`, and the
  category header artwork (see `image-brief.md`) as a right-hung or full-bleed-within-panel image.
  The wash is the only place the category color fills an area larger than a chip; even there it is
  a soft tint, never the saturated accent.
- **Coral discipline.** Coral fills exactly one meaningful area above the fold per index view (the
  featured lockup's coral tick or the guides chip cluster, not both) plus the reading-progress bar
  on posts. Everywhere else coral is a hairline (ticks, `.link-coral`). The `guides` wash is soft
  coral-soft, which does not count against the "one saturated coral" budget.

---

## 6. Motion spec

One primitive only: `<Reveal variant delay index once as>` over `useReveal()`; never a hand-rolled
observer or `whileInView`. Numerics come from `variants.ts` (spring 220/30/0.9, `STAGGER_STEP 0.06`,
`REVEAL_DISTANCE 16`). The server renders the final state; reduced-motion renders the final state.

| Surface | Variant | Stagger | Static? |
|---|---|---|---|
| Masthead wordmark + dek | none | — | **Static** (part of LCP paint). |
| Featured lockup image | none | — | **Static, never wrapped** (LCP candidate on index). |
| Featured lockup text (title/dek/chip) | `fade` | none | Animated, single fade, no travel (it is high on the page). |
| Category chip row | `fade` | none | One fade for the whole row, not per-chip. |
| Post grid cards | `up` | `index` (clamp 8) | Animated. The signature entrance of the index. |
| Post H1 + dek | none | — | **Static** (LCP text on a post). |
| Post hero image | none | — | **Static, never wrapped** (LCP on a post). |
| Body section H2 blocks | `up` | none | Animated as each question scrolls in, `once`. |
| Pull-quote margin aside | `fade` | none | Fade only (it hangs in the margin; travel would look loose). |
| Product embed card | `up` | none | Animated once. |
| FAQ wash panel | `fade` | none | Whole panel one fade; items do not stagger (answer-first, all present). |
| Newsletter band | `up` | none | Animated once. |
| Next/prev footer | `up` | `index` (2 items) | Light stagger. |
| Related row | `up` | `index` | Matches grid feel. |

**One-heartbeat rule.** Exactly one `heartbeat` per page, on the single ♥ in the Emma aside within
the post byline/trust block (or the newsletter aside on the index), firing once on entrance, never
looping. The ♥ motif stays reserved for that one beat plus CTA labels; it is never scattered in
body copy or across cards. Card hover uses the existing `.card-lift` (translateY-only, hover-capable
devices only) plus `.press`; no new hover choreography.

---

## 7. Trust byline block (post header)

Directly under the H1 + dek, above the hero image or immediately below it (build phase picks based
on measured LCP), a compact trust surface in DM Sans, framed by a top+bottom `line` hairline:

- Emma avatar (32px, `--radius-full`, `paper-3` backing) + name, with an **AI-transparency line**
  in `ink-3`: "Written by Emma, the xdipx AI guide. She works from specs, materials, and what
  reviewers report, never personal use." (charter-safe, no lived experience).
- A `.kicker` metadata run: category · reading time · last reviewed date. Use "Last reviewed"
  (evergreen framing), never a countdown or "updated X ago" urgency.
- The heartbeat ♥ lives here, once (§6).
- The **sources / reviewed footer** at the very bottom of the article (before next/prev) mirrors
  this: a `paper-2` panel, `.kicker` `SOURCES & REVIEW`, a plain-language line that facts trace to
  product specs, materials, and review patterns, plus any linked references. No invented awards or
  statistics (charter). This closes the Hims-grade trust loop the category is missing.

---

## 8. Named editorial franchise / series concepts (3 candidates)

Franchises are the Glossier-grade lever: a recurring, named series with cover art and a
"Part N of M" frame turns 30 daily answer posts into a library with spines. All names are
notebook/field-guide-native, pass the charter (no em-dashes, no urgency, Emma has no lived
experience), and map onto the content plan's four categories. Series framing renders as a `.kicker`
eyebrow ("FIRST TIMES · PART 2 OF 5") on the card and post, plus a portrait series cover on the
series landing.

1. **First Times** — the beginner franchise (guides). Pitch: "Plain answers for the thing you're
   buying for the first time. No experience assumed, no wrong questions." Maps the "how to choose
   your first", "how do you start" backlog cluster into one confidence-building spine.

2. **How It Works** — the mechanism franchise (guides). Pitch: "What a toy actually does, and the
   trick behind it, explained the way Emma would say it out loud." Owns the "how does air pulse
   work", "what does a cock ring do", "how do app-controlled toys work" cluster, the highest-value
   LLM-citation shape.

3. **Field Notes** — the care and keeping franchise (care + wellness-basics). Pitch: "Short,
   practical notes on keeping what you own clean, safe, and lasting." Cleaning, storage, sharing,
   body-safe materials, the evergreen maintenance library.

Optional fourth for the comparisons slot, offered for later: **This or That** — "Two honest
options, side by side, so you can pick the one that fits." Kept in reserve so the first launch ships
three franchises, not four; add it once the comparisons backlog has depth.

---

## 9. ASCII wireframes

### 9a. Index — `/notebook` (375 mobile, then 1440 desktop)

```
375 ─────────────────────────────                 1440 ───────────────────────────────────────────────
┌───────────────────────────────┐                 ┌──────────────────────────────────────────────────┐
│  .kicker  THE NOTEBOOK · Nº 12 │                 │  .kicker THE NOTEBOOK · Nº 12          [ search ] │
│                                │                 │                                                  │
│   The Notebook                 │  masthead        │        The  Notebook                              │
│   (Newsreader 40px)            │                 │        (Newsreader 80px, centered)               │
│   ── coral tick                │                 │             ──── coral tick (40px)               │
│   things worth knowing,        │  dek/mono        │        plain answers, worth getting right        │
│   worth trying                 │                 │                                                  │
├───────────────────────────────┤ line-2 hairline  ├──────────────────────────────────────────────────┤
│ [FEATURED  ·  guides]          │                 │  ┌────────────────────────┐  ┌────────────────┐  │
│ ┌───────────────────────────┐  │                 │  │  FEATURED LOCKUP IMG    │  │ [chip guides]  │  │
│ │   FEATURED IMG (16:9)      │  │  LCP, static     │  │  (LCP, static, 3:2)     │  │ First Times    │  │
│ │   [ label ]                │  │                 │  │                         │  │ Part 2 of 5    │  │
│ └───────────────────────────┘  │                 │  │                         │  │                │  │
│ [chip guides] 6 min            │                 │  │                         │  │ How Do You     │  │
│ How Do You Choose Your         │  Newsreader 30   │  │                         │  │ Choose Your    │  │
│ First Toy?                     │                 │  │                         │  │ First Toy?     │  │
│ standfirst dek line…           │                 │  │                         │  │ (Newsreader 54)│  │
│ Emma · AI guide                │                 │  └────────────────────────┘  │ dek… Take a    │  │
├───────────────────────────────┤                 │                              │ peek →         │  │
│ chips: All Guides Compare      │ scroll-x row     ├──────────────────────────────────────────────────┤
│ Care Wellness  (accent-tinted) │                 │  All · Guides · Comparisons · Care · Wellness  12 │
├───────────────────────────────┤                 ├──────────────────────────────────────────────────┤
│  ┌─────────────────────────┐   │                 │  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │ ▏coral tick             │   │ card, Reveal up  │  │▏tick    │  │▏tick    │  │▏tick    │  Reveal up │
│  │ CARD IMG (4:3)          │   │ stagger index    │  │ IMG     │  │ IMG     │  │ IMG     │  stagger   │
│  │ [chip] 4 min            │   │                 │  │ [chip]  │  │ [chip]  │  │ [chip]  │            │
│  │ Card Title Two Lines    │   │                 │  │ Title   │  │ Title   │  │ Title   │            │
│  │ excerpt…                │   │                 │  └─────────┘  └─────────┘  └─────────┘            │
│  └─────────────────────────┘   │                 │  ┌─────────┐  ┌─────────┐  ┌─────────┐  (3-up)    │
│   … more cards (1-up) …        │                 │  └─────────┘  └─────────┘  └─────────┘            │
├───────────────────────────────┤                 ├──────────────────────────────────────────────────┤
│ ┌───────────────────────────┐  │ coral-soft band  │  ┌────────────────────────────────────────────┐  │
│ │ The Notebook, in your      │ │                 │  │ The Notebook, in your inbox.   [email][Show ]│  │
│ │ inbox. [email] [Show me]   │ │                 │  │ One send, once-ish a week. ♥(1 heartbeat)   │  │
│ └───────────────────────────┘  │                 │  └────────────────────────────────────────────┘  │
└───────────────────────────────┘                 └──────────────────────────────────────────────────┘
```

### 9b. Post — `/notebook/:slug` (desktop 1440 with body column + sticky TOC rail)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  progress bar (2px coral, fixed top, scaleX)                                 │
│  Home / Notebook / Guides / How Do You Choose…    (BreadcrumbNav, DM Sans)    │
│                                                                              │
│   [chip guides]  FIRST TIMES · PART 2 OF 5   (.kicker, coral)                │
│   How Do You Choose Your First Sex Toy?        Post H1 Newsreader 56, static │
│   A plain place to start, no experience assumed.   dek, ink-3                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  ── line ──  [Emma 32px]  Written by Emma, the xdipx AI guide. ♥       │  │  trust byline
│  │              GUIDES · 6 MIN · LAST REVIEWED JUL 2026 (.kicker)         │  │  (♥ = 1 heartbeat)
│  │  ── line ──                                                            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐                                     │
│  │   HERO IMG (3:2, LCP, static,       │                                     │
│  │   never wrapped)                    │                                     │
│  └────────────────────────────────────┘                                     │
│                                                                              │
│  ┌───────────────── reading column (65ch) ─────────┐   ┌── sticky rail ──┐  │
│  │  ⓟ  (drop cap, plum, 3 lines) lain-spoken start…│   │ ON THIS PAGE    │  │
│  │  running Newsreader 400 body, leading 1.7 …       │   │ · How do you…   │  │  TOC, sticky top
│  │                                                   │   │ · What matters… │  │
│  │  ── coral tick ──                        ┌────────┤   │ · Common Qs     │  │
│  │  How Much Should You Spend?    H2 + rule  │  “the │   │                 │  │
│  │  running body wraps to the left of the    │ margin│   │ ┌─────────────┐ │  │
│  │  hanging pull-quote aside →               │ pull  │   │ │ Rather ask  │ │  │
│  │  more body…                               │ quote”│   │ │ Emma? →     │ │  │  Emma aside card
│  │                                           │ plum  │   │ └─────────────┘ │  │
│  │  ┌─────────────────────────────────────┐  └───────┤   └─────────────────┘  │
│  │  │ FEATURED IN THIS PIECE   ▏coral tick │         │                        │
│  │  │ [img88] Title (Newsreader)           │  product embed (editorial card) │
│  │  │         why-line, spec · Take a peek →│                                 │
│  │  └─────────────────────────────────────┘                                  │
│  │  ┌─────────────────────────────────────┐  FAQ wash (paper-2, radius-lg)   │
│  │  │ COMMON QUESTIONS                     │                                 │
│  │  │ How do you clean it?  ── line ──     │                                 │
│  │  │ answer…                              │                                 │
│  │  └─────────────────────────────────────┘                                  │
│  │  ┌─────────────────────────────────────┐  SOURCES & REVIEW (trust footer) │
│  │  │ Facts trace to specs, materials, …   │                                 │
│  │  └─────────────────────────────────────┘                                  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│  ── line ──                                                                   │
│  PREVIOUS                                            NEXT                     │  keep-reading
│  [chip] Wand vs Bullet …            How Does a Suction Toy Work? [chip]       │
│  ──────────────────────────────────────────────────────────────────────     │
│  Keep reading (related row, 3 cards, Reveal up stagger)                       │
│  [card] [card] [card]                                                         │
└──────────────────────────────────────────────────────────────────────────────┘

375 mobile: single column. Order = progress bar / breadcrumb / chip+series kicker / H1 / dek /
trust byline / hero img / mobile TOC (collapsible) / body (drop cap, inline full-width pull quotes,
product embed, FAQ wash, sources) / next-prev stacked (next first) / related 1-up.
```

### 9c. Series landing — `/notebook/series/:slug` (e.g. First Times)

```
375 ────────────────────────────                  1440 ───────────────────────────────────────────
┌──────────────────────────────┐                  ┌────────────────────────────────────────────────┐
│ Home / Notebook / First Times │                  │ Home / Notebook / First Times                  │
│ ┌──────────────────────────┐  │  series header    │ ┌───────────────┐  A SERIES · 5 PARTS (.kicker)│
│ │  SERIES COVER (portrait   │ │  wash = franchise │ │ SERIES COVER   │  First Times                 │
│ │  1200x1500 label)         │ │  base (guides →   │ │ (portrait,     │  (Newsreader 54)             │
│ │  A SERIES · 5 PARTS       │ │  coral-soft)      │ │ 1200x1500)     │  Plain answers for the       │
│ │  First Times              │ │                   │ │                │  thing you're buying for     │
│ │  intro dek…               │ │                   │ │                │  the first time. dek…        │
│ └──────────────────────────┘  │                   │ └───────────────┘                              │
├──────────────────────────────┤                  ├────────────────────────────────────────────────┤
│  PART 1  ── line ──           │  numbered list    │  PART 1 ─────────────────────────────────────  │
│  ┌────┐ How Do You Choose…    │  (spine feel,     │  [img] How Do You Choose Your First Toy?   →   │
│  │img │ 6 min · Take a peek → │  not a card grid) │        6 min read · standfirst dek            │
│  └────┘                       │                   │  PART 2 ─────────────────────────────────────  │
│  PART 2  ── line ──           │                   │  [img] How Does a Suction Toy Work?        →   │
│  ┌────┐ How Does a Suction…   │                   │  PART 3 … PART 4 … PART 5 …                     │
│  └────┘                       │                   ├────────────────────────────────────────────────┤
│  … PART 3-5 …                 │                   │  newsletter band (coral-soft) [email][Show me] │
├──────────────────────────────┤                  └────────────────────────────────────────────────┘
│  newsletter band              │  Series uses the numbered "spine" list, not the masonry grid, so
└──────────────────────────────┘  the Part-N-of-M reading order is unmistakable.
```

---

## 10. Handoff notes

- **`rr7-engineer`** builds all components (Routine B PR, never auto-merged): masthead, featured
  lockup, category chips + map, redesigned `BlogPostCard`, drop cap, margin pull-quote,
  "Featured in this piece" embed (replacing the coral-banner variant), FAQ wash, newsletter band,
  next/prev footer, reading-progress bar, trust byline block, series landing. Uses `<Reveal>` per
  §6; wraps nothing that is the LCP.
- **`sanity-content-builder`** (additive only): any new blocks/fields for series (`seriesRef`,
  `seriesPart`, `seriesTotal`), `lastReviewed` date, and the embed why-line/spec if not already on
  the product embed schema. New doc types with fallback to old; do not modify existing schema.
- **`media-manager`** generates masthead art, four category header artworks, series covers, spot
  illustrations, and the OG template per `image-brief.md`. Reuse-first, ref-image-first, vision-gated.
- **`emma-copywriter`** owns any real specimen copy; **`emma-empathy-reviewer`** gates it. All copy
  in this doc and the hi-fi mock is placeholder and already charter-conformant.
- **`qa-reviewer`** / `design-critic`: final visual + CLS + a11y acceptance via preview MCP at
  375/768/1440.

**LCP callout.** On the index, the LCP is the **featured lockup image**; on a post it is the
**post hero image** (text-LCP fallback is the H1). Both are rendered as plain `<img>` and are
**never wrapped in `<Reveal>` or any motion component**, per the hard constraint. The reading-
progress bar and all reveals are transform/opacity only: zero CLS.
