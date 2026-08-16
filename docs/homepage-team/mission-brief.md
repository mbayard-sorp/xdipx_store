# Homepage Team Mission Brief v3

v3 (2026-08-03) adds section 11, extending this brief's coverage beyond the
homepage to the panel deck, the merchandised category pages, and the drop
pages. Sections 1-10 are unchanged from v2.

Load this before every run, after the budget gate and before any read or write.
This brief overrides prior routine framing where they conflict. The voice
charter at docs/emma-voice.md overrides everything, always.

## The mission

Build a homepage people come back to because it keeps helping them find
products that fit them. We win by doing what competitors will not do: talk
plainly and warmly about sex toys, lead with real products instead of vibes,
guide instead of pressure, and change every week. The homepage is a shop
window run by a smart, unembarrassed friend, not a landing-page funnel.

Success for any run is simple: a visitor lands, gets curious about a specific
product, and clicks through to its product page feeling like it might fit them.

## Non-negotiables (unchanged)

Budget gate first and often. Kill switch respected. Auto-publish is content
only; any code, schema, layout, or URL change goes through Routine B as a
reviewed PR. Emma voice gate on all copy. CTA whitelist only. No countdowns,
no urgency theater, no "Buy now." Emma has no lived experience. No em-dashes.

## 1. Product pages are the destination, not /discover

Every module must earn a click to a specific product or collection.

- Target: at least 70 percent of clickable homepage modules resolve to
  /products/{handle} or a collection page. Count them after publishing and
  report the ratio in the run summary.
- /discover appears at most twice on the page: once as the closer for people
  who genuinely do not know where to start ("Not sure? Find your fit →"),
  and at most one preset pill deep-link (/discover?preset=...). Nothing else
  points there. If a tile or rail CTA currently points at /discover and you
  can name the product it is really about, repoint it at that product.
- Rails: pick productHandles you can justify in one Emma line each. Set
  ctaLink to a product or collection, never /discover.
- Tiles and mosaic: tiles[].link goes to products or collections. Only the
  mosaic promo slot may keep /discover.
- Hero: choose featured[0] deliberately as this week's headliner, and write
  the hero copy about that product's payoff for the reader. Set the hero's
  primaryCtaLink to the featured product's page. If the field is not yet
  live in production, compensate with product links elsewhere on the page.
- **Destination continuity for every See-all (owner direction, all-hands
  2026-07-30).** Every "See all" must land the visitor on a surface that
  CONTAINS the products they just looked at, in an order they recognise. This
  is a hard rule for EVERY See-all, whether the module is team-published
  (`emmaCuratedRail`) or auto-generated (the Nº 03 "Most picked" anchor grid,
  whose See-all is set in code, not Sanity). A See-all whose destination does
  not contain the module's own products is a definition-of-done failure,
  exactly like a blank `ctaLink`. `/collections/best-sellers` is no longer an
  acceptable silent fallback for any module: Shopify best-seller order is a
  different ranking from the discovery index that fills the anchor grid, so the
  fallback is structurally guaranteed to mismatch. When the team cannot name a
  destination that genuinely contains the set, ship the module with NO See-all
  rather than point it somewhere plausible. The renderer and the anchor-grid
  destination itself are covered by a companion code ticket.

## 2. Images: the product is the star

Generated images have shipped below the bar before. In July 2026 a run
shipped tea cups, ceramic bowls, and notebooks as tile art. No one comes to
a sex toy store to shop for tableware. Standing rules (Mike's directive,
2026-07-05):

**Archetypes are binding (2026-07-21).** Every generated image declares one of
the four doctrine archetypes — A hand-on-product, B color-block still, C
in-situ bright scene, D metaphor macro — and starts from that surface's
scaffold in `docs/homepage-team/image-prompt-library.md`. Canonical rules:
`docs/design-doctrine.md` §4, including the coral-soft/plum-soft/paper
ground lock. The rules below stand; the doctrine wins where they drift.

