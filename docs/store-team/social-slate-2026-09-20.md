<!-- Drafted 2026-09-20 at the owner's all-hands as a simulated end-to-end run of the on-skin campaign. Working drafts: every caption still goes through the voice gate and the publish gate. Product stock, MAP, specifications and the cast roster were verified LIVE against Shopify and Sanity on 2026-09-20, not carried over from the 08-24 slate. The content dependency that blocked two of the four posts was cleared by the owner later the same day; section 0 records what changed and all four are now briefable. -->

# Instagram + X slate, week 1 of "The Orgasm Gap, Closed" (09-20 to 09-26)

Campaign: **The Orgasm Gap, Closed**, `live-better`, 2026-09-20 to 2026-10-02 (`instagram-campaigns.md` §5).
Predecessor "Lube, Actually" closed 09-19. This is day 1, so §3.4 requires the scheme to be locked
before post 1; §2 of this file is that lock.

The 08-24 slate file's window ended 09-06 and no successor existed, so per §5a this slate was drafted
from the campaign table, the §5a weekday lanes, and the pillars directly. This file is that successor.

Sources: `docs/emma-voice.md` v5.5 social addendum, `instagram-campaigns.md` §3.2a/§3.2b/§3.2c/§3.7/§3.8/§3.9/§4b/§5/§5a/§6a/§7a,
`docs/store-team/social-crossplatform-strategy.md` §1/§3/§4a, `docs/ads-policy.md` §Organic social.
Numbers verified against `social-research-2026-08-22.md`.

---

## 0. RESOLVED the same day: every cast member now has a body reference photo

**Verified live on 2026-09-20 against Sanity project `0nlwk8cf`, dataset `production`, `published`
perspective, with a real token, TWICE: once when this slate was drafted and once after the owner
acted.** All eight cast members are `active` and `approvedForUse`: Diego, Emma, Jade, Marcus, Maya,
Priya, Sofia, Vivian. At drafting time `bodyReferencePhoto` and `skinToneNote` were null on all
eight. **At 16:54 to 17:02 UTC the same day the owner uploaded and approved a `bodyReferencePhoto`
and a `skinToneNote` for every one of them.** Blocker #182 is cleared.

§3.7's three-clause test says an on-skin close crop is a cast member in a scene only when "(a) it is
generated from that cast member's approved BODY reference and the `castSlug` on the row names them".
**Clause (a) is now satisfiable.** Ticket #10270 shipped the schema field and the selector, the
owner supplied the asset, and commit cf96753f wired `resolveCastReference` into both image routes.

**So IG 1 is NO LONGER BLOCKED.** The close hip-hollow crop is the frame this slate exists to make
and it can be generated. Emma is also available as a cast member for on-skin frames, per the owner's
answer to blocker #193 on the same day.

**The one caveat, narrowed.** `scripts/gen-social-image.ts` resolves the body reference correctly
via `--cast-slug`, and it refuses rather than substitutes: a hand-passed `--presenter-image` with a
macro or close crop exits 1, and a cast member with no `bodyReferencePhoto` exits 1. What it does
not do is go through `resolveCastReference`, so `withSkinToneNote` and the bare-product picker do
not run on that path. Ticket #10475. Generate close crops with `--cast-slug`.

**What the original finding got right, and keep it.** The regression this slate diagnosed was
structural, not accidental: the pipeline has a BLOCK and no BORING, so cold costs nothing and the
run retreats every day, and the one frame that would have corrected it was the one the missing asset
blocked. The asset is here now. The gradient is not fixed by the asset, and the mix report
(`{op:mixReport}`) is what makes cold visible. Read it before briefing.

---

## 1. Live verification performed for this slate

Everything here was read today, not carried over.

