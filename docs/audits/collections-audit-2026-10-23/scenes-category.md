# Collection hero scenes: category and theme collections (art direction, 2026-10-23)

Planning only. Nothing generated, uploaded or edited. Every hero handle below was checked against
products.jsonl: ACTIVE, totalInventory > 0, product type not "Discontinued" (on-sale excepted, see
row), and a member of that collection today. Brand collections, deletes, the losing side of each
merge, and utility collections are out of scope.

Binding sources read: design-doctrine §4, §4.1, §4.2, §4.3; instagram-campaigns §3.2a, §3.2c, §3.2g,
§3.6, §3.7a; cast-wardrobe.md; `_layout.collections.$handle.tsx` (PLP hero, line 512) and
`_layout.collections._index.tsx` (hub cards, lines 182 and 232); CategoryMasthead.tsx (4:3).

---

## 1. Series bible

**Title: "One Saturday, every door open."** All ~90 images take place in one sunlit house on
one Saturday, from 8am to just after sunset. The owner's line is the brief: *"The door doesn't have
to stay closed, and we don't have to hide in the dark to use sex toys."* Each collection is one
moment in that day. The hub grid then reads as the day going by, the same eight people moving
through the same rooms.

**The day, by section (hub order follows it):**
- 8 to 10am, **Body** (lube, oils, care, bath). Waking up, warming up.
- 9am to 1pm, **Pleasure** (vibrators, dildos, anal, prostate, strokers). Solo time and the toy drawer.
- 3 to 5pm, **Wear** and **Discover** (getting dressed, packing, gifts, the hotel trip).
- 5:30 to 7pm golden hour, **Couples** and **Play** (bondage, furniture, couples toys).
- After, a handful of frames (toy cleaner, kegel) with the eased, afterglow mood. Emma is never in these.

**The house (four sets, used everywhere, so every frame looks like it came from the same house):**
| Code | Room | Wall (ground lock) | Bedding (cast-wardrobe table only) | Used for |
|---|---|---|---|---|
| W | The White Room | bright white plaster | crisp white cotton percale, cool grey in the folds; lilac washed cotton for Emma | Pleasure, solo, morning |
| C | The Coral Room | coral-soft lime plaster | coral-soft washed cotton, or white percale with a fine coral stripe | Body, wear, playful pairs |
| P | The Plum Room | plum-soft (lilac) plaster | lilac washed cotton by day; deep plum cotton sateen at golden hour only | Couples, play, Vivian |
| B / H | The bath; the hotel room | white tile with a window / plum-soft wall | white percale (hotel) | Silicone lube, hygiene, travel, long distance, bachelorette |

The fixed elements in every room: a tall window at **frame left** with sheer white voile, a pale
oak floor, a low bed, and one walnut nightstand whose drawer is the toy drawer.

**The cohesion devices (all of them, in every frame):**
1. **One light.** A single window key from frame left, always. A hard-edged mullion shadow rakes right
   across the wall, and the hour is named per row. High-key density, directional shape (doctrine §4
   item 2). The sun moves through the series and never switches sides, so the grid reads as one building.
