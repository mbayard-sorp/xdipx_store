# Cast wardrobe (owner direction 2026-10-02)

Owner, verbatim, first ask: *"I'm noticing a trend that our social media images show cast members
wearing what looks like beige sheets. Sometimes it's fine, other's its odd. Do we need a styling
agent or a style director for each of our cast members? They need to be in something that still can
show skin when needed."*

Owner, verbatim, same day, on what good looks like: *"Lingerie can be back on the bodyscape shots...
Robes are good, draped items. Lingerie is good... I just want to stay away from the bulky fabric
look. Garments should be sexy when they are in the frame and should stay at a register 9 for
explicitness. I'd rather see a bra line than a piece of fabric. Our customers need to imagine they
are using the product. No one drapes fabric over themselves to use a vibrator or any of our
products. If they are going to be wearing something, it needs to look like it's been styled for the
shot."*

This file is what each cast member wears, in what colours, with what metal, on what bedding.
`social-art-director` reads it at every brief; `media-manager` and `video-producer` execute what the
brief names from it.

**This file says WHAT they wear, never WHETHER a frame may carry a garment or what may show.** Both
questions have one home, `instagram-campaigns.md` §3.2a, and this file does not restate or widen it.

## Why it exists (measured 2026-10-02)

Nobody designed the beige sheet. It was the sum of four defaults: the 2026-09-19 order took garments
off on-skin frames; a folded sheet was the one closer the doctrine had proved (5 of 5); the "paper"
ban swapped in "warm off-white linen", which was meant for a backdrop and became the name of every
fabric; and the brief template had a colour slot for the product and none for fabric, so anything
unnamed rendered cream.

