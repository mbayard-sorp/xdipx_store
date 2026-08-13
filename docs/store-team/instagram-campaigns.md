# Instagram Campaigns: the standing schedule and how a campaign runs

> **Binding on the social routine** (`docs/store-team/routine-social-daily.md`, Step 2). Loads after
> the gate, alongside `docs/store-team/mission-brief.md` and `docs/emma-voice.md`. The voice charter
> outranks this file for every customer-facing word; `docs/ads-policy.md` §Organic social and the
> platform's own live rules outrank both. This file governs *what runs when*, never *what is allowed*.

Owner direction, all-hands 2026-08-11:

> "it is my expectation that you will all work together to continually run themed campaigns on
> instagram. ... These post campaigns can be anything really. They can be focused on product
> categories, anything having to do with improving your sex life. I'm empowering the team to work
> together to put a schedule together to run these. Ideally, when one ends, the next one begins."

This file is the answer to "put a schedule together." It exists because the same direction was given
on 2026-08-08 and 08-09, became eight approved `instructions` tickets (#2013, #2014, #2023, #2024,
#2025, #2029, #2034, #2213), and was deferred as a cluster on 2026-08-10 pending one consolidated
rewrite that had no owner. This is that rewrite. Those tickets are superseded by this file plus the
campaign section of the social routine.

## 1. What a campaign is

A campaign is a **named, dated arc of Instagram posts that share a subject and a look**. It is not a
sale, not a promo window, and not a licence to post differently. Two campaigns never overlap; the
day one ends, the next is already active.

Every campaign carries these fields. The schedule in §5 fills them in; the routine reads them at run
start and drafts against them.

| Field | What it is |
|---|---|
| `slug` | Stable key, kebab-case. Used in draft event summaries so posts can be traced to a campaign before the schema carries it. |
| `name` | The human name, matching its `marketing_calendar` row. |
| `starts` / `ends` | Real dates, inclusive. `marketing_calendar` rows carry a single `event_date`, so the campaign's start row is the calendar anchor and `ends` lives here. |
| `subject` | One sentence. Either a product category ("wands") or a live-better theme ("talking about it before you need to"). |
| `pillars` | Which content pillars this campaign draws from (§2). Never fewer than two, so a week of posts does not collapse into one shape. |
| `formats` | Which recurring formats are in rotation (§2). |
| `product_scope` | A **rule**, not a frozen SKU list, so the Step 2.6 stock gate can swap a product without breaking the campaign ("in-stock, ACTIVE, product_type_dial = wand"). |
| `visual_scheme` | The look that makes the posts read as one campaign (§3). |
| `end_condition` | Normally the `ends` date. A post removal ends a campaign early and steps volume down per `docs/ads-policy.md`. |

## 2. Pillars and formats

**Pillars** are what a post is *about*. Owner-set, 2026-08-08, unchanged:

1. **Mechanism Plainly.** How a thing actually works. Vibrators, wands, air-pulsation, plugs.
   Never dildos and never anatomically realistic products; those do not survive Meta moderation.
2. **Materials and Care.** Silicone grades, body-safety, cleaning, storage, what degrades what.
3. **Questions Nobody Asks Out Loud.** The embarrassed question, answered plainly and warmly.

**Formats** are the *shape* a post takes. Structures are reusable; wording never is.

| Format | Shape |
|---|---|
| Unboxing with Emma | What is actually in the box, in order, one surprise. |
| Things I Learned Reading the Manual | A short list of specifics nobody reads the manual for. |
| Ask Emma | A reader question restated plainly, then answered. |
| Brand Crush | One maker, why their engineering is interesting. Tag the verified handle only (§8). |
| This Week at xdipx | Site news: a new aisle, a drop, a Notebook piece worth reading. |
| Trend React | A reaction to an adopted trend brief. Never chases a trend we have no view on. |
| Inspo Carousel | Multi-slide affirming or educational message over a metaphor hook. Built for saves. |

**Rotation rule:** never two consecutive posts from the same pillar, and never two consecutive posts
in the same format. A campaign that can only be told one way is too narrow; widen the subject or
shorten the campaign.

## 3. Visual scheme

**Within a campaign you lock. Between campaigns you rotate.** This is the inversion that matters, and
it is the opposite of the homepage instinct. The daily merchandiser is scored on day-over-day
difference; on Instagram that instinct is a defect, because the profile grid is the brand asset and
fourteen posts that each look fresh look like fourteen strangers. The unit of variety is the
campaign, not the post.

Every field below is decided **once, before post 1**, and never re-decided mid-campaign. A campaign
that changes its look partway through was never a campaign. If a format trend lands on day 6, it is
the *next* campaign.

| Field | What it fixes |
|---|---|
| `groundSet` | Primary / secondary / punctuation, all from the doctrine lock (coral-soft, plum-soft, paper-2, paper-3). Primary carries about half the tiles. Never sage. |
| `lightSignature` | One of: high-key seamless noon, window-light afternoon with a single soft cast shadow, overcast diffuse. Fixed for all 14 posts. The strongest continuity signal available and the cheapest to hold. |
| `rhymeProp` | One physical object recurring in at least 4 of 14 posts. |
| `rhymeColor` | One styling accent alongside the ground. The campaign's second colour. |
| `surfaceMaterial` | One repeated surface: raw plaster, pale oak, ribbed glass, washed linen. |
| `castSlate` | One `castMember` slug, two maximum, with an exact versioned `referencePhotoUrl` (§3.2). |
| `wardrobeRegister` | One line that **describes the reference photo**, never instructs against it. |
| `cropSignature` | One repeated framing move (subject on the right third, air left) so slide-1 tiles stack. |
| `retiredForCampaign` | What this campaign will not show, so it cannot drift into the last one. |

**Campaign-to-campaign difference rule.** The next campaign changes at least **three of five** among
primary ground, rhyme prop, rhyme colour, cast slate, and light signature, and may not reuse the
previous campaign's primary ground at all.

### 3.1 The grid is 3-wide, so rotation is a 4-beat cycle

The profile shows three tiles per row. Post N sits beside N+1 and N+2 and directly above N+3, so a
naive 3-beat ground rotation stacks one ground down an entire column.

Ground of post *i* = `[primary, secondary, primary, punctuation][i mod 4]`.

4 and 3 are coprime, so horizontal neighbours differ by one beat and vertical neighbours by three,
and no beat of that sequence equals its neighbour at either offset. **No two tiles sharing a ground
ever touch orthogonally**, every column cycles all four beats, and one punctuation tile lands every
fourth post, which satisfies the doctrine's section rhythm for free.

Archetype runs on a **7-beat spine**: metaphor hook (carousel) → product in a private space (§3.4b, never a styled tabletop) → cast
presenting → resource with no product → product macro → cast reacting (carousel) → deniable still.
Over 14 days that is 4 metaphor, 4 scene, 4 cast, 2 resource. `lcm(4,7) = 28`, longer than the
campaign, so ground and archetype never realign: no pairing repeats in the same grid position.

Three things that are easy to get wrong:

- **Only slide 1 of a carousel is in the grid.** Slides 2 onward may break the ground for internal
  contrast. The tile obeys the rotation; the interior obeys the arc.
- **The grid crop is not the feed crop.** Instagram shows profile tiles at 3:4. Generate 4:5, and the
  subject must survive both a 3:4 and a 1:1 centre crop. The rhyme prop may live in the outer band,
  where it is a bonus in feed and not load-bearing in the grid.
- **Same crop signature on every tile.** One repeated framing move is what makes nine unrelated
  subjects read as nine pages of one magazine.

### 3.2 Cast continuity comes from the reference photo, not the prompt

Pin these once per campaign: `castSlug`, the **exact versioned `referencePhotoUrl`**, the wardrobe
register written to *match* that reference, the crop ladder (mid-shot default, one shoulders-up close
per campaign, no full-length unless the reference is), and one light direction.

**Wardrobe has a floor, and it is stricter than the doctrine's.** The design doctrine's hard limit
is "nothing a premium lingerie campaign could not run", which is the right line for owned surfaces.
Instagram is not an owned surface. On a post that also shows a pleasure product, lingerie reads to a
platform classifier as a different kind of post than a linen shirt does, and the account is the thing
at risk. So on Instagram: **everyday or elevated loungewear, a shirt, a knit, a slip dress worn as
outerwear. No lingerie, no bralette as the visible garment, no underwear, no towel, nothing sheer
over skin.** State the garment in the prompt every time, because the model inherits the reference
photo's neckline when you leave it unsaid, and at least one approved cast reference has a deep V.

This exists because nothing else said it. On 2026-08-13 a composite came back in a sheer lace
bralette holding a vibrator, and the pre-publish gate did not flag the wardrobe at all: not because
the gate is weak, but because no binding document contained a wardrobe standard for it to check
against. A rule a reviewer cannot cite is a rule that does not exist.

What breaks identity, in order of how often it happens: swapping the reference mid-campaign; adding
appearance words to the prompt on top of the reference, which competes with the image and drifts the
face; aspect-ratio mismatch between reference and output; and **compositing straight from a Shopify
packshot**, which puts a legible manufacturer carton in the presenter's hand. The two-stage path
exists to kill that class: stage 1 produces an unlabeled product plate, stage 2 composites it. Never
skip the plate. Cap cast at 4 of 14 posts, which the 7-beat spine does automatically, and never run
three or more faces in one campaign.

### 3.3 Carousel arc: six slides

The previously filed four-slide reveal shape (metaphor → cast reaction → product reveal →
anticipation close) is retired. Its middle was all reaction, so nothing was learned and nothing was
saved, and saves are the only metric that survives capped distribution.

1. **Hook.** Metaphor or arresting scene, no product. This is the grid tile.
2. **The question.** The thing people are embarrassed to ask. Typography over a flat campaign plate.
3. **The substance.** The one real thing learned: material, mechanism, care, anatomy. Product macro.
4. **In a life.** Product in a lived-in scene. Presence and anticipation, never use.
5. **Cast beat.** Presenter presenting, product hero. Performance, never testimony. The only
   expensive slide, and it earns its cost by carrying warmth *after* the education lands.
6. **Save close.** The takeaway as a keepable line on the punctuation ground, plus the engagement
   question. Identical template every carousel in the campaign; only the words change.

Five slides is the floor, seven the ceiling. **Three carousels a week, not daily.** Daily triples
cost, halves completion, and turns the save-close template from a signature into a tic. At most one
metaphor slide per carousel and it is always slide 1; the metaphor is never composited into the same
frame as a product; the caption never names it. **No baked-in text on any slide.** Every word is
rendered typography over a clean plate, and a generated word is a defect even when it is spelled
correctly.

### 3.4 Key art is generated as a set, before day 1

This is the operational change that makes campaigns possible. Step 5 of the routine generates at most
one image per draft, decided on that draft's own day. **One image at a time, decided a day at a time,
structurally cannot produce fourteen posts that read as one thing.** A campaign opens with a kickoff
pass that locks the ground, light signature, rhyme prop, and cast reference, and generates the
reusable typography plates, before the first caption is written. Daily runs then draw from that pool
and generate only what the pool is missing.

### 3.4b The interest floor: what makes an image interesting rather than boring

Owner direction 2026-08-11, the third time on this theme: **"The images need to be interesting and
artistic. Evoke emotion and curiosity. Not boring."** and **"we are selling sex toys and pleasure
products. Not housewares."** The two earlier rounds failed because the remedy was adjectives, and
adjectives are not executable. This is the executable version.

**The one line that does the most work: housewares props are evidence of a *household*. We need
evidence of a *person*.** That is the real reason the July 2026 housewares set failed, and it is a
sharper rule than "no mugs."

**The rule.** Every campaign image must exhibit **at least four** of the ten properties below,
**including at least one from the narrative group**. The brief names which properties it is buying,
by number, before generation, and a reviewer rejects on the count by number.

*Narrative group, which is what actually creates curiosity:*

- **P1. Evidence of a person, with no person in frame.** One physical trace only a human could have
  left in the last minute. The trace comes from the **worn, carried, or body-adjacent world** (a robe
  belt, a slip strap, a hair tie, one earring, a key, a shoe, a pushed-aside textile), never the
  kitchen or the spa. That clause is what separates this from prop salad and keeps it clear of the
  houseware ban.
- **P2. Interrupted state.** Something is mid-action and stopped: a drawer half open, a lid off and
  beside rather than removed, a charging cable still connected. **The one-second test:** say what
  happened one second before and one second after. If both answers are "nothing," it fails.
- **P3. The unexplained second object.** Exactly one object the viewer cannot fully account for.
  Two is not mystery, it is clutter.
- **P9. A frame edge that implies a bigger room.** Something enters or exits the crop: a cable
  running out of frame, a curtain edge, a shadow whose caster is off-screen.

*Craft group, which makes it look expensive but on its own creates no curiosity:*

- **P4. A named hour.** Can a reviewer name the hour within two hours from shadow angle and colour?
  "Seamless studio noon" fails by definition.
- **P5. Instability.** Something is not at rest: overhanging an edge, leaning, propped.
- **P6. A load-bearing void.** The empty area *means* something: where the light comes from, where
  the person was. If the answer is "it is for the headline," it is padding and does not count.
- **P7. Scale surprise.** Reads wrong for a beat, resolves on the second look. If the *resemblance*
  is the point, that is metaphor and it is capped separately.
- **P8. One colour doing something wrong on purpose, inside the palette.**
- **P10. Three planes.** Foreground occluder, sharp subject, soft background. Being *behind*
  something makes the viewer feel like they are looking rather than being shown.

**Two tests that run on top of the count.**

- **The story test.** Say in one sentence what happened just before the frame, without naming a
  product feature. If you cannot, and no narrative property is present, it is boring.
- **The withholding test.** Name what the frame makes you want to see that it does not show. If the
  answer is **a body or an act**, it is over the fence and the frame is killed, not softened. If the
  answer is **the person's next move, or the rest of the room**, it is exactly right.

**The unlock that makes this possible without darkness.** High-key constrains shadow **density**, not
shadow **shape**. Drama comes from the edge and angle of a shadow, not from how black it is. A
hard-edged window-mullion shadow raking across a bright plum-soft wall at 8am is dramatic and fully
high-key at once. Related: **the ground lock is a hue lock, not a surface lock.** Nothing requires a
seamless studio backdrop; plum-soft as raw plaster and paper as a bare wall with a light bar across
it are both inside the lock and both carry an hour, a texture, and a room.

**Failure taxonomy. Reject by name.**

| Name | Detection cue | The one change that fixes it |
|---|---|---|
| Catalog-on-a-table | Product whole, at rest, on a horizontal surface. One-second test returns nothing. | Remove the at-rest condition. Put it mid-interruption. |
| Symmetrical-and-centered | Fold the frame vertically and it matches; the shadow falls straight down. | Move light and subject off-axis in opposite directions so the shadow becomes a second subject. |
| Empty-lifestyle prop salad | More than one object you cannot attribute to a specific human action. | Cut to exactly one unexplained object, and make it something a person wore or carried. |
| Stock-photo-neutral | Swap the product for a face cream and nothing changes. | Give it an hour and a wall. |
| Over-styled showroom | Every textile pressed, nothing has obeyed gravity. | One imperfection with a named cause. |
| Negative-space-as-padding | The brief says "clean negative space" and nothing else about that area. | Make the void the light's origin or the vacated spot. |
| Deniability collapse | It is interesting *because* it is suggestive; the withholding test answers "a body." | Kill the frame. Do not soften it. |

**The staging language this replaces.** "Product in a lived-in scene: nightstand, open drawer,
bathroom shelf, bedside table" came from ticket #2213 and was itself the boring failure wearing a
lifestyle costume. Moving a packshot from white seamless onto a nightstand is a lateral move, which
is why the complaint returned twice. **Tableware props are banned outright** (bowls, dishes, cups,
candles, fruit, napkins, folded towels, empty styled tables), matching the ban the homepage, notebook
and content lanes have carried since July 2026 and which the social lane never inherited.

**What interesting costs.** Not money: a narrative frame costs the same single generation as a boring
one. It costs **specification length** (the boring prompt was 46 words; a working one is about 200,
because models default to centered, at-rest, noon and symmetric, and every deviation must be named)
and **variance** (budget roughly 1.5 calls per keeper). The retry rule changes accordingly: **a
second attempt drops exactly one property, never all of them**, and the packshot is the third
resort, never the second. A brief that misses twice must not fall back to the thing this section
exists to prevent.

**Interest is a property of a frame. Variety is a property of the set.** This section does not
license rotating the look mid-campaign. §3's lock still holds: fourteen individually arresting posts
that share nothing look like fourteen strangers in a 3-wide grid.

### 3.5 Directions that are already retired

Do not re-propose these; each one has been tried or ruled out:

- **Sage as a ground.** The doctrine forecloses it, there is no soft sage token, and a sage field
  fights the high-key mandate. Sage is the heart and the tag colour.
- **Dark, moody, candlelit "intimacy".** Failed on the homepage in July, reads porn-adjacent to a
  platform reviewer, and looks cheap at 375px. Charge comes from daylight and confidence.
- **A campaign built on metaphor.** Produce innuendo is licensed at one slide per carousel, as a
  hook, on the fence of deniability. A campaign of figs and peaches is the emoji-anatomy vocabulary
  the charter bans in words, rendered in pixels. Metaphor is a door, never a room.
- **The doctrine's surreal brand art (archetype E) on Instagram.** Licensed for owned surfaces only,
  precisely because euphemistic sexual imagery is what moderation removes.
- **A campaign that is a product rotation with a hashtag.** Fourteen posts each featuring a different
  SKU is a catalog, and a catalog is what Meta's Restricted Goods standard removes. The campaign's
  subject is the idea; products are examples inside it.
- **Pretty filler.** Non-product content is first-class, and first-class means it teaches something.

### 3.6 Owner ruling: what may be in a hand

**RULED 2026-08-12. The cast holds the product itself.** Owner direction, verbatim: *"Put the
products in a cast members hand. Have them show the product."*

That supersedes the interim reading this section previously carried ("an unlabeled carton in hand,
yes; bare product in hand, no"), which was written explicitly to hold until the owner ruled. He
ruled. A cast member may hold and present the bare product.

Recorded here because the delay already cost something. The ruling was given on 2026-08-12 and not
written down, and on 2026-08-13 the pre-publish gate blocked two compliant cast composites by
correctly applying the superseded reading. The gate was right; the document was stale. Owner
direction that does not reach the binding document has not landed.

**What is unchanged, and is not what this ruling was about:**

- No simulated or implied use. Presenting a product is not using it.
- The product is not on or against a body. In a hand, held out or held up, is the licensed shape.
- No fluid or lubricant texture, no bed with a person in it, nothing explicit.
- Cast reactions stay performance, never testimony. No persona claims to have used anything.
- Stage 1 of the composite still strips packaging, so a manufacturer carton never reaches a
  presenter's hand. That was never about the hand rule; it is the no-text-in-pixels rule, and it
  still binds.

**One conflict remains open and is not resolved by this section.** `docs/ads-policy.md` §Organic
social still lists "no product in hand or on a body" as an Instagram hard limit. That line is this
store's own conservative fence rather than a quotation of Meta policy, which removes for *commerce*
and for explicit content; brands in this category routinely show product in hand. But `ads-policy.md`
sits outside this file's authority and outside the `agent-editor` allowlist, so it needs its own
change. Until it is amended, a gate reading both documents will find them in conflict. **This
section is the operative one for Instagram cast imagery**, and a gate that blocks on the ads-policy
line alone should say so and escalate rather than silently kill the frame.

## 4. Cadence and continuity

**Cadence is context-driven, never a fixed ramp** (owner revision 2026-08-08, superseding the
original ramp).

- **Baseline: at least one Instagram post every day. No zero days.**
- Scale to **2 to 4 per day** on weeks with something real happening: an aisle or drop going live, a
  featured-brand week, a `marketing_calendar` promo, or an adopted trend brief.
- **10 per day is a hard ceiling** for an exceptional moment, never a target.
- **Any post removal steps volume down one level immediately** and ends the campaign, per
  `docs/ads-policy.md` escalation. Volume is earned back by a clean stretch, not by waiting.

**Continuity is a runway rule, not a hope.** The named failure is real and already happened:
"August Reset, Emma's Way" sat at `planned` from 2026-08-01, never activated, never closed.

At Step 2 of every social run:

1. **Activate.** If no `marketing_calendar` campaign row is `active` for today and a `planned` row's
   `event_date` is on or before today, promote it to `active`.
2. **Close.** If the active campaign's `ends` date (§5) has passed, mark it `done` and activate the
   successor in the same pass. There is never a day with no active campaign.
3. **Check the runway.** The schedule in §5 must always hold **at least four weeks of future
   campaigns**. When it holds less, file a suggestion to `store-strategist` (kind `strategy`,
   `targetTeam:'strategy'`) asking for the next block. Do not invent campaign N+1 unilaterally: the
   social team owns execution inside a campaign, `store-strategist` owns which story the store is
   telling this month. That boundary is deliberate.
4. **Report honestly.** If the runway is short and a suggestion is already open, say so in the run
   summary rather than filing a duplicate.

## 5. The schedule

**The Instagram track is parallel to the homepage theme week, not the same campaign.** Three real
mismatches make sharing one row wrong: the homepage turns over weekly on a Monday changeover while an
Instagram arc wants 11 to 14 days; a homepage theme must resolve to a hero SKU while an arc like "The
Orgasm Gap, Closed" has no single hero and should not be forced to find one; and the homepage runs the
desire-forward register at 9 while Instagram runs at 4-5 with no sale attempt at all. Tying them
together would either water down the homepage or push homepage-register copy into a caption, which is
exactly what gets a post pulled. Where the windows overlap, the two channels reinforce each other
through the coordination note below, never by sharing a row.

Working titles. Every caption still goes through the voice gate; a name here is a subject, not copy.

| Window | Campaign | Kind | Subject | Coordination |
|---|---|---|---|---|
| 2026-08-12 → 08-24 (13d) | **The Vibrator Field Guide** | category | Vibrators, air-pulsation, wands: how each mechanism actually differs, which style suits which body, care and cleaning. | Hands into the homepage's Wand Week at the tail (08-24). |
| 2026-08-25 → 09-06 (13d) | **Talk Yourself Into It** | live-better | Communication, consent, checking in, asking for what you want as a learnable skill. | Echoes the homepage's "Start Here, No Wrong Answers" (08-31). |
| 2026-09-07 → 09-19 (13d) | **Lube, Actually** | category | Water, silicone, hybrid. Body-safe materials, what degrades what, why the right one changes everything. | Coincides with the homepage's "The Long Weekend In" (09-07). |
| 2026-09-20 → 10-02 (13d) | **The Orgasm Gap, Closed** | live-better | Clitoral anatomy, foreplay, why partnered pleasure is unequal by default and what changes it. Education and inspiration, no single hero SKU. | Standalone. |
| 2026-10-03 → 10-15 (13d) | **Prostate 101** | category | Prostate massagers, anal-safe materials, prep. An under-discussed category treated plainly. | Standalone. |
| 2026-10-16 → 10-29 (14d) | **Spooky Season, Sensory Play** | seasonal | Temperature play, texture, blindfolds, sensory deprivation. Halloween-adjacent without costume gimmicks. | Standalone. |
| 2026-10-30 → 11-09 (11d) | **Aftercare Is Not Optional** | live-better | Aftercare as a practice, post-play communication, self-care. Closes into cuffing season. | Standalone. |

Category and live-better campaigns alternate deliberately: a feed that is only product education
becomes a catalog, and a feed that is only advice has nothing to sell when someone is ready to buy.

**Calendar rows.** Each campaign's start date gets a `marketing_calendar` row via
`POST /api/team/calendar {op:'propose', eventDate:<starts>, name:<name>, type:'campaign', theme:<subject>}`,
landing at `planned`. The `propose` op does not currently accept `assetsJson`, so **this file is the
authority for `ends`, pillars, formats, and product scope**; the calendar row carries the name, the
start date, and the status.

**Instagram rows are named with an `IG: ` prefix.** The table has no channel column and the homepage
track shares it, so the prefix is how the two are told apart at a glance and in a query. `IG: Wand
Week` is the Instagram campaign; `Wand Week` is the homepage theme week. The social routine reconciles
only prefixed rows and never touches a homepage row. All seven campaigns above are live as `planned`
rows (calendar ids 22 through 28), so the runway is unbroken through 2026-11-09.

**Status reconciliation is a daily duty, not a Monday one.** "August Reset, Emma's Way" was proposed
for 2026-08-01, a Saturday, and sat at `planned` forever because the only thing that reconciles
calendar status is the homepage Monday changeover, and a non-Monday row never gets picked up. The
activate/close pass in §4 is pure date arithmetic with no editorial judgment in it, so the social
routine runs it every day, unconditionally. That redundancy is the fix: even if a Monday run is
skipped, the next daily social run closes the stale row.

## 6. What a campaign does NOT license

A campaign is a subject and a look. It changes nothing about what may ship. Stated explicitly
because a named campaign is exactly the thing that tempts a routine to make an exception:

- **Step 4b platform-policy gate is unchanged.** "Wand Week" is not permission to sell wands. No
  price, no discount, no promo code, no shop CTA, no PDP link in an Instagram caption. The commerce
  path stays post → profile → link in bio → site.
- **Step 4a voice gate is unchanged.** Every draft still passes `emma-empathy-reviewer` against the
  social addendum. A campaign arc never justifies a register the charter does not license.
- **Step 2.6 stock gate is unchanged.** A campaign's `product_scope` is a rule so an out-of-stock
  product is swapped, not featured. The 2026-08-09 deleted post is the reason this is a rule.
- **Step 2b backlog throttle is unchanged.** A campaign does not out-rank an unreviewed queue. When
  the throttle is active, the campaign continues at reduced volume and the run summary says so.
- **Fresh language every time.** A campaign repeats a *subject*, never a sentence. Any phrase that
  appeared in a previous post of the same campaign is spent.
- **"The next campaign begins" means drafted, not published, until autopublish ships.** Publishing an
  Instagram post is an owner action in the Social Studio today. A campaign can be fully drafted and
  still invisible if nothing is published. The run summary reports both numbers and never conflates
  them. The owner directed on 2026-08-11 that he will not be the bottleneck; the posture that
  replaces his click, and the four things that must exist first, are in
  `routine-social-daily.md` §Posting posture. **Autopublish changes who approves a post. It changes
  no gate, and no gate may be relaxed to make it easier to ship.**

## 7. What this needs that does not exist yet

Recorded so no run pretends otherwise, and so the gap is visible rather than quietly absorbed.

- **There is no social image-generation path.** `scripts/gen-homepage-image.ts` and
  `scripts/gen-notebook-art.ts` exist; there is no social equivalent, and nothing in the codebase
  emits a `social-` image spend feature. The consequence is already live: the two posts that shipped
  2026-08-09 carried real generated art, and every Instagram draft written since carries a bare
  Nalpac SKU packshot (`77808A.jpg`, `77292A.jpg`, `96177A.jpg`), precisely the packshot-only still
  the charter retired that same day. **The team is shipping non-compliant imagery because packshots
  are the only image path it has.** Until a generation path exists, the visual scheme in §3 is
  aspirational and every run that falls back to a packshot says so in its summary.
- **`social_team_max_images` is inert.** `getTeamConfigUncached` assigns `maxImagesPerDay` only for
  the homepage and content teams, the cap is enforced only for homepage, and the day's image count is
  read against a hardcoded `homepage-images` feature. Setting the key changes nothing without a code
  edit. The dollar cap is the only control that actually works today.
- **Cost is not the constraint.** At measured rates the owner's ask runs about $4.40/month at one post
  a day and about $13.40/month at four, against a hard ceiling near $31/month at the 10/day ceiling.
  The $5/day cap is not sized for a campaign kickoff burst, but the number was never the problem.
- **Publishing is a manual click, and the owner has directed that it stop being one.** Four things do
  not exist yet and all four gate the change: (a) the social image path above; (b) an **independent
  pre-publish gate** that writes `approved`, since nothing but the owner's click writes it today and
  a publish job would otherwise find nothing to publish; (c) a publish job with a publish-time stock
  re-check, an image-provenance check, a daily publish cap independent of the drafting quota, and its
  own kill switch; (d) a way for the owner to leave feedback on a **posted** row.
- **The owner cannot give feedback on a live post.** `reviewSocialPost` carries
  `ne(socialPosts.status, 'posted')`, so the admin review action refuses any posted row. The loop the
  owner described on 2026-08-11, review live and feed it back to the team, is not buildable in the
  current UI. This is the single blocking gap on his stated plan.
- **No engagement is captured.** `social_posts` has no metrics column and nothing reads Instagram
  insights, so "which posts worked" is unanswerable. `video_jobs.metrics_json` plus its owner
  self-report merge is the existing precedent to mirror. Adding the column is a migration, so it is a
  protected path and an owner merge.

## 8. Brand tagging

Tag a maker only from a **verified** handle. `docs/store-team/brand-ig-handles.json` is the registry
named by the charter; it does not exist yet and `.json` sits outside the `agent-editor` allowlist, so
until it is created by a code ticket the rule is simple: **no verified registry, no tag.** Never guess
a handle. A wrong tag is worse than no tag.