| Check | Source | Result |
|---|---|---|
| Stock + status, all 4 handles | Shopify Admin | All `ACTIVE`. Classic 2: 44. Le Wand Classique: 16. JO H2O Cooling: 132. Zola mini: 486 |
| `xdipx.specifications` | Shopify metafield | **Populated.** Classic 2: 148 x 48 x 35 mm, 110 g. Le Wand Classique: 330 x 63 x 63 mm, 606 g. The 2026-08-22 note that spec length "returned nothing for all six products" no longer holds; `scaleCueFromLengthInches()` has real input |
| MAP gate | `mapAllowsDiscountDisplay()`, run against live metafields | Classic 2 **NOT ALLOWED** (map 129.00 == original 129.00). Le Wand Classique **ALLOWED** (map 125.99 < original 139.99). JO H2O Cooling **NOT ALLOWED** (no map/original metafields at all) |
| MAP floor | live price vs `map_price` | **Classic 2 is priced $116.99 against a $129.00 MAP floor: a $12.01 violation.** See §6 |
| Cast roster | Sanity, authenticated, `published` | 8 approved. `bodyReferencePhoto` null on all 8 (§0) |
| Brand handles | `brand-ig-handles.json`, 20 vendors | Womanizer: **absent**. Le Wand: **absent**. System JO: `_shopjo` (IG), X null. So no maker tag on any post below except an optional `@_shopjo` if a lube is ever named on IG |
| X caption length | `weightedTweetLength()` from `app/lib/social-publish/x-limits.ts` | X 1: 278/280. X 2: 273/280 |

**No number appears on either X post, and that is now proven rather than assumed.** §4b requires the
MAP check before any value framing goes anywhere. It was run. Both heroes fail it or fall under the
store's own 10% surfacing floor (`MIN_DISCOUNT_BADGE_PCT`): Classic 2 is MAP-locked, and Le Wand
Classique's save against list is 9%, which `showDiscountBadge()` returns false for.

---

## 2. Locked visual scheme (§3.4, decided once, before post 1)

"Lube, Actually" has no scheme recorded in any document. Its de facto look is on the record instead:
§3.9a says 7 of its last 7 Instagram posts were product-free hands-and-strand lube macros. The
difference rule is measured against that, and stated as an assumption rather than a reading.

| Field | Locked value |
|---|---|
| `groundSet` | Primary **plum-soft**. Secondary paper-2. Punctuation coral-soft. |
| `lightSignature` | **Overcast diffuse, late morning.** Open shadows, no hard-edged band. Deliberately not the Field Guide's diagonal shaft: an even light is what lets a bare contact zone read as skin rather than as chiaroscuro. |
| `rhymeProp` | **A folded oatmeal linen throw with a visible selvedge edge.** Chosen so the campaign's recurring object is also its compliance device: §3.2c measured that an inanimate closer held the frame edge in 5 of 5 attempts while a limb named by region held in 0 of 4. |
| `rhymeColor` | Warm brass (fine jewellery, a drawer pull, a lamp collar). |
| `surfaceMaterial` | Pale oak. |
| `castSlate` | `maya` and `marcus`. Two, the maximum. Changes the slate off `priya`. |
| `wardrobeRegister` | Non-on-skin frames: an unbleached cotton robe, worn open and loose, and nothing under it. **On-skin frames carry no clothing at all** per §3.2c; the brief states what closes the frame instead of what covers the body. |
| `cropSignature` | Subject on the right third, air left, the linen's selvedge entering the bottom-left corner. Flip-tolerant per §3. |
| `retiredForCampaign` | **The hands-and-strand lube macro**, retired by name so the predecessor's tic cannot carry over. Also styled tabletops, packshots, centred symmetry, night. |

**Difference against the predecessor (§3, needs 3 of 5):** primary ground (unrecorded product-free
macro ground to plum-soft), rhyme prop (none to the linen throw), cast slate (no cast at all to
maya/marcus), light signature (macro-lit to overcast diffuse). **Four of five.**

---

## 3. IG 1, slot B, campaign beat. CLEARED to generate (§0)

**Product:** `womanizer-classic-2-rechargeable-silicone-pleasure-air-clitoral-stimulator` (44 in stock)
**Subject:** External stimulation is the mechanism that closes the orgasm gap, and it is a different thing from a vibrator.
**Sensation sold:** recognition, then permission.
**Draft payload:** `castSlugs: ["maya"]`, `sceneLocation: "bedroom-late-morning"`, `bodyZone: "hip-hollow"`, `contactMode: "resting"`, `cropScale: "close"`
**Charge tier:** ceiling. §3.2b's ceiling-on-skin definition names the hip hollow explicitly.

**HOOK**
95% of straight men usually orgasm during sex. 65% of straight women do. That is not chemistry, it is contact.

**CAPTION**
95% of straight men usually orgasm during sex. 65% of straight women do. That is not chemistry, it is contact.

Most sex is built around the kind of contact he is guaranteed to get. Most women orgasm from a different kind entirely: external, unhurried, and mostly missing from the average bedroom.

