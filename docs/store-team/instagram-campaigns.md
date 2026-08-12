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
| Brand Crush | One maker, why their engineering is interesting. Tag the verified handle only (§6). |
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

Archetype runs on a **7-beat spine**: metaphor hook (carousel) → product in a lived-in scene → cast
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

### 3.6 Open ruling: what may be in a hand

`docs/ads-policy.md` §Organic social lists "no product in hand or on a body" as an Instagram hard
limit. The charter's License C licenses cast to "hold the box, present, and react." The reconcilable
reading, and the one this file operates under until the owner rules otherwise, is: **an unlabeled
carton in hand, yes; bare product in hand, no.** The carton must be unlabeled because a real carton
carries a manufacturer logo, which is text in pixels. Slide 5 above is written to that reading, and it
is load-bearing for 4 of every 14 posts.

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
- **"The next campaign begins" means drafted, not published.** Publishing an Instagram post is an
  owner action in the Social Studio. A campaign can be fully drafted and still invisible if the
  review queue is not cleared. The run summary reports both numbers, never conflates them.

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
- **Publishing is a manual click.** A campaign can be fully drafted and completely invisible. See §6.

## 8. Brand tagging

Tag a maker only from a **verified** handle. `docs/store-team/brand-ig-handles.json` is the registry
named by the charter; it does not exist yet and `.json` sits outside the `agent-editor` allowlist, so
until it is created by a code ticket the rule is simple: **no verified registry, no tag.** Never guess
a handle. A wrong tag is worse than no tag.
