<!-- Drafted 2026-09-20 at the owner's all-hands as a simulated end-to-end run of the on-skin campaign. Working drafts: every caption still goes through the voice gate and the publish gate. Product stock, MAP, specifications and the cast roster were verified LIVE against Shopify and Sanity on 2026-09-20, not carried over from the 08-24 slate. Two of the four posts are blocked on a content dependency named in section 0; read that before briefing anything. -->

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

## 0. Blocking dependency: no cast member has a body reference photo

**Verified live on 2026-09-20 against Sanity project `0nlwk8cf`, dataset `production`, `published`
perspective, with a real token.** All eight cast members are `active` and `approvedForUse` with a
`referencePhoto`: Diego, Emma, Jade, Marcus, Maya, Priya, Sofia, Vivian. **`bodyReferencePhoto` is
null on all eight, and `skinToneNote` is null on all eight.**

§3.7's three-clause test says an on-skin close crop is a cast member in a scene only when "(a) it is
generated from that cast member's approved BODY reference and the `castSlug` on the row names them".
Clause (a) cannot be satisfied today. Ticket #10270 added the schema field and the selector; nobody
has uploaded a photo into it, and approving a cast likeness is the owner's call, not the team's.

Two further gaps found in the same pass, both verified by search:

- **`presenterPhotoUrlForCrop` (`app/lib/sanity.server.ts:467`) has no callers.** It is the function
  that decides to pass the body reference for a `macro` or `close` crop. `scripts/gen-social-image.ts`
  never consults it; `--presenter-image` is a caller-supplied URL. So the selection ticket #10270
  describes as "wired" is not reached by the generation path.
- **It degrades silently.** `presenterPhotoUrlForCrop` returns the portrait reference when no body
  reference exists, and its own docstring names the reason: "the owner has not approved one". Nothing
  logs, warns, or blocks. A close-crop on-skin frame generated today is built from a 576x1024
  portrait, the model invents everything below the neck including skin tone, and the run reports success.

**What this does to today's slate.** A `medium` or `wide` crop correctly uses the portrait reference,
which is approved and present, so those frames are shippable now. A `macro` or `close` crop is not.
So of the four posts below, **IG 2 and X 2 can ship today; IG 1 and X 1 are held** at the image step
and their briefs are written ready for the moment a body reference lands.

This is the on-skin campaign's real state on day 1: the code is merged, the wiring stops one step
short, and the content dependency is empty. It is not visible from any page, which is why a dry run
found it and three weeks of live runs did not.

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

## 3. IG 1 — slot B, campaign beat. HELD at the image step (§0)

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

**§3.7 three-clause check:** (a) **FAILS today.** Requires Maya's approved body reference; `bodyReferencePhoto` is null. (b) adult identity marker: two brass chains plus her own hand and forearm, inside the crop. (c) trace of the world: the hour of the light, the oak floor, and the linen entering frame.

**Status: HELD.** Everything except clause (a) is ready. This post ships the day a body reference for Maya is approved and `presenterPhotoUrlForCrop` is actually called by the generation path.

---

## 4. IG 2 — slot C, Today's Pick. SHIPPABLE TODAY

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

In the same national survey, the women who orgasmed more often reported more oral sex, longer sessions, and asking out loud for what they wanted. Not better luck. Three specific, learnable things, and one of them is just refusing to hurry.

The Le Wand Classique is built for the unhurried version: 606 grams, a deep steady motor instead of a quick buzzy one, a flexible neck, and a run time measured in hours rather than minutes. It is made to stay exactly where you put it, long past the point most people give up and reach for something faster.

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

**Status: SHIPPABLE.**

---

## 5. X companions

Both carry an image with an approved cast member in it (`social-crossplatform-strategy.md` §4a), generated at 16:9 with `--platform x`, never a centre crop of the 4:5 Instagram key art. **The imagery fence on X is identical to Instagram's** (§3.2a), because `postTweet` cannot label sensitive media (ticket #10277). What X buys is caption register, a link, and the number, and it buys nothing inside the frame.

Neither post names a price. See §1: the MAP gate was run and both heroes fail it or fall under the 10% surfacing floor.

### X 1 — companion to IG 1. HELD with IG 1

`castSlugs: ["maya","marcus"]`, `sceneLocation: "bedroom-late-morning"`, `cropScale: "medium"`

**Weighted length: 278/280**, measured with `weightedTweetLength()`.

```
95% of straight men orgasm most times. 65% of straight women do. The gap is contact: most women need clitoral stimulation, not penetration.

Womanizer Classic 2 pulses air over it. Pair with JO H2O Cooling, water-based, toy-safe.

https://xdipx.com/products/womanizer-classic-2-rechargeable-silicone-pleasure-air-clitoral-stimulator?utm_source=x&utm_medium=social&utm_campaign=orgasm-gap-closed
https://xdipx.com/products/jo-h2o-cooling-water-based-lubricant?utm_source=x&utm_medium=social&utm_campaign=orgasm-gap-closed
```

**Image brief:** Maya and Marcus, bedroom, overcast diffuse late-morning light, 16:9. Two cast members in frame is preferred on ceiling frames per §3.2c. Marcus bare to the waist; Maya bare with the oatmeal linen throw drawn across her hips closing the lower edge and her arm crossed tight closing the upper. His hand flat on her waist. The Classic 2 in her hand, held out between them, 148 mm at true scale. Both faces in frame, reading curiosity rather than verdict. Same negatives as §3.

**Why it is held:** the frame itself is `medium` and would pass clause (a). It is held with IG 1 only so the two halves of one campaign beat ship together; drafting them apart is what §1 of the cross-platform strategy exists to prevent.

**No opinion is attributed to either cast member.** The caption is mechanism and a pairing fact. §4a's rule bites hardest here, because a synthetic face now sits beside a checkout link.

### X 2 — companion to IG 2. SHIPPABLE TODAY

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
- **Shippable vs held:** 2 shippable (IG 2, X 2), 2 held on the §0 body-reference dependency.
- **Volume ladder:** rung unread this session. The last value written to a document is `social_freq_instagram = 3` (owner, 2026-08-16); read the live value, never that sentence.
- **Mix report:** `npx tsx scripts/report-social-mix.ts` would run at Step 7. Expect the body-zone and close-crop lines to read UNKNOWN, because the migration-099 columns are null on every row drafted before today. UNKNOWN is not clean.

## 8. Open questions for the owner

1. **Body reference photos.** Eight cast members need one before any close or macro on-skin frame can ship. Whose, and how explicit? The owner approves cast likeness.
2. **A vibrator over a nipple** remains owner-only and unresolved (§3.2c). It is not needed for this campaign.
3. **The MAP floor breaches in §6.**