That is the whole difference between a vibrator and a toy built around external stimulation. One presses in. The other works the outside, patient and direct at once, which is exactly the contact that closes the orgasm gap for a lot of women who assumed they just needed a better partner.

You are not the exception. You are the 65%, and you are allowed to ask for the kind of contact that actually works, out loud, in daylight, today.

Save this for the next time someone calls women harder to please. They are not harder to please. They have been reached wrong.

#sexualwellness #sexualhealth #orgasmgap #airpulsation #pleasureproducts #bodysafe #closethegap

**ALT TEXT**
A close, evenly lit frame in late-morning light: Maya lying on her side on pale oak with a folded oatmeal linen throw across the top of her thighs, a fine brass chain at her waist, the Womanizer Classic 2 resting in the hollow of her hip where it was set down.

**WHY SHE CARES:** the thirty-point gap turns a private "what is wrong with me" into a structural fact with a named mechanism, and hands her permission to ask for the contact that works instead of trying harder at the wrong one.

**IMAGE BRIEF**
Subject: the mechanism that closes the orgasm gap, resting against the body it is for. Feeling in the half second before she reads a word: recognition, then permission.

Maya, side-lying on a pale oak floor with the plum-soft wall behind her, overcast diffuse light from a large window out of frame to the left, late morning. Bare, no clothing anywhere in the picture, a fine brass chain at her waist and a second at her throat. The frame is filled by her hip, the dip of her waist and the outside of one thigh; **a folded oatmeal linen throw drawn across the top of her thighs closes the bottom edge**, and **her upper arm crossed tight over her chest closes the top edge**. One breast only, in profile, nipple covered by the arm's crossing. Subject on the right third, air to the left, the linen's selvedge entering the bottom-left corner.

Product: the Womanizer Classic 2, **148 mm long, 110 g**, resting in the hollow of the hip where it was set down, settled under its own weight. It does not press, dent, or push into the skin. Brief from a bare-product reference: walk the media list, the featured image is `79851B`, and confirm it is the product and not a carton before passing it.

Negatives: no nipple, no labia, no pubic line in frame, no product emerging from a navel, one navel on the front only, correct fingers and limbs with nothing merged or duplicated, no barcode, no printed panel, no carton, no legible text of any kind, no night, no styled tabletop, no hard shadow band. Do not say "paper"; the throw is warm off-white linen.

**Camera note, binding:** side-lying with one breast, never supine-from-above. §3.2c measured 6 of 6 fence breaches on breast-in-frame briefs sharing the supine-from-above composition.

**Placement-follows-use reasoning.** Air pulsation's actual use zone is an unconditional stop: §3.2a bans product against genitalia with no covering exception. §3.2c's cock-ring precedent gives the move, which is to shift the frame rather than the fence. The hip hollow is the nearest licensed zone on the same path and it gives the product absolute scale against the pelvis. It also happens to tell the product's truth, because the Classic 2's whole mechanism is that it seals and pulses air rather than pressing, and a product briefed as *resting* is the honest picture of a contactless toy.

**§3.7 three-clause check:** (a) **PASSES.** Requires Maya's approved body reference, and the owner approved and uploaded one for her at 16:57 UTC on 2026-09-20 (verified live against Sanity). (b) adult identity marker: two brass chains plus her own hand and forearm, inside the crop. (c) trace of the world: the hour of the light, the oak floor, and the linen entering frame.

**Status: CLEARED to generate.** The original BLOCK had two reasons and the owner cleared the one
that mattered.

- The likeness risk was the real one, and it is gone: Maya has an owner-approved
  `bodyReferencePhoto`, so a close crop resolves her actual body rather than inventing one under
  her name. Blocker #182 cleared.
- `runDeterministicPublishChecks` still blocks on `media.length === 0`, which is simply the
  statement that no asset exists yet. That is what generating the frame resolves, not a gate
  finding to argue with.

Everything else in the brief was ready and the gate said so: the camera note, the closers, the
hip-hollow reasoning, the negatives. Generate the frame, then get a fresh gate read against real
pixels, which nobody has judged yet because none exist.

---

## 4. IG 2, slot C, Today's Pick. SHIPPABLE TODAY

