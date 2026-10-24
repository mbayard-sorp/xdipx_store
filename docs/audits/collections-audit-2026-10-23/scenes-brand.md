# Collection imagery: brand logos, brand heroes, production (media-manager, planning only)

Nothing generated, uploaded, spent, or edited in the repo. Read-only checks: repo files, Sanity (cast slugs, existing logo assets), products.jsonl. Dated 2026-10-23.

Facts I verified that shape everything below:
- Brand collections today: 86 in Shopify with a VENDOR rule. Under "live" (ACTIVE, in stock, type != Discontinued) I count 65 existing brands at 8+ live plus Magic Wand (6) = 66, not the 67 in taxonomy-draft; reconcile by the one-brand delta before building. With the 14 proposed new brands plus Hachette and Prowler (both pending decision) the hero set is 82 rows.
- None of the 82 has an image (only Magic Wand is marked img=Y in coll-summary; Shopify shows no brand image anywhere).
- Only 7 of 4,371 live products have a `-nobg` cutout as featuredImage. Every other reference is a raw packshot (may be a retail carton).
- Sanity has no brand logos. The only logo assets are `xdipx_logo.svg` and three `*_wLogo.png` images (xdipx watermark stamped onto For Her / For Him / Couple). No collection logo field exists; `brandLogoWall` is a homepage/page block only.
- Cast slugs in Sanity, all active: emma, maya, jade, sofia, priya, vivian, diego, marcus.

---

## 1. LOGOS

### Do I agree: yes, source the real mark, never generate it

Agree fully, with three additions.
1. A generated logo is a counterfeit of a registered mark and would also fail design-doctrine §4 item 4 (no invented words baked into pixels). It also cannot be made faithful: fal/Atlas render letterforms unreliably. No "inspired by", no redraw.
2. Do not trace a raster by eye either. If only a PNG exists, vectorize it mechanically (potrace/vtracer) from the official file, diff it against the source at 4x, and keep the source PNG as the record. That is a faithful conversion, not a new mark.
3. Reseller use needs an audit trail, not just a file. We use the marks nominatively (naming the brand we stock), and we are an authorized reseller through Nalpac, but several manufacturers' dealer agreements restrict logo use to supplied assets and bar altering colour. Store the source URL, who supplied it, and the date per brand (fields below). Add one line in the site footer: "Brand names and logos belong to their owners; xdipx is an independent retailer."
4. Never place a logo inside a generated image. The owner's "no text or labels" holds for the hero pixels. A brand name that appears on the product body we are featuring is still allowed by the 2026-09-19 ruling (doctrine §4 item 4), which is the only brand text in the image.

### Sourcing tiers (my priors from general knowledge of these companies; NOT yet verified brand-by-brand)

Counts are for the 82-row set. Tier is the Logo tier column of the appendix.

