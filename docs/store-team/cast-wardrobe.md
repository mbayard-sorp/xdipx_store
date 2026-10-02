# Cast wardrobe (owner direction 2026-10-02)

Owner, verbatim: *"I'm noticing a trend that our social media images show cast members wearing what
looks like beige sheets. Sometimes it's fine, other's its odd. Do we need a styling agent or a style
director for each of our cast members? They need to be in something that still can show skin when
needed. What is the right way to do this so we get great looking outfits that are both sexy and
interesting in the scene?"*

This file is the answer to the second half: what each cast member wears, in what colours, with what
metal, on what bedding. `social-art-director` reads it at every brief; `media-manager` and
`video-producer` execute what the brief names from it.

**This file says WHAT they wear, never WHETHER a frame may carry a garment.** That question has one
home, `instagram-campaigns.md` §3.2a, and this file does not restate or widen it. Where §3.2a puts a
frame bare, the closet still supplies the metal, the bedding and the colour of anything else in
frame.

## Why it exists (measured 2026-10-02)

Nobody designed the beige sheet. It was the sum of four defaults: the 2026-09-19 order took garments
off on-skin frames; a folded sheet was the one closer the doctrine had proved (5 of 5); the "paper"
ban swapped in "warm off-white linen", which was meant for a backdrop and became the name of every
fabric; and the brief template had a colour slot for the product and none for fabric, so anything
unnamed rendered cream.