**Product:** `classique-rechargeable-wand-massager` (Le Wand Classique, 16 in stock)
**Subject:** Taking more time is the other half of what closes the gap.
**Sensation sold:** anticipation.
**Draft payload:** `castSlugs: ["maya"]`, `sceneLocation: "sunroom-late-morning"`, `bodyZone: "thigh-top"`, `contactMode: "resting"`, `cropScale: "medium"`
**Charge tier:** ceiling, at medium crop. This is the §3.2c "at least one ceiling frame per rolling 7 wide enough to read a location", and holding it at medium is also what keeps the close-crop cap ("never two consecutive") intact on a two-post day.

Chosen over the Zola mini deliberately: the subject is duration and weight, not portability, and a 606 g wand's product truth is exactly the thing the caption is about.

**HOOK**
The study that found the orgasm gap also found what narrows it. More time was on the list.

**CAPTION**
The study that found the orgasm gap also found what narrows it. More time was on the list.

In the same national survey, the women who orgasmed more often also reported three things: more oral sex, longer sessions, and asking out loud for what they wanted. Nobody proved which way that runs. It is still a hard pattern to look away from, and one of the three is just refusing to hurry.

The Le Wand Classique is built for the unhurried version: 606 grams, a deep steady motor instead of a quick buzzy one, a flexible neck, and a run time measured in hours rather than minutes. It is made to stay exactly where you put it, long past the point most people give up and reach for something faster.

Give it JO H2O Cooling to work with. Water-based, so it will not degrade the silicone the way a silicone lube would, and it stays slick for as long as you are planning to take.

Today's pick, and worth an actual afternoon rather than the last ten minutes before sleep.

What is the longest you have ever let yourself take?

#sexualwellness #selfcare #wandmassager #orgasmgap #bodysafe #takeyourtime

**ALT TEXT**
Maya in a sunroom in late-morning light, an unbleached cotton robe open and loose, sitting back against a pale oak bench with an oatmeal linen throw over her lap and the Le Wand Classique resting along the top of her thigh, its neck bending under its own weight.

**WHY SHE CARES:** it reframes "I never have time for this" as a fixable habit rather than a character flaw, and names the product as built for the slow half of the mechanism the campaign already established, not a generic wand ad dropped into a conceptual week.

**IMAGE BRIEF**
Subject: the wand that is built to stay, resting where it was set down. Feeling before reading: anticipation, and the permission to take an afternoon.

Maya, seated and leaning back against a pale oak bench in a sunroom, plum-soft wall behind, overcast diffuse late-morning light. The location is readable: the window, the bench, the room. Unbleached cotton robe open and loose with nothing under it, breasts bare to the edge of the areola with the robe's own edge covering the nipples, a folded oatmeal linen throw over her lap closing the frame at the hips. Fine brass chain at the throat. Subject on the right third, air to the left, the linen selvedge entering the bottom-left corner.

Product: the Le Wand Classique, **330 mm long, 63 mm head, 606 g**, lying along the top of her thigh, the flexible neck visibly bending under its own mass, her hand resting loosely beside it rather than gripping. It rests; it does not press into the skin. Brief from a bare-product reference off the media list (`96380A` onward), confirmed text-free.

Negatives: no nipple, no labia, no pubic line, no product emerging from a navel, one navel on the front only, correct fingers and limbs, no wordmark legible at any zoom on the product body, no barcode or carton, no baked-in text, no night, no styled tabletop. Do not say "paper"; warm off-white linen.

**§3.7 three-clause check:** (a) **PASSES.** Medium crop, so `presenterPhotoUrlForCrop` correctly selects the portrait reference, which is approved and present for Maya. (b) adult identity marker: her face is in frame. (c) trace of the world: the sunroom, the bench, the hour.

**Status: REVISE, then shippable** (gate verdict, 2026-09-20). This slate first called it shippable,
which was premature, and the gate caught two things:

- **The pairing was missing from the caption.** `social-crossplatform-strategy.md` §3 is explicit
  that Instagram names the pairing without a link, and the X companion for the same SKU named JO
  H2O Cooling in the same run. It was simply dropped between the two platform drafts. Added above.
- **A correlation was written as a prescription.** The line read "Not better luck. Three specific,
  learnable things." Frederick et al. 2018 reports an association between higher orgasm frequency
  and more oral sex, longer sessions, and asking for what you want. It does not establish that
  doing those things causes the outcome. Rewritten above to report the pattern and say plainly that
  nobody proved which way it runs. No number was invented, but converting an association into an
  instruction is the same fabricated-proof failure the doctrine bans.

Both revisions are applied. Nothing else was flagged: §3.7's three clauses genuinely pass at medium
crop, the wardrobe and occlusion are compliant, no sale attempt, no image narration in the caption,
6 hashtags all in range.

