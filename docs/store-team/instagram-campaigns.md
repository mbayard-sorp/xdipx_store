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
| `product_scope` | A **rule**, not a frozen SKU list, so the Step 2.6 stock gate can swap a product without breaking the campaign ("in-stock, ACTIVE, product_type_dial = wand"). Catalog approval status is never part of a `product_scope` rule; see `routine-social-daily.md` Step 2.7. |
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
| Field Notes | Advice slides, no product in frame at all. Toy advice or plain sex advice, the thing a reader would otherwise search for. The resource format (§4a). |
| Today's Pick | One in-stock product, presented by a cast member. Editorial, never an offer: see §4b for what may and may not be said about its price. |

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
| `cropSignature` | One repeated framing move (subject on the right third, air left) so slide-1 tiles stack. **Flip-tolerant by definition (ticket #3526):** the generator reversed a locked left/right composition on 3 of 3 attempts in the first end-to-end publish run, and the fix that worked was a post-hoc horizontal flip, not a regeneration. A mirror-image candidate satisfies the signature; Step 5 flip-corrects it as a routine post-pass before offering it, rather than burning generations chasing handedness the model structurally cannot hold. A lock the generator cannot hit is a lock that stops posts. |
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

**Wardrobe: loungewear and lingerie-as-outerwear are both licensed (owner ruling 2026-08-13).**

This section previously carried a stricter floor that I wrote on 2026-08-13 and that banned lingerie
and bralettes outright. The owner reviewed a frame in a lace bralette the same day and ruled it
"really good", selecting it as the campaign's reference look. His call, his account, and the ban is
withdrawn rather than left on the books for a rule his own reference image breaks.

What is licensed: everyday and elevated loungewear, a shirt, a knit, a slip dress, and lingerie or a
bralette worn as the visible garment, in the relaxed at-home register the cast references already
establish.

### 3.2a The ceiling (owner ruling 2026-08-16)

Owner direction, verbatim: *"I want to make sure we are at the limit of what we can produce that is
sexually charged for posts. This is for marketing, it's not making pornography, that is not the goal.
This is to inspire better sexual wellness and exploration."*

This section replaces a stack of prohibitions that were written conservatively, one at a time, and
that together produced the failure the owner named three times: boring frames. It is deliberately a
**specification rather than a list of bans**, because "be sexier" is not executable and a brief that
cannot be executed produces the timid frame every time.

**Licensed at the ceiling:**

- **Wardrobe and skin.** Lingerie as the visible garment. Bare back, stomach, legs, shoulders,
  cleavage. Fabric is opaque.
- **Beds and posture.** On or in a bed. Arched, prone, tangled in sheets, gripping fabric. Aftermath
  and anticipation are both licensed: the quiet after, the reach toward, the unopened box.
- **Product against a body.** The product may touch or rest on skin: collarbone, sternum, stomach,
  thigh, hip, the inside of a wrist. This is the single biggest unlock in this ruling and it is where
  the tactile charge actually lives.
- **Lubricant texture.** On hands, on fingers, stretched between them, beading on silicone.
- **Two people.** Both in frame, touching. Hands on waist, hip, thigh, back, face.
- **Expression.** Eyes closed, head back, parted lips. Arousal reads on a face at zero policy cost
  and it is the cheapest charge available to us. We have never once used it.
- **Implication.** Use may be implied by context, framing and caption. Occlusion under a sheet is
  licensed **when the occluded shape is the product**.

**The ceiling stops here, and these do not move:**

- Genitalia or nipples visible or outlined, sheer fabric included.
- Hands on genitals, over or under clothing.
- A depicted or discernible sex act.
- Fluid on or near genitalia.
- Product against genitalia.
- Anything age-ambiguous. Judged on ambiguity, not intent.
- Anything built to defeat a classifier. Evasion risks the account, not the post.

Cast reactions stay performance, never testimony: the register got hotter, the no-lived-experience
rule did not move.

### 3.2b The ceiling is a target for the set, not for every frame

Owner-agreed 2026-08-16, and it is a **merchandising rule before it is a safety one**. A feed that is
all ceiling has no ceiling. Contrast is what stops a thumb, the charged frame lands hardest beside a
restrained one, and fourteen maximally charged tiles read as a porn account to a human and to a
reviewer alike, which is the reading that gets an account actioned rather than a post.

Per 7 posts: **roughly 2 at the ceiling, 3 mid, 2 educational.** Same aggregate charge, sharper
peaks, and one bad classifier day costs a post instead of the channel. Do not round every frame up.
Decide which two are the ceiling frames when the campaign's key art is planned (§3.4), not on the day.

**These ratios are per rolling 7 posts, not per campaign** (re-based 2026-08-16, owner direction to
raise volume). They were written when a campaign was 13 or 14 posts because one post a day made
those the same number. At 3 or 4 posts a day a 13-day campaign is 39 to 56 posts, and a cap written
"4 of 14 per campaign" silently stops meaning anything. So read every proportion in this document as
a **rolling window over the most recent posts**, never as a per-campaign total:

- **Charge:** roughly 2 ceiling, 3 mid, 2 educational per rolling 7.
- **Cast:** at most 4 cast frames per rolling 14, and never more than one cast frame in a single
  day. Still never three or more faces in one campaign; that one is about identity, not frequency,
  and it does not re-base.
- **Product-forward:** at most half of any single day's set, per `mission-brief.md` §6b.

**State the garment in every prompt regardless.** Not a restriction, a fidelity rule: the model
inherits the reference photo's neckline when you leave it unsaid, so an unstated wardrobe is an
accidental one rather than a chosen one. At least one approved cast reference has a deep V, and the
2026-08-13 bralette was not asked for by the brief that produced it.

**"Desire-forward" means the picture here, not the caption.** Owner direction 2026-08-16 asked for
posts that are *"desire forward and product highlighting"*, and that phrase carries a specific
meaning in `docs/emma-voice.md`: the intensity-9 register the store runs on owned channels. It does
not travel to this platform, and the split is not squeamishness, it is which half of a post each
rule governs.

- **Imagery: yes, and we are under-using the licence we already have.** Everything in §3.2a is
  available: a bed, a body, product against skin, lubricant texture, two people touching, arousal on
  a face, implied use. The ceiling frames are the desire-forward ones, they are 2 of every 7 by
  §3.2b, and they are chosen when the key art is planned rather than discovered on the day. A set
  with no ceiling frame in it has quietly ignored this section.
- **Caption: stays at register 4-5.** `docs/ads-policy.md` §Organic social and Step 4b question 2
  both bar describing what a product does to a body, and the social addendum sets the register.
  Platform policy outranks the charter on a rented surface, so this one cannot be traded for reach.
  A register-9 line under a ceiling frame is what turns a compliant post into a removed one.

The practical version: **let the image carry the desire and let the caption carry the reason.** That
combination is fully licensed, it is what the owner asked for, and it is not what the account has
been shipping.

**Honest note on what this costs.** Lingerie plus a pleasure product in one frame is a stronger
signal to Meta's classifier than either alone. That is a real increase in account exposure, taken
deliberately by the owner rather than drifted into. It makes the removal watcher (ticket #2741) and
the step-down ladder in `docs/ads-policy.md` more load-bearing, not less: the first removal on a
lingerie frame is the signal that this latitude was priced wrong, and it should step volume down and
reach the owner rather than be absorbed quietly.

What breaks identity, in order of how often it happens: swapping the reference mid-campaign; adding
appearance words to the prompt on top of the reference, which competes with the image and drifts the
face; aspect-ratio mismatch between reference and output; and **compositing straight from a Shopify
packshot**, which puts a legible manufacturer carton in the presenter's hand. The two-stage path
exists to kill that class: stage 1 produces an unlabeled product plate, stage 2 composites it. Never
skip the plate. Cap cast per the rolling window in §3.2b (at most 4 cast frames per rolling 14, and
never more than one in a day), and never run three or more faces in one campaign. This used to read
"4 of 14 posts, which the 7-beat spine does automatically", which was true only while a campaign was
14 posts long; at a multi-post slate the spine no longer does it for you and the window is the rule.

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

**Four slides is the floor, seven the ceiling** (floor lowered from five on 2026-08-16, owner
direction: *"4-5 panel slides with messages and images"*). At four, drop slides 4 and 5 and keep
hook, question, substance, save close: the education and the save are the load-bearing pair, and the
in-a-life and cast beats are the ones worth losing when a subject is tight. Never cut the substance
slide to hit the floor, because a carousel with nothing learned in it is the shape that gets scrolled.

**Up to 5 carousels a week, never two days running** (raised from three on 2026-08-16 to serve the
advice lane in §4a). The reason for the old cap has not gone away: more carousels cost more, halve
completion, and turn the save-close template from a signature into a tic. Rotate the save-close
plate every campaign, and if saves or completion fall, drop back to three and say so in the run
summary. At most one
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

**Moved verbatim to `docs/design-doctrine.md` §4.1, which is canonical** (ticket #2756, owner
direction 2026-08-11: "The images need to be interesting and artistic. Evoke emotion and
curiosity. Not boring." / "we are selling sex toys and pleasure products. Not housewares.").
The doctrine wins on pixels, so the floor now binds every imagery surface and `media-manager`'s
vision gate, not only this routine; this doc points at it instead of carrying its own copy so
the two cannot drift. Everything this section defined lives there unchanged and every reference
to it in this file still resolves through the doctrine: the ten checkable properties (P1-P10;
four required, at least one from the narrative group, named by number in the brief), the
one-second/story/withholding tests, the shadow-density and hue-lock-not-surface-lock unlocks,
the seven-name failure taxonomy, the tableware ban, the ~200-word specification cost and the
drop-exactly-one-property retry rule. §3's lock still holds on top of it: interest is a property
of a frame, variety is a property of the set, and nothing in the floor licenses rotating the
look mid-campaign.

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

**That conflict is now closed.** `docs/ads-policy.md` §Organic social carried "no product in hand or
on a body" as an Instagram hard limit for four days after the 2026-08-12 hand ruling contradicted it,
and the pre-publish gate had to reason around the contradiction on every run (it did so explicitly on
the PASS that shipped post 47). The line was withdrawn by owner ruling 2026-08-16 and that row now
points at §3.2a, which is the single operative rule for Instagram imagery. Product in hand and
product against skin are both licensed; the fence moved to genitalia, hands on genitals, and
depicted acts.

## 4. Cadence and continuity

**Cadence is context-driven, never a fixed ramp** (owner revision 2026-08-08, superseding the
original ramp).

**Owner direction 2026-08-16, verbatim:** *"I can't emphasize enough that I want the team to have a
lot of activity on socials. I want the team to act as though they are our advertising and public
messaging team. I want us to be noisy on Instagram."* Volume is no longer an exceptional-week
posture. It is the standing one, and the sections below are re-based for it.

- **Baseline: at least one Instagram post every day. No zero days.**
- **Target: the full daily slate in §4a**, sized by `social_freq_instagram`. Every post in the slate
  is a real editorial unit, not filler; a thin fourth post is worse than three good ones.
- **10 per day is a hard ceiling** for an exceptional moment, never a target.
- **The owner set the starting rung at 3 on 2026-08-16.** `social_freq_instagram` was moved from 1
  to 3 and `instagram_publish_max_per_day` from unset (3 by default) to 4, both audited to `owner`
  from source `all-hands:2026-08-16`. Read the live values, never this sentence; it records where
  the ladder starts, not where it is.
- **Above that, volume is earned in steps, and the ladder only climbs on a clean stretch.** Move up
  one post per day at a time, and only after **7 consecutive clean days**: no removal, no post
  deleted, no gate BLOCK on anything that shipped, no owner correction on a live post. This is the
  mirror of the step-down that already exists, and it exists for the same reason: the account is
  rented. Say in every run summary which rung you are on and how many clean days are behind it.
- **The publish cap sits one above the drafting quota on purpose.** Reworks and video fan-outs
  compete for the same publish slots, so a cap equal to the quota strands the extra row for a day.
  If the quota rises, raise the cap with it.
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

## 4a. The daily slate

Owner direction 2026-08-16: *"I want different types of posts. Some can only be slides with sex
advice or toy advice, they don't only need to be product focused. We need to be a resource for our
potential customers."*

The campaign supplies the subject and the look. The slate supplies the **shape of a day**, so volume
arrives as a mix rather than as more of whatever the rotation happened to land on. Fill slots in
order and stop when `social_freq_instagram` is met: at 1 a day you post slot A only, at 4 you post
A through D.

| Slot | Lane | Formats | Product in frame |
|---|---|---|---|
| **A** | **Resource.** The advice post, and the reason a non-buyer follows us. | Field Notes, Ask Emma, Inspo Carousel | **No** |
| **B** | **Campaign.** The active campaign's next beat, on its pillar and format rotation. | any campaign format | Usually |
| **C** | **Today's Pick.** One in-stock product presented by a cast member (§4b). | Today's Pick | Yes |
| **D** | **What's new.** A Notebook promo when one is queued, else Brand Crush, This Week at xdipx, or Trend React. | those four | No |
| **E** | **Carousel**, on the days a carousel is scheduled. | Inspo Carousel, Field Notes | Either |

Rules that survive the slate, because they are what keep it a publication:

- **At most half of a day's set is product-forward** (`mission-brief.md` §6b). At 4 posts that is B
  and C, and it is a ceiling, not a quota.
- **Slot A ships every day, including a one-post day.** If only one post goes out, it is the
  resource post, not the product post. A feed that drops advice first under pressure is a catalog
  that has not noticed yet.
- **The rotation rule still binds inside a day.** Never two consecutive posts from the same pillar
  or in the same format, and consecutive means across the day boundary too.
- **Mix the shapes, not just the subjects.** A week that is all single stills is as monotonous as a
  week that is all carousels. Carousel cadence and slide count live in §3.3: 4 slides floor, 7
  ceiling, up to 5 a week, never two days running.
- **The format library in §2 is a starting set, not a fence.** Owner direction 2026-08-16: *"I'm
  giving the team license to create any type of post they think will be the most effective at
  creating engagement and interest for our customers."* Invent a format when you have a real reason
  to, name it in the run summary so it can be adopted or dropped on evidence, and understand exactly
  what the licence does and does not cover: it frees the **shape** of a post, never a gate. A new
  format still clears Step 4a voice, Step 4b platform policy, Step 2.6 stock, the §3.2a imagery
  ceiling, and the §3.4b interest floor. Anything genuinely new that keeps working belongs in §2, so
  file it rather than leaving it as one run's improvisation.

## 4b. Today's Pick, and the thing that cannot go in the caption

Owner direction 2026-08-16, verbatim: *"We also need to post when we have deals. Most every
competitor sells products with a percentage of savings. I would like the /all-hands team to pick a
product every day that is a high percentage off and post about it. I would expect the posts to show
the product with a cast member."*

**The cast-plus-product half is licensed and is now a daily slot.** §3.6 already lets a cast member
hold and present the bare product, so slot C is exactly that, every day, on the campaign's locked
scheme.

**The percentage cannot go in the post, and this is not a style preference.** Three binding
documents and one piece of running code all say the same thing. `docs/ads-policy.md` §Organic
social: *"No sale attempt in the post (no price, discount, promo code, or shop CTA)."* §6 of this
file repeats it. The social addendum in `docs/emma-voice.md` repeats it again. And
`runDeterministicPublishChecks` in `app/lib/social-publish-gate.server.ts` enforces it mechanically
with `block`-severity checks named `sale-price`, `sale-discount`, `sale-promo-code`, `sale-cta` and
`sale-pdp-link`; a `block` finding is final and no agent may overturn one. A caption reading "40%
off" does not get argued about, it fails at the gate every single time.

The reason behind the rule is worth carrying, because it is not squeamishness. Meta's Restricted
Goods standard removes organic content that attempts to sell adult products, enforcement is
account-level and retroactive, and a recurring daily deal format is precisely the repeated pattern
that enforcement is built to catch. A percentage is the clearest sell signal available to us.

**So the value lives one tap away, and the post carries the reason to take that tap:**

- **In the post:** why this specific product is worth owning. Mechanism, material, build, who it
  suits. Value as *quality*, which the charter's ownership register already licenses.
- **On the profile:** the bio link, at most once a day, as a plain sentence and never as a closing
  line.
- **On `xdipx.com/social`:** the day's pick, with its real price. Keeping that landing page in sync
  is already a daily duty in `routine-social-daily.md` Step 4c, and it is now the load-bearing half
  of this lane rather than housekeeping.
- **On X, in email, in SMS, and on the site:** the number itself, freely. X's organic policy permits
  commerce and the PDP link, and the owned channels are where a real offer belongs.

**Picking the product. Three filters, in this order, and none of them are optional.**

1. **In the campaign's `product_scope`.** A lube markdown in the middle of the Vibrator Field Guide
   is how a campaign turns into a product rotation with a hashtag, which §3.5 retired by name.
2. **Instagram-eligible by category.** Never a dildo, never an anatomically realistic product. This
   filter runs at *selection*, before any image is generated, and it matters most here: a deeply
   discounted, slow-moving SKU is disproportionately likely to be exactly the excluded category.
   Post #49 is what skipping it looks like.
3. **In stock and ACTIVE**, per the Step 2.6 stock gate, and **not posted in the last 30 days**.

**Say "our price against list", never "today's markdown".** This is an honesty rule and it is
specific to how this store prices. The pricing engine writes `compare_at = msrp` on every product
whose target-margin price lands under list, so **about 94% of the in-stock catalog shows a
compare-at discount permanently**, roughly 1,000 products at 30% or more. Those percentages are
real, and they are also the same tomorrow. Framing a permanent price relationship as a dated event
is discount theatre, it is the fabricated-occasion cousin of the fabricated proof the design
doctrine bans, and it collides with the charter's no-urgency rule. A genuine, dated, bounded deal is
a different thing and it does exist: `promo-manager` proposes them, the owner approves them, and
`scripts/execute-approved-promos.ts` mints them once `promo_execute_enabled` is on. When a real
promo is live, **that** is a deal and the calendar knows its window.

**MAP is a per-pick check, not an assumption.** 1,639 products carry `map_price == original_price`,
which permits no discount framing anywhere, and the general product cards do not check MAP at all,
so the grid is not a safe place to shop for a pick. Run `mapAllowsAdvertisedDiscount()` against the
live metafields for the chosen product before any value framing goes anywhere, including the bio
link and the `/social` page.

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

### The Vibrator Field Guide, locked scheme (owner-approved 2026-08-13)

Locked per §3: decided once, before the run, and never re-decided mid-campaign. The owner selected
the look on 2026-08-13 and confirmed its proportion. Reference frame:
`social-femmefunn-ultra-bullet-massager-rechargeable-silicone-vibrator-pink-cast-priya-true-scale-20260813-1.jpg`.

| Field | Locked value |
|---|---|
| `groundSet` | Primary coral-soft blush plaster. Secondary plum-soft. Punctuation paper. |
| `lightSignature` | Late-morning sun from a window **out of frame, upper right**, throwing one hard-edged diagonal band down the wall. Open, detailed shadows; never black. The caster stays off-frame, which is what makes it P9 rather than a body shadow. |
| `rhymeProp` | A thin dark elastic hair tie on the wrist. |
| `rhymeColor` | The product's saturated magenta against the coral ground. |
| `surfaceMaterial` | Textured plaster wall. |
| `castSlate` | `priya`, reference `https://cdn.sanity.io/images/0nlwk8cf/production/46d6016c81db7a1725425af6f72231786845cb32-576x1024.jpg`. Pin this exact URL; a re-upload changes the person. |
| `wardrobeRegister` | Soft pink lace bralette with fine straps plus matching pyjama shorts, relaxed at-home loungewear. Licensed by the 2026-08-13 ruling in §3.2. **State it in every prompt**, and state the coverage, not just the garment name: "lace bralette" alone spans a wide range and the model will pick from it. |
| `cropSignature` | Three-quarter to camera, waist-up, subject left of centre with the light and the open wall to her right. Flip-tolerant per §3: a mirrored candidate is compliant once flip-corrected in the Step 5 post-pass. |
| `productScale` | Derived from `xdipx.specifications`, never from a preset. See below. |
| `retiredForCampaign` | Styled tabletops, packshots, centred symmetrical framing, anything the model invents in place of the real SKU. |

**Scale is a lookup, not a judgment.** Read the length from the product's `xdipx.specifications`
metafield and let `scaleCueFromLengthInches()` build the cue. Guessing a preset is what produced the
defect: a 4.7-inch bullet briefed as `palm` ("no taller than her palm is wide", about 3.5 inches)
gave the model a cue contradicting its own reference photo, and it resolved that contradiction
differently on every candidate.

**Known drift, so a run is not reported as clean when it is not.** Two candidates from one stage-2
call can still disagree on size even with a correct cue: on 2026-08-13 one was right and one was
oversized. Shape is stable once the packshot is passed as a second reference; size is not yet.
Check every candidate against the real packshot before offering it, and expect to discard some.

**Calendar rows.** Each campaign's start date gets a `marketing_calendar` row via
`POST /api/team/calendar {op:'propose', eventDate:<starts>, name:<name>, type:'campaign', theme:<subject>}`,
landing at `planned`. Since ticket #2736 the `propose` op accepts an optional `assetsJson` object
(endDate, pillars, formats, product_scope, visualScheme), so a campaign row can carry its own
structured window and scope. **For rows proposed without `assetsJson`, this file remains the
authority for `ends`, pillars, formats, and product scope**; the calendar row carries the name, the
start date, and the status. `scripts/pick-todays-product.ts` reads `assetsJson.product_scope`
(shape `{ "dials": ["vibrator", ...] }`) when present and falls back to its mirror of the §5 table.

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
- **Drafted and published stay two different numbers.** A campaign can be fully drafted and still
  invisible, which is exactly what happens whenever `instagram_autopublish_enabled` is off or the
  daily publish cap is spent. The run summary reports both and never conflates them. The posture that
  replaced the owner's click is in `routine-social-daily.md` §Posting posture. **Autopublish changed
  who approves a post. It changed no gate, and no gate may be relaxed to make it easier to ship.**

## 7. What this needs that does not exist yet

Recorded so no run pretends otherwise, and so the gap is visible rather than quietly absorbed.

- **The social image path now exists and the routine uses it.** `scripts/gen-social-image.ts`
  generates, rehosts to Shopify Files, and logs spend, with a cast-composite form and a
  single-reference form. This section previously said no such path existed, which was true when it
  was written and stale within two days. Verified live 2026-08-14: a routine run generated a
  compliant product-free frame on the locked scheme, discarded a first candidate that drifted from
  the light signature, and passed the pre-publish gate with zero findings.
- **`social_team_max_images` is inert.** `getTeamConfigUncached` assigns `maxImagesPerDay` only for
  the homepage and content teams, the cap is enforced only for homepage, and the day's image count is
  read against a hardcoded `homepage-images` feature. Setting the key changes nothing without a code
  edit. The dollar cap is the only control that actually works today.
- **Cost is not the constraint.** At measured rates the owner's ask runs about $4.40/month at one post
  a day and about $13.40/month at four, against a hard ceiling near $31/month at the 10/day ceiling.
  The $5/day cap is not sized for a campaign kickoff burst, but the number was never the problem.
- **Publishing no longer requires the owner's click.** All four things this section listed as
  missing now exist: the social image path above; the **independent pre-publish gate**, which is the
  only writer of `approved` and runs at Step 6.5 of the social routine; the publish job
  (`/cron/social-publish`, hourly) with its publish-time stock re-check, image-provenance check,
  daily cap, and its own kill switch; and the owner's feedback path on a **posted** row. What decides
  whether posts actually go out is now one valve, `instagram_autopublish_enabled`, on the Social tab
  of `/admin/homepage-team`. Read it, never assume it: a run that reports posts as published when the
  valve is off is worse than one that reports nothing.
- **`approved` alone is not a licence to publish.** The publish job refuses any row without a gate
  PASS stamp in its `feedback`, including one the owner approved by hand. A row reported as
  `no_gate_verdict` is a row nothing adversarial has read; it goes back through the gate, never
  around it.
- **No engagement is captured.** `social_posts` has no metrics column and nothing reads Instagram
  insights, so "which posts worked" is unanswerable. `video_jobs.metrics_json` plus its owner
  self-report merge is the existing precedent to mirror. Adding the column is a migration, so it is a
  protected path and an owner merge.

## 8. Brand tagging

Tag a maker only from a **verified** handle. `docs/store-team/brand-ig-handles.json` is the registry
named by the charter, created by ticket #3732 with per-entry verification evidence and validated by
`scripts/check-brand-handles.ts`. Only non-null entries may be cited for tagging; an all-null entry
is a documented "could not verify", not an invitation to guess. The rule is unchanged: **not in the
registry with a handle, no tag.** Never guess a handle. A wrong tag is worse than no tag. Note that
an IG @mention today is caption text only (it notifies but is not a tag); real `user_tags` plumbing
in the publisher is a separate follow-up.