- **Every merchandising image shows what we sell.** Either the actual
  product (its real Shopify photo submitted to fal as a Kontext reference
  image via `--ref-image` on `scripts/gen-homepage-image.ts`), or a sensual
  human context matched to what the surface links to: lingerie on a body,
  silk against skin, hands, playful tension.
- **Cast members are licensed in merchandising imagery (owner directive,
  2026-08-15).** Generated images may feature approved cast members WITH
  products: holding them, wearing them, mid-scene with them. Show people
  who look sexy and are plainly having an amazing time — desire, delight,
  anticipation, the grin of someone mid-discovery — never bored catalog
  posing. The product stays the hero; a cast member is context, not the
  subject. The doctrine's depicted-people hard rules bind unchanged:
  unambiguous adulthood, nothing a premium lingerie campaign could not
  run, vary age, body type, and skin tone across assets. Faces are
  welcome (the never-face-on rule was withdrawn 2026-07-28). Emma's
  likeness continues under the approved Emma-likeness policy.
- **Bright, colorful, bold** (Mike, 2026-07-05, second directive). No dark,
  moody, candlelit scenes — the first product-forward round shipped
  near-black images and those are retired too. Default to daylight or
  high-key studio light, tinted color-block backdrops from the doctrine
  ground lock (coral-soft, plum-soft, paper), the product LARGE in frame
  and unapologetic. Fun and
  curiosity-inspiring, premium-DTC-launch energy, not boudoir gloom.
- **Banned as the subject:** tea cups, mugs, ceramic bowls, notebooks,
  candles, fruit, napkins, empty styled tables — any still life a homewares
  store could run. Props may support a product; they may never replace it.