---

## 5. X companions

Both carry an image with an approved cast member in it (`social-crossplatform-strategy.md` §4a), generated at 16:9 with `--platform x`, never a centre crop of the 4:5 Instagram key art. **The imagery fence on X is identical to Instagram's** (§3.2a), because `postTweet` cannot label sensitive media (ticket #10277). What X buys is caption register, a link, and the number, and it buys nothing inside the frame.

Neither post names a price. See §1: the MAP gate was run and both heroes fail it or fall under the 10% surfacing floor.

### X 1, companion to IG 1. CLEARED with IG 1

`castSlugs: ["maya","marcus"]`, `sceneLocation: "bedroom-late-morning"`, `cropScale: "medium"`

**Weighted length: 267/280**, measured with `weightedTweetLength()`.

```
95% of straight men orgasm most times. 65% of straight women do. Most women orgasm from clitoral stimulation, which penetration alone mostly misses.

Classic 2 pulses air over it. Pair with JO H2O Cooling, water-based.

https://xdipx.com/products/womanizer-classic-2-rechargeable-silicone-pleasure-air-clitoral-stimulator?utm_source=x&utm_medium=social&utm_campaign=orgasm-gap-closed
https://xdipx.com/products/jo-h2o-cooling-water-based-lubricant?utm_source=x&utm_medium=social&utm_campaign=orgasm-gap-closed
```

**Image brief:** Maya and Marcus, bedroom, overcast diffuse late-morning light, 16:9. Two cast members in frame is preferred on ceiling frames per §3.2c. Marcus bare to the waist; Maya bare with the oatmeal linen throw drawn across her hips closing the lower edge and her arm crossed tight closing the upper. His hand flat on her waist. The Classic 2 in her hand, held out between them, 148 mm at true scale. Both faces in frame, reading curiosity rather than verdict. Same negatives as §3.

**Status: REVISE, then shippable** (gate verdict, 2026-09-20). One finding, and the gate also
corrected this slate's disposition.

- **The exclusivity claim overreached.** The line read "most women need clitoral stimulation, not
  penetration", which states a physiological need and an exclusivity the 95/65 orgasm-frequency
  data does not establish, while running the two together as one finding. Rewritten above to report
  where the orgasm comes from rather than assert what anyone needs. Note the gate's own suggested
  rewrite used "gets there", which the charter names as a banned gesture, so it was not adopted.
- **Holding this with IG 1 was editorial, not compliance.** The frame is `medium`, so
  `presenterPhotoUrlForCrop` resolves to the approved portrait and clause (a) passes. The body
  reference gap never touched it, and that gap is closed now in any case. Shipping the two halves
  of one campaign beat together is a choice worth making, but it must not be recorded as a
  technical blocker it is not.

**No opinion is attributed to either cast member.** The caption is mechanism and a pairing fact. §4a's rule bites hardest here, because a synthetic face now sits beside a checkout link.

### X 2, companion to IG 2. PASS

`castSlugs: ["marcus"]`, `sceneLocation: "sunroom-late-morning"`, `cropScale: "medium"`

**Weighted length: 273/280.**

```
Stress and time are the top two named barriers to sex (We-Vibe, 2025). The fix for both is the same: slow down.

Le Wand Classique: slow and deep, not quick and buzzy. Pair with JO H2O Cooling, water-based and silicone-safe.

https://xdipx.com/products/classique-rechargeable-wand-massager?utm_source=x&utm_medium=social&utm_campaign=orgasm-gap-closed
https://xdipx.com/products/jo-h2o-cooling-water-based-lubricant?utm_source=x&utm_medium=social&utm_campaign=orgasm-gap-closed
```

**Image brief:** Marcus in the same sunroom, 16:9, the Le Wand Classique held across an open palm at true 330 mm scale so the length reads against the hand. Robe open, bare chest, brass chain. Rotates the face off Maya per §3.8's two-of-five rule. Same negatives.

**Pairing rule (§3).** JO H2O Cooling is water-based, so it is safe against the Classique's silicone. That is real material advice, not upsell theater: a silicone lubricant degrades a silicone toy. Sourced by material compatibility, since `accessory_product_ids` / `pairing_why` were not readable in this run.

---

## 6. Escalation: the campaign's lead SKU is priced below its MAP floor

Found while running the §4b MAP check for the X captions, and outside the scope of this slate.