- 15 of the 20 on-skin frames in the last 40 posted rows used a sheet or towel as the coverage.
- 140 of 172 cast-frame prompts since 09-19 name bedding; 0 give any fabric a non-neutral colour.
- Worn garments across all generated prompts fell from 66 (week of 08-31) to 0 (week of 09-28).
- The odd ones: Vivian wrapped in a sheet like a toga in a doorway (#360), a folded hand towel on the
  groin like a loincloth (#364).
- The clothed frames were beige too: an unnamed "plain fitted t-shirt" rendered cream (#353), and the
  model added nude-tone underwear nobody asked for (#358, #359, #360).
- Next repeat already forming: gold jewellery in 122 of 172 cast prompts.

**No styling agent, and no agent per cast member** (all-hands 2026-10-02, art director and architect
agreeing). Wardrobe is already `social-art-director`'s lever, and it is coupled to what the frame may
show, so a stylist upstream of it would be a second author of the same frame. Eight per-cast agents
would be eight drifting prompt files with nobody owning the grid. What was missing was a field in the
brief and the data to fill it. This file is the data.

## The styling rules (binding on every cast frame)

1. **Styled for the shot, at register 9.** If a garment is in frame it is lingerie, a robe worn open
   or slipping, or one deliberate editorial piece, and it reads like a lingerie campaign styled it.
   The test is the owner's: a bra line beats a piece of fabric. A garment that covers more than the
   stop list needs is a REVISE.
2. **No bulky fabric.** Chunky or cable knits, terry, waffle weave, fleece, sweats, cardigans, towels
   and duvets never appear on a body in a bodyscape. A robe is silk, satin, chiffon or fine jersey,
   short, and falls open or slips; never a bathrobe.
3. **Nobody drapes fabric over themselves to use a product.** The customer has to be able to picture
   themselves in the moment of use, so bedding is the set, never the outfit: she lies on the sheet,
   she does not wear it. A sheet wrapped like a dress (#360) or a towel folded on the groin (#364) is a
   REVISE. Where `instagram-campaigns.md` still allows bedding on the body, that is a transitional
   closer and §3.2a says when it ends.
4. **Name every textile by colour and weave.** Never write any of these on its own: linen, off-white,
   cream, ivory, beige, oatmeal, taupe, greige, flax, nude, natural, neutral. "Linen" alone renders
   as flax even with no colour word.
5. **No nude-tone underwear and no skin-tone bodysuit** unless the brief names one. Put it in the
   negative list of every cast frame; the model adds them unprompted.
6. **What covers a stop zone is decided by §3.2a.** Sheer, lace and mesh are the point of most of
   the pieces below; §3.2a says what must sit opaque under them (on a woman, the nipple and the
   labia), and the brief names that detail (an embroidered appliqué, a satin panel, a strap, her hand).
   The 2026-08-24 white bralette rendered sheer over a nipple when nobody named one.
7. **Contrast with the skin.** Pick the colour that separates from that cast member's skin. Beige on
   skin is a safety problem as well as a taste one: the gate read a beige throw as underwear on #698
   (ticket #11468).
8. **The metal is the closet's.** State the cast member's metal; gold is not the default.
9. **Lock per campaign, rotate per post.** A campaign pins one colour from the lead cast member's
   palette as its `rhymeColor` and writes `wardrobeRegister` from this file (§3 of
   `instagram-campaigns.md`). Pieces rotate post to post. The same person in the same piece twice in
   a campaign is continuity, not a repeat.

## Bedding (the set, never the outfit)

| Name it as | Use |
|---|---|
| crisp white cotton percale, cool grey in the folds | the default |
| coral-soft washed cotton | warm, daylight |
| lilac washed cotton | the plum-soft ground in fabric |
| white cotton percale with a fine coral stripe | playful, morning |
| deep plum cotton sateen | evening and drama, at most 1 per rolling 7 |

Each closet below names which bedding contrasts with that skin.

## The closets

Each piece lists how it is worn, the skin it leaves bare, and its coverage class (the vocabulary the
`wardrobeCoverage` axis records). Every woman's piece over a stop zone names the opaque detail that
sits there. The off-character line binds as much as the pieces.

### Emma (guide, fair with pink undertones)
Persona: warm, direct, delighted and curious rather than sultry. Emma gets BEFORE or CHOOSING frames
only (§3.2c), so her styling is the most playful in the cast and the least sultry.
- **Palette:** white, washed denim blue, coral. **Metal:** fine silver chain.
- **Bedding:** lilac washed cotton or coral-soft (white washes her out).
- White cotton-and-lace bralette with a scalloped edge, opaque cups. Bare: waist, shoulders, back. `bralette`
- Matching high-cut lace briefs, opaque front panel. Bare: hip hollow, thigh, lower back. `briefs-highcut`
- Coral fine-jersey slip, thin straps, one off the shoulder. Bare: shoulders, arms, legs. `slip`
- Washed-denim-blue short silk robe, open, sleeves pushed up. Bare: the centre line, legs. `robe`
- Off-character: black leather, corsetry, latex, red satin, anything costumey.

### Maya (warm brown skin, natural curls)
Persona: warm, playful, the reassuring one.
- **Palette:** coral, white, lilac. **Metal:** gold hoops.
- **Bedding:** crisp white percale or lilac washed cotton.
- Coral balconette bra in sheer tulle, embroidered appliqué over the nipple. Bare: cleavage, waist. `bra`
- Matching coral high-cut briefs with a sheer back. Bare: hip hollow, lower back, tops of the cheeks. `briefs-highcut`
- White cotton string bikini-cut thong. Bare: hips, buttocks below the waistband line. `thong`
- Lilac short satin robe, belt untied, falling off one shoulder. Bare: shoulder, centre line, legs. `robe`
- Off-character: black severe sets, mesh harnesses, greige, anything bulky.

### Jade (light warm skin with pink undertones, sleek bob)
Persona: calm minimalist, says little, clean lines.
- **Palette:** ink black, white, deep plum. **Metal:** one silver ring.
- **Bedding:** crisp white percale or deep plum sateen.
- Black triangle bralette in sheer mesh, a narrow opaque band over the nipple. Bare: everything but
  the band, from the side. `bralette`
- Black high-cut briefs, a single clean leg line at the hip bone. Bare: hip hollow, thigh. `briefs-highcut`
- Deep plum open-back bodysuit, high-cut, matte at the front. Bare: spine to the waist, legs. `bodysuit`
- Black silk kimono, short, slipped to the elbows from behind. Bare: the full back. `robe`
- Off-character: ruffles, florals, pastels, chunky anything.

### Sofia (warm olive skin, long dark waves)
Persona: bold confidante, names the want directly; sleek, a touch dramatic.
- **Palette:** black, brand coral, deep plum. **Metal:** gold statement cuff.
- **Bedding:** deep plum sateen or crisp white percale.
- Black lace underwire bra, scalloped, opaque floral motif over the nipple. Bare: cleavage, ribs. `bra`
- Black high-cut thong with thin side strings. Bare: hips, buttocks. `thong`
- Brand-coral satin slip, bias cut, thin straps. Bare: shoulders, back to the waist. `slip`
- Black suspender belt over high-cut briefs, no stockings. Bare: thighs, hips. `garter`
- Off-character: pastels, cutesy prints, anything bulky, anything beige.

### Priya (warm medium brown skin, long dark hair)
Persona: witty, bright, quick to laugh; playful but elevated.
- **Palette:** lilac, coral-pink, sage, white with a coral stripe. **Metal:** stacked fine rose-gold rings.
- **Bedding:** white percale with a fine coral stripe, or lilac washed cotton.
- Lilac plunge bralette in sheer mesh, embroidered daisies over the nipple. Bare: cleavage, waist. `bralette`
- Matching lilac high-cut briefs. Bare: hip hollow, lower back. `briefs-highcut`
- Coral-pink satin cami and tap shorts, cami strap fallen. Bare: shoulder, waist, legs. `slip`
- Sage short silk robe, open. Bare: centre line, legs. `robe`
- Off-character: severe black, leather, grey minimalism, anything bulky.

### Vivian (mid 50s, light skin with pink undertones, silver-streaked hair)
Persona: seen it all, unshockable; soft and elevated. First choice for midlife topics. Styled at the
same register as everyone else: a woman in her fifties in good lingerie is the point, not a
compromise.
- **Palette:** deep plum, coral-soft, slate blue. **Metal:** pearl studs, a silver bangle.
- **Bedding:** lilac washed cotton or deep plum sateen.
- Deep plum lace bra, full-cup line, opaque floral motif over the nipple. Bare: décolletage,
  shoulders, waist. `bra`
- Matching deep plum high-waisted lace briefs, opaque front. Bare: thigh, hip, lower back. `briefs-highcut`
- Coral-soft silk robe, long, open and slipping off both shoulders. Bare: back, shoulders. `robe`
- Slate-blue satin slip, cowl neck. Bare: shoulders, arms, legs. `slip`
- Off-character: beige twinsets, anything "age-appropriate" and frumpy, bulky knits.
  #360 (wrapped in a cream sheet in a doorway) is exactly what this closet replaces.

### Diego (light olive skin, swept-back dark hair, light stubble)
Persona: polished flirt; sharp and put-together. His chest is bare by default once §3.2a's 2026-10-02
amendment lands (male nipples are not nudity); until then a robe closes the chest.
- **Palette:** black, navy, white. **Metal:** steel watch, thin silver chain.
- **Bedding:** crisp white percale or deep plum sateen.
- Black fitted trunks, low on the hip. Bare: chest, abdomen, thighs, back. `briefs-highcut`
- Navy silk robe, untied, open down the centre. Bare: chest, abdomen, legs. `robe`
- White dress shirt fully unbuttoned, cuffs rolled, nothing under. Bare: chest, abdomen. `shirt-open`
- Off-character: athleisure, graphic tees, sweats, anything bulky.

### Marcus (deep brown skin, athletic, short beard)
Persona: easygoing charmer; elevated casual. Same chest rule as Diego.
- **Palette:** white, sage, cobalt. **Metal:** matte black ring.
- **Bedding:** crisp white percale or coral-soft washed cotton.
- White fitted boxer briefs. Bare: chest, abdomen, thighs, back. `briefs-highcut`
- Cobalt silk robe, open. Bare: chest, abdomen, legs. `robe`
- Sage cotton drawstring trousers, worn low on the hip, chest bare. Bare: chest, abdomen,
  hip line. `trousers`
- Off-character: beige, flashy logos, sweats, anything bulky.

## Coverage classes

`bare-jewellery`, `bra`, `bralette`, `briefs-highcut`, `thong`, `garter`, `bodysuit`, `slip`, `robe`,
`shirt-open`, `trousers`, `bedding-on-body`, `towel`, `bulky`. One per frame, the class that does the
covering work. `bedding-on-body`, `towel` and `bulky` exist so the mix report can count them; the
target for all three is zero.

## Changing a closet

Additions and swaps go through the bus as an `instructions` row for this file, and the owner sees
each one as a PR. When the owner marks a frame "more like this" or "less like this" for its outfit,
`social-art-director` files the change here rather than restating it in a brief.
