# Shopify category playbook (enrichment)

Standing reference for the `emma-product-enricher` agent and the Batch API enrichment prompt. Every
enriched product carries a `shopifyCategory` object so no product is published uncategorized in
Shopify. The server (`app/lib/shopify-category.server.ts`) validates and writes it; this doc is how
you decide it.

Goal: the correct Shopify Standard Product Taxonomy category (a leaf, except the one sanctioned
non-leaf below) plus as many of that
category's attribute values as the product data supports. You cannot query the taxonomy, so every
category you may use, with its id, full name, attributes and allowed values, is embedded below.

## Output shape

```json
"shopifyCategory": {
  "id": "ma-1-4",
  "attributes": { "Color": ["Black"], "Pattern": ["Solid"], "Target gender": ["Unisex"], "Power source": ["Rechargeable"] }
}
```

- `id` is the bare category id as printed below (`ma-1-4`), not the gid.
- `attributes` keys are the exact attribute names printed under the category, values are the exact
  value names. Lists may hold more than one value.
- The server drops any attribute or value that is not allowed for the category, so a wrong guess is
  lost, not harmful. It also never overwrites an attribute that is already set, and never changes a
  category that is already set.
- If no category below fits and the product is not an obvious toy, lube, condom, massage oil or
  erotic book, OMIT `shopifyCategory` entirely and say why in the run summary. The server then
  applies a deterministic default by product type where one is unambiguous, and otherwise leaves the
  product uncategorized for the weekly gap check to catch. Never invent an id.

## Category guidance

Use these unless the product data clearly says otherwise. Always pick a leaf, with one exception:
`hb-3` (see the table). Never `na` (Uncategorized).

| What the product is | Category |
|---|---|
| Any sex toy: vibrators, wands, dildos, strokers, cock rings, plugs, anal beads, prostate massagers, pumps, sleeves, extenders, strap-ons and harnesses for them, sex dolls, sex machines, electrostim, kegel balls and trainers | `ma-1-4` Mature > Erotic > Sex Toys & Erotic Games |
| BDSM and bondage gear: restraints, cuffs, rope, paddles, floggers, whips, crops, gags, collars and leashes, blindfolds sold as bondage gear, nipple clamps, chastity cages, bondage kits, sex furniture and positioning aids | `ma-1-4` |
| Adult games, dice, card games, bachelorette and novelty party items | `ma-1-4` |
| Personal lubricant of any base, including flavored and warming | `hb-3-13` Personal Lubricants |
| Condoms | `hb-1-5` Condoms |
| Massage oil, massage lotion | `hb-3-11-4` Massage Oil |
| Erotic or sex-education books | `ma-1-6` Erotic Books |
| Lingerie | the specific leaf under `aa-1-6` (Babydolls, Bodysuits, Bras, Corsets & Bustiers, Hosiery, Lingerie Sets, Garter Belts, Thongs, G-Strings, and so on). Find it in the list below |
| Pasties, nipple covers | `aa-1-6-2-4` Breast Petals & Concealers. Boob or body tape: `aa-1-6-2-6` or `aa-1-6-8-5` |
| Men's underwear, jocks | the leaf under `aa-1-8-3` (Jockstraps `aa-1-8-3-5`, Thongs `aa-1-8-3-7`, and so on) |
| Fetish wear, erotic costumes, bodystockings sold as erotic wear, wet-look and vinyl outfits that fit no ordinary lingerie leaf | `ma-1-1` Erotic Clothing |
| Edible novelty items (candy underwear, edible body paint) | `ma-1-2` Erotic Food & Edibles |
| Toy cleaners, toy sanitizers and sprays, and sexual wellness supplements, pills, gummies and drops | `hb-3` Health & Beauty > Personal Care. Owner decision 2026-09-30: the taxonomy has no leaf for these, and this is the one sanctioned non-leaf. Use `hb-3` itself, do not search for a leaf and do not omit the field |
| Everything else (desensitizers, arousal gels, oral enhancers, pheromones, douches and enemas, wipes, massage candles, bath and body) | The closest leaf listed below (enema bulbs `hb-3-7-3`, enema accessories `hb-3-7-2`, perfume oils `hb-3-2-8-8`, body cleansing wipes `hb-3-2-1-7-1`, and so on). If none fits, omit `shopifyCategory` |

Owner decision 2026-09-30: items from "Prowler RED Toppers" stay uncategorized. Omit `shopifyCategory`
for them and do not substitute a default.

`productType` is the store's own label and is usually right, but it is not the category. The value
`Discontinued` says nothing about what the product is: classify from the title, tags, dials and
description.

## Attributes

Fill every attribute the product data supports, using the exact attribute and value names below.

Evidence rule: a value must be supported by the product data (title, options, specifications,
description, tags, dials). Do not guess and do not fill a value just to fill it. Leave an attribute
out when the data does not say. `Other` is allowed only when the data states a specific value that
the list truly lacks.

Conventions:

- **Color**: from the Color option values, title, or specifications. Map to the nearest listed color
  (teal to Blue or Green by the dominant read, lavender to Purple, nude and flesh tones to Beige,
  "smoke" to Gray). Several color variants: list each, up to six. More than six, or a single item
  that is itself many colors: `Multicolor`. Unknown color: omit.
- **Pattern**: `Solid` when a color is known and nothing indicates a print. A named print (animal,
  floral, hearts, rainbow, camouflage, lace, striped, and so on) uses that value.
- **Target gender**: from the audience data. For-her only: `Female`. For-him only: `Male`. Couples,
  both, or anyone: `Unisex`.
- **Power source**: only for powered products. USB or magnetic rechargeable: `Rechargeable`. Takes
  replaceable cells (AA, AAA, LR44, watch batteries): `Battery-powered`. Plugs into the wall:
  `AC-powered`. Hand-operated pumps: `Manual`. Non-powered products: omit.
- **Material / Fabric**: from "Material(s)" in specifications or the description. List each named
  material that has an allowed value. TPE, TPR and "body-safe" blends with no matching value: omit.
  This is the Shopify attribute on categories that have one. The separate top-level `material`
  field (next section) is in addition to it and applies to every category.
- **Size** (apparel): from the Size option values or title.
- **Lubricant attributes**: composition (water, silicone, oil, hybrid), application, flavor,
  sensation effect, condom compatibility, form and dispenser only as the data states them.
- **Age group**: `Adults` where the attribute exists.

## Material

Every product payload carries a top-level `material` array, beside `shopifyCategory`, when and only
when the product data names what the product is made of. Look at the specifications "Materials" line
first, then the manufacturer description or title. The server writes it to the store-owned
`xdipx.material` metafield (fill gaps only), because the toy category `ma-1-4` has no Material
attribute in Shopify.

```json
"material": ["Silicone", "ABS Plastic"]
```

- Use only these values, spelled exactly: Silicone, TPE, TPR, ABS Plastic, PVC, Vinyl, Stainless
  Steel, Aluminum, Glass, Faux Leather, Leather, Latex, Rubber, Neoprene, Nylon, Polyester, Spandex,
  Cotton, Satin, Silk, Velvet, Faux Fur, Feather, Wood, Crystal, Ceramic, Stone, Polyurethane,
  Acrylic, Polycarbonate, Steel, Metal, Plastic, Elastomer, Paper. Anything else is dropped.
- List every named material. A silicone body with an ABS handle is `["Silicone","ABS Plastic"]`.
- Proprietary skin-feel names map only when the maker states the base: ULTRASKYN, Fanta Flesh and
  CyberSkin are TPE.