2. **One lens.** 50mm full-frame equivalent at f/2.8, camera at mattress height with a level horizon.
   Three planes (P10): a soft foreground occluder in the outer 10% of the frame (voile edge, bed corner,
   door edge, a partner's shoulder), the subject sharp, the wall soft.
3. **Ground lock.** Walls only in coral-soft, plum-soft or bright white plaster. Never write the word
   "paper" or the words linen/cream/beige/ivory/oatmeal/nude/natural in a prompt (cast-wardrobe rule 4).
4. **One coral note per frame** (the coral budget): a coral garment, the coral stripe, or the product's
   own coral. Plum is the emphasis colour of the Plum Room. Each cast member wears the metal from their own closet.
5. **Recurring story cues, at most one per frame:** the half-open walnut drawer (the toy drawer), the
   bedroom door left open with hall light at the frame edge, a charging cable running out of frame, a
   phone face-down or screen-away, the cast member's own jewellery. Nothing else. No mugs, cups,
   books, journals, fruit, plates, flowers, or candles that are not the product.
6. **Hands as signatures.** In hands-only rows the hands belong to a named cast member and are
   recognisable by their metal: Sofia's gold cuff, Jade's single silver ring, Priya's stacked rose-gold
   rings, Marcus's matte black ring, Diego's steel watch, Maya's coral manicure. So even a collage row
   is a person from the house, never an anonymous hand on a seamless backdrop.

**Moments (§3.2g):** ANTICIPATION, CHOOSING, or (non-Emma, solo only) AFTERGLOW. Never during. Use
the stranger test: "she is about to" or "she just did". One sensation carrier per frame (the face or the
posture), never both at full strength.

**Product references are mandatory.** The owner's 2026-10-23 direction (*"feature specific products in
the collections as the hero"*) overrides the image-prompt-library default of no product reference on
collection surfaces. Each row passes the hero handles' real Shopify packshots as references, together
with the cast reference photo(s). Keep to at most 2 product references when there is a cast member in
frame and at most 3 in a hands-only row, because identity drift is the main BLOCK. On bottles and boxes
the label must face the lens and be **composited from the packshot, never rendered by the model**
(§3.6, ticket #5493). Garbled marks like "CULBUN" come from asking the model to draw a label. This also
covers the owner's note on asset 1153 ("the box does not have the product label on it").

**Owner rules that bind every row (from the 211 rejections):**
- The cast member **holds** the product, gripping it in the fingers the way it is held in use. Never
  floating, never presented on an open palm, never resting on or stuck to an arm, shoulder or back.
  Gravity: a hand carries it, or a surface facing up carries it.
- The product appears only where and how it is used, and the gender matches (§3.7a). A man holds a
  female-anatomy product only against a woman's skin.
- Lingerie covers the nipples with an opaque motif across the whole areola (about 5cm) and has an
  opaque, lined front panel. Smooth bare skin above the waistband.
- Correct product scale (except deliberate §4.2 levity, which is flagged per row), correct anatomy,
  exactly two hands per person.
- There is a story. No empty rooms, no seamless catalog backdrop, nobody presenting to the lens.

### Crop-safe composition rule

One master feeds three crops, all `object-cover` and centred. No focal point is honoured.
- PLP hero `aspect-[16/6]` (2.67:1, about 343x129 at 375px). It is `loading="eager"
  fetchPriority="high"`, so it is the **LCP element**, and it is not wrapped in any motion primitive.
  Keep it that way.
- Hub cards: fixed 200px tall. About 1.7:1 on mobile, about 1.35:1 on desktop featured cards.
- CategoryMasthead 4:3 on the merchandised pages: pleasure, play, body, wear, discover, on-sale. This
  is also the LCP on those pages, and it is not wrapped either.

**Master: 16:9, rendered at 2560x1440 or larger.** Measured on that master:
- 16:6 keeps the middle 66.7% of the height (y 16.7% to 83.3%).
- 4:3 keeps the middle 75% of the width (x 12.5% to 87.5%). 1.35:1 keeps 76%, 1.7:1 keeps 96%.
- **Safe zone: x 12.5% to 87.5%, y 16.7% to 83.3%.** Inside that, brief an **action band at x 18% to 82%,
  y 25% to 75%**. Every face, every gripping hand and every hero product sits inside the band. Occluders,
  doors, cables and the window go outside it.
- **The horizon composition.** At 129px tall a standing full figure puts a face at about 10px. So bodies
  recline or sit along the bed. Heads and product share one horizontal line, and frames are waist-up
  or closer.
- **Size floor at 375px.** The hero product's long axis is at least 35% of the band height (about 45px
  in the 343x129 crop), and each face is at least 22% of the band height. A product smaller than that
  becomes a prop.
- Hold products level or diagonal, not tall and vertical. A vertical dildo or wand loses its tip or its
  base in the 16:6 crop.
- Generation risk: the 16:9 cast-composite path fails product identity and age ambiguity more often
  than 4:5 does (ticket #10685). Budget about 2 calls per keeper. If identity fails twice, render at 4:3
  with the band briefed and outpaint the sides to 16:9 rather than give up the product reference.
- QA: media-manager checks all three crops on every keeper before upload (343x129, 1.7:1 at 200px,
  4:3). A keeper that loses a face or the product in any crop is a reject.

### Negative prompt (append to every row)

no visible or outlined female nipple, no areola edge showing through lace or mesh, no sheer fabric over the
nipple, no labia or labia outline, no penis or penis outline, no anus, no product touching or pointing at
the genitals, no hand below the navel, no hand on genitals, no pubic hair, no hair above or around the
waistband, no hair at the cleft or lower back, no product floating, no product resting on an arm,
shoulder or back, no product on an open flat palm, no product at or on a nipple, no extra fingers, no
extra hands, no third arm, no misplaced or doubled navel, no distorted hands, no youthful or
age-ambiguous face or body, no dead eyes, no warped teeth, no sweat, no sheen, no flushed chest, no
splayed legs toward camera, no nude-tone underwear, no skin-tone bodysuit, no beige, cream, ivory,
oatmeal or flax fabric, no bedding wrapped on a body, no towel on a body, no knitwear, no bathrobe, no
mug, cup, candle (unless it is the product), book, journal, card text, fruit or plate, no seamless
studio backdrop, no empty room, no candlelit gloom, no near-black shadows, no person looking into the
lens while holding the product at chest height, no watermark, no caption, no invented text, no garbled
or invented brand wordmark, no barcode, no shipping label, no ingredient panel, no phone screen UI.

### Motion

None added. The PLP hero and the 4:3 masthead stay static and unwrapped because they are the LCP.
Hub cards keep their current treatment. No new Reveal usage is needed for this work.

---

## 2. Scene table

Set column: room code · hour · bedding. "Hands only: X" rows are the collage rows. They still carry a
person through that cast member's hands, jewellery, and a knee or hip at the edge.

### Pleasure (morning to noon)

| handle | story | cast | hero product handles | wardrobe | set and light | hands | ceiling notes |
|---|---|---|---|---|---|---|---|
| pleasure (4:3 masthead) | 9am. Maya kneels at the open drawer, can't choose, and has taken both out. | maya | romp-2-0, we-vibe-nova-2-rechargeable-flexible-silicone-rabbit-vibrator | coral sheer tulle plunge bralette with coral appliqué over each nipple, coral micro thong, gold hoops | W · 9am · white percale, drawer half open at frame right | ROMP palmed in her left hand, thumb on the button, mouth facing away from the palm. Nova held by its base in her right hand, arm curving up. Both at waist height, eyes on the Nova, lip caught in her teeth | CHOOSING. Both products above the waist. The face carries it |
| vibrators | Jade brings the Womanizer to Priya's hip and Priya is laughing before it is even on. | priya + jade | womanizer-next-dark | Priya: lilac mesh plunge bralette with daisy motifs, lilac micro brief. Jade: black mesh triangle bralette, black micro brief, silver ring | W · 11am · white percale with fine coral stripe | Jade palms the Next with her thumb on the button, at the side of Priya's hip above the hip bone. Priya's fingers circle Jade's wrist | Other-held at the hip, at least a hand's width from the pelvis. Two people means ANTICIPATION only |
| finger-clit-vibes | Emma has just slid the Dame Fin onto two fingers and is delighted by how it sits. | emma | dame-fin-2-0-finger-vibrator-citrus, we-vibe-touch-x-rechargeable-silicone-lay-on-vibrator-massager-crave-coral | white tulle triangle bralette with embroidered daisies, white micro brief, denim-blue silk robe open with sleeves pushed up, fine silver chain | W · 9:30am · lilac washed cotton | Fin worn on her index and middle fingers, raised to collarbone height, gaze on it. Touch X held loosely in her other hand at her side on the sheet | Emma: ANTICIPATION/CHOOSING only. The Fin worn on the fingers is its real use. Hands above the navel |
| g-spot | Jade lies on her side turning the Dame Arc to find the curve, already smiling. | jade | dame-arc-g-spot-vibrator-plum, we-vibe-rave-2-g-spot-fuchsia | deep plum mesh open-back bodysuit, opaque at the nipples and the front panel | W · 10am · white percale | Arc gripped by its base, shaft curving up with the tip toward her shoulder. Rave 2 set down on the pillow by her head | The shaft never points at the pelvis. Gravity: the pillow carries the Rave |
| rabbits-dual-action | Vivian laughs at someone in the open doorway, the Nova 2 already in her hand. | vivian | we-vibe-nova-2-rechargeable-flexible-silicone-rabbit-vibrator | deep plum lace plunge bra with opaque floral motifs, plum lace thong, coral-soft silk robe slipping off both shoulders, pearl studs | P · 10am · lilac washed cotton | Nova held by its base, the flexible arm bent in her fingers, resting on her stomach above the navel | Door edge and hall light at frame left (P9). Midlife, styled at the same register as everyone else |
| suction-air-pulse | Sofia turns the Womanizer's mouth toward Diego's fingertip so he can feel the air, and he looks genuinely impressed. | sofia + diego | womanizer-premium-2-rechargeable-silicone-luxurious-pleasure-air-clitoral-stimulator-bordeaux, we-vibe-melt-2-pleasure-air-clit-stim-sage | Sofia: black lace balconette with opaque floral motifs, black micro thong, gold cuff. Diego: black micro briefs, bare chest | P · 4pm · white percale, plum-soft wall | Sofia palms the Womanizer with her thumb on the button. Diego's fingertip is a centimetre from its mouth. Melt 2 lies on the sheet beside them | Levity licensed. The air on a fingertip is an honest demo away from any genitals. She holds it, not him |
| wands | Marcus rests the Magic Wand on Maya's thigh and her fingers are already twisting the sheet. | maya + marcus | magic-wand-rechargeable-hv-270-massager | Maya: white mesh string bikini set, opaque triangles. Marcus: white micro briefs, matte black ring | C · 1pm · coral-soft washed cotton | Marcus: fist on the handle, head forward, resting on the top of her thigh halfway to the knee. Maya: fingers twisted into the sheet | Wand head more than a hand's width from the pelvis. Posture is the one carrier, the face shows anticipation. §3.7a other-held |
| bullets-eggs | Priya holds one bullet in each hand at shoulder height and weighs them up. | priya | dame-zee-bullet-vibrator-periwinkle, we-vibe-tango-x-rechargeable-silicone-intense-bullet-vibrator-cherry | coral-pink tulle string bikini set, opaque triangles, rose-gold rings | C · 11am · white percale with coral stripe | Each bullet pinched between thumb and two fingers, eyes on the Tango, a half-laugh | CHOOSING. Real palm-size scale |
| thrusting-vibrating | Sofia, on her back, holds the Velvo up and watches its beads turn, eyebrows raised. | sofia | lovense-velvo-rotating-beaded-g-spot-clit-rabbit-vibrator | coral chiffon babydoll open over the black lace set | W · 10:30am · white percale | Base gripped, held horizontal above her sternum at arm's length, beads in focus | The product is above her body and pointing away. Levity in the face only |
| vibrating-dildos | Vivian takes the Mission 2 out of the drawer and raises one eyebrow at its size, unbothered. | vivian | mission-2, tantus-duchess-o2-dual-density-vibrating-dildo-quartz | plum lace set, coral-soft robe open | P · 11am · lilac washed cotton, drawer open | Mission 2 gripped by the base at shoulder height, held diagonally. Duchess still in the open drawer | §4.2 levity (the unshockable persona). Diagonal hold keeps both ends inside the 16:6 crop |
| app-controlled | Maya reads a message, the Lush 3 in her other hand, and bites her lip at what it says. | maya | lush-3-bluetooth-remote-controlled-egg-vibrator | coral plunge bralette, coral micro thong | C · 12pm · white percale | Lush pinched by its tail between her fingers at collarbone height. Phone in the other hand, screen angled away | The phone is the one unexplained object. Its screen is never visible. Diptych with long-distance |
| discover-long-distance | Same moment, across town. Marcus in a hotel bed grins at his phone, the Max 2 in his other hand. | marcus | max-2-bluetooth-app-controlled-vibrating-and-suction-masturbator-neutral-sleeve | cobalt silk robe open over white micro briefs | H · 12pm · white percale, plum-soft wall, edge of an open carry-on at frame left | Max 2 held in his fist, lying across his stomach (a surface facing up). Phone screen away | Male product, male cast. Pairs with Maya's app-controlled frame |
| rechargeable | Emma unplugs the Magic Wand Mini, the cable still trailing out of frame. | emma | magic-wand-mini-hv-135-rechargeable-massager | white tulle set, denim-blue robe | W · 8am · lilac washed cotton | Fist on the handle, head up, charging cable still connected and running off frame right | P2 interrupted plus P9. Emma CHOOSING |
| discover-whisper-quiet | The door to the hall is open. Jade puts a finger to her lips and switches on the Touch X anyway. | jade | touch-x-rechargeable-silicone-lay-on-vibrator-massager-green-velvet | black mesh bralette and micro brief, black silk kimono slipped to the elbows | W · 2pm · white percale, door ajar at frame left | Touch X held flat between fingers and thumb at the side of her hip. The other index finger at her lips | Levity. Product above the hip bone |
| discover-discreet-picks | Priya, on her way out, clips the keychain vibe onto her keys and slips the Lay into her other hand. | priya | lay-panty-vibrator-with-remote-control, master-series-thunderstick-mini-vibrating-wand-keychain | sage silk robe open over the lilac set | C · 4pm · coral stripe, seated on the edge of the bed | Keys and keychain dangling from her fingers. Lay held between her fingers | Carried keys are evidence of a person (§4 carve-out) |
| discover-travel-friendly | Sofia packs the Le Wand Petite while Diego holds up the lube she nearly forgot. | sofia + diego | petite-rechargeable-vibrating-massager-rose-gold, jo-h2o-original-water-based-lubricant-8-oz | Sofia: black lace set. Diego: white shirt unbuttoned over black briefs | H · 8am · white percale, open carry-on on the bed | Sofia's fist on the Petite's handle above the case. Diego, seated on the edge of the bed, holds the JO between his fingers with the label to the lens | The packed suitcase is a licensed story place. JO label composited |
| wearable-toys | Sofia dangles the Ferri's magnet clip at Diego, who has her app open and looks far too pleased. | sofia + diego | ferri-bluetooth-remote-controlled-panty-vibrator | black lace set, gold cuff. Diego in a navy robe | P · 3pm · white percale | Ferri pinched between her fingers at waist height, clip swinging. Diego's phone screen away | ANTICIPATION. It is not shown clipped in place, because that position is at the vulva |
| couples-vibrators | Jade holds out the Sync Go between two fingers and Priya takes her time deciding. | priya + jade | we-vibe-sync-go-turquoise, lapis | Priya: coral-pink tulle set. Jade: plum mesh bodysuit | P · 6pm · deep plum sateen | Sync Go pinched in Jade's fingers. Priya's hand closing on it. Lapis set down on the pillow | Golden hour |
| couples | Golden hour. Maya has the Chorus in her hand, one cuff is already on Marcus's wrist, and he is laughing. | maya + marcus | we-vibe-chorus-pro-satin-black, sportsheets-sex-mischief-beginner-s-handcuffs-black | Maya: coral set. Marcus: white briefs | P · 6:15pm · deep plum sateen | Chorus held by its arm in Maya's fingers. One cuff closed on his wrist, the other swinging | Handcuffs on a wrist. Two people, so ANTICIPATION |
| dildos | Priya holds the King Cock up beside her face for scale and Maya collapses laughing. | priya + maya | king-cock-8-in-cock-realistic-dildo-with-suction-cup | Priya: lilac set. Maya: white mesh bikini set | C · 12pm · coral stripe | Gripped by the base, held diagonally beside her cheek, a hand's width from her mouth | §4.2 levity: scale may be played up. Nothing at the mouth |
| realistic-dildos | Sofia holds the clear pink 7 and the purple 8 side by side and cocks an eyebrow at someone off frame. | sofia | realrock-crystal-clear-realistic-7-dildo-with-balls-and-suction-cup-pink, realrock-crystal-clear-realistic-8-dildo-with-balls-and-suction-cup-purple | black lace set, coral chiffon babydoll open | W · 11am · white percale | One in each hand, gripped at the base, suction cups visible, held diagonally at shoulder height | CHOOSING. The clear tinted material reads as a toy, not anatomy |
| silicone-dildos | Jade holds the amethyst Curve and the hard window shadow cuts across both her and it. | jade | curve-super-soft-g-spot-dildo-amethyst | black mesh bralette and brief | W · 8:30am · white percale | Gripped by the base at chest level, held diagonally, gaze on it, not the lens | Her minimalism is the story. The shadow is a second subject (P4) |
| fantasy-non-phallic | Vivian turns the copper Magma in the light like an antique she is valuing. | vivian | tantus-magma-7-in-fantasy-dildo-medium-firm-copper, creature-cocks-night-prowler-silicone-dildo | plum lace set, silver bangle | P · 11:30am · lilac cotton, drawer open | Magma held by the base and tilted to the window. Night Prowler waiting in the drawer | Levity |
| strap-on-compatible | Hands only. Priya pushes the Strap-On Me's base through the harness O-ring, her knee at the edge of the frame. | hands only: priya | strap-on-me-bendable-dual-density-silicone-suction-cup-dildo, cush-o2-dual-density-g-spot-dildo-twilight | rose-gold rings, lilac brief at the edge | C · 3pm · coral stripe | Fingers seating the dildo base in the ring. Cush O2 lies on the sheet beside it | Collage row. The harness is the real bend-over kit (not in this collection; it is only the fitting) |
| strap-on-harnesses | Priya kneels on the bed in the Bend Over harness, the dildo set in the front O-ring, grinning down at Jade, who grins back from her elbows. | priya + jade | bend-over-beginner-strap-on-harness-kit-lavender | Priya: harness worn over her lilac micro brief (opaque front panel), lilac plunge bralette. Jade: black set | C · 4pm · coral-soft cotton | Priya's hand on the harness strap at her hip, not on the dildo | Owner rule: worn by a woman, dildo on the front O-ring. The lavender colour reads as a toy. Three-quarter side angle, dildo pointing forward and up, never touching Jade |
| discover-lgbtq | Diego holds up the Mood Pride box and Marcus laughs into his shoulder. | diego + marcus | mood-pride-anal-plug-training-set-3-piece | Diego: navy robe open, black briefs. Marcus: white briefs | W · 9am · white percale | Box held by its edges between Diego's fingers, label to the lens (composited). Marcus's arm over his chest | The male couple anchors the series. Pride merges in here (§3) |
| plugs | Sofia, face-down, looks back over her shoulder at Diego, who is dangling the bunny tail by its tail. | sofia + diego | crystal-delights-magnetic-bunny-tail-plug-white, snug-plug-1-weighted-silicone-anal-plug-black | Sofia: black lace micro thong with the string closing the cleft, balconette. Diego: black briefs | P · 5pm · deep plum sateen | Diego pinches the tail beside her waist, not touching her. Sofia's fingers cup the weighted Snug Plug from below by her face | Buttocks rule: smooth skin at the cleft, cleft closed. Not on her back. Levity |
| anal | Maya takes the Ditto remote out of Marcus's fingers before he can press it. | maya + marcus | we-vibe-ditto-rechargeable-remote-control-vibrating-anal-plug-satin | Maya: coral set. Marcus: cobalt robe open | C · 2pm · white percale | Marcus holds the Ditto by its base in one hand. Maya's fingers close on the remote in his other hand | ANTICIPATION. The plug stays in his hand |
| beads | Jade lets the indigo beads swing from their loop, counting them with one finger. | jade | luxe-silicone-10-beads-for-anal-play-indigo, lovense-ridge-vibrating-and-rotating-anal-beads | black mesh set, black kimono | W · 9am · white percale | Loop pinched at the top, strand hanging straight (gravity). Ridge on the sheet | Held, not laid along the spine. The owner's 10-23 note overrides the §3.2c spine placement |
| training-sets | Hands only. Priya lines up the three dilators from smallest to largest, her knee at the edge. | hands only: priya | silicone-anal-training-dilator-set | rose-gold rings | C · 10am · coral stripe | Fingertip nudging the largest into line | Collage row. True relative scale |
| prostate | Marcus, propped on pillows, weighs the Eupho against the Vector with a relaxed grin. | marcus | aneros-eupho-syn-v, we-vibe-vector-dual-stimulation-prostate-massager | white micro briefs, bare chest | C · 2pm · coral-soft cotton | One in each hand, fingers around the handles, at chest height, gaze on the Vector | Male product, male cast. CHOOSING. Never looking into the lens |
| strokers | Sofia passes Diego the Arcwave Ion and he is already grinning. | sofia + diego | arcwave-ion-2, tenga-geo-coral | Diego: black briefs, back against the headboard. Sofia: black set | P · 5:30pm · white percale | Ion passing from her fingers to his. The Geo set down on the sheet | The male product lands in a man's hand. Nothing at his groin |
| cock-rings | Maya spins the ROMP Juke on her finger and Marcus pretends not to watch. | maya + marcus | romp-juke-rechargeable-silicone-vibrating-penis-ring-light-blue | Maya: coral set. Marcus: white briefs | C · 1:30pm · coral stripe | Ring hooked over her raised index finger | ANTICIPATION. Never shown worn |
| best-sellers | Vivian, on her back and laughing, the Magic Wand Original in her hand, its cord running off the bed. | vivian | magic-wand-original-hv-260-massager, jo-h2o-original-water-based-lubricant-4-oz | plum lace set, robe open | P · 10am · lilac cotton | Fist on the handle, head up beside her on the pillow. JO on the nightstand, label out | The cord leaving the frame is P9 |
| just-dropped | Emma lifts the iroha Pairing out of its box, the tissue still in her other hand. | emma | pairing-black | white tulle set, denim-blue robe | W · 8:30am · lilac cotton | Pairing held in her fingers above the open box, label to the lens | Emma CHOOSING. Box label composited |
| body-safe-silicone | Hands only. Jade bends the Cush O2 into a slow arc, the Magic Wand Mini lying by her wrist. | hands only: jade | cush-o2-dual-density-g-spot-dildo-twilight, magic-wand-mini-hv-135-rechargeable-massager | single silver ring, black mesh at the edge | W · 8am · white percale | Both hands flexing the shaft | Collage row. The bend shows the dual-density material honestly |
| under-25 | Hands only. Priya scoops three things out of the drawer at once. | hands only: priya | luxe-silicone-10-beads-for-anal-play-indigo, sportsheets-sex-mischief-beginner-s-handcuffs-black, aneros-sessions-gel | rose-gold rings, sage robe sleeve | C · 11am · drawer open | Beads looped on two fingers, cuffs hooked on her thumb, Sessions tube gripped with the label out | Collage row. Three references is the ceiling |
| under-50 | Close bodyscape. Sofia, seated, holds the ROMP and the Le Wand mini, one on each thigh. | hands only: sofia (no face) | romp-2-0, le-wand-classique-mini-wand-massager | black thong waistband at the frame edge, gold cuff | P · 4pm · white percale | Each product gripped in a hand, resting on the top of a thigh that faces up, halfway to the knee | Collage-class row. Products at least a hand's width from the pelvis |
| on-sale (4:3 masthead) | Hands only. Maya's and Marcus's hands meet over the open drawer, both going for the Doxy. | hands only: maya + marcus | doxy-usb-c-wand-matte-black, romp-free-rechargeable-silicone-pleasure-air-clitoral-vibrator-purple | matte black ring, coral manicure | C · 12pm · drawer | Both hands on the Doxy's handle. The ROMP Free still in the drawer | Every on-sale product is typed Discontinued. These two are in stock (298 and 88). Re-check stock each quarter |

### Body (morning)

| handle | story | cast | hero product handles | wardrobe | set and light | hands | ceiling notes |
|---|---|---|---|---|---|---|---|
| body (4:3 masthead) | 8am. Vivian sits up against the headboard, warms a drop of Dame Sex Oil between her fingertips and smiles toward the open door. | vivian | dame-sex-oil-massage-oil-2-oz, jo-h2o-original-water-based-lubricant-4-oz | plum lace set, coral-soft robe slipping | C · 8am · coral-soft cotton | Bottle in one hand, label out. Oil between two fingertips of the other. JO on the nightstand | Opens the day |
| lubricants | Maya squeezes the Coconu onto Marcus's fingers and they both watch the strand stretch. | maya + marcus | coconu-water-based-personal-lubricant-3oz, jo-h2o-original-water-based-lubricant-4-oz | Maya: white mesh bikini set. Marcus: white briefs | C · 9am · white percale | Coconu tipped in her grip. The strand between his fingers | Lube texture on hands is licensed. Labels composited |
| water-based | Priya, on her stomach, holds the Sliquid H2O up to the window and lets a bead run down her fingertip. | priya | naturals-h2o-intimate-lubricant-8-5-oz, dame-aloe-lube-personal-lubricant | lilac set, sage robe open | C · 9:30am · coral stripe | Bottle in one hand, label out. A bead on the other fingertip | Dame Aloe set down on the sheet |
| silicone-based | The bath is run. Sofia, waist-deep in the water in her black lace balconette, sets the Pjur on the rim because silicone stays put. | sofia | original-concentrated-silicone-personal-lubricant-3-4-oz | black lace balconette, opaque motifs | B · 9am · white tile, window left | Fingers around the bottle on the tub rim, label to the lens | The water hides everything below the waist. No towel on her body |
| hybrid-lubricants | Hands only. Maya's and Marcus's fingers interlace, with the milky JO Hybrid stretching between them. | hands only: maya + marcus | jo-classic-hybrid-lubricant | matte black ring, coral manicure | C · 10am · coral-soft cotton | Marcus's other hand holds the bottle, label out | Collage row. Two skin tones |
| warming-lubes | Vivian rubs the JO Warming between her palms while Diego, face-down, turns his head to watch. | vivian + diego | jo-h2o-warming-water-based-lubricant-4-oz, sliquid-organics-sensation-warming-lubricant | Vivian: plum set, robe. Diego: black briefs | P · 6pm · deep plum sateen | Palms pressed together, the JO bottle pinned under her thumb | ANTICIPATION. The bottle stays in her hand, not on his back |
| cooling | Jade dabs a fingertip of JO Cooling on her own collarbone and shivers into a laugh. | jade | jo-h2o-cooling-water-based-lubricant-2-oz | black mesh bralette, kimono | W · 7:30am · white percale | Bottle held in her fingers, fingertip at the collarbone | Goosebumps are allowed. Nothing near the nipple |
| flavored-lubes | Sofia tastes the Raspberry Sorbet off her fingertip and holds the bottle out to Diego. | sofia + diego | jo-h2o-raspberry-sorbet-flavored-water-based-lubricant-1-oz, jo-candy-shop-cotton-candy-flavored-water-based-lubricant-2-oz | black set. Diego: navy robe | P · 4:30pm · white percale | Fingertip at her lip. Bottle offered between two fingers, label out | Oral is implied by the flavour only. Nothing near anyone's body |
| oral-enhancers | Maya runs the GoodHead balm across her lower lip, eyes on Marcus lying back on the bed. | maya + marcus | goodhead-pout-perfection-lip-balm-cherry-limeade | coral set. Marcus: white briefs, soft in the background | C · 5pm · coral stripe | Balm held like a lipstick, at her lip | Implication only. Recommend merging into flavored-lubes (§3) |
| desensitizers | Diego shakes the Dynamo delay spray like a cocktail and Marcus laughs at him. | diego + marcus | screaming-o-dynamo-delay-spray | Diego: white open shirt, black briefs. Marcus: cobalt robe | W · 5pm · white percale | Can in Diego's fist, label out | Hero the delay spray only. Never a throat or anal numbing product (§3) |
| enhancers-arousal | Vivian dips a fingertip into the Clitherapy jar, the lid off beside her, grinning at what comes next. | vivian | bijoux-indiscrets-clitherapy-horny-jar-clitoral-balm-0-28-oz, pjur-woman-lust-vibrating-orgasm-gel-15ml | plum lace set | P · 10:30am · lilac cotton | Jar held, fingertip in the balm. The Pjur set down by her knee | Lid off is P2. Hands stay above the navel |
| massage-oils | Marcus warms the Sliquid in his palm above Maya's bare back. She looks back at him with her eyes half closed. | maya + marcus | sliquid-massage-oil-citrus-neroli, dame-sex-oil-massage-oil-2-oz | Maya: coral thong, bralette fastened. Marcus: white briefs | C · 11am · coral-soft cotton | Bottle tipped in one hand, oil pooling in the other palm, not yet on her | The oil on her back is the use. The bottle stays in his hand |
| candles | Diego tips the Slow Sex candle and a ribbon of warm oil falls toward Sofia's shoulder blade, mid-laugh. | sofia + diego | slow-sex-massage-candle, je-joue-luxury-massage-candle-jasmine-lily | Sofia: black thong, face-down. Diego: black briefs | P · 6:30pm · deep plum sateen | Tin gripped by its rim, the oil ribbon mid-air. The Je Joue unlit on the nightstand | A massage candle is the product, not a houseware prop. Small flame, bright room |
| massage-mood | Jade's oiled hands at Priya's shoulders. Priya, eyes closed, holds the Dame bottle loosely against her cheek. | priya + jade | dame-sex-oil-massage-oil-2-oz, je-joue-luxury-massage-candle-jasmine-lily | Priya: lilac set. Jade: black set | C · 5pm · coral stripe | Jade's palms on Priya's shoulders. Priya's fingers around the bottle | Use the rule fix from the draft (oils and candles only) |
| natural-organic | Maya, lilac robe falling open, turns the Sliquid Organics to the window light. | maya | organics-natural-lubricant-4-2oz, moon-bloom-hybrid-comfort-glide-4-oz | coral set, lilac satin robe | C · 8:30am · white percale | Bottle in her fingers, label out. Moon Bloom on the sheet | The rule needs fixing first (§3) |
| toy-cleaners | Afterglow. Jade on the edge of the bed mists La Nua over the Curve she has just used, with a slow, loose smile. | jade | la-nua-mist-toy-cleaner | black kimono slipped over the black set | W · 7pm · white percale | Mist in one hand aimed at the toy held in the other, away from her body | AFTERGLOW (not Emma, solo) |
| hygiene-douches | Vivian on the bath ledge, robe slipping, uncaps the JO Balance in the morning sun. | vivian | jo-balance-intimate-mist-2-oz, sliquid-splash-feminine-wash-unscented | plum lace set, coral-soft robe | B · 8am · white tile | Mist held with the cap off. Sliquid on the ledge, label out | Washes and mists only. Douches are never the hero (§3) |
| condoms | Maya tears the SKYN foil with her teeth and Marcus, up on one elbow, has stopped talking. | maya + marcus | skyn-12, dame-condom-12-pack | Maya: coral set. Marcus: white briefs | P · 6pm · lilac cotton | Foil pinched at her teeth. The box on the nightstand, label composited | Foil printing illegible |
| kegel-exercisers | Vivian, unhurried and sincere, holds the Je Joue Ami set by its cords in the morning light. | vivian | je-joue-ami-3-piece-silicone-kegel-set | plum lace set, robe | W · 8am · lilac cotton | Three weights hanging from her fingers by their cords | Health-adjacent: no levity, no playing with scale |
| pheromones | Vivian dabs the Eye of Love at her neck and Diego, behind her, leans in toward it. | vivian + diego | eye-of-love-bloom-attract-him-pheromone-parfum-sunny-daze | plum set, pearl studs. Diego: navy robe | P · 5:15pm · plum-soft wall | Bottle tipped at her pulse point, label out | The neck is where it is used |

### Wear and Discover (afternoon)

| handle | story | cast | hero product handles | wardrobe | set and light | hands | ceiling notes |
|---|---|---|---|---|---|---|---|
| wear (4:3 masthead) | 5pm, getting ready. Maya fastens the waist chain around Priya, who is rolling up a back-seam stocking. | maya + priya | bijoux-indiscrets-magnifique-chain-waist-jewelry, dreamgirl-sheer-thigh-high-stockings-with-plain-top-and-back-seam-os | Maya: white mesh bikini set. Priya: lilac set | C · 5pm · coral stripe, by the window | Maya's fingers at the chain clasp on Priya's hip. Priya's thumbs inside the stocking top above the knee | The waist chain has 6 in stock. Re-check, fallback pastease-glitter-star-pasties |
| bra-panty-sets | Sofia kneels at the window in the Opulence set, adjusting the pearl strap and glancing back at Diego. | sofia | fantasy-lingerie-opulence-underwire-bra-g-string-with-removable-adjustable-pearl-string-harness-black-l-xl, fantasy-lingerie-domina-bralette-panty-with-zipper-details-berry-l-xl | the hero set replaces her closet. The Domina set lies on the bed | C · 4:30pm · white percale | Fingers on the strap at her shoulder | If the packshot cups are sheer at the nipple, swap the SKU. Never invent coverage the real garment does not have |
| sets | Jade lies on her side in the Dreamgirl lace set, watching Priya off frame with a small smile. | jade | dreamgirl-lace-seamless-3-piece-set-black-o-s | the hero set | W · 4pm · white percale | One hand at the waistband line, the other under her cheek | Same packshot coverage check |
| bodysuits-teddies | Vivian in the Magic Silk teddy laughs toward the door, robe off one shoulder. | vivian | magic-silk-seamless-teddy-black-o-s | the hero teddy, coral-soft robe | P · 4pm · lilac cotton | Robe edge in her fingers | Packshot coverage check. Avoid every crotchless SKU in this collection |
| babydolls-chemises | Maya turns once at the foot of the bed in the Rene Rofe chemise and Marcus, on his elbows, applauds. | maya + marcus | rene-rofe-2-piece-hollywood-chemise-g-string-set | the hero chemise | C · 5pm · coral-soft cotton | Her fingers lifting the hem a little at the thigh. His hands mid-clap | Seated or kneeling turn so it fits the band |
| bodystockings | Sofia stretches one arm overhead in the window light, the crochet net bodystocking over her black lace set. | sofia | rene-rofe-2-piece-quarter-crochet-net-bodystocking | net styled over the opaque-motif balconette and thong | W · 3:30pm · white percale, kneeling | Hand gripping the window frame | The net never sits on bare nipple or vulva. The set underneath does the covering |
| hosiery | Vivian on the edge of the bed rolls a back-seam stocking past her knee, toes pointed. | vivian | dreamgirl-sheer-thigh-high-stockings-with-plain-top-and-back-seam-os | plum lace set | P · 4:30pm · lilac cotton | Both thumbs inside the stocking top | Seated, horizontal leg line, fits the band |
| pasties | Priya peels a glitter star off its backing with a fingernail, her bralette still on, grinning at Maya. | priya | pastease-glitter-star-pasties | lilac bralette | C · 4pm · coral stripe | Card held with the printed side away, star half peeled | Not shown worn (§3) |
| mens-underwear | Diego lies face-down across the bed in the Prowler trunk, chin on his fist, grinning at Sofia in the doorway. | diego | prowler-trunk | the hero trunk, steel watch | W · 4pm · white percale | Chin on his fist, the other hand flat on the sheet | Male buttocks allowed. Penis never outlined |
| costumes | Priya strikes a pose in the Mischief Maker set while Jade, laughing, fixes the strap at her shoulder. | priya + jade | fantasy-lingerie-play-mischief-maker-5-piece-costume-set | the hero costume. Jade: black set | C · 3pm · coral stripe | Jade's fingers at the strap | Packshot coverage check. Levity |
| fetish-roleplay | Sofia pulls the latex glove up past her elbow, eyes on Diego, who is sitting very still. | sofia + diego | me-you-us-latex-full-length-glove, me-you-us-latex-stockings | glove and stockings over the black lace set | P · 6pm · deep plum sateen | One hand drawing the glove cuff up the other arm | Golden hour. Body-harnesses and masks merge in here |
| accessories | Hands only. Diego dangles the chained clamps over the plum sheet next to a bottle of JO. | hands only: diego | sportsheets-sex-mischief-adjustable-chained-nipple-clamps, jo-h2o-original-water-based-lubricant-4-oz | steel watch | P · 6pm · deep plum sateen | Chain pinched in the middle, clamps hanging | Recommend retiring the collection (§3). Clamps never at a nipple |
| discover-date-night | Vivian fastens an earring at the window. Marcus, behind her, holds up the VUSH box and raises an eyebrow. | vivian + marcus | vush-curiosity-cues-cards, sportsheets-sex-mischief-amor-silicone-cuffs | Vivian: plum set, pearl studs. Marcus: cobalt robe open | P · 5:30pm · plum-soft wall | Box held between his fingers, label composited. Cuffs looped over his other wrist | Waist-up, both faces inside the band. Card faces never shown |
| date-night-box | Hands only. Her gold cuff, his steel watch: they lift the night's things out of an open box on the plum sheets. | hands only: sofia + diego | jo-h2o-original-water-based-lubricant-4-oz, the-9-s-make-me-melt-sensual-warm-drip-candles-4-pack-red-hot | jewellery, sleeve edges | P · 6pm · deep plum sateen | Her fingers lift the JO, label out. His hold the candle pack, label legible | Collage row. The box is plain, with no printing |
| games-romance | Priya and Jade lie head to toe on the striped sheet. Jade reads a card to herself and Priya has a hand over her mouth. | priya + jade | vush-curiosity-cues-cards, love-language-couples-game | Priya: coral-pink set. Jade: black set | C · 3pm · coral stripe | Card held facing Jade. The boxes on the sheet, labels composited | Card faces never shown (they would come out as invented text) |
| discover-gift-guide | Emma knots a coral ribbon round the Je Joue gift set and can't resist lifting the lid once more. | emma | the-naughty-collection-4-piece-gift-set, naturals-h2o-intimate-lubricant-8-5-oz | white tulle set, denim robe | W · 3pm · lilac cotton | Fingers mid-knot, lid lifted | 16 in stock. Fallback sex-mischief-ex-s-oh-s-kiss-kit |
| first-time | Maya, cross-legged, turns the JO bottle to the light, the furry cuffs looped round her wrist like a bracelet, smiling at her own nerve. | maya | jo-h2o-original-water-based-lubricant-4-oz, ouch-beginner-s-furry-handcuffs-with-quick-release-black | coral set, lilac robe | C · 10am · white percale | Bottle held, label out. One cuff closed on her wrist | ANTICIPATION. Warm, not nervous |
| discover-beginner-kits | Jade opens the b-Vibe training set and Priya, chin on her shoulder, counts the sizes. | jade + priya | b-vibe-7-piece-anal-training-education-set, mood-pride-anal-plug-training-set-3-piece | Jade: black set. Priya: lilac set | W · 10am · white percale | Lid lifted in Jade's fingers, box label out | Products stay in the box |
| discover-bachelorette | Noon on a hotel bed. Sofia has cuffed her wrist to Priya's and Maya waves the ROMP Party like a trophy. | sofia + priya + maya | ouch-heavy-duty-fluffy-handcuffs, romp-party | each in her own closet set | H · 12pm · white percale | The cuffs link two wrists. The ROMP raised in Maya's fist | Three faces raise identity risk, so cap it at three. No men. Levity |
| discover (if it survives, 4:3 masthead) | Emma at the open drawer in the White Room, one toy in each hand, delighted to be choosing. | emma | we-vibe-touch-x-rechargeable-silicone-lay-on-vibrator-massager-crave-coral, zola-rechargeable-silicone-mini-wand | white tulle set | W · 9am · lilac cotton, drawer | One in each hand at waist height | Only if `discover` is not deleted (§3) |

### Play (golden hour)

| handle | story | cast | hero product handles | wardrobe | set and light | hands | ceiling notes |
|---|---|---|---|---|---|---|---|
| play (4:3 masthead) | Golden hour. Diego closes the cuffs on Sofia's wrists above her head, and she is the one giving the instructions. | sofia + diego | sportsheets-sex-mischief-beginner-s-handcuffs-black, sportsheets-signature-twilight-tease-blackout-blindfold | Sofia: black lace set, gold cuff. Diego: black briefs | P · 6:20pm · deep plum sateen | His fingers closing the second cuff. The blindfold hanging from his other hand. Her hand mid-gesture, directing | Handcuffs on wrists. Her smile and instruction carry consent |
| restraints | Maya's wrists are in the under-the-bed cuffs, the straps disappearing under the mattress. Marcus leans over her and they are both laughing. | maya + marcus | under-the-bed-restraint-system-black | Maya: coral set. Marcus: white briefs | P · 6pm · lilac cotton | Cuffs on her wrists. His hand on the mattress beside her | Straps leaving the frame are P9. Horizontal, fits the band |
| blindfolds | Jade ties the Twilight Tease over Priya's eyes, and Priya's lips part into a smile. | priya + jade | sportsheets-signature-twilight-tease-blackout-blindfold | Priya: lilac set. Jade: black set | P · 6:30pm · deep plum sateen | Jade's fingers knotting it at the back of Priya's head | Owner rule: blindfolds belong in a couple's bondage scene, not sleep |
| paddles-crops | Maya taps the Tantus Pelt against her own palm. Marcus, face-down in his briefs, looks back in mock alarm. | maya + marcus | tantus-pelt-paddle-onyx-hanging | Maya: coral set. Marcus: white briefs | P · 5:45pm · white percale | Flat face against her palm, handle loose | §3.2c: no raised implement, no marks. Levity |
| collars | Priya holds her hair up while Jade fastens the Heartbound lace collar at her nape. | priya + jade | sportsheets-sex-mischief-heartbound-lace-day-collar | Priya: coral-pink set. Jade: black kimono | P · 5:30pm · lilac cotton | Jade's fingers at the clasp | The collar is worn at the neck, its real use |
| gags | Jade twirls the ball gag by its strap with one eyebrow up at Priya, whose hand is on her knee. | jade (+ priya's hand) | temptasia-ardor-ball-gag | black mesh bodysuit | P · 6pm · deep plum sateen | Strap hooked over a finger, ball swinging | Held, never worn (§3) |
| sex-furniture | Maya lies back with the Dame Pillo under the small of her back, knees together, laughing up at Marcus. | maya + marcus | dame-pillo-sex-pillow-indigo | Maya: white mesh bikini set. Marcus: white briefs, on one elbow | C · 5pm · coral-soft cotton | Her fingers on the Pillo's edge. His hand on her waist | Side angle, knees together, nothing splayed toward the lens |
| body-harnesses (merge) | Sofia buckles the Shadow body harness over her black lace set. | sofia | sportsheets-sex-mischief-shadow-body-harness | the harness over the closet set | P · 6pm · deep plum sateen | Fingers on the buckle at her ribs | Recommend merging into fetish-roleplay. Use this only if the collection is kept |
| masks (merge) | Marcus turns the neoprene puppy hood over in his hands, and Diego, beside him, is clearly delighted. | diego + marcus | ouch-puppy-play-neoprene-puppy-hood | white briefs / navy robe | W · 5pm · white percale | The hood held open in both hands, about to go on | Recommend merging into fetish-roleplay (§3) |
| chastity-cages | Vivian, unshockable, wears the tiny key on a chain at her throat and holds the cage up to Marcus. | vivian + marcus | titanmen-cock-cage-black | plum set, the key on a silver chain. Marcus: cobalt robe | P · 6pm · lilac cotton | Cage held between her fingers at shoulder height | Never worn (§3). The key is the story |
| electrostim | Jade holds the violet wand a finger's width above Priya's thigh, a thread of violet light between them, and Priya's toes curl. | priya + jade | zeus-electrosex-body-light-twilight-wand-electro-conductor | Priya: lilac set. Jade: black set | P · 6:30pm · deep plum sateen | Jade's fist on the wand handle, the glass electrode above mid-thigh | Thigh only, never the torso or the pelvis. No pads or power box (§3) |
| pumps-extenders | Hands only. Marcus's ringed hands lift the Bathmate out of its box on the coral sheets, with Maya's hand on his wrist at the edge. | hands only: marcus (+ maya) | bathmate-hydromax7-clear, pumped-comfort-beginner-penis-pump-black | matte black ring, coral manicure | C · 2pm · coral-soft cotton | Bathmate held level in both hands above the box, label out | Never worn or in use (§3) |
| for-him / for-her | Do not commission (§3). If the owner keeps them: for-him reuses the prostate frame, for-her reuses the rabbits frame. | n/a | aneros-eupho-syn-v / we-vibe-nova-2-rechargeable-flexible-silicone-rabbit-vibrator | n/a | n/a | n/a | Gendered merchandising was retired |
| plus-size | Blocked until a plus-size cast member exists (§3). | none yet | dreamgirl-plus-size-sheer-thigh-high-stockings-with-silicone-lace-top-queen (once the rule is fixed) | n/a | C · 4pm | n/a | Doctrine says vary body type on purpose. The roster has no plus-size body |

**Mix (counted):** 93 rows. 81 have named cast in a scene (87%, well above the 50% floor; 4 of these are
merge-or-block fallbacks). 10 are hands-only or faceless bodyscape collage rows, each with a person in
frame. 2 are blocked (for-him/for-her, plus-size). Appearances, hands included: Marcus 22, Maya 22,
Priya 21, Jade 19, Sofia 18, Diego 17, Vivian 14, Emma 5. Couples: Sofia and Diego, Maya and Marcus,
Priya and Jade, Diego and Marcus, Vivian with Marcus or Diego. Order the hub by section (the day) and interleave the couples, so no pairing sits on two
adjacent cards.

---

## 3. Where a scene cannot be made honestly within the ceiling, and the alternative

| collection | why an honest in-use scene is over the fence | alternative |
|---|---|---|
| chastity-cages (12) | A cage worn is a penis, or labia for the vulva cage, outlined. That is on the §3.2a stop list. | The "key" frame above (ANTICIPATION, the cage held, the key worn by the partner). Or merge into fetish-roleplay with no dedicated hero. My recommendation is to merge. |
| electrostim (13) | Pads and power boxes are used on the genitals, and at the torso they read as a safety claim. Health-adjacent, so no levity. | Only the violet wand, only above a thigh, as in the row. If the vision gate reads the violet glow as an injury or as clinical, merge into play. |
| pumps-extenders (83) | A pump in use is a penis. A sleeve in use is a penis outline. | Hands-only unboxing with the label out (row above). No body contact at all. |
| nipple-toys (38), accessories | Clamps are used on nipples. Product at any nipple is banned (Meta, and §3.2a). | Held dangling by the chain, at least a hand above the body, bra on (rows above). Retire `accessories` as a grab bag: tag rule, lube plus pasties plus a charging cable. |
| pasties (78) | Worn means a bare breast with a pastie. The owner's rejections say "no bare breasts" and "nipple covers subtle, not blacking out the breast". | Peeling one off its backing, bralette on (row above). Whether pasties may be shown worn is the owner's call. Do not brief it until he answers. |
| gags (22) | Worn, it blocks the face that carries consent and pleasure. It reads as non-consent, and the face can no longer show amused anticipation. The "penis stuffy" SKUs are novelty items. | Held by the strap, eyebrow raised (row above). Never hero the stuffy SKUs. |
| masks (7), body-harnesses (4) | Hoods (gas mask, pig, puppy) cover the face, and the set is too thin to stand alone. | Merge both into fetish-roleplay. That applies the same fewer-than-8-live rule the draft applies to brands. |
| desensitizers (67) | Most are throat and anal numbing sprays. Numbing anal sensation is health-adjacent (it masks pain), and throat spray implies oral. | Hero only the delay spray (row above). Do not run levity on the anal SKUs. |
| hygiene-douches (35) | An enema or douche in use is a bathroom act. Not shootable. | Washes and mists on the bath ledge (row above). |
| plus-size (73) | No problem with the ceiling. The problem is cast: none of the 8 has a plus-size body, so an honest image is impossible. | Owner decision (brand and likeness): add a plus-size cast member with a closet in cast-wardrobe.md. Until then, no image. Also fix the rule: the tag pulls in cock rings, cages and jocks. |
| wearable-toys | The Ferri and other panty vibes are used at the vulva. Showing them in place is product against genitalia. | ANTICIPATION hold (row above). The collection is also overtagged (harnesses, dildos). |
| strap-on-harnesses | Possible, and required: the owner wants it worn with the dildo in the O-ring. | Worn over the opaque front panel, lavender non-flesh dildo, three-quarter angle, no contact with the partner. The vision gate must not read "harness at pelvis" as "product against genitalia". Pre-brief the gate with the owner's 10-23 note. |

### Where I disagree with the taxonomy draft, or with the docs

1. **for-him / for-her: retire them, do not keep them.** `app/routes/_layout.for-him.tsx` says the store
   retired gendered merchandising and must "never redirect to the gendered /collections/for-him", and
   §3.7a's scope guard forbids casting rules leaking into collections. High traffic is a reason for a
   301 to an ungendered collection, not a reason for hero art.
2. **`discover` (umbrella): check before deleting.** The coordinator's code map lists `discover` as a
   merchandised CategoryMasthead page. Deleting the Shopify collection could blank a live 4:3 masthead.
   Ask rr7-engineer to confirm what feeds it first.
3. **natural-organic needs a FIX RULE too.** It uses the same `matters:natural` rule as bath-body, so
   strokers, plugs and a penis pump are in it. A lube hero cannot represent that.
4. **pride (7 live): merge into discover-lgbtq.** They are near-duplicates and pride is thin.
5. **apparel (45): merge into wear and fix the types.** It is a TYPE grab bag: a toy bag, a shimmer oil,
   men's packing underwear, and the **Liberator Heart Wedge typed as Apparel** (it is Sex Furniture). No
   single honest scene covers it.
6. **cooling (17, TITLE CONTAINS): merge with warming-lubes into "Warming & cooling",** or re-rule it by
   tag. If both are kept, the two rows above are written to work as a diptych.
7. **oral-enhancers vs flavored-lubes:** after the draft's flavored fix, oral enhancers are a subset.
   Merge them, or keep both with the distinct scenes above.
8. **Owner 10-23 notes overrule two placements in instagram-campaigns §3.2c.** "Graduated beads along
   the spine" and "mini wand held flat across the lower back" are still listed as licensed placements. The
   owner's new "never on shoulders, backs, arms" overrules both. That should be an `instructions` row
   for §3.2c so the social lane stops briefing them.
9. **§3.9a (lube default: hands and a strand, no bottle) vs the owner's "labels visible on bottles".** For
   collection heroes the bottle is in frame with its real label composited, and the strand is the story.
   The social §3.9a default should note that exception.

---

## Handoffs

- **media-manager:** generates every row with atlas seedream-4.5-edit at a 16:9 master, using cast
  reference plus product packshot references, labels composited from the packshot, a crop QA on all three
  crops, and the series bible as the fixed prefix. Budget about 2 calls per keeper, so about 180 to 190
  calls for 92 rows (fewer if the merges land first). Upload to the Shopify collection image, named
  `collection-{handle}-{cast}-{yyyymmdd}`.
- **homepage-ia / taxonomy owner:** settles the merges and retirements above before generation, so
  budget is not spent on collections about to be deleted. Orders the hub by section in day order.
- **emma-copywriter:** collection image alt text (`heroImageAlt` falls back to the H1). SEO register,
  no copy in the pixels.
- **rr7-engineer (optional, Routine B):** honour a focal point on the 16:6 PLP crop. Nothing in this
  plan depends on it, because the safe zone is centred.
- **Owner (blocker list, not this thread):** plus-size cast member, whether pasties may be shown worn,
  and whether for-him/for-her are retired.
- **qa-reviewer:** 375px check of the PLP hero (LCP, unwrapped, zero CLS from its fixed width and height
  attributes) and the 4:3 mastheads.
