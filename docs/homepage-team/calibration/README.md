# design-critic calibration corpus

Ten committed, regenerable screenshots: five the gate must score PASS, five it
must score BLOCK. Run the calibration pass against this directory before
trusting a BLOCK verdict from `design-critic`, per
`routine-design-cycle.md` §4 and the `<calibration>` block in
`.claude/agents/design-critic.md`.

Machine-readable index: `manifest.json` (same entries, with the expected verdict
and the rule each one is calibrated against).

## Why this directory exists

The calibration requirement is old and had never run once.

`design-critic` is told to score five known-good and five known-bad historical
screenshots before a BLOCK is trusted, and until that pass is recorded it
downgrades every BLOCK it would otherwise issue to a REVISE, because an
untrusted BLOCK is worse than a visible REVISE. Ticket #16881 fixed the
ownership half of that — Routine B records the calibration event — and run 1703
then found the supply half had never been checked: `.design-snapshots/` is
gitignored (`.gitignore:73`) and a scheduled cloud routine runs in an ephemeral
container that is cloned fresh and reclaimed afterwards, so **no capture any run
has ever taken still exists by the time the next run starts**. A historical
corpus could not be assembled by the agent assigned to assemble it. Filed as
#18635.

So the corpus stops being historical and becomes **reproducible**. Every image
here is cut from a live capture of production by
`scripts/design-calibration.ts`, and every `bad-*` image is produced by
injecting one documented CSS rule that reinstates a defect this repo actually
shipped, cited to the ticket that fixed it. Three things follow, each of which
the historical version could not offer:

1. **It can be regenerated.** `npx tsx scripts/design-calibration.ts` rebuilds
   all ten from whatever is live, so the corpus does not rot as the storefront
   moves.
2. **The geometry can be re-verified.** Each reinstatement reverses a named
   class, so the resulting shape can be checked against the measurement the
   fixing run recorded rather than taken on trust.
3. **Four of the five bad images have an exact good twin** — same region, same
   viewport, same page — so the only variable between the pair is the defect.
   A pair that differs in one thing calibrates a scorer. Ten unrelated images
   do not.

Total weight is about 580 KB. The full-page captures these are cut from run
2.2 to 3.6 MB each at 12,800 to 18,100 px tall, so committing ten of those
would have put roughly 25 MB of binary in the repo. Crops are the point.

## One class deliberately absent, and why

The historical candidate list for this corpus included "a Vercel bot-wall page,
if one can be re-provoked" — the error page run 1298 scored three of without
noticing, at 98.5-99.6% near-white and mean luminance 253-254 against a real
homepage's 26-29% at 197-204.

That class is **not** here, on purpose. It is not a design defect and it should
never reach a human or model scorer at all: it is "the capture is not the
storefront", which is now a mechanical check. `npx tsx scripts/design-crop.ts
measure <png>` prints both numbers and exits 2 on the signature. Spending one of
ten calibration slots teaching a scorer to recognise something an exit code
already catches would make the corpus worse, not better.

## The ten

Expected verdicts are the fixture. **Do not edit them to match what a gate run
produced** — a disagreement between a verdict here and a verdict from the gate
is the calibration result, and it is the whole reason to run the pass.

### Must score PASS

| File | Region | Why it is good |
|---|---|---|
| `good-01-rail-header-375.png` | Rail header, 375 | The heading owns a full-width row and the See-all drops onto its own row beneath it, with the whitelist arrow intact. The shipped state after #18637. |
| `good-02-tab-bar-375.png` | Bottom tab bar, 375, consent stored | Every nav label renders at its natural width inside a horizontal scroller, in DM Sans, with the account tab pinned outside the scroller. |
| `good-03-rail-band-1440.png` | Rail band, 1440 | v3 card system: flat cards on one plum-soft ground, no borders, no drop shadows, no rounded card frames. Twin of `bad-05`. |
| `good-04-meet-emma-1440.png` | Nº 04 Meet Emma, 1440 | Newsreader display against DM Sans body, one plum emphasis word, generous vertical rhythm on a single paper-2 ground. |
| `good-05-ink-closer-1440.png` | Nº ink closer, 1440 | White display type on `bg-ink`, exactly one plum emphasis word lifted with `.em-on-dark` (~6.75:1), coral CTA at 5.51:1. Twin of `bad-04`. |

### Must score BLOCK

| File | Reinstates | The defect, and the rule it breaks |
|---|---|---|
| `bad-01-rail-header-collision-375.png` | `flex: 1 1 0%` on the rail heading column, reversing `basis-full sm:basis-auto sm:flex-1` (#468, #16879a) | The 0% basis lets the heading column absorb every pixel of shrink, so the row never overflows, the promised `flex-wrap` never fires, and the heading's *text* wraps onto the See-all's baseline instead. The CTA reads as a continuation of the sentence. Doctrine §2: hierarchy has to be legible as hierarchy. Twin of `good-01`. |
| `bad-02-tab-bar-runon-375.png` | `flex: 1 1 0%` and zero padding on the tab buttons, reversing `shrink-0 grow` (#18637) | Seven Sanity-published menu items get equal slices narrower than their own labels. Run 1703 measured the labels running x=25 to x=304 as one continuous glyph run with inter-*word* gaps of 1-2px, reading `PleasurePlayBodyWearDiscoverSaleNotebook`. This is the primary mobile navigation. CLAUDE.md mobile-first at 375. Twin of `good-02`. |
| `bad-03-nav-serif-375.png` | Newsreader on the tab bar, reversing the run 1298 / 1703 type fix | Doctrine §2 assigns Newsreader to headlines and editorial display and DM Sans to nav, labels and CTA text. This one looks deliberate, which is exactly why it needs to be in the corpus: it is a type-system violation that does not look like a bug. Twin of `good-02`. |
| `bad-04-plum-on-ink-1440.png` | `--color-plum` on the ink closer's emphasis word, reversing `.em-on-dark` | Plum (`#7A2BB8`) on `bg-ink` reads about 2.5:1, so the emphasis word becomes the least legible word in the headline it exists to emphasise. The owner flagged two live banners for exactly this, which is why mission brief §2 names the lift by class. Under the AA floor the doctrine sets (4.5:1 body, 3:1 large display). Twin of `good-05`. |
| `bad-05-v2-card-chrome-1440.png` | v2 card chrome (rounded corners, drop shadow, cream ground and border) on a v3 rail (#1450, PR #506) | Shipped on the team's main lever for weeks through the `emmaCuratedRail` → `EmmaCuratedRail` → `ProductCarousel` wrapper path, which the `VARIANT_B_SECTION_TYPES` exclusion could not see. Doctrine §1 and §5: flat on white paper, hairline frames, no drop shadows, no cream grounds. Twin of `good-03`. |

## Regenerating

```bash
npx tsx scripts/design-calibration.ts                      # against production
npx tsx scripts/design-calibration.ts --base http://localhost:3000
npx tsx scripts/design-calibration.ts --only bad-01-rail-header-collision-375
```

The entry list, the injected CSS and the expected verdicts all live in
`CALIBRATION` at the top of that script, which is the single place to edit them.
The generator refuses to write anything from a session whose page answered with
an edge-block page or dropped a render-critical request, for the same reason the
bot-wall class is absent above: a fixture that is quietly wrong is worse than a
missing one.

**When the storefront changes under a fixture, regenerate it and re-read it
before committing.** A `good-*` image is only good as long as the live region it
was cut from still is; if a regenerated `good-*` picks up a real defect, that is
a finding for the cycle, not a fixture to paper over.
