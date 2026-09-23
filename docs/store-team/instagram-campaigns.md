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
| Customer Question | A REAL inbound question opens the caption, then Emma answers with authority about the reader's experience. Distinct from Ask Emma: this one is sourced from an actual inbound (support ticket, DM, or search query), never invented. See the provenance rule below. |
| Brand Crush | One maker, why their engineering is interesting. Tag the verified handle only (§8). |
| This Week at xdipx | Site news: a new aisle, a drop, a Notebook piece worth reading. |
| Trend React | A reaction to an adopted trend brief. Never chases a trend we have no view on. |
| Inspo Carousel | Multi-slide affirming or educational message over a metaphor hook. Built for saves. |
| Field Notes | Advice slides. Toy advice or plain sex advice, the thing a reader would otherwise search for. The resource format (§4a). Since 2026-08-22: when the advice is about a category we sell, the product is in frame (§3.9); product-free only when the subject has no product in it. |
| WTF Is… | A one-question mechanism carousel ("WTF is air pulsation?"): slide 1 the question, slide 2 the science, the last slide why she will care tonight. The 2026 carousel format with the highest save rate, and a mechanism post that still carries heat. |
| Send This To | A caption written to be forwarded: to the partner who keeps asking what she wants, to the friend who overthinks the lube aisle. The engagement close is the forward itself. |
| Let Me Guess | A list of three habits the reader recognises, the third one the drawer. Recognition is the hook, the product is the punchline she already owns or wants. |
| Today's Pick | One in-stock product, presented by a cast member. Editorial, never an offer: see §4b for what may and may not be said about its price. |

**Rotation rule:** never two consecutive posts from the same pillar, and never two consecutive posts
in the same format. A campaign that can only be told one way is too narrow; widen the subject or
shorten the campaign.

**Customer Question provenance (mandatory).** A Customer Question post cites where the question came
from in the run summary — the support ticket id, the DM, or the search query. An invented question
presented as a real one is fabricated proof, which the doctrine bans. The format fits xdipx precisely
because the question shape lets Emma speak with authority about the *reader's* experience rather than
her own, which is exactly what her no-lived-experience constraint requires; a fixed neutral frame (per
the `cropSignature` / `lightSignature` locks in §3) gives visual continuity with no face.