- 15 of the 20 on-skin frames in the last 40 posted rows used a sheet or towel as the coverage.
- 140 of 172 cast-frame prompts since 09-19 name bedding; 0 give any fabric a non-neutral colour.
- Worn garments across all generated prompts fell from 66 (week of 08-31) to 0 (week of 09-28).
- The odd ones are sheets with no job: Vivian wrapped like a toga in a doorway (#360), a folded hand
  towel on the groin like a loincloth (#364). The good ones give the sheet an action: knotted at the
  hip (676, 677, the frames the owner loved).
- The clothed frames were beige too: an unnamed "plain fitted t-shirt" rendered cream (#353), and the
  model added nude-tone underwear nobody asked for (#358, #359, #360).
- Next repeat already forming: gold jewellery in 122 of 172 cast prompts.

**No styling agent, and no agent per cast member** (all-hands 2026-10-02, art director and architect
agreeing). Wardrobe is already `social-art-director`'s lever, and it is coupled to occlusion, so a
stylist upstream of it would be a second author of the same frame. Eight per-cast agents would be
eight drifting prompt files with nobody owning the grid. What was missing was a field in the brief
and the data to fill it. This file is the data.

## Fabric rules (binding on every prompt with a textile in it)

1. **Name every textile by colour and weave.** Never write any of these on its own: linen,
   off-white, cream, ivory, beige, oatmeal, taupe, greige, flax, nude, natural, neutral. "Linen"
   alone renders as flax even with no colour word.
2. **Bedding has a job.** It closes an edge by something the person did: pulled it up, knotted it at
   the hip, held it to the chest, kicked it to the foot of the bed. It never wraps the torso like a
   dress (#360) and never sits folded on the groin as a cover (#364). Either is a REVISE.
3. **No nude-tone underwear and no skin-tone bodysuit** unless the brief names one. Put it in the
   negative list of every cast frame; the model adds them unprompted.
4. **Opaque by construction over a stop zone:** cotton jersey, terry, chunky or ribbed knit, matte
   microfibre, poplin. Never thin white cotton, satin, lace or mesh over a nipple or the labia (the
   2026-08-24 white bralette rendered sheer). Satin, silk and lace are fine away from a stop zone,
   which in practice means from behind.
5. **Contrast with the skin.** Pick the bedding and garment colour that separates from that cast
   member's skin. Beige on skin is a safety problem as well as a taste one: the gate read a beige
   throw as underwear on #698 (ticket #11468).
6. **The metal is the closet's.** State the cast member's metal; gold is not the default.
7. **Lock per campaign, rotate per post.** A campaign pins one colour from the lead cast member's
   palette as its `rhymeColor` and writes `wardrobeRegister` from this file (§3 of
   `instagram-campaigns.md`). Pieces rotate post to post. The same person in the same piece twice in
   a campaign is continuity, not a repeat.

## Bedding and towels

| Name it as | Use |
|---|---|
| crisp white cotton percale, cool grey in the folds | the default |
| coral-soft washed cotton | warm, daylight |
| lilac washed cotton | the plum-soft ground in fabric |
| white cotton percale with a fine coral stripe | playful, morning |
| deep plum cotton sateen | evening and drama, at most 1 per rolling 7 |
| white waffle-weave towel, or coral-soft terry towel | bath and after-shower; never cream |

Each closet below names which bedding contrasts with that skin.

## The closets

Each piece lists the action that holds it, the skin it leaves bare, and its coverage class (the
vocabulary ticket #13158's `wardrobeCoverage` axis records). Pieces over a stop zone are opaque by
construction. The off-character line is as binding as the pieces.

### Emma (guide, fair with pink undertones)
Persona: warm, direct, delighted and curious rather than sultry; nothing costumey. Emma gets BEFORE or
CHOOSING frames only (§3.2c).
- **Palette:** white, washed denim blue, heather grey, one coral accent. **Metal:** fine silver chain.
- **Bedding:** lilac washed cotton or coral-soft (white washes her out).
- Oversized washed-denim shirt, sleeves rolled, slid off one shoulder from behind by her own hand.
  Bare: shoulder blade, nape. `shirt-open`
- Heather-grey ribbed cardigan, held closed at the sternum with one hand. Bare: collarbones, thigh.
  `knit`
- White ribbed tank, hem at the waist. Bare: arms, shoulders, waist. `tank`
- Coral matte high-cut briefs, leg line at the hip bone. Bare: hip hollow, thigh, lower back. `briefs-highcut`
- High-waisted light denim for clothed frames. `trousers`
- Off-character: lace, corsetry, latex, red satin, anything sultry-coded or costumey.

### Maya (warm brown skin, natural curls)
Persona: warm, playful, the reassuring one; softens the hard question with food or a blanket.
- **Palette:** coral, white, lilac. **Metal:** gold hoops.
- **Bedding:** crisp white percale or lilac washed cotton.
- His white poplin shirt, slid down to the elbows, from behind only. Bare: back, shoulders. `shirt-open`
- Chunky coral cardigan, held closed at the sternum. Bare: thigh, hip. `knit`
- Coral matte high-cut briefs. Bare: back, waist, tops of the cheeks. `briefs-highcut`
- Lilac terry robe, belt knotted at the waist. Bare: collarbones, cleavage line, legs. `robe`
- White ribbed cropped tank, hem at the under-curve, side view. Bare: waist, underboob line. `tank`
- Off-character: leather, corsetry, mesh, greige.

### Jade (light warm skin with pink undertones, sleek bob)
Persona: calm minimalist, says little, clean lines.
- **Palette:** ink black, white, lilac, deep plum. **Metal:** one silver ring.
- **Bedding:** crisp white percale or deep plum sateen.
- Black ribbed cropped tank, hem at the under-curve, side view only. Bare: underboob, waist. `tank`
- Black matte high-cut briefs. Bare: leg line, hip hollow. `briefs-highcut`
- Charcoal fine knit pulled off one shoulder by her own hand. Bare: shoulder blade, nape. `knit`
- Lilac short silk kimono, from behind. Bare: the full back below it. `robe`
- Deep plum open-back bodysuit, high-cut, matte. Bare: spine to the waist, legs. `bodysuit`
- Off-character: lace, ruffles, florals, chunky knits, blush.

### Sofia (warm olive skin, long dark waves)
Persona: bold confidante, names the want directly; sleek, a touch dramatic.
- **Palette:** black, brand coral, white. **Metal:** gold statement cuff.
- **Bedding:** deep plum sateen or crisp white percale.
- Black tailored blazer worn over nothing, held closed at the sternum by one hand. Bare: cleavage
  line, legs. `shirt-open`
- Black matte high-cut one-piece, open back. Bare: spine, hips, legs. `bodysuit`
- Coral matte high-cut briefs. Bare: hip hollow, lower back. `briefs-highcut`
- White poplin shirt, cuffs undone, falling off both shoulders from behind. Bare: back, shoulders. `shirt-open`
- Deep plum satin slip, from behind, one strap off the shoulder. Bare: shoulder blade. `slip`
- Off-character: pastels, cutesy prints, chunky knits, anything beige.

### Priya (warm medium brown skin, long dark hair)
Persona: witty, bright, quick to laugh; playful but elevated.
- **Palette:** lilac, coral-pink, white with a coral stripe, sage. **Metal:** stacked fine rose-gold rings.
- **Bedding:** white percale with a fine coral stripe, or lilac washed cotton.
- White pyjama shirt with a coral stripe, unbuttoned, slid off the shoulders from behind. Bare:
  back. `shirt-open`
- Matching pyjama shorts, waistband low at the hip bone. Bare: waist, hip hollow. `briefs-highcut`
- Lilac cropped cardigan, held closed at the sternum. Bare: waist, collarbones. `knit`
- Sage ribbed tank, hem at the waist. Bare: arms, shoulders, waist. `tank`
- Coral-soft terry robe, belt knotted. Bare: legs, collarbones. `robe`
- Off-character: severe black, leather, grey minimalism.

### Vivian (mid 50s, light skin with pink undertones, silver-streaked hair)
Persona: seen it all, unshockable; soft, elevated, modest. First choice for midlife topics.
- **Palette:** plum, coral-soft, white, slate blue. **Metal:** pearl studs, a silver bangle.
- **Bedding:** lilac washed cotton or deep plum sateen.
- Plum cashmere wrap cardigan, belted loosely, slipping from one shoulder. Bare: shoulder,
  collarbones. `knit`
- White poplin shirt, open, slid off both shoulders from behind. Bare: back. `shirt-open`
- Coral-soft silk robe, held closed at the sternum. Bare: neck, collarbones, legs. `robe`
- Deep plum matte high-waisted briefs. Bare: thigh, hip, lower back. `briefs-highcut`
- Slate-blue fine knit for clothed frames. `knit`
- Off-character: beige twinsets, anything "age-appropriate" and frumpy, costumey, sheer.
  #360 (wrapped in a cream sheet in a doorway) is exactly what this closet replaces.

### Diego (light olive skin, swept-back dark hair, light stubble)
Persona: polished flirt; sharp and put-together.
- **Palette:** white, navy, black. **Metal:** steel watch, thin silver chain.
- **Bedding:** crisp white percale or deep plum sateen.
- Male chest frames need a garment closer: shirtless frames failed on nipples in 5 of 6 tests (707
  to 710, 741); a robe closed over the chest passed 2 of 2.
- Navy silk robe, belted, closed over the chest. Bare: neck, forearms, legs. `robe`
- Crisp white dress shirt unbuttoned to the sternum, cuffs rolled. Bare: throat, forearms. `shirt-open`
- Black matte boxer briefs. Bare: thighs, hips, back. `briefs-highcut`
- Charcoal fitted tee for clothed frames. `tank`
- Off-character: athleisure, graphic tees, beige linen.

### Marcus (deep brown skin, athletic, short beard)
Persona: easygoing charmer; elevated casual.
- **Palette:** white, sage, cobalt. **Metal:** matte black ring.
- **Bedding:** crisp white percale or coral-soft washed cotton.
- Same male chest rule as Diego.
- White waffle-weave robe, belted, closed over the chest. Bare: forearms, legs. `robe`
- Sage knit henley, top buttons open. Bare: throat, forearms. `knit`
- Grey marl sweatpants low on the hip, with the robe or henley above. Bare: hip line. `trousers`
- White matte boxer briefs. Bare: thighs, back. `briefs-highcut`
- Cobalt overshirt, open, from behind only. Bare: neck, back of the shoulders. `shirt-open`
- Off-character: beige, flashy logos, anything costumey.

## Coverage classes

`bare-jewellery`, `bedding-edge`, `towel`, `robe`, `shirt-open`, `knit`, `tank`, `briefs-highcut`,
`bodysuit`, `slip`, `trousers`. One per frame, the class that does the covering work.

## Changing a closet

Additions and swaps go through the bus as an `instructions` row for this file, and the owner sees
each one as a PR. When the owner marks a frame "more like this" or "less like this" for its outfit,
`social-art-director` files the change here rather than restating it in a brief.
