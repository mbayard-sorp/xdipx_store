# Homepage Team Mission Brief v2

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

## 2. Images: the product is the star

Generated images have shipped below the bar before. In July 2026 a run
shipped tea cups, ceramic bowls, and notebooks as tile art. No one comes to
a sex toy store to shop for tableware. Standing rules (Mike's directive,
2026-07-05):

- **Every merchandising image shows what we sell.** Either the actual
  product (its real Shopify photo submitted to fal as a Kontext reference
  image via `--ref-image` on `scripts/gen-homepage-image.ts`), or a sensual
  human context matched to what the surface links to: lingerie on a body,
  silk against skin, an unmade bed with intent, hands, silhouettes, tension.
- **Banned as the subject:** tea cups, mugs, ceramic bowls, notebooks,
  candles, fruit, napkins, empty styled tables — any still life a homewares
  store could run. Props may support a product; they may never replace it.
- **The mood is charged and anticipatory.** A visitor should feel on the
  edge of finding something that will bring them pleasure. Attractive,
  curiosity-inspiring, sexy. Hard limits for legal / processor / ad-platform
  safety: no exposed genitalia, no nipples, no sex acts — nothing a premium
  lingerie campaign could not run. Short of that, push.
- Every generated image gets a self-review before upload. Check: does it
  read clearly at 375px, are objects and hands and bodies undistorted, is
  the product or the sensual context unmistakably the subject, and would a
  design-literate friend believe it came from a high-end sexual-wellness
  brand. One failed check means regenerate once with a corrected prompt.
  Two failures means stop generating and use product photography or a
  reused Sanity asset instead. Never publish an image you would not defend
  to Mike.
- Reuse-first stands, but only for assets that meet these rules. The July
  2026 housewares set is retired; do not re-place those assets. When
  uploading, name and tag assets with product handle and mood so future
  runs can find them.

## 3. Weekly rhythm: mix it up

The homepage must be visibly different week over week. Sameness is a defect.

- Monday run, step one: merch-calendar sets or confirms this week's theme in
  marketing_calendar. Themes are editorial curricula, not sales events (per
  the charter: "Wand Week" teaches first, the offer rides along). Every daily
  run reads today's theme from the calendar and merchandises inside it.
- Rotation minimums: hero product changes at least twice per week. Rails are
  re-picked weekly under the theme. At least one module (tile art, rail
  concept, mosaic arrangement) is visibly new each week.
- No two consecutive weeks with the same hero product, the same rail lineup,
  or the same tile artwork. Check last week's run summaries before picking.

## 4. Competitor recon: weekly, and it must produce decisions

Monday run, before theme setting:

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

## 5. Serve both visitors on the customer journey

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

## 6. Voice on the homepage

The charter (docs/emma-voice.md) is the source of truth. For homepage work,
the notes that matter most:

- Be forward. We exist to inspire curiosity in a market that has run on
  shame. Plainer, not naughtier. "Sex toy" is a normal noun. Say what a
  product does and how it works, suggestively but matter-of-factly.
- Write about the reader, their payoff and their curiosity, never about the
  catalog or about Emma. The test: would a smart, unembarrassed friend say
  this out loud.
- "Fit" is our word. People are here to find something that fits them; hero,
  rails, and closers should use fit language naturally, not as a slogan
  stamped everywhere.
- Fresh, product-specific language on every run. Retire every coined phrase
  after one use. Whitelist CTAs only.

## 7. Definition of done, every run

After publishing, fetch the live homepage and verify before closing the run:

1. Page returns 200 and the hero renders the intended product.
2. Count product/collection links versus /discover links; report the ratio
   and flag if under the 70 percent target.
3. Every image on the page passed the section 2 review or is Shopify product
   photography.
4. All new copy passed the Emma voice gate.
5. Run summary states: theme, hero product and why, what changed versus
   yesterday, what will change next run, and (Mondays) the recon memo.

A run that publishes nothing is fine. A run that publishes something broken,
ugly, or identical to yesterday is not.