- "Phthalate-free", "latex-free" and "body-safe" are not materials.
- A material named only as something the product is compatible with ("safe with silicone toys", "use
  with latex condoms") is not the product's material.
- When the data does not say, OMIT the field. Never guess from the product type.

Attributes marked "see Appendix" share one allowed-value list, printed once in the appendix at the
end of this file.

## Categories

### `aa-1-4` Apparel & Accessories > Clothing > Dresses

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Sleeve length type: 3/4 | Cap | Long | Other | Short | Sleeveless | Spaghetti strap | Strapless
- Age group: see Appendix Age group (attribute 30, 12 values)
- Neckline: Asymmetric | Bardot | Boat | Cowl | Crew | Halter | Hooded | Mandarin | Mock | Other | Plunging | Round | Split | Square | Sweetheart | Turtle | V-neck | Wrap
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Skirt/Dress length type: Knee | Maxi | Midi | Mini | Other | Short
- Top length type: Bodysuit | Crop top | Long | Medium | Other
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Clothing features: Hypoallergenic | Insulated | Moisture wicking | Other | Quick drying | Reversible | Stretchable | UV protection | Vegan friendly | Water resistant | Windproof | Wrinkle resistant
- Dress occasion: Birthday | Casual | Dance | Everyday | Formal | Holiday | Other | Pageant | Party | Portrait | Religious ceremony | School | Wedding
- Dress style: A-line | Babydoll | Blouson | Caftan | Drop waist | Empire waist | Flared | Gown | Jacket | Mermaid | Other | Pencil | Peplum | Sheath | Shift | Shirt | Skater | Slip | Sweater | Tank | Trumpet | Wrap
- Back design: Backless | Button back | Criss-cross | Keyhole back | Low back | Open back | Other | Racerback | Tie-back | Zipper back
- Hemline style: Asymmetric | Handkerchief | High-low | Mermaid | Other | Ruffled | Scalloped | Slit | Straight | Tulip
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-1` Apparel & Accessories > Clothing > Lingerie > Bodysuits

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Cup size: A | AA | B | C | D | DD | DDD | E | F | FF | G | GG | H | HH | I | J | JJ | K | L | M | N | Other
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-10-1` Apparel & Accessories > Clothing > Lingerie > Shapewear > Bodysuits

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Shapewear support level: see Appendix Shapewear support level (attribute 1197, 6 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Bust design: Built-in bra | High back | Open bust | Other | Plunge | Strapless
- Post-surgery stage suitability: Non-post-surgical | Other | Stage 1 | Stage 2 | Stage 3
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-10-2` Apparel & Accessories > Clothing > Lingerie > Shapewear > Full Body Shapes

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Shapewear support level: see Appendix Shapewear support level (attribute 1197, 6 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-10-3` Apparel & Accessories > Clothing > Lingerie > Shapewear > High Waisted Briefs

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Shapewear support level: see Appendix Shapewear support level (attribute 1197, 6 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Shapewear enhancement feature: Anti-chafing | Anti-roll waistband | Butt lift | Hip padding | Leakproof lining | Other | Postpartum support | Thigh slimming | Tummy control | Waist cinching
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-10-4` Apparel & Accessories > Clothing > Lingerie > Shapewear > Thigh Slimmers

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Shapewear support level: see Appendix Shapewear support level (attribute 1197, 6 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-10-5` Apparel & Accessories > Clothing > Lingerie > Shapewear > Waist Cinchers

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Shapewear support level: see Appendix Shapewear support level (attribute 1197, 6 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Boning type: Acrylic | Bamboo | Carbon fiber | Flat steel | Mixed steel and plastic | None | Other | Plastic | Spiral steel | Steel | Synthetic whalebone
- Heat retention technology: Ceramic coating | Copper infused | Graphene infused | Infrared lining | Latex thermal layer | Neo-sweat neoprene | Other | Polyurethane coating | Silver fiber
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-10-6` Apparel & Accessories > Clothing > Lingerie > Shapewear > Shaping Camisoles & Tank Tops

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Shapewear support level: see Appendix Shapewear support level (attribute 1197, 6 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-10-7` Apparel & Accessories > Clothing > Lingerie > Shapewear > Arm & Upper Body Shapers

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Shapewear support level: see Appendix Shapewear support level (attribute 1197, 6 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-10-8` Apparel & Accessories > Clothing > Lingerie > Shapewear > Shaping Slips

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Shapewear support level: see Appendix Shapewear support level (attribute 1197, 6 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-11-1` Apparel & Accessories > Clothing > Lingerie > Women's Underpants > Bikinis

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Waist rise: see Appendix Waist rise (attribute 37, 4 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Gusset material: see Appendix Gusset material (attribute 6709, 11 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-11-2` Apparel & Accessories > Clothing > Lingerie > Women's Underpants > Boyshorts

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Waist rise: see Appendix Waist rise (attribute 37, 4 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Gusset material: see Appendix Gusset material (attribute 6709, 11 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-11-3` Apparel & Accessories > Clothing > Lingerie > Women's Underpants > Briefs

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Waist rise: see Appendix Waist rise (attribute 37, 4 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Gusset material: see Appendix Gusset material (attribute 6709, 11 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-11-4` Apparel & Accessories > Clothing > Lingerie > Women's Underpants > G-Strings

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Waist rise: see Appendix Waist rise (attribute 37, 4 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Gusset material: see Appendix Gusset material (attribute 6709, 11 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-11-5` Apparel & Accessories > Clothing > Lingerie > Women's Underpants > Period Underwear

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Waist rise: see Appendix Waist rise (attribute 37, 4 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Absorbency level: Heavy | Light | Moderate | Other | Overnight | Regular | Super
- Underwear style: Bikini panties | Boxer briefs | Boxers | Boyshorts | Classic briefs | Control briefs | G-string panties | High-cut briefs | Hipster panties | Other | Raw-cut briefs | Tanga panties | Thong panties | Trunk
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Gusset material: see Appendix Gusset material (attribute 6709, 11 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-11-6` Apparel & Accessories > Clothing > Lingerie > Women's Underpants > Thongs

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Waist rise: see Appendix Waist rise (attribute 37, 4 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Gusset material: see Appendix Gusset material (attribute 6709, 11 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-11-7` Apparel & Accessories > Clothing > Lingerie > Women's Underpants > Bloomers

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Waist rise: see Appendix Waist rise (attribute 37, 4 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Gusset material: see Appendix Gusset material (attribute 6709, 11 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-11-8` Apparel & Accessories > Clothing > Lingerie > Women's Underpants > Hipsters

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Waist rise: see Appendix Waist rise (attribute 37, 4 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Gusset material: see Appendix Gusset material (attribute 6709, 11 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-11-9` Apparel & Accessories > Clothing > Lingerie > Women's Underpants > Cheeky Panties

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Waist rise: see Appendix Waist rise (attribute 37, 4 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Gusset material: see Appendix Gusset material (attribute 6709, 11 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-12` Apparel & Accessories > Clothing > Lingerie > Women's Undershirts

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-13` Apparel & Accessories > Clothing > Lingerie > Women's Underwear Slips

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-14` Apparel & Accessories > Clothing > Lingerie > Babydolls

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Age group: see Appendix Age group (attribute 30, 12 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Bra padding type: Lightly padded | Other | Padded | Push-up | Unpadded
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-15` Apparel & Accessories > Clothing > Lingerie > Corsets & Bustiers

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Age group: see Appendix Age group (attribute 30, 12 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Bra padding type: Lightly padded | Other | Padded | Push-up | Unpadded
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-16` Apparel & Accessories > Clothing > Lingerie > Lingerie Sets

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Age group: see Appendix Age group (attribute 30, 12 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Bra padding type: Lightly padded | Other | Padded | Push-up | Unpadded
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-2-1` Apparel & Accessories > Clothing > Lingerie > Bra Accessories > Bra Strap Pads

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Cup size: A | AA | B | C | D | DD | DDD | E | F | FF | G | GG | H | HH | I | J | JJ | K | L | M | N | Other
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-2-2-1` Apparel & Accessories > Clothing > Lingerie > Bra Accessories > Bra Straps & Extenders > Bra Extenders

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-2-2-2` Apparel & Accessories > Clothing > Lingerie > Bra Accessories > Bra Straps & Extenders > Bra Straps

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-2-3` Apparel & Accessories > Clothing > Lingerie > Bra Accessories > Breast Enhancing Inserts

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Enhancement level: Moderate | Other | Significant | Subtle
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-2-4` Apparel & Accessories > Clothing > Lingerie > Bra Accessories > Breast Petals & Concealers

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-2-5` Apparel & Accessories > Clothing > Lingerie > Bra Accessories > Bra Hardware & Findings

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-2-6` Apparel & Accessories > Clothing > Lingerie > Bra Accessories > Breast Lift Tape

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-3` Apparel & Accessories > Clothing > Lingerie > Bras

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Cup size: A | AA | B | C | D | DD | DDD | E | F | FF | G | GG | H | HH | I | J | JJ | K | L | M | N | Other
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Bra strap type: Adjustable | Convertible | Cross-back | Other | Racerback | Standard
- Bra closure type: Back | Front | Other | Pull-on (no closure)
- Bra coverage: Demi | Full | Minimal | Other | Plunge | Quarter
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Bra features: Adjustable band | Breathable design | Convertible strap | Other | Removable padding | Seamless | Sweat-wicking fabric | Underwire support
- Bra style: Adhesive | Balconette | Bandeau | Bralette | Bullet | Contour | Convertible | Halter | Longline | Minimizer | Molded | Other | Plunge | Push-up | Racerback | Strapless | T-shirt | Triangle | Underwire | Wireless
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-4` Apparel & Accessories > Clothing > Lingerie > Camisoles

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Age group: see Appendix Age group (attribute 30, 12 values)
- Neckline: Asymmetric | Bardot | Boat | Cowl | Crew | Halter | Hooded | Mandarin | Mock | Other | Plunging | Round | Split | Square | Sweetheart | Turtle | V-neck | Wrap
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-6` Apparel & Accessories > Clothing > Lingerie > Hosiery

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Hosiery toe style: Closed toe | Open toe | Other | Reinforced toe | Sandal toe | Seamed toe | Toeless
- Seam design: Back seam | Other | Regular seam | Seamless
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-7` Apparel & Accessories > Clothing > Lingerie > Jock Straps

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Jockstrap design features: Cock ring | Codpiece | Crotchless | Detachable pouch | Harness-compatible D-rings | LED light-up | Open back | Other | Padded pouch | Zipper front
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-8-1` Apparel & Accessories > Clothing > Lingerie > Lingerie Accessories > Garter Belts

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-8-2-1` Apparel & Accessories > Clothing > Lingerie > Lingerie Accessories > Garters > Sock Garters

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Embellishment type: Bow | Chain | Embroidery | Feather | Lace | Other | Pearl | Rhinestone | Ruffle | Spike | Stud
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-8-2-2` Apparel & Accessories > Clothing > Lingerie > Lingerie Accessories > Garters > Shirttail Garters

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Embellishment type: Bow | Chain | Embroidery | Feather | Lace | Other | Pearl | Rhinestone | Ruffle | Spike | Stud
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-8-3` Apparel & Accessories > Clothing > Lingerie > Lingerie Accessories > Pantyhose

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Pantyhose style: Compression | Control-top | Fishnet | Footless | Maternity | Opaque | Other | Seamed | Sheer | Toeless
- Pantyhose crotch style: Closed crotch | Crotchless | Other | Reinforced gusset
- Toe reinforcement type: Full toe | Invisible toe | No toe | Open toe | Other | Reciprocated toe | Reinforced toe | Sandal toe | Seamless toe | Sheer toe
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-8-4` Apparel & Accessories > Clothing > Lingerie > Lingerie Accessories > Body Harnesses

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-8-5` Apparel & Accessories > Clothing > Lingerie > Lingerie Accessories > Fashion & Body Tape

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-9-1` Apparel & Accessories > Clothing > Lingerie > Petticoats & Pettipants > Petticoats

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-6-9-2` Apparel & Accessories > Clothing > Lingerie > Petticoats & Pettipants > Pettipants

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-8-3-10` Apparel & Accessories > Clothing > Men's Undergarments > Men's Underwear > Hipsters

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Pouch style: see Appendix Pouch style (attribute 6789, 10 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-8-3-2` Apparel & Accessories > Clothing > Men's Undergarments > Men's Underwear > Boxer Briefs

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Pouch style: see Appendix Pouch style (attribute 6789, 10 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-8-3-3` Apparel & Accessories > Clothing > Men's Undergarments > Men's Underwear > Boxer Shorts

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Pouch style: see Appendix Pouch style (attribute 6789, 10 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-8-3-4` Apparel & Accessories > Clothing > Men's Undergarments > Men's Underwear > Briefs

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Pouch style: see Appendix Pouch style (attribute 6789, 10 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-8-3-5` Apparel & Accessories > Clothing > Men's Undergarments > Men's Underwear > Jockstraps

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Pouch style: see Appendix Pouch style (attribute 6789, 10 values)
- Protective cup configuration: Cup included | Cup pocket only | No cup | Other | Removable cup included
- Rear coverage: Full back | Open back | Other | Partial back
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-8-3-6` Apparel & Accessories > Clothing > Men's Undergarments > Men's Underwear > Midway Briefs

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Pouch style: see Appendix Pouch style (attribute 6789, 10 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-8-3-7` Apparel & Accessories > Clothing > Men's Undergarments > Men's Underwear > Thongs

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Pouch design: Anatomical | Bulge-enhancing | C-ring | Contoured | Flat | Lined | No pouch | Open/Peek-a-boo | Other | Single layer
- Pouch style: see Appendix Pouch style (attribute 6789, 10 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-8-3-8` Apparel & Accessories > Clothing > Men's Undergarments > Men's Underwear > Trunks

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Leg length: Full length | Knee length | Long | Mid | Other | Short | Standard
- Pouch style: see Appendix Pouch style (attribute 6789, 10 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `aa-1-8-3-9` Apparel & Accessories > Clothing > Men's Undergarments > Men's Underwear > Undershorts

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)
- Pouch style: see Appendix Pouch style (attribute 6789, 10 values)
- Size type: see Appendix Size type (attribute 12821, 7 values)

### `hb-1-5` Health & Beauty > Health Care > Condoms

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Material: see Appendix Material (attribute 4, 82 values)
- Flavor: Almond | Apple | Banana | Blueberry | Caramel | Cherry | Chocolate | Cinnamon | Coconut | Coffee | Dulce de leche | Elderflower | Ginger | Lemon | Lime | Lychee | Mango | Matcha | Mint | Mojito | Orange | Other | Peach | Raspberry | Rose | Salted caramel | Strawberry | Tropical | Unflavored | Vanilla
- Condom type: Female | Male | Other
- Lubricant composition: Hybrid | Oil-based | Other | Silicone-based | Water-based
- Surface texture: Assorted | Dotted | Other | Ribbed | Rugged | Smooth | Textured
- Lubricant effect: Cooling | Delay | Extra lubricated | Flavored | Lubricated | Non-lubricated | Other | Spermicidal | Standard | Tingling | Warming
- Condom fit type: Anatomical | Beaded | Close fit | Contoured | Extra large | Flared | Large | Other | Regular | Roomy head | Snug | Straight | Tapered

### `hb-1-8-5-5` Health & Beauty > Health Care > First Aid > Hot & Cold Therapies > Hot & Cold Packs

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Usage type: Disposable | Other | Refillable | Reusable
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Treatment objective: see Appendix Treatment objective (attribute 1564, 19 values)
- Allergy-friendly features: Chemical-free | Dust mite resistant | Hypoallergenic | Latex-free | Low VOC | Mold resistant | Natural materials | Other

### `hb-3-11-4` Health & Beauty > Personal Care > Massage & Relaxation > Massage Oil

- Material: see Appendix Material (attribute 4, 82 values)
- Age group: see Appendix Age group (attribute 30, 12 values)
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Package type: see Appendix Package type (attribute 1456, 27 values)
- Texture: Absorbent | Butter-like | Creamy | Cushiony | Heavyweight | Lightweight | Non-greasy | Other | Silky | Smooth | Soft | Velvety
- Suitable for skin type: see Appendix Suitable for skin type (attribute 1559, 16 values)
- Treatment objective: see Appendix Treatment objective (attribute 1564, 19 values)
- Detailed ingredients: see Appendix Detailed ingredients (attribute 1570, 86 values)
- Skin care effect: see Appendix Skin care effect (attribute 1617, 83 values)
- Constitutive ingredients: see Appendix Constitutive ingredients (attribute 1629, 70 values)
- Allergens: Alpha-isomethyl ionone | Amyl cinnamal (amyl cinnamic aldehyde) | Amylcinnamyl alcohol | Anisyl alcohol | Benzyl alcohol | Benzyl benzoate | Benzyl cinnamate | Benzyl salicylate | Cinnamal | Cinnamyl alcohol | Citral | Citronellol | Coumarin | Eugenol | Evernia furfuracea (treemoss) extract | Evernia prunastri (oakmoss) extract | Farnesol | Geraniol | Hexyl cinnamal | Hydroxycitronellal | Isoeugenol | Limonene | Linalool | Lyral (hydroxyisohexyl 3-cyclohexene carboxaldehyde) | Methyl 2-octynoate (methyl heptin carbonate) | Myroxylon pereirae (balsam peru) | Other
- Fragrance: see Appendix Fragrance (attribute 1637, 24 values)
- Base oil: Almond | Apricot kernel | Argan | Avocado | Coconut | Grapeseed | Jojoba | Olive | Other | Sesame | Sunflower
- Alcohol/Solvent content: Alcohol >24% | Alcohol ≤24% | Other | Solvent - large container (>1L) | Solvent - small container (≤1L)

### `hb-3-12-1` Health & Beauty > Personal Care > Oral Care > Breath Sprays

- Material: see Appendix Material (attribute 4, 82 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Dispenser type: Ampoule | Bottle | Box | Can | Capsules | Case | Jar | Other | Palette | Pan | Pencil | Pot | Pouch | Pump bottle | Roll-on | Sachet | Spray | Squeeze bottle | Stick | Tube | Wipes
- Package type: see Appendix Package type (attribute 1456, 27 values)
- Flavor: Almond | Apple | Banana | Blueberry | Caramel | Cherry | Chocolate | Cinnamon | Coconut | Coffee | Dulce de leche | Elderflower | Ginger | Lemon | Lime | Lychee | Mango | Matcha | Mint | Mojito | Orange | Other | Peach | Raspberry | Rose | Salted caramel | Strawberry | Tropical | Unflavored | Vanilla
- Active ingredient: see Appendix Active ingredient (attribute 1598, 15 values)
- Breath sprays certifications: Aerosol-free | Alcohol-free | Artificial flavor free | Artificial preservatives free | Cruelty-free | Dentist recommended | Dye-free | EU organic | EWG verified | Fair trade | Fluoride-free | Gluten-free | Halal | Kosher | Natural ingredients | Non-GMO | Organic ingredients | Other | PETA approved | Sugar-free | Suitable for diabetics | USDA organic | Vegan
- Ingredient origin: see Appendix Ingredient origin (attribute 2449, 3 values)
- Oral care function: Anti-inflammatory | Antibacterial | Breath freshening | Canker relief | Cavity protection | Denture care | Dry mouth relief | Enamel strengthening | Gum health | Kids teething | Oil pulling detox | Orthodontic care | Other | Pain relief | Plaque control | Probiotic support | Remineralization | Sensitivity relief | Stain removal | Tartar control | Ulcer relief | Whitening
- Breath spray benefit: Anti-bacterial | Breath freshening | Cavity prevention | Dry mouth relief | Oral pH balancing | Other | Plaque reduction | Probiotic support | Teeth whitening | Throat soothing

### `hb-3-13` Health & Beauty > Personal Care > Personal Lubricants

- Material: see Appendix Material (attribute 4, 82 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Flavor: Almond | Apple | Banana | Blueberry | Caramel | Cherry | Chocolate | Cinnamon | Coconut | Coffee | Dulce de leche | Elderflower | Ginger | Lemon | Lime | Lychee | Mango | Matcha | Mint | Mojito | Orange | Other | Peach | Raspberry | Rose | Salted caramel | Strawberry | Tropical | Unflavored | Vanilla
- Constitutive ingredients: see Appendix Constitutive ingredients (attribute 1629, 70 values)
- Fragrance: see Appendix Fragrance (attribute 1637, 24 values)
- Lubricant application: Anal | Massage | Oral | Other | Vaginal
- Lubricant composition: Hybrid | Oil-based | Other | Silicone-based | Water-based
- Lubricant dispenser type: Aerosol spray | Bottle | Bucket | Can | Canister | Cartridge | Drum | Other | Pail | Pouch | Tube
- Lubricant form: Gel | Liquid | Oil | Other | Paste
- PH level: 0.0 (strongly acidic) | 0.5 (strongly acidic) | 1.0 (strongly acidic) | 1.5 (strongly acidic) | 10.0 (moderately alkaline) | 10.5 (moderately alkaline) | 11.0 (strongly alkaline) | 11.5 (strongly alkaline) | 12.0 (strongly alkaline) | 12.5 (strongly alkaline) | 13.0 (strongly alkaline) | 13.5 (strongly alkaline) | 14.0 (strongly alkaline) | 2.0 (strongly acidic) | 2.5 (strongly acidic) | 3.0 (strongly acidic) | 3.5 (strongly acidic) | 4.0 (moderately acidic) | 4.5 (moderately acidic) | 5.0 (moderately acidic) | 5.5 (slightly acidic) | 6.0 (slightly acidic) | 6.5 (slightly acidic) | 7.0 (neutral) | 7.5 (slightly alkaline) | 8.0 (slightly alkaline) | 8.5 (slightly alkaline) | 9.0 (moderately alkaline) | 9.5 (moderately alkaline) | Other
- Condom compatibility: All condom types | Latex | Not condom-compatible | Other | Polyisoprene | Polyurethane
- Sensation effect: Cooling | Desensitizing | Long-lasting | Moisturizing | Neutral | Numbing | Other | pH-balancing | Relaxing | Stimulating | Tingling | Warming

### `hb-3-2-1-7-1` Health & Beauty > Personal Care > Cosmetics > Bath & Body > Hygienic Wipes > Body Cleansing Wipes

- Material: see Appendix Material (attribute 4, 82 values)
- Age group: see Appendix Age group (attribute 30, 12 values)
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Ingredients: 2,4-d | Aloe vera | Builders | Calendula | Deet | Dyes | Emulsifiers | Enzymes | Fragrances | Glyphosate | Lanolin | Lemon eucalyptus oil | Neonicotinoids | Other | Petroleum jelly | Picaridin | Preservatives | Pyrethrins | Solvents | Stabilizers | Surfactants | Vitamin E | Water | Zinc oxide
- Package type: see Appendix Package type (attribute 1456, 27 values)
- Suitable for skin type: see Appendix Suitable for skin type (attribute 1559, 16 values)
- Body area: see Appendix Body area (attribute 1563, 28 values)
- Skin care effect: see Appendix Skin care effect (attribute 1617, 83 values)
- Fragrance: see Appendix Fragrance (attribute 1637, 24 values)
- Wipe packaging: Other | Plastic tub | Refill pack | Soft pack | Travel size
- Absorbent hygiene product features: Adjustable | Biodegradable | Easy to clean | Easy to remove | Eco friendly | Flushable | Fragrance-free | Hypoallergenic | Leakproof | Odor control | Other | Scented | Soft padding | Tear resistant | Waterproof | Wetness indicator
- Exfoliating agent type: Apricot seed | Bamboo powder | Charcoal | Coconut sugar | Coffee grounds | Enzyme exfoliant | Fruit acids | Jojoba beads | Loofah fibers | Microbeads (biodegradable) | None | Oatmeal | Other | Pumice | Rice powder | Salt | Sea sand | Strawberry seeds | Sugar | Walnut shell powder
- Wipe purpose: Antibacterial | Baby care | Body cleansing | Deodorizing | Exfoliating | Hand sanitizing | Intimate care | Makeup removal | Moisturizing | Other | Sensitive skin

### `hb-3-2-8-10` Health & Beauty > Personal Care > Cosmetics > Perfumes & Colognes > Solid Perfumes

- Material: see Appendix Material (attribute 4, 82 values)
- Age group: see Appendix Age group (attribute 30, 12 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Dispenser type: Ampoule | Bottle | Box | Can | Capsules | Case | Jar | Other | Palette | Pan | Pencil | Pot | Pouch | Pump bottle | Roll-on | Sachet | Spray | Squeeze bottle | Stick | Tube | Wipes
- Suitable for skin type: see Appendix Suitable for skin type (attribute 1559, 16 values)
- Occasion: Casual | Everyday | Formal | Other | Special occasion
- Season: Fall | Other | Spring | Summer | Winter
- Fragrance: see Appendix Fragrance (attribute 1637, 24 values)
- Gift set format: Gift bag | Gift basket | Gift box | Other
- Olfactory family: Aldehydic | Animalic | Aquatic | Aromatic | Balsamic | Chypre | Citrus | Earthy | Eccentric | Floral | Fougere | Fresh | Fruity | Gourmand | Green | Herbal | Leather | Musky | Oriental | Other | Powdery | Resinous | Spicy | Woody

### `hb-3-2-8-8` Health & Beauty > Personal Care > Cosmetics > Perfumes & Colognes > Perfume Oils

- Material: see Appendix Material (attribute 4, 82 values)
- Age group: see Appendix Age group (attribute 30, 12 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Dispenser type: Ampoule | Bottle | Box | Can | Capsules | Case | Jar | Other | Palette | Pan | Pencil | Pot | Pouch | Pump bottle | Roll-on | Sachet | Spray | Squeeze bottle | Stick | Tube | Wipes
- Suitable for skin type: see Appendix Suitable for skin type (attribute 1559, 16 values)
- Occasion: Casual | Everyday | Formal | Other | Special occasion
- Season: Fall | Other | Spring | Summer | Winter
- Fragrance: see Appendix Fragrance (attribute 1637, 24 values)
- Gift set format: Gift bag | Gift basket | Gift box | Other
- Olfactory family: Aldehydic | Animalic | Aquatic | Aromatic | Balsamic | Chypre | Citrus | Earthy | Eccentric | Floral | Fougere | Fresh | Fruity | Gourmand | Green | Herbal | Leather | Musky | Oriental | Other | Powdery | Resinous | Spicy | Woody

### `hb-3-2-9-23-2` Health & Beauty > Personal Care > Cosmetics > Skin Care > Body Butters & Balms > Body Balms

- Material: see Appendix Material (attribute 4, 82 values)
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Suitable for skin type: see Appendix Suitable for skin type (attribute 1559, 16 values)
- Body area: see Appendix Body area (attribute 1563, 28 values)
- Active ingredient: see Appendix Active ingredient (attribute 1598, 15 values)
- Skin care effect: see Appendix Skin care effect (attribute 1617, 83 values)
- Fragrance: see Appendix Fragrance (attribute 1637, 24 values)
- Ingredient origin: see Appendix Ingredient origin (attribute 2449, 3 values)
- Skin care features: Durable | Easy to apply | Fast acting | Long lasting | Moisturizing | Neutral pH | Non-greasy | Other | Soothing | UVA/UVB protection | Waterproof
- UVA protection grade: Not rated | Other | PA+ | PA++ | PA+++ | PA++++

### `hb-3-2-9-3` Health & Beauty > Personal Care > Cosmetics > Skin Care > Body Oil

- Material: see Appendix Material (attribute 4, 82 values)
- Age group: see Appendix Age group (attribute 30, 12 values)
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Package type: see Appendix Package type (attribute 1456, 27 values)
- Texture: Absorbent | Butter-like | Creamy | Cushiony | Heavyweight | Lightweight | Non-greasy | Other | Silky | Smooth | Soft | Velvety
- Suitable for skin type: see Appendix Suitable for skin type (attribute 1559, 16 values)
- Body area: see Appendix Body area (attribute 1563, 28 values)
- Active ingredient: see Appendix Active ingredient (attribute 1598, 15 values)
- Cosmetic finish: Dewy | Embossed | Glitter | Glossy | Holographic | Luminous | Matte | Metallic | Natural | Neon | Opaque | Other | Pearlescent | Radiant | Satin | Satin-matte | Semi-matte | Sheer | Shimmer | Shine-free | Smooth | Soft-focus | Sparkly | Velvet | Velvet-matte
- Skin care effect: see Appendix Skin care effect (attribute 1617, 83 values)
- Constitutive ingredients: see Appendix Constitutive ingredients (attribute 1629, 70 values)
- Cosmetic function: Anti-aging | Brightening | Cleansing | Exfoliating | Healing | Hydrating | Hydration | Moisturizing | Nourishing | Other | Pore minimizing | Protecting | Repairing | Soothing
- Fragrance: see Appendix Fragrance (attribute 1637, 24 values)
- Base oil: Almond | Apricot kernel | Argan | Avocado | Coconut | Grapeseed | Jojoba | Olive | Other | Sesame | Sunflower
- SPF level: Other | SPF 100 | SPF 15 | SPF 20 | SPF 25 | SPF 30 | SPF 35 | SPF 4 | SPF 40 | SPF 45 | SPF 50 | SPF 50+ | SPF 60 | SPF 70 | SPF 8 | SPF 85
- Ingredient origin: see Appendix Ingredient origin (attribute 2449, 3 values)
- UVA protection grade: Not rated | Other | PA+ | PA++ | PA+++ | PA++++
- Oil extraction method: Cold-pressed | Expeller-pressed | Other | Refined | Solvent extracted | Steam-distilled | Unrefined
- Alcohol/Solvent content: Alcohol >24% | Alcohol ≤24% | Other | Solvent - large container (>1L) | Solvent - small container (≤1L)

### `hb-3-2-9-4` Health & Beauty > Personal Care > Cosmetics > Skin Care > Body Powder

- Material: see Appendix Material (attribute 4, 82 values)
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Package type: see Appendix Package type (attribute 1456, 27 values)
- Suitable for skin type: see Appendix Suitable for skin type (attribute 1559, 16 values)
- Body area: see Appendix Body area (attribute 1563, 28 values)
- Active ingredient: see Appendix Active ingredient (attribute 1598, 15 values)
- Cosmetic finish: Dewy | Embossed | Glitter | Glossy | Holographic | Luminous | Matte | Metallic | Natural | Neon | Opaque | Other | Pearlescent | Radiant | Satin | Satin-matte | Semi-matte | Sheer | Shimmer | Shine-free | Smooth | Soft-focus | Sparkly | Velvet | Velvet-matte
- Skin care effect: see Appendix Skin care effect (attribute 1617, 83 values)
- Constitutive ingredients: see Appendix Constitutive ingredients (attribute 1629, 70 values)
- Fragrance: see Appendix Fragrance (attribute 1637, 24 values)
- Ingredient origin: see Appendix Ingredient origin (attribute 2449, 3 values)
- UVA protection grade: Not rated | Other | PA+ | PA++ | PA+++ | PA++++
- Talc content: Other | Reduced talc | Talc-based | Talc-free
- Alcohol/Solvent content: Alcohol >24% | Alcohol ≤24% | Other | Solvent - large container (>1L) | Solvent - small container (≤1L)

### `hb-3-7-2` Health & Beauty > Personal Care > Enema Kits & Supplies > Enema Accessories

- Material: see Appendix Material (attribute 4, 82 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Treatment objective: see Appendix Treatment objective (attribute 1564, 19 values)
- Product sterility: Non-sterile | Other | Sterile
- Enema nozzle type: Other | Pediatric tip | Plastic nozzle | Silicone colon tube | Slim tip | Soft flexible tip | Stainless steel nozzle | Standard tip | Vaginal douche nozzle | Vented tip | Wide tip
- Enema device type: Bag | Bucket | Bulb syringe | Colon tube | Disposable prefilled bottle | Electric pump device | Gravity set | Hose adapter kit | Other | Shower attachment

### `hb-3-7-3` Health & Beauty > Personal Care > Enema Kits & Supplies > Enema Bulbs

- Material: see Appendix Material (attribute 4, 82 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Treatment objective: see Appendix Treatment objective (attribute 1564, 19 values)
- Product sterility: Non-sterile | Other | Sterile
- Enema nozzle type: Other | Pediatric tip | Plastic nozzle | Silicone colon tube | Slim tip | Soft flexible tip | Stainless steel nozzle | Standard tip | Vaginal douche nozzle | Vented tip | Wide tip
- Enema device type: Bag | Bucket | Bulb syringe | Colon tube | Disposable prefilled bottle | Electric pump device | Gravity set | Hose adapter kit | Other | Shower attachment

### `hb-3-8-8` Health & Beauty > Personal Care > Feminine Sanitary Supplies > Feminine Moisturizers & Oils

- Material: see Appendix Material (attribute 4, 82 values)
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Treatment objective: see Appendix Treatment objective (attribute 1564, 19 values)

### `hb-3-8-9` Health & Beauty > Personal Care > Feminine Sanitary Supplies > Feminine Wipes

- Material: see Appendix Material (attribute 4, 82 values)
- Product certifications & standards: see Appendix Product certifications & standards (attribute 1261, 56 values)
- Product form: see Appendix Product form (attribute 1285, 29 values)
- Treatment objective: see Appendix Treatment objective (attribute 1564, 19 values)

### `ma-1-1` Mature > Erotic > Erotic Clothing

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Care instructions: see Appendix Care instructions (attribute 2336, 7 values)
- Fabric: see Appendix Fabric (attribute 2777, 48 values)
- Size: see Appendix Size (attribute 2778, 85 values)
- Intimate apparel features: see Appendix Intimate apparel features (attribute 3000, 9 values)

### `ma-1-2` Mature > Erotic > Erotic Food & Edibles

No choice-list attributes.

### `ma-1-3` Mature > Erotic > Erotic Magazines

No choice-list attributes.

### `ma-1-4` Mature > Erotic > Sex Toys & Erotic Games

- Color: see Appendix Color (attribute 1, 19 values)
- Pattern: see Appendix Pattern (attribute 3, 51 values)
- Target gender: see Appendix Target gender (attribute 837, 4 values)
- Power source: AC-powered | Alcohol | Batteries | Battery-powered | Butane | Charcoal | Cigar lighter | DC-powered | Diesel | Ethanol | Firewood | Gasoline | Hot water | Hybrid | Hydraulic | Infrared | Manual | Mechanical | Natural gas | Oil | Other | Pellet | Pneumatic | Propane | Rechargeable | Solar | USB | Vehicle electrical system

### `ma-1-5` Mature > Erotic > Erotic Videos

No choice-list attributes.

### `ma-1-6` Mature > Erotic > Erotic Books

No choice-list attributes.

### `me-1-3` Media > Books > Print Books

- Genre: see Appendix Genre (attribute 2535, 53 values)
- Language version: see Appendix Language version (attribute 2536, 153 values)
- Target audience: Adults | Kids | Other | Suitable for all ages | Teens & young adults
- Book cover type: Hardcover | Other | Paperback | Soft | Soft front & hard back

## Appendix: shared and long value lists

Each list is the complete set of allowed values for that attribute.

### Active ingredient (attribute 1598)

Aloe vera | Caffeine | CBD | Ceramides | Collagen | Green tea extract | Hemp oil | Hyaluronic acid | Niacinamide | Other | Peptides | Retinol | Shea butter | Vitamin C | Vitamin K

### Age group (attribute 30)

0-6 months | 1-2 years | 6-12 months | Adults | All ages | Babies | Kids | Newborn | Other | Teens | Toddlers | Universal

### Body area (attribute 1563)

Abdomen | Arms | Back | Bikini line | Buttocks | Calves | Chest | Eyes | Face | Feet | Full body | Hamstrings | Hands | Head | Heels | Hips | Knees | Legs | Lips | Lumbar region | Neck | Other | Shoulders | Soles | Thighs | Toes | Waist | Wrists

### Care instructions (attribute 2336)

Dry clean only | Dryer safe | Hand wash | Ironing instructions | Machine washable | Other | Tumble dry

### Color (attribute 1)

Beige | Black | Blue | Bronze | Brown | Clear | Gold | Gray | Green | Multicolor | Navy | Orange | Pink | Purple | Red | Rose gold | Silver | White | Yellow

### Constitutive ingredients (attribute 1629)

Acacia honey | Acerola cherry | Alcohol | Almond oil | Aloe vera | Aluminum sulfate | Apricot oil | Argan oil | Avocado oil | Beeswax | Blueberry seed oil | Calendula | Calendula oil | Castor oil | Catnip oil | CBD | Chamomile | Charcoal | Cherry oil | Citronella oil | Clay | Cocoa butter | Coconut oil | Collagen | Cucumber extract | Essential oil | Eucalyptus | Ferulic acid | Fruit extracts | Glycerin | Glycolic acid | Goji berry extract | Grapeseed oil | Green tea | Hazelnut oil | Hemp oil | Honey | Hyaluronic acid | Jojoba oil | Keratin | Lactic acid | Lanolin | Lavender oil | Lemon butter | Lemongrass oil | Macadamia oil | Menthol | Moringa butter | Olive oil | Orange | Other | Peppermint oil | Retinol | Rose extract | Rosehip oil | Rosemary oil | Salicylic acid | Shea butter | Sodium lauryl sulfate | Sorbitol | Sunflower seed oil | Tea tree oil | Titanium dioxide | Vitamin A | Vitamin C | Vitamin E | Walnut oil | Water | Wheat protein | Zinc oxide

### Detailed ingredients (attribute 1570)

Acacia | Acai | Aloe vera | Animal protein | Arnica | Artichoke | Bacillus coagulans | Bacillus subtilis | Bifidobacterium bifidum | Calcium | CBD | Chamomile | Chlorophyll | Cinnamon | Collagen | Creatine | Curcumin | Echinacea | Egg protein | Flaxseed | Fructooligosaccharides (FOS) | Ginger | Ginseng | Green tea | Guarana | Hemp | Hemp seed oil | Honey | Inulin | Iodine | Iron | L-carnitine | L-cysteine | L-glutamine | L-valine | Lacticaseibacillus casei | Lacticaseibacillus rhamnosus | Lactobacillus acidophilus | Lavender | Lecithin | Magnesium | Manganese | Mannan-oligosaccharide (MOS) | Matcha | Milk protein | Moringa | Natural flavors | Olive oil | Omega fatty acids | Other | Phosphorus | Plant-based protein | Potassium | Propolis | Rosehip | Rosemary | Royal jelly | Selenium | Sodium | Soy protein | Spirulina | Stevia | Tapioca | Taurine | Trace minerals | Vitamin A | Vitamin B | Vitamin B1 | Vitamin B12 | Vitamin B2 | Vitamin B3 | Vitamin B5 | Vitamin B6 | Vitamin B7 | Vitamin B9 (folic acid) | Vitamin C | Vitamin D | Vitamin D3 | Vitamin E | Vitamin K | Vitamin K1 | Vitamin K2 | Vitamin K3 | Whey protein | Yeast | Zinc

### Fabric (attribute 2777)

Acrylic | Angora | Bamboo | Canvas | Cashmere | Corduroy | Cork | Cotton | Denim | Faux fur | Faux leather | Felt | Flannel | Fleece | Fur | Hemp | Jute | Latex | Leather | Linen | Lycra | Lyocell | Merino | Mesh | Modal | Mohair | Neoprene | Nylon | Other | Plastic | Plush | Polyester | Rattan | Rayon | Rubber | Satin | Sherpa | Silk | Suede | Synthetic | Terrycloth | Tweed | Twill | Velour | Velvet | Vinyl | Viscose | Wool

### Fragrance (attribute 1637)

Aquatic | Cherry | Cinnamon | Citrus | Eucalyptus | Floral | Fresh | Fresh linen | Fruity | Herbal | Jasmine | Lavender | Ocean breeze | Oriental | Other | Pine | Rose | Sandalwood | Spicy | Strawberry | Tea tree | Unscented | Vanilla | Woody

### Genre (attribute 2535)

Action & adventure | Animation | Anime | Arts | Biography | Business | Children | Comics & graphic novels | Crime & mystery | Design | Documentary | Drama | Education | Family | Fantasy | Fashion & beauty | Finance | Food & cooking | Game show | Gaming | Health & fitness | Historical fiction | History | Hobbies & interests | Horror | Humor & comedy | Literature | Marketing | Mental health | Movies & TV | Music | News & politics | Other | Parenting | Period drama | Philosophy | Reality TV | Relationships | Religion & spirituality | Romance | Sci-fi | Self-help & personal development | Society & culture | Sports | Supernatural | Suspense | Talk show | Technology | Thriller & suspense | Travel | War | Western | Young adult

### Gusset material (attribute 6709)

Bamboo | Bamboo viscose | Cotton | Mesh | Microfiber | Modal | Nylon | Organic cotton | Other | Polyester | Silk

### Ingredient origin (attribute 2449)

Natural | Other | Synthetic

### Intimate apparel features (attribute 3000)

Breathable design | Comfort fit | Hypoallergenic | Moisture wicking | Other | Seamless | Stretchable | Tagless | Thermal

### Language version (attribute 2536)

AAR- Afar | AFR- Afrikaans | AKA- Akan | AMH- Amharic | ARA- Arabic | ARA-EG- Arabic (Egypt) | ARA-GUL- Arabic (Gulf) | ARA-IQ- Arabic (Iraq) | ARA-LEV- Arabic (Levantine) | ARA-MAG- Arabic (Maghrebi) | ARA-SUD- Arabic (Sudanese) | ASM- Assamese | AYM- Aymara | AZE- Azerbaijani | BEL- Belarusian | BEN- Bengali | BOD- Tibetan | BOS- Bosnian | BRA- Brazilian Portuguese | BRE- Breton | BUL- Bulgarian | CAT- Catalan | CES- Czech | CRO- Croatian | CYM- Welsh | DAN- Danish | DEU-BE- German (Belgium) | DEU-CH- German (Switzerland) | DEU- German | ELL- Greek | ENG-AU- English (Australia) | ENG-CA- English (Canada) | ENG- English | ENG-GB- English (United Kingdom) | ENG-HK- English (Hong Kong) | ENG-IN- English (India) | ENG-NZ- English (New Zealand) | ENG-SG- English (Singapore) | ENG-US- English (United States) | ENG-ZA- English (South Africa) | EPO- Esperanto | EST- Estonian | EUS- Basque | EWE- Ewe | FAO- Faroese | FAS- Farsi | FAS- Persian | FIL- Filipino | FIN- Finnish | FRA-BE- French (Belgium) | FRA-CA- French (Canada) | FRA-CH- French (Switzerland) | FRA- French | GLE- Irish | GLG- Galician | GRC- Ancient Greek | GRN- Guarani | GSW- Swiss German | GUJ- Gujarati | HAU- Hausa | HEB- Hebrew | HIN- Hindi | HRV- Croatian | HUN- Hungarian | HYE- Armenian | IBO- Igbo | INC- Indonesian | IND- Indonesian | IRA- Iranian | ISL- Icelandic | ITA- Italian | JAV- Javanese | JPN- Japanese | KAL- Greenlandic | KAN- Kannada | KAT- Georgian | KAZ- Kazakh | KHM- Khmer | KIN- Kinyarwanda | KIR- Kirghiz | KOR- Korean | KUR- Kurdish | LAO- Lao | LAT- Latin | LAV- Latvian | LIN- Lingala | LIT- Lithuanian | LTZ- Luxembourgish | MAL- Malayalam | MAR- Marathi | MDR- Mandar | MKD- Macedonian | MLG- Malagasy | MLT- Maltese | MON- Mongolian | MRI- Maori | MSA- Malay | Multilingual- multilingual (not specific to one language) | MYA- Burmese | NAV- Navajo | NEP- Nepali | NLD-BE- Dutch (Belgium) | NLD- Dutch | NNO- Norwegian (Nynorsk) | NOB- Norwegian (Bokmål) | NOR- Norwegian | NYA- Chichewa | ORM- Oromo | Other | PAN- Punjabi | POL- Polish | POR-BR- Portuguese (Brazil) | POR- Portuguese | PUS- Pashto | QUE- Quechua | ROH- Romansh | RON- Romanian | RUS- Russian | SCR- Croatian | SLK- Slovak | SLV- Slovenian | SME- Northern Sámi | SMO- Samoan | SOM- Somali | SOT- Southern Sotho | SPA-LATAM- Spanish (Latin American) | SPA-MX- Spanish (Mexico) | SPA- Spanish | SQI- Albanian | SRP- Serbian | SUN- Sundanese | SWA- Swahili | SWE- Swedish | TAM- Tamil | TEL- Telugu | TGK- Tajik | TGL- Tagalog | THA- Thai | TON- Tongan | TUK- Turkmen | TUR- Turkish | UIG- Uyghur | UKR- Ukrainian | URD- Urdu | UZB- Uzbek | VIE- Vietnamese | WOL- Wolof | XHO- Xhosa | YID- Yiddish | YOR- Yoruba | ZHO (simpl)- Chinese (simplified) | ZHO (tr)- Chinese (traditional) | ZUL- Zulu

### Material (attribute 4)

Acrylic | Aluminum | Angora | Bamboo | Biodegradable materials | Brass | Bronze | Canvas | Carbon | Cardboard | Cashmere | Ceramic | Chrome | Clay | Coir | Concrete | Copper | Corduroy | Cork | Cotton | Denim | Fabric | Faux fur | Faux leather | Felt | Fiberglass | Flannel | Fleece | Fur | Glass | Graphite | Hemp | Iron | Jute | Latex | Leather | Linen | Lycra | Lyocell | Marble | Medium density fiberboard (MDF) | Merino | Mesh | Metal | Modal | Mohair | Neoprene | Nylon | Other | Paper | Plastic | Plush | Plywood | Polyester | Polyethylene (PE) | Polypropylene (PP) | Polyurethane (PU) | Polyvinyl chloride (PVC) | Porcelain | Rattan | Rayon | Resin | Rubber | Satin | Sherpa | Silicone | Silk | Stainless steel | Stone | Suede | Synthetic | Terrycloth | Thermoplastic elastomer (TPE) | Thermoplastic polyurethane (TPU) | Tweed | Twill | Velour | Velvet | Vinyl | Viscose | Wood | Wool

### Package type (attribute 1456)

Bag | Bottle | Box | Can | Canister | Case | Dispenser | Flip-top | Glass bottle | Glass container | Jar | Keg | Other | Plastic bottle | Plastic container | Pot | Pouch | Pump bottle | Refill | Sachet | Shaker | Spray bottle | Squeeze tube | Stick | Tin | Travel size | Tube

### Pattern (attribute 3)

Abstract | Animal | Art | Bead & reel | Birds | Brick | Bull's eye | Camouflage | Characters | Checkered | Chevron | Chinoiserie | Christmas | Collage | Coral | Damask | Diagonal | Diamond | Dog's tooth | Dots | Egg & dart | Ethnic | Everlasting knot | Floral | Fret | Geometric | Guilloche | Hearts | Illusion | Lace | Leaves | Logo | Mosaic | Ogee | Organic | Other | Paisley | Plaid | Rainbow | Random | Scale | Scroll | Solid | Stars | Striped | Swirl | Text | Texture | Tie-dye | Trellis | Vehicle

### Pouch style (attribute 6789)

Anatomical | Ball pouch | Contoured | Crotchless | Magnum/Roomy | No pouch | Open top | Other | Sheer | Standard

### Product certifications & standards (attribute 1261)

Alcohol-free | All-natural ingredients | Aluminum-free | ASC | B corporation | Biodegradable | BPA-free | CE certified | Cruelty-free | DBP | Dermatologist tested | Dye-free | Eco-friendly | Ecocert | EWG verified | Fair trade | FDA approved | Free from formaldehyde | Free from toluene | Gluten-free | GMP | GRAS | Halal | Hypoallergenic | Informed choice | ISO | Kosher | Latex-free | Leaping bunny certified | Made safe certified | Marine stewardship council (MSC) | Natrue certified | Natural ingredients | No artificial colors | No artificial fragrance | Non-GMO | Non-toxic | NSF | Oil-free | Organic | Other | Paraben-free | PETA approved | Phosphate-free | Phthalate-free | Plastic-free | Pregnancy safe | Rainforest alliance | Restriction of hazardous substances (RoHS) compliant | RSPO certified | Sensitive skin | Silicone-free | SPF protection | Sulfate-free | UL certified | Vegan

### Product form (attribute 1285)

Cream | Cream-to-powder | Film | Foam | Foaming lotion | Gel | Kohl | Liquid | Loose powder | Lotion | Milk | Mousse | Oil | Ointment | Other | Pads | Paste | Pencil | Powder | Pressed powder | Roll-on | Serum | Solid | Spray | Stick | Suppository | Tablets | Towelette | Wipes

### Shapewear support level (attribute 1197)

Level 1 | Level 2 | Level 3 | Level 4 | Level 5 | Other

### Size (attribute 2778)

0 | 0-3 months | 00 | 000 | 0X | 1 | 10 | 10-11 years | 11-12 years | 12 | 12-13 years | 12-18 months | 13-14 years | 14 | 16 | 18 | 18-24 months | 1X | 2 | 2-3 years | 20 | 22 | 24 | 26 | 28 | 2T | 2X | 3-4 years | 3-6 months | 30 | 32 | 34 | 36 | 38 | 3T | 3X | 4 | 4-5 years | 40 | 42 | 44 | 46 | 48 | 4T | 4X | 5-6 years | 50 | 52 | 54 | 56 | 58 | 5T | 5X | 6 | 6-7 years | 6-7 years | 6-9 months | 60 | 6T | 6X | 7-8 years | 7-8 years | 7XL | 8 | 8-9 years | 8-9 years | 8XL | 9-10 years | 9-12 months | Double extra large (XXL) | Double extra small (XXS) | Extra large (XL) | Extra small (XS) | Five extra large (5XL) | Four extra large (4XL) | Large (L) | Medium (M) | Newborn | One size | Other | Preemie | Six extra large (6XL) | Small (S) | Triple extra large (XXXL) | Triple extra small (XXXS)

### Size type (attribute 12821)

Big | Maternity | Other | Petite | Plus | Regular | Tall

### Skin care effect (attribute 1617)

Anti-acne | Anti-aging | Anti-bacterial | Anti-blackhead | Anti-blemish | Anti-cellulite | Anti-dark circle | Anti-dark spot | Anti-drying | Anti-dullness | Anti-fatigue | Anti-imperfections | Anti-irritation | Anti-itching | Anti-keratin | Anti-particles | Anti-perleche | Anti-pimple | Anti-puffiness | Anti-redness | Anti-rubbing | Anti-scars | Anti-shine | Anti-stress | Anti-stretch mark | Anti-wrinkle | Brightening | Bronzing | Calming | Clarity | Cleansing | Color correction | Cooling | Drying | Elasticity | Energizing | Exfoliating | Filler effect | Firming | Healing | Hydrating | Illuminating | Invigorating | Keratin reduction | Leveling | Lifting | Mattifying | Moisturizing | Nourishing | Other | Oxygenating | Plumping | Pore refining | Pore shrinking | Pore tightening | Prevents age spots | Prevents freckles | Priming | Protection | Purifying | Rebalancing | Refreshing | Regenerating | Relaxation | Repairing | Replenishing | Revitalizing | Reviving | Scrub | Shimmering | Shine | Slimming | Smoothing | Softening | Soothing | Strengthening | Tightening | Tonifying | Treatment | Unclogging | Uneven skin tone | Warming | Whitening

### Suitable for skin type (attribute 1559)

Aging | All skin types | Combination | Demanding | Dry | Mature | Normal | Oily | Other | Problem | Rough | Sensitive | Universal | Very dry | Wet | With redness

### Target gender (attribute 837)

Female | Male | Other | Unisex

### Treatment objective (attribute 1564)

Bowel cleansing | Comfort | Constipation relief | Ear cleaning | Ear infection relief | Earwax removal | Fever | Hydration | Joint pain | Muscle pain | Obstructive sleep apnea | Other | Pain relief | Preparation for a medical procedure | Relieving irritation | Snoring | Support | Swelling | Vaginal pH balancing

### Waist rise (attribute 37)

High | Low | Mid | Other