- **No text in generated images** (Mike's directive, 2026-07-06). Every
  fal.ai / Imagen output must be text-free: no words, letters, captions,
  labels, logos, watermarks, or typographic overlays baked into the pixels.
  Copy belongs in the markup, never in the image. Add "no text, no words, no
  letters, no watermark, no logo, no caption" to the negative brief of every
  prompt, and reject on self-review any image with baked-in text.
- **Rendered-text legibility over photography (owner directive, 2026-08-15).**
  The no-text rule keeps words out of the pixels; this rule governs the copy
  the SITE typesets on top of them. Any surface placing copy over a
  photograph must either (a) put the text on a solid ground below or beside
  the image, the door-tile pattern, or (b) run the redesign-v2-spec scrim:
  bottom-anchored ink gradient with white text over a low-detail image
  region. Plum emphasis on a dark ground always uses the `.em-on-dark`
  lift, never bare `.em` (2.5:1 is illegible; the owner flagged two live
  banners for exactly this). WCAG AA is the floor per the doctrine: 4.5:1
  body, 3:1 large display. design-critic BLOCKS on text-over-image below
  that floor, and the routine's image briefs must reserve low-detail
  negative space wherever a label will land.
- **The mood is playful curiosity with charge underneath.** A visitor
  should feel on the edge of finding something that will bring them
  pleasure, and smile on the way. Hard limits for legal / processor /
  ad-platform safety: no exposed genitalia, no nipples, no sex acts —
  nothing a premium lingerie campaign could not run. Short of that, push.
- Every generated image gets a self-review before upload. Check: does it
  read clearly at 375px, are objects and hands and bodies undistorted, is
  the product or the sensual context unmistakably the subject, and would a
  design-literate friend believe it came from a high-end sexual-wellness
  brand. One failed check means regenerate once with a corrected prompt.
  Two failures means stop generating and use product photography or a
  reused Sanity asset instead. Never publish an image you would not defend
  to Mike.
- **Fresh-art floor (owner direction 2026-07-27, replaces reuse-first as the
  default for homepage merchandising art).** When the hero product or the
  calendar theme changed since yesterday, generate NEW art for at least three
  of the swappable image slots: hero block art, the 3-4 wayfinder tiles, the
  Discover You promo, the couples band. The Emma portrait is excluded. Reuse
  is the fallback for a slot only after two failed vision-gate attempts on
  that slot. A run with a changed hero or a changed theme that generated zero
  images is a definition-of-done failure.
  Reuse-first still stands where it is right: product packshots and PDP art,
  where the real photo is the point. Every existing cap stays a ceiling and is
  unchanged (`homepage_team_max_images`, the daily $ cap, the gate re-check
  before every generation). The caps were never the problem: 15 consecutive
  merchandise runs generated zero images and spent $0.43 in 11 days against a
  $600/day budget and a 100-image/day cap.
  The floor is a mandate to try, never a licence to ship a bad image. The
  vision gate and the no-text-in-generated-images rule above are unchanged and
  still reject anything that fails them, and a slot that fails twice falls back
  to product photography or a compliant reused asset.
- Reused assets must still meet every rule in this section. The July 2026
  housewares set is retired; do not re-place those assets. When uploading,
  name and tag assets with product handle and mood so future runs can find
  them.

## 3. Weekly rhythm: mix it up

The homepage must be visibly different week over week. Sameness is a defect.

- Monday run, step one: merch-calendar sets or confirms this week's theme in
  marketing_calendar. Themes are editorial curricula, not sales events (per
  the charter: "Wand Week" teaches first, the offer rides along). Every daily
  run reads today's theme from the calendar and merchandises inside it.
- Rotation minimums (owner direction 2026-08-15, supersedes the old
  "rails are re-picked weekly" line, which contradicted the routine's
  per-run rails surface and let the page sit still):
  - Hero product changes at least twice per week; hero copy every run.
  - Wired rails vary every run: each run visibly changes the wired-rails
    slate (headings, order, or lineup). The one exception stays the
    featured-brand rail, which rotates weekly per its own rule below.
  - Every wired rail carries at least 4 products. The under-$30 entry
    rail carries at least 6; three products next to an 8-card anchor grid
    reads broken, and the catalog holds 20+ under $30 at all times.
  - The panel deck is merchandising, not shell: the door tiles and the two
    large banners (Discover / Just landed) get a visible refresh at least
    weekly (art, labels, blurbs, or link targets). A `singleton.panelDeck`
    `_updatedAt` more than 7 days old is a definition-of-done failure for
    that day's run. (It sat untouched 2026-07-30 to 2026-08-15; the owner
    noticed. Never again.)
  - The anchor grid's backing collection is re-ordered or re-pointed at
    least weekly.
- No two consecutive weeks with the same hero product, the same rail lineup,
  or the same tile artwork. Check last week's run summaries before picking.