**Womanizer Classic 2: live price $116.99 against a `map_price` of $129.00. That is $12.01 below the floor.** MAP violations are a supplier-relationship risk, not a storefront cosmetic.

It is not isolated. In a 50-product sample of active products read live today, **13 of the 17 products carrying a `map_price` were priced below it**: Bathmate Hydromax7 (-$16.00), Fantasy For Her Ultimate Pleasure (-$17.00), PDX Elite Fuck-O-Matic (-$17.00), Oh My Gem Revival Opal (-$36.40), and nine lubricants between -$1.81 and -$4.37.

`scripts/report-below-map.ts` (ticket #3714) exists for exactly this and its own header says the normal remedy is re-running the batch recompute now that `computePrice` clamps MAP after rounding. I did not run it (no Shopify credentials in this session; the numbers above come from live Admin API reads) and I did not change a price. Pricing is a money surface and `pricing-ops` never applies a price change itself. This needs the owner.

---

## 7. Run summary this run would owe

- **Campaign:** The Orgasm Gap, Closed, day 1 of 13. Calendar row would be promoted `planned` to `active` by the §4 reconciliation pass.
- **Slate:** the 08-24 slate expired 09-06 with no successor. This file is the successor and the runway is intact through 2026-11-09.
- **Drafted vs published, never conflated:** drafted 4 (2 Instagram, 2 X). Published 0. Nothing was filed to `social_posts`, nothing went through `social-publish-gate`, nothing reached the hourly publish job. This session has no team token or database.
- **Gate verdicts (Step 6.5, run adversarially on all four):** 1 BLOCK (IG 1), 2 REVISE (IG 2, X 1), 1 PASS (X 2). Both REVISE findings are applied above. IG 1's BLOCK was cleared by the owner the same day, see §0 and §3.
- **Charge ratio, stated plainly:** this slate carries two ceiling frames and, with §0 cleared, can ship both. Report the outcome and not the intent: count a ceiling frame when it posts, not when it is briefed. Reporting intent rather than outcome is how the last three weeks looked fine.
- **Volume ladder:** rung unread this session. The last value written to a document is `social_freq_instagram = 3` (owner, 2026-08-16); read the live value, never that sentence.
- **Mix report:** `POST /api/team/social-post {"op":"mixReport"}` would run at Step 7. Expect the body-zone and close-crop lines to read UNKNOWN, because the migration-099 columns are null on every row drafted before today. UNKNOWN is not clean.

## 8. Open questions for the owner

1. ~~**Body reference photos.**~~ **ANSWERED 2026-09-20.** The owner uploaded and approved a
   `bodyReferencePhoto` and a `skinToneNote` for all eight cast members. Blocker #182 cleared.
2. **A vibrator over a nipple** remains owner-only and unresolved (§3.2c). It is not needed for this campaign.
3. **The MAP floor breaches in §6.**

Also answered the same day, and none of them need anything further: Emma's likeness in an
implied-nude frame is licensed (#193), the §3.2c caps stay report-only (#194), on-skin frames may
appear in video (#192), and the Sanity Studio is deployed (#155).

## 9. Filed rather than fixed here

- ~~**Make the presenter-reference fallback loud.**~~ **DONE, and it landed before this file was
  finished.** Commit cf96753f wired `resolveCastReference` into both image routes, and
  `scripts/gen-social-image.ts` refuses rather than substitutes: a hand-passed `--presenter-image`
  with a macro or close crop exits 1, and a `--cast-slug` whose member has no `bodyReferencePhoto`
  exits 1 with the remedy. What remains is narrower and is ticket #10475: the CLI resolves the
  reference directly instead of through `resolveCastReference`, so `withSkinToneNote` and the
  bare-product picker do not run on that path.
- **Check `PAIRING_REQUIRED_TYPE_DIALS` covers `wand` and `air-pulsation`.** The gate's deterministic
  pairing check may not fire for either product in this campaign, which would explain how IG 2's
  missing pairing got past drafting and had to be caught editorially. Verify the live
  `product_type_dial` values for both SKUs and extend the set if they are absent.
- **One line separating mechanism-as-fact from mechanism-as-narration.** §6a licenses
  mechanism-and-health framing; License A bans mechanism-on-body description. The charter's own
  worked example ("air pulsation seals over the clitoris and pulses") resolves it, but the gate had
  to reason its way there. A clarifying sentence would save the next reviewer the trip.