**Ask Emma provenance boundary (ticket #9674).** An Ask Emma caption may pose an invented
rhetorical question freely, no provenance needed — e.g. "Is it weird that I want it more than he
does?" is fine as a standalone rhetorical prompt. The moment the caption asserts that an inbound
event actually happened ("someone asked me this week", "a reader wrote in", "I got a message about
this"), it has crossed into Customer Question territory and needs the same provenance that format
already requires above: cite a real source (support ticket id, DM, or search query) in the run
summary, or drop the event-asserting frame and pose the question as a standalone prompt instead.

**Spec-checklist caption shape (available to Today's Pick and Brand Crush).** A caption may take the
form: a customer question or a plain lead, then a short run of checkmark lines of material,
compatibility, and safety fact, then hashtags. It converts catalog knowledge into authority without
Emma ever claiming she tried anything. Draw the facts from the product's own enrichment metafields —
`feature_bullets`, `sensation_dial`, and the material/care/compatibility fields already stored under
the `xdipx` namespace — never from invented spec. It is the single most charter-compatible caption
structure found in the 2026-08 teardown (`docs/store-team/competitor-social-teardown-2026-08.md`
§3.6-3.7); MAP and sale-gate rules (§4b) still bind, so no price or discount enters the checklist.

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

**This section is the single operative imagery ceiling for social.** `docs/design-doctrine.md`
§4.3 (v1.3, owner ruling 2026-08-19) defers to it by name and deliberately does not restate it,
and the `docs/emma-voice.md` social addendum points here rather than carrying its own list. Those
three documents used to disagree; ticket #4206 closed that. If you are briefing a social image,
this section is the rule. Do not reason from a summary of it elsewhere, and if you find another
document restating a ceiling, that document is the stale one.

Owner direction, verbatim: *"I want to make sure we are at the limit of what we can produce that is
sexually charged for posts. This is for marketing, it's not making pornography, that is not the goal.
This is to inspire better sexual wellness and exploration."*

This section replaces a stack of prohibitions that were written conservatively, one at a time, and
that together produced the failure the owner named three times: boring frames. It is deliberately a
**specification rather than a list of bans**, because "be sexier" is not executable and a brief that
cannot be executed produces the timid frame every time.

**The owner's explicit ceiling, 2026-08-22 (verbatim, and it supersedes the wardrobe line below
where they differ):** *"What we can show (and others on Instagram are showing): bare butt cheeks
(usually with a thong). All parts of breasts, except the actual nipples. Vaginas: all parts except
the labia lips. Tiny high cut bottoms is allowed. You can show the pubic mound and a little pubic
hair is allowed. Penis: not shown, but all other parts of a man are fine. I want to see sexy images
in our posts. Combine cast members together in posts. Create anticipation. Don't always make it at
night. Sex toys are ALWAYS available for someone to use for pleasure. The door doesn't have to stay
closed, and we don't have to hide in the dark to use sex toys. That is a core message of the brand.
I want to see images that emote sexuality and curiosity because it fits what we are selling. Be
explicit in your descriptions."*

So, stated as a brief can use it: a thong with bare buttocks; a breast bare to the edge of the
areola with the nipple covered by a hand, a strap, an arm, a sheet edge, or the crop; sideboob and
underboob; tiny high-cut bottoms or a string tie with the pubic mound and a little hair visible
above the line; a man bare except his groin; two cast members touching, holding, undressing each
other, reading anticipation and curiosity on their faces. Daylight is the default light. Briefs
state exactly which of these the frame uses, in plain words. A brief that says "sexy" and stops has
said nothing.

**Licensed at the ceiling:**

- **Wardrobe and skin.** Per the owner's list above. Lingerie, a thong, tiny high-cut bottoms, an
  open shirt, or nothing above the waist with the nipple covered. Bare back, stomach, legs,
  shoulders, cleavage, buttocks. Fabric is opaque where it covers the nipple or the labia.
  **On-skin frames (owner direction 2026-09-19, §3.2c) carry no clothing at all.** Owner, verbatim:
  *"no clothes on any of the bodies. No underwear or bras. Jewelry is ok."* For those frames the
  body is bare, fine jewelry is licensed and encouraged, and the occluder is the crop, the pose, a
  hand or forearm, the hair, a sheet edge, or the product. Bedding is not clothing and stays
  available. Breast presence is the default on any on-skin chest or torso frame, not the exception:
  the owner's dominant note across 18 reviewed frames was *"as much breast as possible, but no
  nipple"*, *"the tops of her breasts"*, *"bottom of breasts"*, *"cleavage"*. A chest frame that
  crops the breasts out entirely has under-delivered and is a REVISE. The stop list below does not
  move. **State plainly what this costs:** wardrobe was the visible evidence of compliance to a
  HUMAN reviewer, a thong reads as a lingerie campaign, and a bare body with a product at the right
  line reads as nothing until the reviewer decides. Exposure rises deliberately. The removal watcher
  (ticket #2741) and the step-down ladder in §4 below are more load-bearing from the
  first on-skin post, and the first removal on one is the signal this latitude was priced wrong.
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

**Bodyscape is the default on-skin frame (owner direction 2026-09-22, codified same day).** The body
is the landscape and the product is the only object in it. Close crop, one zone, skin fills the
frame, no face unless the brief says why. Reference frames in the socials library: asset 602
(Womanizer Beauty in the hip hollow, gold waist chain, sheet closing the top corner) and asset 607
(LELO SONA held flat on the stomach, sheet closing the bottom edge). Licensed compositions include:

- The thigh and the hip crease, product resting on the thigh.
- The belly, with the under-curve of the breasts at the top edge and a hint of pubic hair at the
  bottom edge. Pubic hair is not on the stop list under the 2026-09-20 nudity definition, but it is
  new ground for the classifier: at most 1 such frame per rolling 7, never the default.
- Face-down on the bed, product on the small of the back, the tops of the cheeks in frame, the
  cleft closed by the pose or the sheet.
- The product held against a bare shoulder, camera looking over the shoulder.

A full-body or face-forward portrait (library asset 635) is the exception, at most 1 per rolling 7,
and the brief names why. The three brief rules below (write the frame, inanimate closers, camera
angle) apply to every bodyscape frame without change.

**The ceiling stops here, and these do not move:**

- Nipples visible or outlined, sheer fabric included. Labia visible or outlined. A penis, in any
  state, visible or outlined. The anus visible or outlined (owner definition of nudity,
  2026-09-20: nipples, labia, penis, anus; everything else is allowed). A plug laid between the
  cheeks under §3.2c must therefore keep the cleft closed by the pose, a hand, or the product.
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

Per 7 posts: **roughly 4 at the ceiling, 2 mid, 1 educational** (re-based 2026-09-01 on the owner's
more-skin direction from the social alignment audit; it was 3 / 3 / 1 from 2026-08-22, and
2 / 3 / 2 before that). Same principle, hotter floor: the peaks stay sharper than the
rest, and one bad classifier day costs a post instead of the channel. Do not round every frame up
to the ceiling, and do not round any product frame down to a packshot-in-a-room: since 2026-08-22
the **mid** frame carries skin, touch, posture, or expression by default (§3.2a licenses all four at
zero policy cost), and the educational frame is the only one that may be quiet. Decide which three
are the ceiling frames when the campaign's key art is planned (§3.4), not on the day.

**These ratios are per rolling 7 posts, not per campaign** (re-based 2026-08-16, owner direction to
raise volume). They were written when a campaign was 13 or 14 posts because one post a day made
those the same number. At 3 or 4 posts a day a 13-day campaign is 39 to 56 posts, and a cap written
"4 of 14 per campaign" silently stops meaning anything. So read every proportion in this document as
a **rolling window over the most recent posts**, never as a per-campaign total:

- **Charge:** roughly 4 ceiling, 2 mid, 1 educational per rolling 7. **Do not re-base these
  numbers again.** They have been re-based three times in five weeks (2/3/2, 3/3/1, 4/2/1) while
  the measured output moved the other way, and on 2026-09-19 the last 21 posted held 1 ceiling
  frame against the ~12 this ratio implies. A target that has never once been run is not evidence
  the target is wrong. What the on-skin treatment changes is what **mid** means, and for the first
  time it gets a positive definition rather than "not the ceiling":
  **Ceiling on-skin** = a bare contact zone in implied-nude territory: hip hollow, small of the
  back to the dimples, sternum with the breasts bare, stomach to the navel.
  **Mid on-skin** = a contact zone that reads clothed-adjacent even while bare: inner wrist,
  forearm, nape with the hair lifted, behind the knee, the back of a shoulder. Real contact, real
  charge, a frame a perfume campaign could run.
  **Educational** stays the quiet one. It is the only frame that may be.
- **Cast:** at most 4 cast frames per rolling 14. The cap is on repetition of the same face, not on
  frames-per-day: no single cast member appears in more than 2 of any 5 consecutive cast frames,
  mirroring the §3.7 product-post rotation floor ("no cast member carries more than 2 of any 5
  consecutive product posts"). On a multi-post day, more than one cast frame is expected, not
  exceptional — §3.7's cast-on-every-product-post rule and §5a's weekday-lane structure now
  structurally require it at `social_freq_instagram >= 2` — so ship them, varying WHICH cast member
  appears. The spirit of the old flat one-frame-per-day ceiling (no single face carrying the whole
  feed) is served by that rotation floor, not by capping frame count. Still never three or more
  faces in one campaign; that one is about identity, not frequency, and it does not re-base.
- **Product-forward:** at most half of any single day's set, per `mission-brief.md` §6b.

**State the garment in every prompt regardless, and for an on-skin frame state what CLOSES the
frame instead.** The garment rule is a fidelity rule, not a restriction: the model inherits the
reference photo's neckline when you leave it unsaid, so an unstated wardrobe is an accidental one
rather than a chosen one. At least one approved cast reference has a deep V, and the 2026-08-13
bralette was not asked for by the brief that produced it. An on-skin frame has no garment to state,
so the brief states what is outside the crop and which drawn object closes each edge. Worked
example that verifiably held: *"bare, no clothing anywhere in the picture, fine gold chain at the
throat; the frame is filled by throat, collarbones and breastbone and her shoulder closes it at the
bottom edge."* Three rules came out of 40 measured frames on 2026-09-19, and they are binding on
every brief:

- **Write the frame, never the exclusion.** Describing what is EXCLUDED (*"everything above that
  line is out of frame"*, *"cuts across so only the lower half is included"*) makes the model
  render a nude WIDE shot, reliably, in every attempt tested. Describe positively what FILLS the
  frame and name the body part or object that CLOSES it.
- **An inanimate closer holds; a limb described by region does not.** A folded sheet or towel
  drawn across the hips closed the bottom edge cleanly in every frame that used one (5 of 5). A
  forearm described as *"lying across her chest"* covered the nipples in 0 of 4, because that names
  a region and the model puts the arm somewhere else that is anatomically plausible. Where a limb
  DID hold it was performing an action only possible at that exact spot: arms crossed tight, a hand
  cupping from below, a second person's hand pressing an object, a pastie adhered. Name the action,
  not the region, or use an object.
- **The camera angle decides more than the wording.** Every fence breach on a breast-in-frame
  brief (6 of 6) shared one composition: the subject supine, the camera above, both breasts in the
  picture. In that pose the breasts separate and the model fills the gap with the limb instead of
  covering. Every frame that held was seated, kneeling, side-lying with one breast, or two-person.
  Do not brief the supine-from-above composition with breasts in frame; change the camera, not
  the sentence.

None of these three substitutes for a check on the produced pixels. Across 24 frames the fence
breach rate was roughly 29 percent and it rose whenever the brief asked for more skin.

**That check is live, and this paragraph no longer holds anything back.** It used to end "until it
is live no on-skin frame ships to Instagram unattended", which was true when it was written on
2026-09-19 and stale the same day: ticket #10268 merged as `d88d3d3` and #10279 as `f2bd4bc`.
`social-vision-gate.server.ts` now runs eight checks per frame (the doctrine's four anatomy checks
plus `nippleOccluded`, `genitaliaAbsent`, `anusNotVisible`, `adultUnambiguous`) and reports `legibleText` as a
transcription rather than a verdict, and `social-publish-gate.server.ts` blocks any media URL that
carries no recorded verdict or a failed one. So the unattended path is open for on-skin frames on
the same terms as every other frame. Left as written, the sentence was a hold on exactly the
treatment §3.2c exists to ship, which is the §3.6 failure again: the gate was right and the
document was stale. Owner direction that does not reach the binding document has not landed, and
neither has a blocker that outlives its cause. That hole is closed (tickets #10337, #10476): the publish gate BLOCKS a `social-`/`ig-` prefixed asset with no recorded verdict unless it is demonstrably older than the 2026-09-01 legacy cutoff, and an asset it cannot date at all now blocks too rather than skipping, because a row about to publish always has a created_at so "no date" means nobody looked, not old art. The video poster frame is walked as well. A stored verdict that answers fewer checks than the gate currently has is rejected the same way a missing one is, naming the unanswered checks, so a pre-#10477 verdict cannot publish on a seven-check read; that is read off `VISION_CHECK_NAMES`, so it covers every check added later with no further edit. There is no automated re-gate, and do not assume one: `recordVisionVerdict` is called only from a generation flow on a freshly uploaded url, and `/api/team/vision-gate` runs the gate without recording the result, so nothing writes a fresh verdict onto an existing `social_media_assets` row. A blocked row lands in `needs_changes`, and `reworkCaption` cannot clear it, because it redrafts the caption against the same media and reproduces the same finding. Clearing one needs regenerated art, or the re-gate action filed as ticket #10511. Measured against production on 2026-09-20 the cost of that is two rows: all 205 recorded verdicts predate the check, but 72 of the 74 unposted rows touching them are already `rejected`, leaving #238 and #182, both already in `needs_changes` and both over a week stale. One thing still does not gate itself: the video pipeline never calls `runVisionGate`, so a reel has no verdict to find and fails closed on every path until that lands.

**"Desire-forward" means the picture and the caption, since 2026-08-22.** Owner direction
2026-08-16 asked for posts that are *"desire forward and product highlighting"*; on 2026-08-22 the
owner closed the loophole that had kept the caption at 4-5 while the picture ran at the ceiling:
*"I'm officially saying, our posts should be at a 9 for the explicit register. That's an order. I
want innuendo, suggestive phrases, skin in the images (not nudity)."* The social addendum in
`docs/emma-voice.md` now runs Instagram at **9 by implication**, and the split that remains is not
picture-versus-caption, it is intent-versus-vocabulary.

- **Imagery: yes, and we are under-using the licence we already have.** Everything in §3.2a is
  available: a bed, a body, product against skin, lubricant texture, two people touching, arousal on
  a face, implied use. The ceiling frames are the desire-forward ones, they are roughly 4 of every 7 by
  §3.2b, and they are chosen when the key art is planned rather than discovered on the day. A set
  with no ceiling frame in it has quietly ignored this section.
- **Caption: register 9 by implication.** The caption wants the reader and says so; it fires the
  fantasy and steps back; it authors the evening and leaves the ending hers. It reaches the 9
  through innuendo, double meaning, anticipation, and the unsaid, because Meta's classifier reads
  words and not intent. What stays out is a word list, not a register: no act naming, no orgasm or
  arousal vocabulary, no anatomy nouns, no emoji-anatomy, no use narration (`docs/ads-policy.md`
  §Organic social, Step 4b question 2). Bellesa Boutique lost a 700K-follower account in March 2026
  over caption vocabulary; the hottest line in our feed is one a moderator cannot quote as a
  violation. A caption that could run unchanged on a skincare account is a REVISE.

The practical version: **the image carries the desire, the caption names the wanting, and neither
one names the act.** That combination is fully licensed, it is what the owner has now asked for
three times, and until 2026-08-22 it was not what the account was shipping.

**Honest note on what this costs.** Lingerie plus a pleasure product in one frame is a stronger
signal to Meta's classifier than either alone. That is a real increase in account exposure, taken
deliberately by the owner rather than drifted into. It makes the removal watcher (ticket #2741) and
the step-down ladder in §4 below more load-bearing, not less: the first removal on a
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

### 3.2c The on-skin treatment (owner direction 2026-09-19)

Owner, verbatim: *"Our posts are starting to get boring. Almost like we are regressing to boring
and not staying on the edge of what's allowed to create curiosity and desire... products against
skin on the body. I want to see the edges of breasts, the pubic mounds, bellies, backs, butt cheeks.
No full nudity, but the suggestion that the subject is nude is what I want. These are close up
shots, they are not wide body shots... Could be with a hand holding it in place."*

**This is not new licence.** It is the third bullet of §3.2a, which calls product-against-a-body
"the single biggest unlock in this ruling", read out loud. Measured across all 152 Instagram rows
on 2026-09-19: sternum 0, hip hollow 0, small of the back 0, inner wrist 0, stomach-as-contact 0.
"Collarbone" appeared five times and not one was a contact frame. The licence had been briefed
zero times in the account's history. The root cause is structural and it is named here so the
section change holds: the gate has a BLOCK and no BORING. Too hot costs a post; too cold costs
nothing anyone measures. Under that gradient a run retreats every day. Ticket #10271 puts the
rolling mix on the page so cold is at least visible.

**What an on-skin frame is.** A close crop with a product in contact with bare skin at a named
body zone, resting under its own weight. The cast member's body is the location. Three variety
axes replace the room when the crop eats it, and they rotate the way §3.8 rotates locations:

- **Body zone**: hip hollow, sternum, nape, small of the back, inner wrist, forearm, stomach, top
  of thigh, behind the knee, shoulder blade, ankle. **No zone repeats inside 5 consecutive on-skin
  frames, judged on the visible zone, not the label.** Four anal or prostate products in a set of
  nine is four gluteal frames if shot naively; the window is what stops that.
- **Contact mode**: resting, held by the subject, pressed by a second person's hand, drawn along
  the skin, worn, balanced against the body's own curve.
- **Crop scale**: macro, close, medium. With clothing gone the wardrobe edge is gone as a location
  proxy, so the trace of the world comes from the sheet, the surface, the hour of the light, or a
  second body, and the brief names which.

**STANDING ORDER, 2026-09-22: ON-SKIN IS THE DEFAULT ON EVERY INSTAGRAM AND X PRODUCT POST, UNTIL
THE OWNER SAYS STOP.** Owner, verbatim: *"The two posts that went out to IG are boring. Why weren't they
on-skin posts? I want to see on-skin posts until I say stop. No more boring posts."* This has no end
date. It ends when he says it ends, and until then a clothed product frame is an exception that has
to justify itself in writing (`social-art-director.md`, Clothed exception block). The only standing
exemption is a product-free resource post, meaning a subject with no product in it, and §3.9 already
narrows those hard.

**It covers X as well as Instagram (owner answer, 2026-09-22: "Yes, on-skin applies to x too").**
Read that as what it is: a change of DEFAULT POSITION within the existing ceiling, not a widening of
the ceiling. §3.2a is already "the single operative imagery ceiling for social" and
`social-crossplatform-strategy.md` §4a already holds that "the imagery fence does not widen with X's
hotter caption register" and "the ceiling remains instagram-campaigns.md §3.2a on both platforms".
None of that moves. What moves is where a frame sits by default underneath it, on both surfaces.

**It does NOT reach the video lane (owner answer, 2026-09-22: "No action needed on the video for
now").** The order covers stills on Instagram and X and stops there. Read "for now" as written: this
is a scope boundary with a date on it, not a judgment that reels should stay clothed, and the video
pipeline already carries the on-skin machinery from tickets #10484, #10485, #10486 and #10500. So
extending it later is a decision, not a build. Until that decision, no routine widens this to video
on its own reading of "no more boring posts".

**One compounding risk to know about on X, recorded rather than discovered later.** The X 16:9
cast-composite path already fails `product-identity` and `age-ambiguity` at a materially higher rate
than the Instagram 4:5 path on the same SKU and the same cast reference (ticket #10685: two
occurrences, 2026-09-05 and 2026-09-21, each time clean at 4:5 the same day). Requiring on-skin on a
path that already fails more will compound, so the X lane is where to expect the first burnt image
budget. That is an argument for fixing #10685's generate-at-4:5-then-crop question, not an argument
for exempting X, which the owner has ruled on.

The order was given against measured evidence, so it is not a matter of taste. Across all 152
Instagram rows on 2026-09-19: sternum 0, hip hollow 0, small of the back 0, inner wrist 0,
stomach-as-contact 0. The licence in this section had been briefed **zero times in the account's
history**. The two rows that triggered the order, 292 and 293 on 2026-09-22, both carried
`body_zone` null and `contact_mode` null, which is not "judged clothed" but "nobody answered".

**While this order is in force, the 3-per-rolling-7 close-crop cap and the no-two-consecutive rule
below are SUSPENDED** (owner decision, same day, asked and answered directly). They are suspended
rather than deleted, and rather than left to show a permanent breach, because a doctrine that
contradicts itself is a doctrine a run can quote either half of. The ceiling-frame floor is NOT
suspended: at least one frame per rolling 7 must still be wide enough to read a location, because
that one is what stops the grid becoming a stock library, and the owner's complaint was that the
grid is boring, which ten identical macro crops would also be. When the order lifts, both
suspended clauses resume as written with no further decision needed.

**The cap, a merchandising rule before a safety one (SUSPENDED while the standing order above is in
force).** At most 3 close crops per rolling 7 Instagram product posts, never two consecutive, and at
least one ceiling frame per rolling 7 wide enough to read a location. Ten tight crops of bare skin is a stock library and fails the standing
bar ("someone scrolling the last ten posts sees ten different lives"). It is also the aggregate
read that gets an account actioned rather than a post.

**The caps report, they never hold (owner answer to blocker #194, 2026-09-20, verbatim: "report
only (no hold)").** `app/lib/social-mix-report.server.ts` computes them and prints them on
`/admin/socials/calendar`; nothing in the publish path blocks on a breached cap, and nothing
should. Read that ruling narrowly, because the loose reading demotes something nobody asked to
demote: **it covers the caps in this section and not the §3.2a stop list.** The stop list is a hard
stop and still BLOCKs at the gate, on every surface, exactly as before. A cap is a merchandising
rule about the shape of a set. A stop is a rule about what may be in one frame. "Report only" was
an answer about the first.

**Placement follows use, or it is a product on a person.** The owner's test: *"Have the team
evaluate how to best place these based on how they are used."* A heavy steel plug goes in a palm,
because weight is the product and weight is only legible when something carries it. Graduated
beads go along the spine, because the spine is the body's own graduated column and gives absolute
scale. A hands-free prostate massager is briefed by what the hands are doing instead. A lipstick
bullet goes at the collarbone, not the wrist, because the disguise is what people buy. Pasties go
on the nipples, and they are the one product whose use zone and licensed placement are the same
place: the stop list's test is "no nipple visible" and a pastie satisfies it BY being the product.
A vibrator over a nipple is not settled by that and stays an owner question.

**Brief craft, from the owner's review of 40 frames on 2026-09-19. Binding.**

- **The product rests.** *"the toy should be resting, it looks like it's pushing into the skin."*
  It settles where it was set down. It never presses, dents or pushes into skin.
- **No product emerging from a navel.** The model does this unprompted and did it twice. Name it as
  a negative in every belly frame.
- **Anatomy is a reject condition.** *"a lot of body distortion. Belly button on a back."* One
  navel, on the front, only. Correct limbs and fingers, no merged or duplicated parts.
- **Only depict products we sell, in a zone where one plausibly belongs.** *"good use of close up
  neck shot and holding a toy. However we don't sell any neck massagers."* Pair every body zone
  with a catalog category before briefing it. The nape is retired until a SKU fits it.
- **Only brief from a bare-product reference.** Shopify `featuredMedia` is sometimes the retail
  carton. SKU 96203 has the box as image A and the product as image B; passing A made the model
  reconstruct the toy from box art and invent a stalk and club that do not exist. Walk the media
  list for a text-free bare-product frame. Never assume the featured image is one.
- **Plug placement.** Owner, twice: *"lay the plug between the butt cheeks."* Licensed. It is the
  highest-classifier-signal frame in the campaign because it reads as product-positioned-for-use
  on a bare rear. Ceiling tier, at most one per rolling 7, and the first frame to drop if the
  removal watcher fires. The lower-back placement above the cleft, with a folded towel closing the
  frame at the top of the buttocks, is the safer default and it held cleanly.
- **Two cast members in frame.** *"love the use of having multiple people in the shot. More like
  this."* Raised from permitted to preferred on ceiling frames. A cast member's hand pressing the
  product to another's skin is also the most reliable occluder we have.
- **Cock ring.** The use zone is an unconditional stop, so the frame is the hand-off: a woman's
  hand pressing the ring flat to a man's lower belly above a folded sheet, his hand over her wrist.
  The argument is that she is sharing it with him. No cast shadow reading as a penis: §3.2a stops
  "a penis, in any state, visible or outlined", and a deliberate shadow is an outline.
- **Paddle.** Shootable. Violence comes from three removable things: a raised implement, a gripped
  handle, a mark on skin. Hand flat on the paddle FACE, never the handle; across the lap, at her
  side, or in a relaxed hand; no marks, so aftermath is closed. A paddle is a held object, not a
  restraint, and it is nearer a hairbrush than a cuff in what the frame says.
- **Brand names on real products are fine.** Owner, verbatim: *"Showing brand names is OK when we
  are placing actual products."* Packaging junk (barcodes, labels, cartons) and baked-in captions
  stay out. The three-case rule lives in `docs/design-doctrine.md` §4 item 4.
- **Ban the word "paper" from image prompts.** The brand token name renders as literal sheets of
  paper: a prop in 4 of 7 frames before the ban, 0 of 33 after. Say "warm off-white linen".

**Surfaces.** Instagram and X share one imagery fence until X can label sensitive media. The
posting path (`postTweet` in `app/lib/twitter.server.ts`) sends text and media ids only; X permits
the category on condition of labeling; we cannot label; therefore nothing on X may need it.
Ticket #10277. A frame drafted hotter for X manufactures a row the gate blocks.

**How this sits with §3.7.** An on-skin frame satisfies the cast-in-a-scene mandate when all three
of §3.7's conditions hold: it is generated from that cast member's approved body reference with the
`castSlug` on the row, it carries an adult identity marker inside the crop, and it carries a trace
of the life around it. §3.7's premise, a group of people out in the world talking about these
products, is preserved across the SET by the close-crop cap above rather than by any single frame:
the cap is what guarantees the wide frames that read a location, which is why it is a merchandising
rule before it is a safety one.

**Emma's likeness is licensed in an implied-nude frame (owner answer to blocker #193, 2026-09-20,
verbatim: "Yes, Emma can and she has a body reference").** §3.7 already made her a cast member for
imagery purposes; this reads that licence against a bare body explicitly, which is what had never
been done. She is briefed on the same terms as the rest of the roster: her own approved
`bodyReferencePhoto`, her `castSlug` on the row, and every fence in §3.2a and §3.2c unchanged. The
answer was given for her likeness specifically and does not generalise to anyone outside the
approved cast.

**Still owner-only, not licensed here:** a pleasure product covering a nipple (the specialists
split, and only the owner resolves it); a product covering a vulva (both specialists BLOCK: §3.2a's
"product against genitalia" is a contact rule with no covering exception).

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

**Standalone metaphor posts are licensed (owner direction 2026-09-01), up to 2 per rolling 7.**
A single-image post built on the doctrine's archetype D (silk, water, soft foil, fruit standing in
for sensation) may now run on Instagram on its own, not only as a carousel hook. Every deniability
fence holds unchanged: the fig reads as a fig at a glance, the metaphor is never composited into
the same frame as a product, and the caption never names it. A metaphor post counts as a mid frame
in the §3.2b charge ratio, follows the normal pillar and format rotation, and archetype E (the
surreal euphemistic hybrids) remains off Instagram entirely, per §3.5. Two per rolling 7 is a
ceiling, not a quota: a week with none is fine, a week with three is a defect.

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
- **A campaign built on metaphor.** Produce innuendo is licensed as a carousel hook and, since
  2026-09-01, as a standalone archetype-D post capped at 2 per rolling 7 (§3.3), always on the
  fence of deniability. What stays retired is the campaign: a whole arc of figs and peaches is the
  emoji-anatomy vocabulary the charter bans in words, rendered in pixels. Metaphor is a door,
  never a room.
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

- Cast reactions stay performance, never testimony. No persona claims to have used anything.
- Stage 1 of the composite still strips packaging, so a manufacturer carton never reaches a
  presenter's hand. That was never about the hand rule; it is the no-text-in-pixels rule, and it
  still binds.
- **Never ask the image model to render a real brand's wordmark, logo lockup, or label copy on the
  product body (ticket #5493).** The no-text-in-pixels rule above is about packaging; this extends it
  to the printed label on the product itself (the JO bottle, the Le Wand neck). A baked wordmark
  garbles into a plausible-but-wrong mark (CULBUN for COOLING) that misrepresents a real third-party
  brand, so a legible-but-wrong label is worse than no label. Two routes only: composite the real
  packshot or its label region, or frame and light so no wordmark is legible at any zoom. The drafting
  rule and its two permitted routes live in `routine-social-daily.md` Step 5.

**Four bullets were removed from this list on 2026-08-19 (ticket #4206 follow-up).** They read "no
simulated or implied use", "the product is not on or against a body", and "no fluid or lubricant
texture, no bed with a person in it". Every one of those was superseded by §3.2a on 2026-08-16, as
this section's own closing paragraph already said, so the list contradicted the page it sits on and
gave a run its pick of two answers. **§3.2a is the ceiling. This section is only about what may be
in a hand.** Do not restate a ceiling here again.

**That conflict is now closed.** `docs/ads-policy.md` §Organic social carried "no product in hand or
on a body" as an Instagram hard limit for four days after the 2026-08-12 hand ruling contradicted it,
and the pre-publish gate had to reason around the contradiction on every run (it did so explicitly on
the PASS that shipped post 47). The line was withdrawn by owner ruling 2026-08-16 and that row now
points at §3.2a, which is the single operative rule for Instagram imagery. Product in hand and
product against skin are both licensed; the fence moved to genitalia, hands on genitals, and
depicted acts.

### 3.7a The cast member has to match the product (owner direction 2026-09-22)

Owner direction, verbatim across three messages: *"the context of the toy needs to be taken into
account. When we have a man holding a vibrator; we look like idiots. A man can share a prostate
massager or a stroker."* Then: *"If you want to show a man holding a vibrator he should be holding it
against a woman's skin."* Then: *"A man should show products that men use!"*

§3.7 says every product post carries a cast member. This section says **which** one.

- **A man alone in frame carries only a product classified `male` or `universal`.** The
  classification is `xdipx.cast_target`, derived from `product_type_dial` and
  `product_subtype_dial`; the full derivation table is ADR-015 §1 and that table is authoritative,
  not the summary here. Clearly `male`: `stroker`, `cock-ring`, `pump`, `extender`, and `anal` with
  subtype `prostate`. Clearly `universal`: `lube`, `massage`, `condom`, `wellness`, `book-media`,
  `bondage`, `couples`.
- **A man never appears alone with a product classified `female`.** Chiefly `vibrator` (every
  subtype, `wand` and `air-pulsation` included). The failure this section is written from: row 293,
  2026-09-22, Marcus alone in a white v-neck holding a ROMP Presto Wand at chest height.
- **Read the subtype, never only the parent.** Two parents split by subtype and a summary that
  ignored them would be wrong in both directions: a `dildo` is `female` except a `packer`, which is
  `male`; `wear` is `universal` except `mens-underwear` (`male`) and the `panty`/`bodysuit`/
  `hosiery` family (`female`). This is exactly why the classification is a published product fact
  and not a list anyone reproduces from memory.
- **A man MAY carry any of those in a two-cast frame where he holds it against the woman's skin.**
  That is `contactMode: other-held`, which already exists in the vocabulary for exactly this. His
  hand on the product, the product on her skin. §3.2a already licenses the hand-off frame and
  §3.6's worked cock-ring example is the same shape read from the other side.
- **A woman in frame is unrestricted by this section.** The owner's complaint was specific and this
  rule is no wider than the complaint.

**The product's audience is a product-side fact, and social asks rather than infers (owner
direction, same day).** Verbatim: *"Our /all-hands team should be able to tell the merchandising
agents and the social media agents which products are related to men, and which are for women. Some
are universal. Bind the social media team to check with our product and experts before using a male
or a female cast member in an image."* So the classification is published once by the people who own
the catalog and read by everyone else. Until it is published, the type and subtype dials above are
the interim answer, and a product whose audience cannot be determined is a product to swap out, not
to guess at: pick a body-neutral product, or put a woman in frame.

**Scope guard, and it matters.** This governs **who appears in a photograph with an object, and
nothing else.** It must never reach collections, navigation, merchandising copy, or SEO. The store
deliberately retired gendered merchandising: `/for-him` and `/for-her` 301 away and
`app/routes/_layout.for-him.tsx` carries the instruction "never redirect to the gendered
/collections/for-him". A casting rule is not a merchandising taxonomy, and the day this leaks into
one is the day it has been misread.

### 3.7 A cast member in a scene, on every product post (owner ruling 2026-08-19)

Owner direction, verbatim: *"Emma is also a cast member. All instagram product post images need to
be with at least one cast member in a scene. You can include a solo product shot as a second slide
in an image series if it's relevant. The social media team can pick the scene, I want variety. This
needs to look like the team we have is out in the wild talking about these products."*

**The rule.** Every Instagram **product** post carries at least one approved cast member, in a
scene, in the lead image. A product photographed alone is no longer a publishable lead frame, and
neither is a styled still life with no person in it. The lead slide is a person somewhere real,
with the product, not an object on a surface.

**Emma is a cast member.** She is treated exactly like any other approved presenter for imagery
purposes and may appear in scenes, hold and present product, and appear alongside other cast. Her
existing likeness policy is unchanged: her likeness is licensed for merchandising imagery, the
product stays the hero, and she never claims lived experience. What changed is only that she is now
in the rotation rather than a separate case.

**The premise this serves.** The feed should read as *a group of people who are out in the world
talking about these products*, not as a catalogue. That premise is the test to apply when a frame
is technically compliant but feels wrong: would this read as a person with a life, or as a product
listing with a human decoration attached?

**An on-skin close crop is a cast member in a scene only when all three hold (owner direction
2026-09-19, §3.2c).** A faceless bare hip is a cast member's skin, not a cast member in a scene,
and it has no identity anchor the system can verify. So the frame satisfies this rule when: (a) it
is generated from that cast member's approved BODY reference and the `castSlug` on the row names
them (ticket #10270 shipped the field and the selector, and the owner approved a
`bodyReferencePhoto` and a `skinToneNote` for all eight cast members on 2026-09-20, so clause (a)
is satisfiable today on the route path; the CLI path at `scripts/gen-social-image.ts` does not yet
reach the selector, ticket #10475); (b) it carries an **adult identity marker** inside
the crop: the face, a hand, a tattoo, jewellery, body hair, or the second cast member; and (c) it
carries a trace of the life around it: the hour of the light, a sheet or surface entering frame, or
a second person. Skin and product alone, with no face, no adult marker and no edge of a world, is a
plate with skin in it and not a publishable lead. Clause (b) is load-bearing and gets more so with
clothing gone: ticket #7727 recorded three independent age-ambiguity BLOCKs in one day on exactly
this chest-up framing, and the rule is judged on ambiguity, not intent. Jewellery, which the owner
has licensed, is the cheapest adult marker available; use it deliberately.

**When the model will not hold the product, use the packshot on a card (owner catch 2026-08-22).** Four plate renders of the Womanizer Classic 2 in a row invented a white body, then a stylus tip, with the packshot passed as reference and the defect named in the prompt; negations do not hold on the current provider. The fallback for a product slide is the real Shopify packshot composited onto a brand card (kicker, one line, XDIPX, slide counter) by `scripts/generate-slate-carousel-slides.ts` kind `packshot`. It is generated social art under a `social-` filename, so provenance passes, and it is the one representation that cannot drift. Reach for it after the second failed plate, not the fifth.

**Solo product shot: licensed, as slide 2, and it must still be generated art.** A product-only
frame may run as the second slide of a carousel when it is genuinely useful (showing scale, finish,
controls, or what is in the box). It may **never** be the lead. And there is a hard mechanical
constraint that is easy to get wrong: `allMediaAreGeneratedSocialAssets` is an `every()`, so
**every slide** must pass `isGeneratedSocialAsset`, which requires a `social-` or `ig-` prefixed
basename. **A raw Shopify CDN packshot as slide 2 BLOCKs the entire post, lead slide included.**
Generate the solo shot with archetype `plate`, which renders a packaging-free product frame that
passes provenance. Never reach for the catalog image. See `routine-social-daily.md` Step 5.

**Non-product posts** (education, a campaign kickoff, a Notebook handoff, a resource carousel) are
not covered by the cast mandate and may run cast-free art per the archetypes in §3.2a. The mandate
is about product posts, because that is where a lonely packshot reads as a catalogue.

**The roster, and how to check it without getting it wrong.** This rule needs approved
`castMember` documents in Sanity carrying a `referencePhoto`. As of **2026-08-21 there are eight**:
Diego, Emma, Jade, Marcus, Maya, Priya, Sofia, Vivian, all `active` and `approvedForUse` (Vivian
approved 2026-08-21, `referencePhoto`
`https://cdn.sanity.io/images/0nlwk8cf/production/ccea0d34f4043e9fcb1af09c5f734f0b5ddab4ea-576x1024.jpg`).
The rule is
satisfiable today and §3.8's rotation windows bind normally.

This paragraph previously stated there were **zero**, which was false and stalled Instagram product
drafting on a blocker that did not exist. That count was run with an **empty Sanity token**;
anonymous access to this dataset returns only one of the eight docs, and the partial read was
reported as the whole truth. **Check the roster with `SANITY_API_TOKEN` on the `published`
perspective**, the same client `getApprovedCastMembers()` uses, and never conclude "none exist" from
an unauthenticated read.

If the roster is ever genuinely empty, an honest run declares Instagram product drafting
degraded-to-zero and says so, exactly as Step 2b requires. **It does not fall back to a packshot to
fill the slot.** That fallback is what produced row 59.

### 3.9 The picture depicts the subject, never the verb (owner direction 2026-08-22)

Owner direction, verbatim: *"Why are we posting a picture of Jade washing her hands when it's a post
about washing your sex-toys? Like, who's going to care that she's washing her hands when it's a post
about sex toy cleaning? We have sex toy cleaning products."* And: *"Think about why are they looking
at what we are selling? Why should they care? What is the sensation we want them to feel when they
view it?"*

Row 80 (2026-08-22) is the reference failure. The caption was a toy-care guide, the slate put it in
the product-free resource slot, the art director received the slot and the location bank but never
the subject, and the location bank's "bathroom and shower-adjacent" met the caption's verb "wash" in
a literal hand-washing frame with no toy and no cleaner in it. Every rule was followed. The post was
meaningless. These rules exist so that cannot happen again:

- **The brief carries the subject and the feeling, always.** `social-art-director` receives, for
  every post, the post's subject in one line, the product(s) that belong to that subject, and the
  sensation the post is selling (anticipation, recognition, permission, relief, curiosity). A brief
  with a slot and a location and no subject is incomplete and is sent back.
- **Depict the subject, never a literal illustration of the verb.** A cleaning post shows the toy
  and the cleaner, held by a cast member in a scene that makes owning both desirable (the toy drying
  on a folded towel beside the bottle on a nightstand at morning light; a cast member in a robe with
  the bottle in one hand and the toy in the other, mid-sentence). It never shows a person washing
  their hands, a sink, a bar of soap, or "a dish of water". A lube post shows the bottle and the
  skin. A mechanism post shows the toy against the body it is for. If the obvious frame is the verb
  acted out by a person with nothing we sell in frame, it is the wrong frame.
- **A post about a category we sell shows the product.** Slot A is a resource post, not a
  product-free post. When the advice is about cleaning, storage, lube, materials, or first toys, the
  relevant in-stock product is in frame and may be named. Product-free frames are for subjects with
  no product in them. The stock gate (Step 2.6) and the Instagram-eligibility filter (§4b) apply to
  the product exactly as they would in slot C.
- **The image answers "why should she care" before "what is happening".** The test for a brief:
  name the feeling a woman scrolling past should have in the half second before she reads a word.
  If the honest answer is "she learns that someone is washing their hands", the brief failed.
- **A genuinely product-free caption reaches register 9 on wanting/curiosity/permission, not on a
  product outcome (ticket #5862).** When the subject truly has no product in it (communication,
  consent, the orgasm gap as a conversation), the caption cannot borrow the "everything on that
  nightstand has a job" pattern because there is no nightstand item to anchor it to, and reaching
  for a vague gesture instead ("the thing nobody explains") is exactly the evasion the voice charter
  bans. Name the feeling plainly instead: curious, wanting, permission, relief. `docs/emma-voice.md`
  social addendum carries the worked lines; judge a product-free draft on whether it lands the
  curiosity-or-permission charge on its own terms, not on whether it manages to reference a product.
- **Owner feedback on a rejected post binds the rework, clause by clause.** Row 74 was rejected
  with *"Show a cast member cleaning a toy with one of our toy cleaning products"*; the rework
  satisfied "cast member" and dropped "toy" and "cleaning product". A rework that satisfies part of
  the feedback is not a rework. `social-publish-gate` reads the original row's `feedback` and
  REVISEs any rework that leaves a clause of it unmet.

### 3.9a Lube-category default: macro/hands-and-strand, no bottle (ticket #9538)

The Lube, Actually campaign (2026-09-07 through 09-19) published 7 of its last 7 Instagram posts as
product-free hands-and-glide macro shots (no bottle, no brand, no SKU shown) — not because a rule
required it, but because every attempt that week to show an actual branded lube bottle drew a
product-identity or baked-in-text BLOCK (rows 230, 233, 244, 256, 257), while the macro/hands-and-strand
technique (a thin strand of clear liquid between two fingers, no bottle in frame) PASSed cleanly every
time it was tried (rows 236, 249, 250, 261, 262). This is a §3.9 subject-not-verb-compliant treatment,
not an exception to it: the subject (what the product does, felt on skin) is still depicted, just
without a bottle render that risks a wordmark BLOCK.

**Default rule, restated 2026-09-19 as the constraint rather than the technique: a lube-category
Instagram or X post carries no legible packaging junk and no invented product body.** That was
always the protection; "no bottle" was one technique that achieved it, and writing the technique
as the default made it a floor a tired run never left, which is how seven consecutive lube posts
became the same photograph. Owner, on a glide-on-belly frame: *"ideally we show the bottle of lube
in a shot like this."* Three treatments satisfy the constraint, in preference order:

1. **A real bottle resting on skin**, lying on its side in the hollow of the waist or on the flat
   of the stomach, label foreshortened and partly occluded by the contact, colour and silhouette
   stated from the packshot. A brand mark on the bottle is fine (owner ruling, §3.2c); a barcode or
   printed panel is not, and the prompt negative does not reliably stop it, so the legible-text
   report in the vision gate (ticket #10268) is the control.
2. **Product-on-skin with no bottle**: glide on a stomach, a hip, the inside of a forearm, held
   between a thumb and the skin.
3. **Hands-and-strand macro with no bottle.** The observed-safe technique of September 2026, now
   the fallback rather than the first choice.

**No lube treatment repeats on two consecutive lube posts.** Seven of seven happened because
nothing forbade seven of seven.

**Fluid crop floor, a fence not a preference.** A frame with fluid on skin ends at or above the
navel and never includes the pubic area. A bare stomach with glide on it and the pubic line in
shot is "fluid on or near genitalia" on §3.2a's stop list, and it was the one frame of eight that
had to be rejected the day this rule was written.

### 3.8 Scene and location variety, and how it is kept honest

Owner direction, verbatim: *"Variety is key here. Put them on a beach, or camping, doing some fun
intimate activity, giving as a gift to another cast member. The possibilities are endless, so make
choices in the context of the brand."*

**The team picks the scene.** This is delegated, not prescribed. What follows is a starting bank,
not a menu to cycle through in order, and inventing a new location that fits the brand is the
preferred move over reusing one from this list.

**Starting bank.** Bedroom. Bathroom and shower-adjacent. Kitchen at night. A guest chair on a
podcast set, headphones on, mid-sentence. Beach and beach house. Camping and a tent at golden hour.
A hotel room and an open suitcase. A car at a trailhead. A bookshop or a market. A rooftop or a
balcony at dusk. A gift being handed from one cast member to another. Two cast members getting
ready to go out. A bath being run. Packing for a trip. A long weekend morning with nowhere to be.

**What makes a location on-brand.** Warm, lived-in, private or semi-private, and plausibly this
person's actual life. Not a studio, not a showroom, not a props table. The ground lock and the
warm-light mandate in `docs/design-doctrine.md` §4 still bind, and the ceiling is §3.2a as always.

**Variety is a rule, not an aspiration.**

- **No location repeat inside 8 consecutive Instagram product posts.** Bedroom is the default every
  model reaches for, so it is the one most likely to violate this.
- **No cast member carries more than 2 of any 5 consecutive product posts.** A rotation with one
  face is not a cast.
- **Every run states, in its decision event, the location and cast member chosen and the last time
  each was used.** A rule nobody reports on is a rule nobody keeps. Until the rotation is tracked
  in data (ticket filed 2026-08-19), derive it by reading the last 8 posted and drafted rows.
- **Two cast members in frame is licensed and encouraged**, including one giving the product to the
  other. §3.2a already licenses two people touching.

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
| **A** | **Resource.** The advice post, and the reason a non-buyer follows us. | Field Notes, Ask Emma, Inspo Carousel, WTF Is… | **Yes when the advice is about a category we sell** (§3.9); no only when the subject has no product in it |
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
- **Prefer the carousel for the resource slot until the standing carousel target is met (ticket
  #5940).** Single-image resource stills keep failing the publish gate and carousels carry roughly 9x
  the saves, so while the standing target of at least one carousel published (Step 7 slate-mix
  self-check) is unmet, the resource slot (A, or E when scheduled) prefers the carousel format at least
  once per rolling 7. This is a preference, not a new quota: it sits inside the §3.3 cadence (up to 5 a
  week, never two days running) and steps aside once the target is met. Report the carousel count in
  every retro, which Step 7 already computes.
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

## 4c. Event triggers: what on the site earns a post

Owner question, 2026-08-19: *"What are all of the events on the site the team can come up with as a
reason to create a new post on Instagram to promote?"*

This section is the answer, and it is deliberately a **short list with evidence** rather than a long
list of everything imaginable. Each entry says whether the data behind it actually exists, because a
trigger with an empty table behind it is a proposal, not a trigger, and writing it down as though it
were real is how a routine ends up waiting for an event that can never fire.

**The governing finding, and it is counter-intuitive: the frequent events are the bad triggers and
the rare events are the good ones.** New products go live in bursts of a dozen a day and most are
interchangeable. A genuine restock after a real stockout happens rarely and is worth saying every
time. Volume is not signal.

**An event does not buy a new slot.** The daily slate (§4a) is already fully assigned. An event wins
**first right of refusal on the slot that was going to be a generic instance of that format anyway**,
and it still obeys the campaign's visual scheme, the §3.7 cast mandate, and the §3.8 variety rules.
Budget roughly **one event-sourced post per day, at most**. An event never justifies skipping a gate,
and "it is news" is not a reason to cut the cast composite.

### Tier 1: live today, with data behind them

| Event | Where it comes from | Cadence | State |
|---|---|---|---|
| **Notebook post published** | `routine-content-daily.md` Step 6 files a `notebook-promo:<slug>` row targeted at social | near-daily | **Working.** Read at Step 1 item 9, never at Step 7b. |
| **New product live** | `server/webhooks.ts` files `kind:'process'`, `dedupeKey:'new-product:<handle>'`; the enrich chain files one batched `new-products:enrich:<day>` row per publish run | bursty, ~15/day when an import batch lands | **Working since 2026-09-01** (PR #1007 added the missing `targetTeam:'social'`; before that every row was invisible to the mailbox query). See below. |

### Tier 2: live since 2026-09-01 (was: detector built, not reaching social)

**Restock after a true stockout.** `isRestockCrossing()` and `handleInventoryUpdate()`
(`server/webhooks.ts:580`) detect a genuine 0-to-positive crossing, with guards against routine
noise and against the first observation. The crossing calls `triggerBackInStock()` (Klaviyo email)
AND, since ticket #5430, files one batched `restock-digest:<day>` row per UTC day at social
(`app/lib/restock-digest.server.ts`; routed with `targetTeam:'social'` since 2026-09-01, PR #1007).
So this tier is live, not waiting to be built. Frame it as mechanism or quality ("why this one
keeps selling out"), never as scarcity. "Back in stock" as urgency is the sale-signal register the
charter and the gate both refuse.

### Tier 3: schemas waiting for traffic. Do NOT build against these yet

Stated so nobody proposes them again without checking:

- **Reviews.** `reviews` holds **one** row, a test from 2026-04-03. `review_media` 0,
  `review_attribute_ratings` 0, `review_invites` 0, and `order_line_items` is empty, so the
  invite chain has no input. There is no threshold to cross.
- **Co-purchase.** `product_copurchase` is **0 rows**, and `app/lib/recommendations.server.ts`
  documents that it returns `[]` for every handle. No writer job exists. This is not a someday
  trigger, it is a never-started one.
- **Wishlists.** 33 items ever, top product at 2 saves, stale since 2026-07-29. "Most saved"
  on n=2 is fabricated proof, which §6 of the doctrine bans outright.
- **Dial and product votes.** `pdp_dial_votes` and `pdp_product_votes` are both 0.
- **`deal_history`.** 5,018 rows but `max(deal_date)` is the sentinel 2099-12-31, left from the
  retired daily-deal system. Dead table. Do not read it as live.

### Never on Instagram, and this is settled

**Price drops, clearance, sales, and promo codes.** `social-publish-gate.server.ts` blocks
`sale-price`, `sale-discount`, `sale-promo-code`, `sale-cta`, and `sale-pdp-link` by construction,
and §6 says the same. The volume is real (`pricing_audit_log` carried 194 discontinued-clearance and
226 margin-recompute entries in a fortnight) and it is all unpostable here. **Route every price event
to email and X and do not build an Instagram price lane.** Do not attempt a clever framing that
technically clears the regex; the gate is doing its job.

### The exclude list, for any product-triggered post

Learned from sampling the 37 stranded rows. A product that trips any of these does not get a post,
however new it is:

- **Discontinued or on clearance.** A "new find" post for a SKU that 404s in three weeks is the
  worst available outcome. `pricing_audit_log` rationale containing `Discontinued` is a hard exclude.
- **Dead velocity.** Rationale `dead -> target margin`. The pricing engine's own words say nobody is
  buying it.
- **Commodity consumables.** Condoms, toy cleaner, coconut oil lube, delay wipes, oral gel. These are
  accessory-tier restocks that happened to get a fresh Shopify id, not launches. A mandatory cast
  composite is real spend, and there is nothing new to say.
- **Off-theme novelty.** The current batch contains a cannabis-leaf sticky-note pad sitting beside
  the featured vibrators. One such post undercuts "editorially curated sexual wellness" for a week.
- **No distinct story.** If the SKU has no distinct mechanism, material, or use case versus ten
  others already in the catalogue, it is filler. At this account size filler reads as having nothing
  to say, which is worse than posting less often.

### Why the product-live trigger produced zero posts until 2026-09-01, and what changed

Two stacked defects, both fixed (owner audit 2026-09-01, PR #1007). First, every filer set
`team:'social'` but no `targetTeam`, and the routine's mailbox query filters on strict
`targetTeam:'social'` equality, so the rows were invisible: 465 products published in the prior 30
days produced zero social coverage. Second, the enrich-chain row filed `kind:'campaign'`; it is now
`kind:'process'`, matching the webhook half (#4360). Note the earlier version of this section
claimed `RUN_CLOSE_KINDS` is `['process','strategy']` and that the queue was a permanent dead end;
that was stale even then. The actual list is `['process','strategy','campaign','promo']`
(`app/lib/team.server.ts`, `RUN_CLOSE_KINDS`), so runs can close what they act on. **The queue IS
a source of drafts now:** read it at context load, draft against it, and close rows with the run.

## 5. The schedule

**The Instagram track is parallel to the homepage theme week, not the same campaign.** Three real
mismatches make sharing one row wrong: the homepage turns over weekly on a Monday changeover while an
Instagram arc wants 11 to 14 days; a homepage theme must resolve to a hero SKU while an arc like "The
Orgasm Gap, Closed" has no single hero and should not be forced to find one; and the homepage runs the
desire-forward register at 9 in full vocabulary while Instagram runs at 9 by implication with no
sale attempt at all (since 2026-08-22). Tying them together would either water down the homepage or
push homepage vocabulary into a caption, which is exactly what gets a post pulled. Where the windows overlap, the two channels reinforce each other
through the coordination note below, never by sharing a row.

Working titles. Every caption still goes through the voice gate; a name here is a subject, not copy.

| Window | Campaign | Kind | Subject | Coordination |
|---|---|---|---|---|
| 2026-08-12 → 08-24 (13d) | **The Vibrator Field Guide** | category | Vibrators, air-pulsation, wands: how each mechanism actually differs, which style suits which body, care and cleaning. | Hands into the homepage's Wand Week at the tail (08-24). |
| 2026-08-25 → 09-06 (13d) | **Talk Yourself Into It** | live-better | Communication, consent, checking in, asking for what you want as a learnable skill. | Echoes the homepage's "Start Here, No Wrong Answers" (08-31). |
| 2026-09-07 → 09-19 (13d) | **Lube, Actually** | category | Water, silicone, hybrid. Body-safe materials, what degrades what, why the right one changes everything. | Coincides with the homepage's "The Long Weekend In" (09-07). |
| 2026-09-20 → 10-02 (13d) | **The Orgasm Gap, Closed** | live-better | Why partnered pleasure is unequal by default, what actually closes the gap, and how external stimulation and taking more time change the outcome. Mechanism and experience, not anatomy: see §6a. Education and inspiration, no single hero SKU. | Standalone. The anatomical version of this subject runs on the Notebook, in email, and on X. |
| 2026-10-03 → 10-15 (13d) | **Prostate 101** | category | The category, body-safe materials, prep, and going slowly. Same §6a exposure as the 09-20 window: on Instagram the copy is mechanism, material and comfort, never anatomical vocabulary. | Standalone. The anatomical version runs on the Notebook, in email, and on X. |
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

## 5a. The message, and the two-week slate (owner direction 2026-08-22)

Owner direction, verbatim: *"Dig into the psyches of our potential customers (who are mostly female)
and find a message that drives curiosity and a desire to learn more."* And: *"Come up with a post
schedule that aligns with a message or a strategy."*

**The message: "What you haven't asked for yet."** Every post plants one question the reader has not
asked out loud, about her own evening, her own body, or the person next to her, and the product is
the answer one tap away. It is built on what the research says moves this buyer (sources in
`docs/store-team/social-research-2026-08-22.md`): the orgasm gap is real and not her fault (95% vs
65%, Frederick 2018); couples who talk about it finish every time at 87% against 3.5% for couples
who do not (We-Vibe 2025); toys in partnered sex raise satisfaction and 62% of partners have gifted
or would gift one; stress, sleep, and exhaustion are the three named barriers; 65% have sex for
stress relief and 60% for sleep (Lovehoney 2026); and the thing stopping the first purchase is
embarrassment, which discretion dissolves. Curiosity is the lever on every one of those, and
permission is the tone: she is allowed to want more, and she is allowed to ask.

**The weekly rhythm.** Seven lanes, one per weekday, each a recurring question. Carousels carry
roughly 9x the saves of a single image and single images are losing reach year on year (Metricool,
2026), so three of the seven are carousels and at least one a week is a Reel.

| Day | Lane | The question it plants | Shape | Product |
|---|---|---|---|---|
| Mon | **The Gap** | "Is it just me?" The numbers that say it is not. | Carousel, text-led, one ceiling-adjacent frame | Optional, named |
| Tue | **Any Hour** | "Why wait for bedtime?" Anticipation in daylight, product on skin, the door open. | Single still at the ceiling, cast member | Yes |
| Wed | **WTF Is…** | "How does that even work?" Mechanism as curiosity. | Carousel, 5-6 slides, last slide is why she cares | Yes |
| Thu | **Say It** | "What would you want them to know?" Partner and couples. | Reel or still, two cast members, Send This To | Yes, couples-coded |
| Fri | **Lights On** | "Who said this happens in the dark?" Two cast members, daylight, curiosity on both faces. | Single still at the ceiling, two cast | Yes |
| Sat | **Nightstand** | "What is actually in the drawer?" Care, lube, storage, pairing. | Still or carousel, product and its companion in frame (§3.9) | Yes, the care or lube product |
| Sun | **Ask Emma** | "Can I ask you something?" The embarrassed question, answered warmly and hot. | Text-on-image still or Story poll, confession shape | Optional |

**The first slate, 2026-08-24 through 2026-09-06**, riding the Vibrator Field Guide tail into
"Talk Yourself Into It" (§5). Working subjects; every caption still goes through the gate.

| Date | Lane | Subject | Product in frame |
|---|---|---|---|
| 08-24 Mon | The Gap | 95 vs 65, and the one habit that closes it | Air-pulsation toy, named |
| 08-25 Tue | Any Hour | The lipstick-sized wand that lives in your bag, a Tuesday at 2pm | Mini wand against an inner thigh, daylight |
| 08-26 Wed | WTF Is… | WTF is air pulsation (why it is not a vibrator) | Air-pulsation toy |
| 08-27 Thu | Say It | Send this to the one who keeps asking what you want | Couples ring or wand, two cast |
| 08-28 Fri | Lights On | Saturday, 11am, curtains open, two of them and one wand | Wand, two cast, bed in daylight |
| 08-29 Sat | Nightstand | Silicone on silicone: the pairing that ruins a toy, and the one that does not | Water-based lube beside the toy |
| 08-30 Sun | Ask Emma | "Is it weird that I want it more than he does?" | None |
| 08-31 Mon | The Gap | Couples who talk finish every time: 87% vs 3.5% | Optional |
| 09-01 Tue | Any Hour | A rabbit on a lunch break, why slow is a choice and not a schedule | Rabbit, thigh, kitchen daylight |
| 09-02 Wed | WTF Is… | WTF is a rumbly motor (and why buzzy ones numb you out) | Wand |
| 09-03 Thu | Say It | Year-five gift guide: the one you open together | Gift handed between two cast |
| 09-04 Fri | Lights On | Stress relief nobody puts on the self-care list, at noon | Bullet, bath edge, skin, window light |
| 09-05 Sat | Nightstand | Wash before, wash after, and the cleaner that makes it a ten-second job | Toy cleaner and the toy, held |
| 09-06 Sun | Ask Emma | "How do I bring it up without making it weird?" | None |

Drafted captions, alt text, hashtags, and image briefs for the first week live in
`docs/store-team/social-slate-2026-08-24.md`; the routine drafts from them rather than from scratch
**while that slate's window is open.** A slate file is a convenience, not a dependency: when the
current slate's window has ended and no successor file exists, the routine drafts from this
document's campaign table, weekday lanes, and pillars directly, and says so in the run summary
instead of stalling or treating the expired slate as current.

**What the owner approved on the first rendered set (2026-08-22), so the team leans toward it:**
the partner-sharing frame is the one to make more of: *"A partner sharing a toy with their partner!
YES"* (Sofia handing Marcus the ring on a sunlit sofa). Two cast members, one product passing
between them, both faces in on it. The small honest detail earns the look: the little bit of hair
below the navel in the balcony frame was called out as the thing that makes you look; briefs keep
one such detail per frame. And product scale is a defect the owner sees first: the Womanizer Next
rendered far too large and the bullet far too small. Every product in frame, including a second
product, gets a reference photo passed and a stated length in the prompt (`scaleCueFromLengthInches`),
and the spec-length lookup returned nothing for all six products, so the length comes from the
manufacturer page until `xdipx.specifications` is populated.

**Daylight and an open door are the default frame** (owner direction 2026-08-22): night is one
option, never the rule, and no caption personifies time or trades on its scarcity. **Name the
fact, imply the act, never gesture:** "orgasm gap" is written out, "gets there" is not
(`emma-voice.md` social addendum).

The lanes persist past this slate; the subjects rotate with the campaign calendar. A lane that
underperforms for three weeks on saves and comments is swapped, and the swap is filed, not improvised.

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

## 6a. Subject versus surface: a campaign may be anatomical, an Instagram caption may not

**Standing rule (ticket #4065).** The *subject* of a campaign may be anatomical. **Instagram
surface copy never is.** The anatomical version of the same campaign runs on the Notebook, in
email, and on X, where policy permits it and where xdipx owns the surface. The Instagram beat
points at it and drives the reader there.

**Why this is a rule and not caution.** Bellesa (@bellesaco), roughly 700K followers in this exact
category, was suspended on 2026-03-28 for sexually explicit language in **organic** content,
reportedly the word "clitoris", and the appeal was upheld. Meta's Community Standards put explicit
or graphic detail about genitals in the **removal** tier, not the age-gate tier. Sources:
riverfronttimes.com/metabannedbellesa/ and xtramagazine.com/video/bellesa-instagram-ban-sexual-health-281447;
full context in `docs/store-team/competitor-social-teardown-2026-08.md` §2. One honest correction
to keep the citation accurate: @bellesaco resolves today as an age-gated but existing profile, so
the account came back through a path the coverage does not record. **Cite the ban. Never cite the
deletion as final.**

**What to do instead, and it is not a euphemism treadmill.** Meta's ad standards permit content
whose focus is health and medical efficacy and prohibit a focus on pleasure or enhancement, so
mechanism-and-health framing is the one workaround grounded in Meta's own written policy rather
than in folklore. Write the mechanism and the experience: "external stimulation", "most people need
more time", "what actually works for most bodies", "where the sensation comes from". These are
truthful, they are on charter, and they carry the same information.

**What this rule does NOT do.** It does not cancel a subject. The orgasm gap is a real, on-charter,
high-value topic and it is exactly the resource content the owner asked for. Only the **register**
and the **lexicon** move, and only on Instagram. This is the charter working as designed:
`docs/ads-policy.md` §Organic social already says platform policy outranks the charter on a rented
surface.

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
  whether posts go out *unattended* is one valve, `instagram_autopublish_enabled`, on the Social tab
  of `/admin/homepage-team`. Read it, never assume it: a run that reports posts as published when the
  valve is off is worse than one that reports nothing. It is not the whole story of what is live,
  though, and do not report it as such: since 2026-08-23 the owner's own Post-now click publishes a
  still with the valve off, so a post can be live that your run never published.
- **`approved` alone is not a licence to publish.** The publish job refuses any row without a gate
  PASS stamp in its `feedback`, including one the owner approved by hand. A row reported as
  `no_gate_verdict` is a row nothing adversarial has read; it goes back through the gate, never
  around it. This governs the scheduled job. The owner's own Post-now click stopped requiring the
  stamp on 2026-08-23 by his direction, keeping only the deterministic checks; that is his path, not
  yours, and it changes nothing about what you must do before a row reaches him.
- **No engagement is captured.** `social_posts` has no metrics column and nothing reads Instagram
  insights, so "which posts worked" is unanswerable. `video_jobs.metrics_json` plus its owner
  self-report merge is the existing precedent to mirror. Adding the column is a migration, so it is a
  protected path and an owner merge.

## 7a. Hashtags

Five to eight per post, on their own line after the engagement close. Two broad category tags
(#sexualwellness, #sexualhealth, #intimacy, #selfcare), three niche tags on the post's subject
(#bodysafe, #wandmassager, #airpulsation, #lube, #couplesintimacy, #toycare), and one or two specific
to the post or campaign. Hashtag following was removed from Instagram in December 2024, so tags are a
search keyword signal and not a reach play; the first caption line and the bio carry more weight.
Verify every tag in-app before first use: a tag whose recent posts are hidden is restricted and is
dropped. Never #sex, never an anatomy tag, never an emoji, never a tag from a known-restricted list
(#woman, #women, #dating, #goddess, #curvy, #kissing, #adultsonly are all on 2026 lists), and never a
coded or reclaimed tag to route around a block.

## 8. Brand tagging

Tag a maker only from a **verified** handle. `docs/store-team/brand-ig-handles.json` is the registry
named by the charter, created by ticket #3732 with per-entry verification evidence and validated by
`scripts/check-brand-handles.ts`. Only non-null entries may be cited for tagging; an all-null entry
is a documented "could not verify", not an invitation to guess. The rule is unchanged: **not in the
registry with a handle, no tag.** Never guess a handle. A wrong tag is worse than no tag. Note that
an IG @mention today is caption text only (it notifies but is not a tag); real `user_tags` plumbing
in the publisher is a separate follow-up.