| Tier | Brands | Best route | SVG / transparent PNG likelihood |
|---|---|---|---|
| A (32) | LELO, We-Vibe, Womanizer, Lovense, Dame, Je Joue, Tenga, Doc Johnson, Blush, Shots, Pipedream, System JO, Sliquid, Pjur, Bathmate, Le Wand, Magic Wand (Vibratex), BMS (PowerBullet), Screaming O, Adam & Eve, Tantus, b-Vibe, Shinesty, Aneros, Wicked, Swiss Navy, ID Lubricants, XR Brands, Evolved, VUSH, FemmeFunn, Sportsheets | Brand press/media-kit page first; else the Nalpac dealer/brand portal (brand sell sheets carry the mark); else an email to the brand's trade contact asking for "retailer logo pack, SVG + one-colour" | Transparent PNG: near certain. SVG or vector PDF/EPS: likely (roughly 60 to 70 percent). Larger brands (LELO, We-Vibe, Womanizer, Lovense, Dame, Doc Johnson, Blush, Shots) usually publish both one-colour and reversed |
| B (38) | Everything else with a real consumer brand: Camtoyz, Nasstoys, Forto, Dreamgirl, Fantasy Lingerie, Magic Silk, Allure, Rene Rofe, Oxballs, Perfect Fit, Zero Tolerance, Intimate Earth, Earthly Body, Bijoux Indiscrets, Eye of Love, Exsens, Pastease, UVA, Biird, Gender X, Selopa, SVibe, VeDO, Luv Inc., Nu Sensuelle, Sweetums, Together Toy, HighOnLove, Sensuva, Male Power, Prowler, Prowler RED, Rouge Garments, Curve Novelties, Tentra, Nexus | Brand website header or footer SVG as the lead, then a trade-contact email for permission and a clean file. Nalpac sell sheets for the rest | Transparent PNG: probable. SVG: roughly 50/50. Expect a 2 to 3 week reply tail; ship the page with the typographic fallback and swap the logo in when it lands |
| C (12) | Distributor or house vendors that are not consumer brands: Paradise Marketing (the consumer brand is Trojan), Global Novelties (Nixie, Winx), Hott Products, Icon Brands (The 9's), Lovely Planet (Love to Love, Strap-On-Me), PDX Brands, Creative Conceptions (Sei Mio, Clarity), Stockroom (Kinklab), Hachette (a publisher), NS Novelties, Little Genie, Kheper Games | Do not hunt for a corporate mark nobody recognises. Either retitle the collection to the consumer brand (Trojan, Love to Love, Kinklab) and source that mark, or ship with the typographic wordmark and no logo | n/a. Recommend the retitle for Paradise Marketing, Lovely Planet, Stockroom, Global Novelties at taxonomy time |

Recommended sourcing run (one agent day plus waiting): an agent fetches each brand's press/asset page, records URL and file types found, drafts the trade email for the owner or buyer to send (agents do not send outreach, per the outreach campaign rule). Tier A should land first; the page does not wait on Tier B/C.

### Display spec

- Where: PLP brand header only, in a row directly above the H1 on `_layout.collections.$handle.tsx` for `collectionType === 'brand'`. Left aligned, 36px tall at 375px, 44px at md+, max width 160px, 16px clear space on all sides, min clear space equals the mark's own height or the brand kit's rule if it states one.
- Hub card (`_layout.collections._index.tsx` brand grid): logo in the card body above the title at 24px tall. Never overlaid on the hero image (keeps the image text-free and avoids contrast problems).
- Colour: monochrome ink (#1A1418) is the default everywhere so 80 marks read as one shelf. Use the brand's own one-colour or "black" variant, not a CSS recolour, whenever it exists. Reversed (white) on any ink surface, from the supplied reversed file; a CSS `filter: brightness(0) invert(1)` is acceptable only for a flat single-colour mark and only if the brand kit permits one-colour use. A full-colour mark is allowed only where the brand supplies nothing else, only on paper, and only if it clears 4.5:1 against paper; never recolour to coral or plum.
- Alt: "{Brand} logo". `loading="lazy"` on the hub, eager on the PLP header (it is above the fold but tiny). Explicit width/height from the file to avoid CLS.
- Fallback when no file: no logo slot, and the H1 stays the brand name in Newsreader. Do not set a fake wordmark that imitates the brand's lettering.

### Data home

Recommend Sanity, in a NEW document type, not a Shopify metafield and not a new field on `collectionPage`.
- Why not Shopify: a collection metafield of type file_reference would store an SVG as a generic file, not an image, and the loader projections (`image{url}`) would not give dimensions or a clean transform. The logo also needs provenance fields that make no sense on a Shopify collection.
- Why not a new field on `collectionPage`: CLAUDE.md says Sanity schema is additive only and not to modify existing schema. Adding a field to an existing document type is a modification. A new type is additive.
- Shape: new file `studio/schemas/brandIdentity.js`, registered in the schema index only: `shopifyHandle` (string, required, matches the collection handle), `logoMono` (file, SVG), `logoMonoPng` (image, transparent), `logoReversed` (file or image), `logoColor` (file or image, optional), `status` (supplied, pending, wordmark-only), `sourceUrl`, `suppliedBy`, `permissionNote`, `checkedAt`.
- Loader: `getBrandIdentity(handle)` added to the existing `Promise.all` in the collection loader (no new waterfall), returning null when absent. 172 `collectionPage` docs already exist keyed by handle, so the editorial pattern is the same.
- The existing `brandLogoWall` block can be reused on the hub later; it is homepage/page scoped and separate from this.

---

## 2. BRAND HEROES

### My cohesion device (to reconcile with the series bible)

"Brands are people, categories are zones." Every brand hero is a face and a hand holding the real product; categories (sibling's set) are body-zone and use frames. The viewer scanning the hub sees a cast of people on the brand shelf and bodies on the category shelf, which is also how the cast distribution reads.

Locked grammar for all 82 brand frames:
1. One subject: a cast member waist-up or tighter, or a four-product collage. Product in a hand, fingers visible, label forward where there is a label. Never an empty room: a collage is product on a colour block, not a room.
2. Ground by product family, from the existing ground lock only. Coral-soft: vibrators, wands, suction, bullets, rings. Plum-soft: lube, oil, care, games, books, scent. White plaster (the word "paper" is banned in prompts): lingerie, fetish gear, menswear, rope.
3. Rhyme: exactly one echo of the product's own colour (nail, a tiny object, jewellery in that cast member's metal), per archetype B.
4. Beat vocabulary, one verb per frame so no two neighbours repeat: offer, test, choose, pour, wear, wind, dare. The story sentence in the table is the beat.
5. Camera: 85mm eye level, hard directional daylight window shadow, shallow depth. One small physical heart only in about one frame in four (hero motif).
6. Crop safety band for all consumers: master is 16:9, subject and hands inside the central 67 percent height by 70 percent width (see section 3).

Cast mix: 60 of 82 rows carry a cast member (73 percent); 22 are collages. That leaves room for the category set to sit below 50 percent and still clear the owner's overall "at least half" across 150. Counts: priya 11, sofia 10, maya 9, jade 8, vivian 8, emma 7, marcus 4, diego 3, collage 22. Hub order rule: never two identical cast faces adjacent, never two collages adjacent.

### Rules applied to every row (owner rejection list)

- Cast holds the product. Never floating, never resting on arms, shoulders, backs. Prompt text: "held in the fingers, thumb visible".
- Where and how it is used, with one honest clarification. Genital and anal toys cannot be shown at the real use site (stop list). So the licensed substitute is the nearest permitted contact zone, hip hollow or top of thigh or low belly or bare hip bone (§3.2c), held in hand, never at the cheek, collarbone, wrist or shoulder. Wands are the exception: a back/shoulder/nape massage is their real use, so the Magic Wand and Le Wand rows are on the shoulder and nape. Lube and oil are poured onto fingers or palm or worked onto a shoulder; blindfolds go over the eyes; rope and cuffs go on wrists; stockings go up a leg; lingerie is worn; condoms and games are held as packets.
- Female-anatomy products only on female cast (Emma, Maya, Jade, Sofia, Priya, Vivian). The We-Vibe row shows a male forearm laid over her hand; she holds the product.
- Penis-use products (strokers, rings, pumps, sleeves) are collages in every case; I did not put any on a man, since product-against-genitalia and outline are stop-list items.
- Bottle and box labels visible. This collides with "no text or labels" and with the routing doc's no-retail-carton rule, so I resolve it as follows: "no text" means no overlay graphics, captions, watermarks, invented words. The product's own printed label and body wordmark are part of the product and must render faithfully (doctrine §4 item 4). Cartons stay out unless the carton is the product (books, games, condoms, kits). Vision gate transcribes legible text; garbled or invented text is a reject, matching label to the product title.
- No bare breasts, no genitals, no pubic hair above the panty line: wardrobe comes from `cast-wardrobe.md` closets (register 9, opaque nipple motif and front panel, smooth skin above the waistband, no beige, no bulky fabric, no draped sheets). Pasties rows (Pastease, UVA) are flagged gate-risk medium with a held-in-fingers fallback.
- Men: chests bare (2026-10-02 definition), briefs or jock opaque at the front. Shinesty ball-hammock briefs are the highest outline risk in the male set; crop at the waistband, with the right-meow boyshort on Priya as the fallback hero.
- Product scale: `PRODUCT_SCALE_RATIO_ANCHOR` in the prompt (no wider than a third of the face and smaller than the hand for hand-held toys).

### Hero table

The full 82-row table with real handles, in-stock counts, cast, one-sentence story, and hand action is the appendix at the end of this file. A few rows worth reading first:
- Collage (22): blush, b-vibe, ns-novelties, pipedream, oxballs, me-you-us, pdx-brands, shaft, forto, curve-novelties, hott-products, zero-tolerance, aneros, tenga, bathmate, gender-x, nexus, tentra, screaming-o, together-toy, perfect-fit, stockroom. Pure penis-device brands (Oxballs, Perfect Fit, PDX, Bathmate, Zero Tolerance, Shaft) are collage by rule.
- Emma (CHOOSING frames only, per cast-wardrobe): little-genie, bijoux-indiscrets, je-joue, eye-of-love, vush, kheper-games, hachette.
- Men on cast: prowler-red (Diego), male-power (Diego), id-lubricants (Diego), swiss-navy (Marcus), paradise-marketing (Marcus), shinesty (Marcus), prowler (Marcus).
- Decisions the owner or taxonomy needs: Hachette (51 books and games, publisher not brand; row is ready if it stays), Prowler vs Prowler RED (two rows ready, a merge would drop one), the Tier C retitles above, and the counting delta of one brand.

### Reference caveat on heroes

I validated each handle for ACTIVE, in stock, not Discontinued, but I did not open the photos. Several hero reference images may be a retail carton rather than a bare product (routing doc: SKU 96203 case). Section 3 handles that with the bare-reference check before any spend.

---

## 3. PRODUCTION

### Model route: Atlas seedream-4.5-edit, not fal

The owner said "the fal.ai integration". I read it as "the existing image-generation integration", which was fal-first until his own 2026-08-15 all-hands direction made Atlas Cloud primary because fal's failure rate on this vertical was unfit. Evidence in `docs/media-model-routing.md`: seedream-v4.5/edit on fal returned 422 content_policy on the Shopify packshot itself (input filter on `body.image`); the same model on Atlas passed the cast-plus-insertable-toy pairing twice, held product geometry, honoured exact 1728x2160 free-form sizes, at $0.036 per image in 22 to 31 seconds. fal nano-banana is rejected too (Google IMAGE_SAFETY). So:
- Primary: Atlas `bytedance/seedream-v4.5/edit` with 2 to 5 reference images (cast + product, product-only for collages), via `generateImage()` / `atlasGenerate()`. Single entry point, no direct provider calls.
- Fallback: fal flux-kontext/dev with a product reference, only if Atlas errors. Imagen last.
- fal's role stays BiRefNet background removal for cutouts, which is trivial in cost.
- Residual owner item that still stands: the Atlas AUP contradiction in `docs/atlascloud-aup-capture-2026-08-15.md`. One sentence to the owner: this plan uses Atlas for ~600 images of lingerie-clad cast with products; the AUP item should be closed first, or we fall back to fal and accept the higher block rate.
- No model or API route is needed for logos (section 1).

### Product reference approach

1. Walk the product's Shopify media list, not `featuredMedia`, for a text-free bare-product frame, using the existing bare-reference vision check (`bare-reference-vision-check.ts`). Reason: featuredMedia can be a retail carton (routing doc).
2. Run fal BiRefNet on the chosen frame to a transparent cutout on white (only 7 of 4,371 live products already have a `-nobg`). About 170 cutouts for 82 brands.
3. Pass the cutout as the product reference; add `ATLAS_NO_CARTON_CLAUSE` and the scale clause (`compositeProductClauses('atlas')`). For books, games, condoms and kits the carton is the product: flag `cartonIsProduct` and waive the clause.
4. Collages use 3 to 4 cutouts as refs. Fallback if Seedream scrambles products: a deterministic composite (sharp) of cutouts on the flat ground with hard-edged shadows, zero generation cost; weaker story but always faithful.
5. Label products (lubes, sprays, oils, games): reference must show the label front; vision gate OCR checks the label text matches the product.

### Cast reference approach

- Face: `castMember.referencePhoto`; body-on-skin frames use `bodyReferencePhoto` where present (`social-cast-reference.server.ts` already picks). One cast reference plus one product reference per call. The reference photo propagates into the frame (Maya's neckline lesson), so wardrobe is fixed by the closet in `cast-wardrobe.md` in the prompt, and any cast whose reference needs reshooting is raised before the run.
- Wardrobe per row comes from the named cast closet (register 9, named colour and weave, named metal, opaque nipple detail and front panel where lingerie shows, smooth skin above waistband). Emma keeps BEFORE/CHOOSING frames.
- No new cast likeness policy question: all 8 are existing roster; Emma's body is cleared (blocker #193).

### Candidates and cost for ~150 collections

- Brands: cast rows 3 candidates, collage rows 4 candidates. 60 x 3 + 22 x 4 = 268 images.
- Categories (sibling's set, about 68): assume 3 each = 204 images.
- Retry allowance 30 percent (one regenerate on a failed pair per the media-manager rule; two failures fall back to product photography or the deterministic composite): about 140 images.
- Total about 610 images x $0.036 = about $22. Cutouts about $1 or less. Automated vision gate on the shortlisted winners and runners-up (about 300 calls) is API-key spend, about $3 to $6 at current gate size; interactive viewing of contact sheets (this agent family views images directly) is free. Budget cap to request: $45 all-in, hard stop at $35 for the generation line. The existing daily budget gate and `max_images` apply; a refused gate no-ops.
- Wall clock: 22 to 31 s each, Atlas allows parallel; the whole run is a few hours of queue time, not days.

### QA gate

1. Automatic reject before anyone looks: the existing vision gate checks (hands/anatomy, nudity as the owner defined it, stop list, age ambiguity, legible text transcription) plus two new brand-frame checks I would add: product identity (hero SKU shape and colour match the reference) and label legibility match. Run on the cropped frames the page will actually show (16:6 and 4:3 and 1.35:1 crops), since a crop that cuts a hand off fails.
2. Media-manager contact-sheet review of every survivor against the owner rejection list (hold, scale, anatomy, use site, labels, hair line, cohesion with neighbours). One fail: regenerate once; two fails: stop and use the composite or product photography.
3. Owner review before anything goes live (his brand, legal, likeness surface per the owner-bandwidth doctrine). He sees one winner per collection plus the two runners-up; approving, rejecting with a note, or redoing is one click.

### Where results go, and what has to be fixed first

Collection image storage target: Shopify `collection.image`. Reason, from the coordinator's code map: the hub cards read only Shopify `collection.image`; the PLP hero reads `sanity.heroImageUrl || collection.image.url`; og:image is derived from the same. Putting the image in Shopify reaches the hub, the PLP hero, the OG tag and structured data in one write. Sanity `heroImageOverride` reaches only the PLP hero and og:image, so using it would leave the hub empty and split the truth across two systems. (Sanity remains right for logos, section 1.)

Blockers that must be fixed before the first upload; all are small:
1. `updateCollectionImage` (shopify.server.ts line 6399) is a stub returning ''. Implement it: stagedUploadsCreate with the collection-image resource, upload, then `collectionUpdate` with `image { src, altText }`; reuse the staged-upload code that `uploadMoodImageToShopifyFilesWithId` already contains. Also return the Shopify file URL for the record.
2. Remove the watermark from the collection path. `api.admin.collection-image.tsx` calls `applyWatermark`, which stamps the xdipx logo (the three `*_wLogo.png` assets in Sanity are exactly that). That is a logo in the pixels and contradicts "no text or labels".
3. Do not route generation through `api.admin.imagen.generate`: it appends "no logos" (which would also strip brand wordmarks on the product body that the 2026-09-19 ruling allows) and is Imagen-only. Add a new script `scripts/gen-collection-image.ts`, modelled on `gen-homepage-image.ts` but writing to Shopify, with `feature: 'collection-images'`, per-image cost logging, and the budget gate. Do not reuse `gen-homepage-image.ts`: it uploads to Sanity.
4. Rework the admin surface (below) since `admin.collections-mgr.tsx` generates through that Imagen route and sets through the stub.
5. Name and tag uploads: `collection-{handle}-{cast|collage}-{hero-handle}-{yyyymmdd}-cand{n}`.

Crop contract (one master serves all four consumers): generate 2560 x 1440 (16:9). Consumers: PLP hero 16:6 (2.67:1) crops to 67 percent of height; hub card about 1.7:1 crops a little; featured card 1.35:1 crops to about 76 percent of width; CategoryMasthead 4:3 crops to 75 percent of width; OG 1.91:1. So brief every frame with: subject, hands and product inside the central 67 percent height and 70 percent width, face in the upper third of that band, nothing important at the left or right 15 percent. The hub and masthead use `object-cover object-center`, so centre-weighted composition is the whole trick. Check each winner with all four crops in the contact sheet.

Alt text: write per collection and store in `collection.image.altText`: plain, factual, keyword-relevant, register-neutral. Example: "Priya holding the LELO Sona clitoral stimulator against her hip, bright plum-soft backdrop". Written under the voice charter: no em dashes, no "sexy", no claims of experience.

### Review surface for the owner

Do not stage on live collections. Plan:
1. Candidates upload as unlinked Shopify Files with the naming above (no collection update, so nothing is customer-visible).
2. A new admin route (suggest `admin.collections-review`) lists each collection: handle, current image (none), the three or four candidates at their actual hub crop and PLP crop, the hero products, the story line, the QA verdict (gate flags, label read), and buttons Approve (calls `collectionUpdate`), Reject with note, Redo. This replaces the generate flow in `admin.collections-mgr.tsx`. Batch Approve per group (brands, categories) after the owner has spot-checked.
3. Until that route is built, a single static contact-sheet page committed to a PR (one row per collection) works as the review surface; the approve step is a script run by an agent.
4. Nothing goes live until the owner approves a group. After approval the hub's cache window (900s edge) applies.

### Order of operations

1. Close the Atlas AUP item or confirm the fal fallback. 2. Fix blockers 1, 2, 3. 3. Source Tier A logos while the bare-reference and cutout pass runs for all 82 heroes (no generation cost besides cutouts). 4. Pilot 6 brands (two collage, four cast across Maya/Jade/Vivian/Marcus, plus one label product like System JO) with 3 candidates each, about $0.65. 5. Owner reviews the pilot; adjust the grammar. 6. Run the remaining brands, then the categories after the series bible lands. 7. Reconcile the two cohesion proposals before the full run, not after.

### Risks I want on the record

- Highest gate-risk rows: Pastease and UVA (nipple covers), Shinesty and Male Power and Prowler (men's briefs outline), Lovense and VeDO type panty-vibe frames near the thong line. Each has a fallback hero or a held-in-fingers option written into the row.
- Collage rows with flesh-tone or realistic forms (Shaft, PDX, Hott) can read as genitals to the gate. I used tube-form models and the abstract 'object' framing; the deterministic composite is the escape.
- A multi-product Seedream edit can merge products; the 4-candidate collage budget and the composite fallback are the mitigation.
- Atlas AUP and any provider change are the single largest schedule risk; everything else is a few days.

## Appendix: all 82 brand heroes (handles validated against products.jsonl: ACTIVE, totalInventory>0, productType != Discontinued; inventory in parentheses)

| # | Collection handle | Hero product handle(s) (primary first) | Cast | Story (one sentence) | What the hands are doing | Logo tier | New? |
|---|---|---|---|---|---|---|---|
| 1 | blush | `b-yours-power-bullet-remote-controlled-egg-vibrator` (195)<br>`gaia-eco-slimline-vibrator` (101)<br>`b-yours-beginner-s-bunny-rabbit-vibrator-purple` (40)<br>`temptasia-ardor-blindfold` (59) | collage | House of first-time wins: four sub-lines tipped out of a tote onto a coral-soft block, one bullet rolled loose toward the edge. | none (a single hand may enter at the edge reaching for the bullet, not counted as cast) | A |  |
| 2 | shots | `loveline-budsie-airtaptech-rechargeable-vibrator` (247)<br>`ouch-satin-mask` (296) | priya | The treat she bought herself: Priya turns the Budsie in her fingertips like a new lipstick, deciding. | fingertips of both hands cradle the Budsie against her bare hip hollow, thumb on the button | A |  |
| 3 | doc-johnson | `goodhead-deep-throat-spray-sweet-strawberry` (263)<br>`mochi-mushroom-rechargeable-silicone-vibe-purple` (99) | sofia | A pre-date tease: Sofia lifts the strawberry spray to her mouth with a half smile, bottle label facing camera. | right hand holds the bottle at chin height, label forward; left thumb rests on the nozzle | A |  |
| 4 | xr-brands | `bang-vibrating-bullet-with-remote-control-purple` (389)<br>`bang-10x-mini-silicone-wand` (118) | maya | The hand-off: Maya presses the bullet to her bare hip bone with one hand and holds the remote out to the lens with the other, daring you to take it. | bullet held in right hand on bare hip hollow; left hand offers the remote palm-up to camera | A |  |
| 5 | prowler-red | `prowler-red-switch-jock-xl` (619)<br>`prowler-hanky` (1987) | diego | Pride-week swagger: Diego hooks a thumb in the jock waistband, red hanky in the other fist. | thumb in waistband, other hand grips the hanky at his hip; frame cropped chest to upper thigh | B |  |
| 6 | sportsheets | `sportsheets-sex-mischief-satin-blindfold-black` (127)<br>`under-the-bed-restraint-system-black` (156) | sofia | The reveal before the dark: Sofia draws the satin blindfold across her own eyes, lips parted. | both hands pull the band taut at her temples | A |  |
| 7 | b-vibe | `b-vibe-snug-plug-2-weighted-silicone-anal-plug` (84)<br>`b-vibe-snug-ring-45mm-snug-fit-silicone-c-ring-black` (173)<br>`4-in-vibing-plug` (96) | collage | The weight class: three graduated plugs and a ring in a descending row on plum-soft, a shadow-step staircase. | none | A |  |
| 8 | tantus | `tantus-rope-30-ft-azure` (4260)<br>`tantus-silk-dildo-onyx` (1090) | jade | Jade winds thirty feet of azure rope around her own wrists, unhurried, slightly amused. | both hands loop and cross the rope at the wrists, loose, thumbs free | A |  |
| 9 | little-genie | `love-me-lotto` (274)<br>`sex-slime-water-based-lubricant` (207) | emma | Emma, choosing: a scratch game in one hand, a bottle of slime in the other, eyebrow up. | one product per hand, held up at chest height, label facing the lens, weighing them like fruit | C |  |
| 10 | global-novelties | `nixie-smooch-rechargeable-lipstick-vibrator-ombre` (1170)<br>`nixie-rechargeable-wand-massager-ombre-metallic` (781) | priya | Priya presents the Smooch lipstick vibe like a lipstick she is not putting on her mouth. | right hand holds it at the bare top of the thigh, left hand cups the cap | C |  |
| 11 | pipedream | `fetish-fantasy-series-satin-love-mask-red` (181)<br>`classix-rocket-bullet-vibrator` (83)<br>`pipedream-glow-in-the-dark-erotic-dice` (73)<br>`moist-personal-lubricant-premium-formula-130-ml-4-4-oz` (56) | collage | Date-night kit: red mask, rocket bullet, dice and a bottle fanned out like a poker hand on coral-soft, dice mid-tumble. | none | A |  |
| 12 | oxballs | `oxballs-willy-rings-3-pack-cockrings-o-s` (352)<br>`oxballs-spinner-single-silicone-ring` (161) | collage | Stacked like bangles: silicone rings in a tower on plum-soft, one rolled off and caught mid-wobble. | none | B |  |
| 13 | system-jo | `jo-classic-hybrid-lubricant` (575)<br>`jo-h2o-original-water-based-lubricant-4-oz` (184) | vivian | Vivian pours a slow ribbon of lube across her fingertips, thumb and finger parting to show the string. | pump bottle in the left hand tilted, right hand open beneath, label readable | A |  |
| 14 | ns-novelties | `glams-xchange-heart-anal-plug-medium-1` (136)<br>`cosmic-glams-plug-m` (48)<br>`minnie-s-flick-pink` (26)<br>`firefly-halo-cock-ring` (28) | collage | The jewel box: heart-gem plugs and a halo ring laid out like earrings on a coral-soft ground, one heart gem catching a hard window light. | none | C |  |
| 15 | fantasy-lingerie | `fantasy-lingerie-opulence-pearl-strap-halter-bralette-adjustable-pearl-g-string-light-blue-l-xl` (49)<br>`fantasy-lingerie-opulence-split-pearl-cup-crotchless-teddy-with-adjustable-pearl-g-string-hot-pink-l-xl` (51) | sofia | Sofia in the pearl halter set, mid-twirl of a pearl strand, mirror light on her collarbone. | one hand lifts the pearl back strap, the other rests on the hip bone; frame to mid-thigh, panel opaque | B |  |
| 16 | intimate-earth | `intimate-earth-pussy-willow-silk-hybrid-glide` (318)<br>`intimate-earth-pussy-willow-hybrid-foil` (355) | priya | Priya stretches a ribbon of silk glide between thumb and two fingers and holds it to the window light, testing the slip. | tube in left hand, label forward; right hand lifted, thread of lube between fingertips | B |  |
| 17 | me-you-us | `me-you-us-crystal-jewels-metal-plug` (1197)<br>`me-you-us-furry-handcuffs` (679)<br>`me-you-us-hopping-hare-cock-ring` (655)<br>`me-you-us-dual-masseuse-silicone-nipple-suckers-2-pack-purple` (984) | collage | Four-piece gift set tipped out of a gift bag onto plum-soft, ribbon half undone. | none | B |  |
| 18 | lovely-planet | `love-to-love-waouhhh-bullet-vibrator-midnight-indigo` (186)<br>`love-to-love-waouhhh-bullet-vibrator-teal-me` (73) | maya | Midnight indigo against warm skin: Maya rolls the Waouhhh along her hip bone as if checking the weight. | right hand holds the bullet resting on the bare hip bone, left hand flat on her belly | C |  |
| 19 | pdx-brands | `pdx-elite-motobator-2-rechargeable-thrusting-vibrating-masturbator-clear-black` (24)<br>`pdx-elite-fuck-o-matic-rechargeable-vibrating-suction-stroker-with-ball-cradle` (46) | collage | The machine room: tube-form rechargeable strokers standing like a trophy shelf on paper-white, charging cables looped like bows. Use tube-form models only. | none | C |  |
| 20 | creative-conceptions | `quickie-cuffs` (96)<br>`clarity-utopian-mystique-glass-dildo` (125) | priya | Priya snaps one Quickie Cuff around her own wrist and holds the other loop up to the lens. | left wrist cuffed, right hand lifts the open loop on its chain | C |  |
| 21 | femmefunn | `femmefunn-ultra-bullet-massager-rechargeable-silicone-vibrator` (172)<br>`solia-bullet-pink` (120) | vivian | Vivian, unbothered: the pink Ultra Bullet resting against her bare hip hollow in her loose fist. | right hand holds it against bare hip hollow, silver bangle visible | A |  |
| 22 | pastease | `pastease-plus-x-faux-latex-pleather-vinyl-black-cross-pasties` (63)<br>`pastease-glitter-star-pasties` (81) | jade | Black X pasties and a straight look: Jade adjusts the edge of one with a fingertip. Gate-risk medium; fallback is the pasties pair held between fingertips beside her face. | index finger and thumb press the pastie edge; other forearm across lower bust | B |  |
| 23 | vedo | `vedo-moe-rechargeable-extra-mini-wand-black` (73)<br>`vedo-retro-rechargeable-bullet` (122) | sofia | Sofia weighs the Moe extra-mini wand against the top of her bare thigh, deadpan, like checking a pen. | right hand holds Moe against bare top of thigh; gold cuff visible | B |  |
| 24 | shaft | `shaft-model-n-7-5-in-dual-density-silicone-dildo-with-balls-oak` (109)<br>`shaft-model-r-c-ring-size-3` (49) | collage | Craft-object shot: an oak and a mahogany Shaft with their c-ring on a coral-soft block, hard window shadow raking across. | none | B |  |
| 25 | wicked | `wicked-water-based-lubricant` (651)<br>`wicked-simply-hybrid-lubricant-4-oz` (256) | sofia | Sofia presses the pump bottle with one hand and watches the glossy drop land on her other palm. | pump head pressed, palm open below; label to camera | A |  |
| 26 | evolved | `evolved-spiral-charm-mint` (38)<br>`evolved-real-simple-rechargeable-bullet-vibrator-black-chrome` (94) | maya | Mint on honey: Maya holds the Spiral Charm rabbit against her hip bone, grinning at its ears. | right hand holds the rabbit's handle against bare hip, left hand on thigh | A |  |
| 27 | sliquid | `sliquid-massage-oil-mint-cedar` (424)<br>`sliquid-naturals-silk-hybrid-lubricant` (373) | vivian | Vivian works mint-cedar oil across her own shoulder, bottle in the other hand, eyes half shut. | bottle in left hand label forward; right palm gliding on bare shoulder | A |  |
| 28 | camtoyz | `camtoyz-eggy-app-controlled-vibrating-egg` (795)<br>`camtoyz-syntra-rechargeable-bullet-vibrator` (644) | sofia | Remote control, literally: Sofia holds the Eggy against her bare hip hollow and a phone face-down in the other hand. | right hand holds egg on hip hollow, left holds phone face-down so no screen text | B |  |
| 29 | nasstoys | `nasstoys-mini-s-leopard-bullet-leopard` (83)<br>`anal-ese-cherry-desensitizing` (359) | priya | Leopard print, tiny and loud: Priya holds the Mini S against her bare hip bone with a grin. | right hand holds the bullet against hip bone | B |  |
| 30 | lovense | `lush-3-bluetooth-remote-controlled-egg-vibrator` (151)<br>`ferri-bluetooth-remote-controlled-panty-vibrator` (113)<br>`nora-bluetooth-remote-controlled-long-distance-rabbit-vibrator` (141) | maya | Maya with Ferri clipped on the waistband of a coral thong, phone face-down in her other hand: the long-distance flirt. | left hand holds Ferri at the thong edge on the bare hip, right hand holds phone face-down | A |  |
| 31 | we-vibe | `we-vibe-sync-lite-pink` (310)<br>`we-vibe-chorus-pro-satin-black` (340) | maya | Two hands, one Sync: Maya (holding) and a partner's hand over hers, knuckles touching, the toy between them. | Maya holds Sync against her bare thigh; second hand (Diego's, forearm only) rests over hers | A |  |
| 32 | bijoux-indiscrets | `bijoux-indiscrets-slow-sex-oral-sex-strips-7-pack` (922)<br>`clitherapy-better-than-your-ex-rechargeable-finger-vibrator` (303)<br>`bijoux-indiscrets-slow-sex-warming-massage-oil-1-69-oz` (411) | emma | Emma choosing: the oral strips pack in one hand, Clitherapy finger vibe in the other. | one item per hand held at chest height, labels forward | B |  |
| 33 | forto | `forto-f-64-wide-liquid-silicone-cockring` (115)<br>`forto-f-31-silicone-anal-plug` (89)<br>`forto-vibrating-anal-plug-green` (78) | collage | Liquid-silicone colour study: rings and plugs in a loose spiral on plum-soft. | none | B |  |
| 34 | dreamgirl | `dreamgirl-sheer-thigh-high-stockings-with-plain-top-and-back-seam-os` (62)<br>`dreamgirl-large-fence-net-fishnet-pantyhose-black-os-1` (77) | sofia | Sofia pulls a back-seam stocking up her calf, heel on the edge of a bed, glance back at you. | both hands smooth the stocking up the shin; frame knee to ankle plus her glance in the upper half | B |  |
| 35 | icon-brands | `the-9-s-flirt-finger-butterfly-finger-vibrator-purple` (44)<br>`the-9-s-make-me-melt-sensual-warm-drip-candles-4-pack-red-hot` (71) | priya | Priya slips the Flirt Finger on her index finger and rests it on the bare top of her thigh, grinning. | vibe on right index finger, fingertip on thigh | C |  |
| 36 | curve-novelties | `curve-toys-gossip-pop-rocker-rechargeable-remote-controlled-silicone-vibrating-anal-plug-magenta` (23)<br>`curve-toys-easy-riders-7-dual-density-dildo-with-balls-suction-cup-beige` (17) | collage | Magenta pop: the Pop Rocker plug and companions on a coral-soft block, remote tilted like a game controller. | none | B |  |
| 37 | pjur | `pjur-water-based-personal-lubricant` (326)<br>`pjur-back-door-silicone-anal-lubricant-with-jojoba` (494)<br>`pjur-woman-lust-vibrating-orgasm-gel-15ml` (310) | jade | Jade rolls the Pjur bottle between her palms, a bead of lube trailing down her wrist. | bottle held between flat palms; lube bead running along bare forearm | A |  |
| 38 | earthly-body | `earthly-body-at-night-aphrodisiac-massage-oil-ylang-ylang` (306)<br>`earthly-body-at-night-aphrodisiac-bubble-bath-sea-jasmine` (122) | vivian | Vivian warms a pour of ylang-ylang oil in her palms over the curve of her own shoulder. | oil bottle at palm height, other hand cupped and glossy, bare shoulder in frame | B |  |
| 39 | adam-eve | `adam-eve-eve-s-blooms-of-bliss-vibrating-sucking-rose` (1886)<br>`adam-eve-slim-lady-rabbit` (1213)<br>`adam-eve-pouty-pucker-lipstick-vibe` (1170) | priya | Priya pins the Blooms of Bliss rose at her bare hip like a corsage and laughs at how it looks. | right hand holds rose toy against the hip bone, petals out | A |  |
| 40 | magic-silk | `magic-silk-seamless-teddy-black-o-s` (26)<br>`magic-silk-pheromone-panties-crotchless-thong-2-pack-lilac-rose-l-xl` (15) | vivian | Vivian in the black seamless teddy, one strap off, tucking her hair, morning light. | one hand tucks hair, other thumb hooks the strap; to mid-thigh, panel opaque | B |  |
| 41 | le-wand | `le-wand-mini-micro-wand` (361)<br>`le-wand-mini-micro-wand-violet` (231) | jade | Jade rolls the Mini Micro wand along the bare nape of her neck, shoulders dropping. | right hand holds the wand by the handle at the nape, head against skin | A |  |
| 42 | je-joue | `ily-by-je-joue-the-pebble-squishy-pebble-shaped-bullet` (291)<br>`ily-by-je-joue-g-spot-rabbit-bullet` (206) | emma | Emma holds the pebble in her cupped palm like a smooth stone from a beach she plans to revisit. | cupped open palm toward the lens, the other hand's fingertip tracing it | A |  |
| 43 | bms | `power-bullet-point-rechargeable` (118)<br>`tie-affair-mini-wand` (44) | sofia | Sofia carries the PowerBullet: it rests against her bare hip beside a gold cuff. | two fingers hold the bullet against bare hip | A |  |
| 44 | eye-of-love | `eye-of-love-bloom-attract-him-pheromone-parfum-lilac-dream` (390)<br>`eye-of-love-bloom-attract-her-pheromone-parfum-earth-s-desire` (156) | emma | Emma dabs perfume at her pulse point, unconvinced and delighted. | roll-on or dropper to bare neck, other hand holds bottle label forward | B |  |
| 45 | lelo | `lelo-sona-3-clitoral-stimulator-purple` (46)<br>`lelo-mia-3-personal-vibrator` (39)<br>`lelo-dot-travel-clitoral-pinpoint-vibrator-purple` (40) | jade | Jade, composed: the Sona held against her bare hip hollow, eyes closed, a rare half smile. | right hand holds Sona flat on hip hollow; left forearm across waist | A |  |
| 46 | dame | `dame-aer-suction-toy-coral` (140)<br>`dame-dip-2-0-classic-vibrator-plum` (132)<br>`dame-aloe-lube-personal-lubricant` (180) | vivian | Vivian with the coral Aer held in a loose fist against her bare hip hollow, comfortable and sure. | Aer in right fist on bare hip hollow, thumb free | A |  |
| 47 | hott-products | `orgasmix` (88)<br>`skins-pecker-straws-lovers-10-pack` (136)<br>`tongue-star-tongue-vibe` (85)<br>`edible-g-string` (72) | collage | Party-drawer pile: arousal gel, pecker straws, tongue vibe and edible g-string in a flat-lay, a drinking straw mid-fall. | none | C |  |
| 48 | exsens | `exsens-wet-kiss-lime-moisturizing-saliva-spray` (149)<br>`exsens-body-oil-amber-jojoba` (145)<br>`exsens-nipple-arousal-cream-oh-my-strawberry-0-3-oz` (215) | priya | Priya gives herself a spritz of lime Wet Kiss toward her open mouth, eyes shut, delighted. | bottle at chin height label forward, other hand at her jaw | B |  |
| 49 | zero-tolerance | `zero-tolerance-naughty-bunny-silicone-rechargeable-purple` (44)<br>`all-the-bases-black` (41)<br>`zero-tolerance-ballin-out-black` (28) | collage | Clubhouse kit: ring, vibe and trainer on a plum-soft block, sporty hard shadows. | none | B |  |
| 50 | sweetums | `sweetums-sweet-spot-sweet-rose` (288)<br>`sweetums-intimate-wipes-cinnamon-bun-flavor-10-pack` (321) | priya | Priya peels a cinnamon-bun wipe pack open with her teeth, mischief in her eyes. | left hand holds the pack, right hand tears the corner; label forward | B |  |
| 51 | svibe | `svibe-snail-twinn-finger-vibrator-cherry-no-app` (345)<br>`svibe-snail-curve-purple` (792)<br>`svibe-snail-jovi-couples-ring-black` (1309) | maya | Maya wears the Snail Twinn finger vibe and presses her fingertip to her bare hip bone, smiling at the camera. | finger vibe on right index finger, resting on hip bone | B |  |
| 52 | vush | `vush-peachy-g-spot` (138)<br>`vush-peachy-mini-wand` (128)<br>`vush-curiosity-cues-cards` (69) | emma | Emma choosing: the Peachy G-spot in one hand, a deck of curiosity cards in the other. | one per hand, held up at shoulder height | A |  |
| 53 | aneros | `aneros-eupho-syn-v` (139)<br>`helix-syn-v-vibrating-prostate-stimulator` (102)<br>`aneros-sessions-gel` (115) | collage | Engineered curves: Aneros pieces arranged like sculptures on paper-white with a hard rake of window light. | none | A |  |
| 54 | highonlove | `highonlove-stimulating-o-oil` (58)<br>`highonlove-firming-body-oil` (80)<br>`highonlove-dark-chocolate-body-paint` (57) | maya | Maya paints a swipe of chocolate body paint along her own bare forearm with a brush, delighted. | brush in right hand, jar in left, painted stripe along forearm | B |  |
| 55 | tenga | `tenga-pairing-orange` (67)<br>`pairing-black` (66)<br>`tenga-geo-coral` (61)<br>`tenga-flip-zero-white` (77) | collage | Tenga's Japanese-design lineup: Pairing and Flip Zero as sculptural objects on coral-soft; Geo-coral as the fruit-bright accent. | none | A |  |
| 56 | bathmate | `bathmate-hydromax7-clear` (33)<br>`bathmate-hydroxtreme5-only` (10) | collage | The acrylic Hydromax 7 standing like a glass vase on plum-soft next to its pump-bulb, hard window light through the water chamber. | none | A |  |
| 57 | biird | `biird-gii-glow-mint` (285)<br>`biird-yonii-2-piece-quartz-eggs-set` (185)<br>`biird-cecii-beaded-glass-dildo` (154) | jade | Jade holds the glowing mint Gii against her bare lower belly in window shade, watching it glow. | right hand holds Gii flat against lower belly, shade across the frame | B |  |
| 58 | gender-x | `gender-x-flapjack-flapper-dual-stimulator-blue` (38)<br>`gender-x-egg-streme-blue` (17)<br>`gender-x-spread-the-love` (31) | collage | Pop-art colour block: Flapjack Flapper and friends on a coral-soft ground, frozen mid-bounce. | none | B |  |
| 59 | kheper-games | `let-s-get-slutty-dice-game` (65)<br>`hedonism-card-game` (59)<br>`santa-s-secret-sex-position-coupons` (171) | emma | Emma shakes the dice in a closed fist beside her ear, listening for the number. | right fist raised beside her ear; left hand fans cards (box or cards legible, no text invented) | C |  |
| 60 | selopa | `selopa-blue-belle-rechargeable-dual-ended-wand-vibrator-silicone-blue` (55)<br>`selopa-siren-g-silicone-rechargeable-blue` (47) | maya | Blue Belle in Maya's hands against a coral thong, a bright and giddy grin. | right hand holds the Blue Belle by one end against her bare hip | B |  |
| 61 | swiss-navy | `swiss-navy-water-based-lubricant-2-oz` (501)<br>`water-based-lubricant-4-oz` (321) | marcus | Marcus, shirtless in a navy robe, flips the 2oz bottle in his fingers like a coin. | bottle flipped between thumb and fingers, label legible; chest bare, robe open | A |  |
| 62 | nexus | `revo-extreme` (15)<br>`nexus-revo-intense-prostate-massager` (7)<br>`douche-pro-prostate-anal-douche-black` (16) | collage | Studio engineering shot of the Revo family standing like a row of watch cases on paper-white; no cast. | none | B |  |
| 63 | allure-lingerie | `allure-the-wild-flower-set-l-xl` (25)<br>`allure-lip-sync-lace-band-thong-with-front-to-back-pearl-string-black-o-s` (20) | sofia | Sofia in the Wild Flower set, a hand tucking a curl behind her ear, caught mid-turn. | hand at hair, other hand on the hip bone; panel opaque, mid-thigh crop | B |  |
| 64 | tentra | `tentra-twyss-twisted-tentacles-vibrating-grinder-purple` (20)<br>`tentra-cor-unicorn-horn-double-ended-vibrating-dildo-pink` (6)<br>`marinus-sea-beast-vibrating-dildo-blue` (12) | collage | Archetype E brand art: a fantasy dildo bouquet arranged like a sea-shell display on coral-soft, wit not crude. | none | B |  |
| 65 | magic-wand | `magic-wand-original-hv-260-massager` (271)<br>`magic-wand-plus-hv-265-massager` (292) | vivian | Vivian, plug-in generation: the original Magic Wand on her bare shoulder like a mic, the cord looped around her wrist. | right hand grips the handle, head against bare shoulder muscle; cord over left wrist | A |  |
| 66 | paradise-marketing | `trojan-her-pleasure-condoms` (101)<br>`night-light-glow-in-the-dark-condoms-3-pack` (136) | marcus | Marcus holds a Trojan Her Pleasure foil packet between two fingers beside his smile. | two fingers pinch the box top corner or packet, label legible, other hand in pocket of a navy robe | C |  |
| 67 | screaming-o | `screaming-o-color-pop-quickie` (101)<br>`screaming-o-plus-color-pop` (70)<br>`screaming-o-ringo-ritz` (166) | collage | Colour-pop party: Color Pop Quickie and Ringo rings in a candy-coloured spiral on plum-soft. | none | A | new |
| 68 | male-power | `male-power-soo-cumfy-boxer-brief-2` (26)<br>`male-power-kilauea-limited-edition-mini-short` (25) | diego | Diego in the Kilauea mini short, a roll of the waistband, eyebrows saying everything. | thumbs hooked low at hip; chest bare; frame chest to upper thigh | B | new |
| 69 | shinesty | `shinesty-the-naughty-bears-gummy-bear-ball-hammock-pouch-underwear-with-fly` (98)<br>`shinesty-the-popsicle-stick-apex-usa-ball-hammock-pouch-underwear-with-fly` (80) | marcus | Gummy-bear boxers and an unbothered grin: Marcus holds the waistband at his hip bone, humour licensed. | both thumbs at the waistband; chest bare, mid-thigh crop | A | new |
| 70 | womanizer | `womanizer-next-liberty-bordeaux` (266)<br>`womanizer-beauty-black-gold` (203)<br>`womanizer-enhance-black` (309) | jade | Jade's Liberty, held against her bare hip hollow like a compact: the design object. | left hand holds Liberty against hip hollow, right hand rests on thigh | A | new |
| 71 | together-toy | `together-blended-pleasure-remote-controlled-triple-pronged-vibrator` (91)<br>`together-double-tap-dual-ended-vibrating-strapless-strap-on` (70)<br>`together-lock-in-dual-ended-vibrating-strap-on-harness-set` (83) | collage | Two-of-a-kind: the paired items laid shoulder to shoulder on coral-soft, remote nestled between. | none | B | new |
| 72 | perfect-fit | `perfect-fit-play-zone-kit-black` (95)<br>`perfect-fit-cock-ball-ring-stretcher-black` (32) | collage | Fit-guide still: the Play Zone kit opened like a tackle box on plum-soft. | none | B | new |
| 73 | sensuva | `sensuva-sizzle-lips-warming-edible-gel-strawberry` (49)<br>`sensuva-on-original-arousal-oil-5-ml-large-box` (162)<br>`sensuva-think-clean-thoughts-anti-bacterial-toy-cleaner` (119) | maya | Maya swipes warming strawberry lip gel across her bottom lip and grins at the tingle. | tube in left hand label forward, right fingertip at lower lip | B | new |
| 74 | id-lubricants | `id-glide-lubricant-disc-cap` (214)<br>`id-sensation-warming-water-based-lubricant` (120) | diego | Diego flicks the ID Glide disc cap open with a thumb, easy and sure. | bottle in left fist, thumb on disc cap; chest bare under open navy robe | A | new |
| 75 | luv-inc | `luv-inc-mw65-mini-wand-rechargeable-flexible-silicone-vibrator` (77)<br>`luv-inc-lb72-silicone-bullet-rechargeable-vibrator` (48)<br>`luv-inc-cs19-pulsing-clitoral-stimulator-rechargeable-silicone` (114) | priya | Priya bends the Mini Wand's flexible neck to show it, laughing. | two hands bend the wand's neck at her chest height, hip bare in lower frame | B | new |
| 76 | rene-rofe | `rene-rofe-2-piece-hollywood-chemise-g-string-set` (31)<br>`rene-rofe-spank-me-strap-back-lace-teddy` (23) | vivian | Vivian in the Hollywood chemise set, a hand on the doorframe, a film-star pause. | one hand on frame, other lifts the chemise hem; panel opaque | B | new |
| 77 | nu-sensuelle | `nu-sensuelle-sunni-nubii-warming-bullet-purple` (29)<br>`nu-sensuelle-siren-nubii-g-spot-vibe-w-hinge` (34) | jade | Jade holds the warming Sunni Nubii bullet in her fist against the bare top of her thigh, curious about the warmth. | right fist closed around the bullet, resting on thigh | B | new |
| 78 | rouge-garments | `rouge-mini-flogger-10-black` (11)<br>`rouge-fetish-play-vegan-ankle-cuffs` (30) | sofia | Sofia drags the tails of the mini flogger across her own shoulder, assessing. | flogger handle in right hand, tails over left bare shoulder | B | new |
| 79 | uva | `uva-circular-nipple-covers-cocoa` (528)<br>`uva-moderate-flow-period-panties-xl` (172) | priya | Priya peels the backing off a cocoa nipple cover, a private, practical moment treated like beauty. Gate-risk medium; fallback is the cover held up between fingertips. | fingertips peel backing; forearm across lower bust | B | new |
| 80 | stockroom | `kinklab-lube-shooter-smoke` (128)<br>`leather-vampire-gloves` (89)<br>`kinklab-neoprene-black-on-black-cuffs` (43) | collage | Kinklab drawer: a lube shooter set, leather gloves and cuffs in a flat-lay on paper-white with one shooter mid-roll. | none | C | new |
| 81 | hachette | `kama-sutra-mini-book` (229)<br>`the-naughty-and-nice-dates-kit` (170)<br>`spark-romance-50-ways-to-deepen-your-connection-match-stick-game` (166) | emma | Emma reads the back of the Kama Sutra mini-book with a smile that has not made a decision yet. | both hands hold the book, spine toward camera (title visible) | C | new |
| 82 | prowler | `prowler-lace-garter-set` (1573)<br>`prowler-lace-bra` (1512)<br>`prowler-brief` (999) | marcus | Marcus in the Prowler lace bra and brief, fingers of one hand through the garter strap, as ordinary as a Tuesday. | one hand at garter strap on bare thigh, the other on a hip; lace bra opaque at the nipple area | B | new |