- **Featured brand rail (owner direction #718, existing primitives only).** Run
  a rotating FEATURED BRAND rail using existing content primitives — an
  `emmaCuratedRail` (or `productCarousel`) filtered to one carried brand's
  in-stock SKUs (Shopify `vendor` field) with an editorial intro tile for the
  brand story. It rotates WEEKLY (not daily), aligned with the social team's
  featured-brand-of-the-week series and the marketing calendar; `merch-calendar`
  proposes the brand queue. Place it mid-page, after the first one to two
  product-forward rails and the trust bar, and never replacing a top rail, so
  every tile still links `/products/{slug}` and the 70% PDP-link target holds.
  Copy passes the voice gate as usual. This adds no shell: a distinct
  single-brand visual treatment later is a `homepage-designer` +
  `sanity-content-builder` additive-schema PR, not something Routine A invents.
- **The hero belongs to the theme (binding, owner direction 2026-07-27).**
  During an active `marketing_calendar` theme week, the hero product is either
  a product from the theme's own category, or a product plus theme combo where
  the theme category is visibly part of the hero (a toy paired with the week's
  featured lube, a wand shown with the cleaner the week is teaching). A hero
  from outside the theme with only an editorial argument for it is a miss, not
  a judgment call. Section 5's photogenic-first rule selects WITHIN the theme
  category; it never overrides the theme binding. If nothing in the theme
  category is photogenic enough to carry the hero, run the combo, or fix the
  photography, and say which in the run summary.
  Why this is binding: on 2026-07-27 Lube Literacy Week shipped with a glass
  wand hero on a documented photogenic-first rationale, because no rule bound
  the hero to the theme and no gate checked it. The page read as "we sell
  lubricant" under an unrelated hero instead of as a lube-week campaign.

## 4. Competitor recon: weekly, and it must produce decisions

Monday run, before theme setting. **Baseline first (2026-07-21):** the standing
reference is the live teardown at
`docs/homepage-team/competitor-teardown-2026-07-live.md` (16 real captures,
July 2026). Recon reports *deltas against it* — what changed on each site since
the teardown — and appends a dated delta section to that doc rather than
re-deriving the field from scratch.

- WebFetch the homepages of Lovehoney, Spectrum Boutique, In The Groove, and
  Too Timid, plus one new competitor you have not reviewed before.
- Write a short recon memo into the run log: what each leads with, what they
  do badly (urgency banners, clutter, coy euphemism, porn-copy, walls of
  discounts, no guidance), one idea worth adapting, and one thing we will do
  this week that none of them do.
- The memo must change something: the week's theme, a rail concept, a tile,
  or a Routine B backlog item. Recon that changes nothing is a wasted step.
- Our standing differentiators, use them as the lens: plain shame-free talk,
  guidance toward fit, product-first merchandising, zero urgency theater.
  When a competitor tactic depends on discount pressure or crude copy, log it
  as a thing we deliberately do not do.

## 5. Product curation: pick winners, then commit to them

Featuring a product is a bet; place it deliberately. When choosing the hero
and rail products (on top of the selection criteria in Routine A):

- **Photogenic first, inside the theme.** A featured product needs photography
  that can carry a bright, bold image — strong silhouette, saturated color,
  clean shots. A great product with murky photos loses the hero slot to a good
  product that pops. During a theme week this rule ranks candidates *within*
  the theme category (section 3's hero binding); it is never a reason to leave
  the theme. A photogenic off-theme product does not beat an on-theme one.
- **Actually look at the primary image before pinning it (operationalises
  "photogenic first").** Before pinning any product to the hero or a rail,
  download and *look at* its Shopify PRIMARY image. Reject or reorder it if it is
  a retail packaging shot — the product small and floating on white with large
  empty bands, or with baked-in packaging text. Confirming `imgs > 0` is NOT the
  check; roughly 29% of the active catalog leads with a packaging shot, so this
  fires often. If a cleaner sibling image exists on the product, promote it with
  `setMediaAsPrimary` before pinning (as run 89 did by hand for 77791B). The
  Routine A pick step is where this check runs; a packaging-shot hero passes
  every numeric score and still looks wrong on the page.
- **Story-able.** You must be able to say in one sentence what it does for
  the reader and why it earns the slot this week. If the enrichment data
  (Emma's take, sensation dial, tags) is thin, either route it to
  emma-copywriter for copy or pick something with a story ready to go.
- **Curiosity spread.** Across the page, cover an on-ramp (approachable,
  under $30), a headliner (the hero, the week's theme), and a
  reach (something that stretches a browser's imagination). All three
  jobs, every week.
- **Follow through.** A featured product gets the full treatment: bold
  image, fresh copy, a preset or rail that leads to it. No orphan features.

## 6. Emma's Presets: the team owns the lineup

`emmaPreset` docs in Sanity render as "Emma's Presets" filter pills on
collection and search pages. Standing rules (Mike, 2026-07-05):

- **The homepage team owns preset publish state.** Publishing and
  unpublishing presets is a content-plane action the team does without
  per-change approval, same as rails and tiles.
- **Max 5 published at any time.** Thirty live pills bury discovery on the
  PLPs. Five is the ceiling, not the target; fewer, sharper presets beat a
  full row.
- **Match the homepage theme.** The published preset lineup follows the
  week's theme and the current homepage merchandising. When the theme
  changes, re-curate the lineup in the same run.
- **Every published preset must land on products.** A preset's
  mood/audience/matters tags must match live product tags (the vocab from
  `scripts/dump-discovery-vocab.ts`; tags outside the live vocab match
  zero products and render a dead pill). Verify match counts before
  publishing; a preset matching fewer than 3 products gets fixed or stays
  unpublished.
- **The label must keep its promise.** The tag vocabulary has no
  material/product-type dimension, so a label like "Glass and metal mood"
  or "Flavored and edible" filtered by mood tags alone delivers a random
  grab-bag (the 2026-07-05 audit found five of these among the 30 then
  live). Before publishing, eyeball the actual filtered results: if the
  products do not look like what the label promises, rename the preset or
  retag the products; never ship the mismatch.
- **Create when nothing fits.** If no existing preset matches the theme,
  draft a new one with emma-copywriter (label + narratorCopy in charter
  voice, tags from the live vocab only), verify matches, publish it, and
  unpublish whatever it replaces.

## 7. Serve both visitors on the customer journey

Two people land on this page:

- The seeker knows roughly what they want. Get them to a product or category
  in one click: clear category tiles, a named hero product, rails with
  legible headings.
- The browser is curious but cautious. Give them a comfortable on-ramp:
  forward, warm copy that treats curiosity as the whole point, framing that
  makes pushing their own boundaries feel safe and normal, and the Compass
  (/discover) as the single closer when they still are not sure.

Map every module to one job before publishing: orient (nav, category tiles),
tempt (a specific product with a reason it fits), deepen (education, the
Notebook), or close (Compass, email capture). A module with no job gets
better content or gets its slot re-planned via Routine B.

The "From the Notebook" module auto-populates with the latest published posts
(see `docs/store-team/internal-linking.md`), so it stays current on its own;
publish a curated `editorialTiles` override only for a deliberate editorial
pick, not to keep it fresh.

## 8. Voice on the homepage

The charter (docs/emma-voice.md) is the source of truth. For homepage work,
the notes that matter most:

- Be forward. We exist to inspire curiosity in a market that has run on
  shame. Plainer, not naughtier. "Sex toy" is a normal noun. Say what a
  product does and how it works, suggestively but matter-of-factly.
- Write about the reader, their payoff and their curiosity, never about the
  catalog or about Emma. The test: would a smart, unembarrassed friend say
  this out loud.
- **No omniscience, no self-narration** (charter rules, codified 2026-07-30 in
  docs/emma-voice.md; binding here). Emma never claims to know everything, to
  know the catalog cold, or to have read every spec — she describes her
  process ("I'll match it against the specs and the reviews"), not the extent
  of her knowledge. And she never narrates her own nature: she does not
  announce that she is an AI, that she has a purpose, that she does not get
  embarrassed, that she has no shelf to push, or that she is unbiased. Being
  unembarrassed is a property of how she writes, demonstrated, never asserted.
  Trust claims ("Hand-checked, not auto-listed") live in the trust canon, not
  in Emma's mouth; a no-incentive claim in first person is also indefensible,
  since the scorer weights profitability. The charter's honesty rule still
  stands: disclose her nature when a reader could otherwise mistake her for a
  human who used the product; this only bans volunteering it as a trust
  argument.
- **Her own introduction is a trust beat, not a sell beat.** The "Meet Emma"
  band runs the plain-warm register, not the v5 desire-forward 9 — the v5
  register is scoped to selling copy, and heating up her self-introduction
  centers Emma over the reader. Ruled twice by emma-empathy-reviewer on
  2026-07-30; recorded here so it is not re-litigated each cycle.
- Retired tic: **"point you to"** (add it to the copy pre-flight retired list).
- "Fit" is our word. People are here to find something that fits them; hero,
  rails, and closers should use fit language naturally, not as a slogan
  stamped everywhere.
- **The hero runs the full v5 register, dial 9.** Owner direction 2026-07-21
  (after rejecting an under-dialed hero as "not the v5 we worked on"): the
  charter's optional first-touch pullback to 5-7 does NOT apply to
  `singleton.emmaHero` copy. Hero headline, body, and pull-quote are
  desire-forward at 9: act-anchored, embodied, temptation closer. Cozy
  lifestyle copy that never names what the reader will feel is a defect the
  voice gate should flag as under-dialed, not a safe default.
- Fresh, product-specific language on every run. Retire every coined phrase
  after one use. Whitelist CTAs only.

## 9. Design ambition: invent the experience, don't decorate the template

Mike's standing directive (2026-07-05): push the limits of the team's design
capabilities. The bar is not "a clean page"; it is unique customer
experiences for exploration and self-discovery that no competitor has.

- Routine B exists to invent, not just to maintain. Every design cycle
  should carry at least one genuinely new experience concept from the
  backlog to a wire or prototype: interactive finders beyond the Compass,
  playful self-discovery moments, bold editorial formats, new ways to make
  browsing feel like exploring.
- Judge concepts by whether they help a visitor learn something about
  themselves (what they are curious about, what fits them) while moving
  them toward a product. Exploration that dead-ends is decoration.
- Design proposals may be ambitious; shipping stays disciplined — code and
  layout still go through the reviewed-PR path, content experiments can
  ship same-day within the content plane.
- Log rejected concepts with reasons in the run record so ambition
  compounds instead of resetting each cycle.

## 10. Definition of done, every run

After publishing, fetch the live homepage and verify before closing the run:

1. Page returns 200 and the hero renders the intended product.
2. Count product/collection links versus /discover links; report the ratio
   and flag if under the 70 percent target.
3. Every image on the page passed the section 2 review or is Shopify product
   photography. **"Shopify product photography" is not a free pass for a retail
   packaging shot:** a pinned hero/rail primary image that is a packaging shot
   (product small on white with empty bands, or baked-in packaging text) fails
   this check even though it is genuine Shopify photography. Look at it and
   promote a cleaner sibling per section 5 before pinning.
4. All new copy passed the Emma voice gate.
5. Published `emmaPreset` count is 5 or fewer, the lineup matches the
   current theme, and every published preset lands on 3+ products.
6. Run summary states: theme, hero product and why, what changed versus
   yesterday, what will change next run, and (Mondays) the recon memo.
7. **Theme mapping:** the hero, at least one rail, and at least one wayfinder
   tile demonstrably belong to this week's theme, and the run summary states
   the mapping (which surface carries the theme, and how). A theme week where
   the mapping cannot be stated in one line each is a failed run.
8. **Sameness diff:** today's published slate differs from yesterday's on at
   least two surfaces (Routine A step 2c), and at least one of the two is
   imagery or product selection, not copy alone. State the diff in the summary.
9. **Fresh-art floor:** if the hero product or the calendar theme changed since
   yesterday, at least three swappable image slots carry newly generated art
   (mission brief section 2, Routine A step 4). Zero images generated on a
   changed-hero or changed-theme day is a failure, not a saving.

A run that publishes a page visually identical to yesterday is a FAILED run,
unless the run summary states an explicit hold reason (a deliberate editorial
hold, a gate refusal, a supply or data problem named specifically). "Nothing
scored well enough to swap" is not a hold reason. Publishing nothing is a
decision that must be argued for in the summary, not the safe default.

**This does not loosen the sparse-data rule, and the two do not conflict.**
Below 300 sessions/week the scoreboard still never auto-triggers swaps: that
rule exists so we do not optimize on noise, and it stands. The freshness floor
is not optimization, it is editorial cadence. Sparse traffic tells you *which*
product to pick on margin and heuristics instead of on GA4; it never tells you
to ship yesterday's page again. Metric-driven swaps stay gated on 300
sessions/week. Freshness is ungated and mandatory.

## 11. Merchandised surfaces beyond the homepage (v3, 2026-08-03)

Owner direction, 2026-07-29 all-hands (suggestion #285): the team's remit now
covers the panel deck on the homepage, the merchandised category pages at
`/collections/{pleasure,play,body,wear,discover}`, and the drop pages at
`/new` and `/collections/on-sale`. Everything above in sections 1-10 still
applies to the homepage; this section adds what is specific to the new
surfaces. Nothing here loosens a gate, a valve, or the 70 percent
product-forward target; it extends them.

**a. Definition of done, per page.** Before closing a run that touched any of
these surfaces, verify on the live page:

1. A masthead with exactly one H1. Never zero, never a second H1 buried in a
   shelf or the FAQ block.
2. Populated shelves with working anchors. An empty shelf or a shelf whose
   anchor link 404s or scrolls nowhere is a definition-of-done failure, same
   as a blank `ctaLink` on the homepage.
3. One FAQ block. Not zero, not a duplicate block from a stale override.
4. A trust block, per `docs/design-doctrine.md` §6. Never fabricate proof:
   the trust block only states claims we can back (see §6's rule against
   invented review counts, invented guarantees, or invented stock signals).
5. No fabricated dial or proof data. Sensation dials, mood/audience/matters
   tags, and any "X people picked this" style proof must come from real
   product data or real behavior, never invented to fill a slot.

**b. Tiered upkeep cadence (binding policy).** This cadence is not a
suggestion, it is the standing schedule for these surfaces, the same weight
as the homepage's weekly rhythm in section 3:

- **Daily health sweep, all live pages.** Every run checks that every live
  page in this section's scope still passes the definition of done in (a):
  masthead H1, shelf anchors, FAQ block, trust block, no fabricated data.
- **Category pages: 2 deep-refreshed per day on a 3-day cycle.** Across
  `pleasure`, `play`, `body`, `wear`, `discover`, refresh two per day so
  every category page gets a deep refresh at least once every three days.
- **Monday theme pass on all.** On the Monday run, after the homepage theme
  is set (section 3), pass the week's theme across every category and drop
  page in scope so merchandising reads as one coherent week, not a homepage
  theme with stale category pages underneath.
- **New and Sale auto-populate.** `/new` and `/collections/on-sale` populate
  from their `sourceRule`, not manual curation. The team's job on these two
  is a weekly masthead refresh, not shelf-by-shelf picking.
- **Art cadence differs by surface.** Category page art refreshes weekly.
  Drop page art (`/new`, `/collections/on-sale`) is event-driven, tied to
  what actually changed in the sourced set, not a fixed calendar day. The
  homepage keeps its existing daily fresh-art floor from section 2 unchanged.

**c. The 70 percent product-forward target, restated for the new fold.** The
section 1 target applies here too, with two additions specific to the new
surfaces:

- At least 3 direct PDP links above email capture on every page in scope.
- At least 1 direct PDP link above the panel deck.
- Deck doors are capped at the schema composition: 4 squares, 2 large,
  2 small. Never exceed the schema's slot counts to fit in an extra door.

**d. Panel order is navigation, not daily merchandising.** The order of
doors in the panel deck is an information-architecture decision, not a
content refresh. Deck reshuffles are rare and owned by Routine B, the same
way a rail reorder that changes IA goes through Routine B elsewhere in this
brief. Daily and weekly merchandising runs may refresh art, copy, and the
populated shelves behind a door; they may not reorder the deck.

**e. Discover-door disambiguation.** `/collections/discover` (the Discover
category page, in scope for this section) is not the same surface as
`/discover` (the Compass finder, governed by section 1 and section 7). When
the panel deck or any merchandising surface links a "Discover" door, link it
to `/collections/discover`, the collection page, not to the Compass finder.
Conflating the two sends visitors to the wrong experience for what the door
promised.
