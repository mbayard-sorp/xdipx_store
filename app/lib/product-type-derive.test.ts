import { describe, expect, it } from 'vitest'
import {
  CANONICAL_PRODUCT_TYPES,
  allRuleOutputTypes,
  deriveProductType,
  isCanonicalProductType,
} from './product-type-derive'

function derive(categories: string[], title = 'Some Product') {
  return deriveProductType({ categories, title })
}

describe('vocabulary integrity', () => {
  it('every rule output is a canonical product type', () => {
    for (const type of allRuleOutputTypes()) {
      expect(CANONICAL_PRODUCT_TYPES, `rule output "${type}" missing from canonical list`).toContain(type)
    }
  })

  // Ticket #17600, premise corrected by #17678: "Discontinued" IS a real
  // product_type — the Nalpac Integration app writes it directly on the live
  // Shopify product when Nalpac discontinues an item (owner decision
  // 2026-10-24), and it is not legacy mistyped data. What stays true is
  // narrower: Nalpac's own app is the sole legitimate writer of that value,
  // so deriveProductType's rules here — which run only from Nalpac
  // categories/title at import/enrich time — must never emit it themselves,
  // and the enrich/publish guard in product-type.server.ts relies on that.
  // It stays in CANONICAL_PRODUCT_TYPES because pricing_product_type_map
  // still needs the row the state/legacy pricing routes resolve rules
  // through.
  it('no rule can ever output "Discontinued" — only Nalpac\'s own app may write that value', () => {
    expect(allRuleOutputTypes()).not.toContain('Discontinued')
  })

  it('canonical list has no duplicates', () => {
    expect(new Set(CANONICAL_PRODUCT_TYPES).size).toBe(CANONICAL_PRODUCT_TYPES.length)
  })

  it('isCanonicalProductType matches the list', () => {
    expect(isCanonicalProductType('Wand Massager')).toBe(true)
    expect(isCanonicalProductType('Widget')).toBe(false)
  })
})

describe('category derivation', () => {
  it('maps common single Nalpac categories', () => {
    expect(derive(['Wands']).productType).toBe('Wand Massager')
    expect(derive(['Dual Action and Rabbits']).productType).toBe('Rabbit Vibrator')
    expect(derive(['Bullets and Eggs']).productType).toBe('Bullet Vibrator')
    expect(derive(['Air Pulse and Suction']).productType).toBe('Suction Vibrator')
    expect(derive(['Finger and Clit']).productType).toBe('Clitoral Vibrator')
    expect(derive(['G-Spot and Classic Slimline']).productType).toBe('G-Spot Vibrator')
    expect(derive(['Plugs and Probes']).productType).toBe('Anal Plug')
    expect(derive(['Vagina Strokers']).productType).toBe('Stroker')
    expect(derive(['Vibrating Cockrings']).productType).toBe('Cock Ring')
    expect(derive(['Water-Based']).productType).toBe('Lubricant')
    expect(derive(['Restraints']).productType).toBe('Restraints')
    expect(derive(['Lingerie Sets']).productType).toBe('Lingerie Set')
    expect(derive(['Toy Cleaners']).productType).toBe('Toy Cleaner')
    expect(derive(['Sex Machines']).productType).toBe('Sex Machine')
    expect(derive(['Pasties']).productType).toBe('Pasties')
    expect(derive(['Hosiery']).productType).toBe('Hosiery')
    expect(derive(['Socks']).productType).toBe('Hosiery')
  })

  it('reports matchedBy category', () => {
    expect(derive(['Wands'])).toEqual({ productType: 'Wand Massager', matchedBy: 'category' })
  })

  it('is robust to case and apostrophe encoding', () => {
    expect(derive(["COUPLES' VIBRATORS"]).productType).toBe('Couples Vibrator')
    expect(derive(["Men's Underwear"]).productType).toBe("Men's Underwear")
    expect(derive(['WANDS']).productType).toBe('Wand Massager')
  })

  it('splits comma-joined category elements (feed quirk)', () => {
    expect(derive(['Dual Density,Realistic,Silicone Dildos and Dongs,Strap-on Compatible']).productType)
      .toBe('Realistic Dildo')
    expect(derive(['Plugs and Probes,Vibrating Anal Toys']).productType).toBe('Vibrating Anal Toy')
  })

  it('maps condom brand categories to Condom', () => {
    expect(derive(['Trojan']).productType).toBe('Condom')
    expect(derive(['Lifestyles']).productType).toBe('Condom')
  })
})

describe('priority ordering', () => {
  it('vibrating dildo beats silicone dildo', () => {
    expect(derive(['Silicone Dildos and Dongs', 'Vibrating Dildos and Dongs', 'Strap-on Compatible']).productType)
      .toBe('Vibrating Dildo')
  })

  it('cock ring beats couples-vibrator categories it co-occurs with', () => {
    expect(derive(['Couples and Wearable', "COUPLES' VIBRATORS", 'Vibrating Cockrings']).productType)
      .toBe('Cock Ring')
  })

  it('stroker beats the Non-Realistic dildo modifier', () => {
    expect(derive(['Non-Realistic', 'Vibrating Masturbators and Strokers']).productType)
      .toBe('Stroker')
  })

  it('prostate beats vibrating anal', () => {
    expect(derive(['Prostate Toys', 'Vibrating Anal Toys']).productType).toBe('Prostate Massager')
  })

  it('kegel beats bullets for kegel eggs', () => {
    expect(derive(['Bullets and Eggs', 'Kegel Toys', 'Remote']).productType).toBe('Kegel Exerciser')
  })

  it('desensitizer beats the lube-base categories', () => {
    expect(derive(['Desensitizers and Relaxers', 'Water-Based']).productType).toBe('Desensitizer')
  })
})

// Ticket #15376, follow-up to #14756: Nalpac cross-lists some unambiguous
// lubricants and vibrator kits under unrelated vibrator/ring shape
// Sub-Category values. These pin the three live-confirmed mismatches plus the
// cock-ring/vibrator-kit collision, and the precedents that prove a blanket
// fix would have broken real products (a silicone dildo also tagged
// Silicone-Based; a genuine bullet-equipped vibrating cock ring also tagged
// Vibrator Kits; an Arousal Gel also branded "Personal Lubricant").
describe('category/title collisions (#15376)', () => {
  it('a lube-base category plus a colliding shape category resolves to Lubricant when the title says so (nalpac-sku 102077)', () => {
    expect(
      derive(['Finger and Clit', 'Silicone-Based'], 'Moist Silicone Personal Lubricant 1 oz.').productType,
    ).toBe('Lubricant')
  })

  it('Dual Action and Rabbits plus a lube-base category resolves to Lubricant when the title says so (nalpac-sku 101685)', () => {
    expect(
      derive(['Dual Action and Rabbits', 'Silicone-Based'], 'Sex Grease Silicone-Based Personal Lubricant 4 oz')
        .productType,
    ).toBe('Lubricant')
  })

  it('Vibrating Cockrings plus a lube-base category resolves to Lubricant when the title says so (nalpac-sku 102293)', () => {
    expect(
      derive(['Silicone-Based', 'Vibrating Cockrings'], 'Sex Sauce Thick Silicone Lubricant 1.69 oz').productType,
    ).toBe('Lubricant')
  })

  it('does NOT flip to Lubricant without the title corroboration (precision guard)', () => {
    expect(derive(['Finger and Clit', 'Silicone-Based'], 'Some Toy').productType).toBe('Clitoral Vibrator')
  })

  it('a real silicone dildo keeps its type — the lube-base category is not trustworthy alone', () => {
    expect(
      derive(
        ['Realistic', 'Silicone Dildos and Dongs', 'Silicone-Based', 'Strap-on Compatible'],
        'K-Pop Idols Aren Realistic Silicone Dildo with Balls',
      ).productType,
    ).toBe('Realistic Dildo')
  })

  it('a real Arousal Gel keeps its type even when branded "Personal Lubricant" — the colliding-shape set is scoped to toy/ring aliases, not Arousal Gel', () => {
    expect(
      derive(
        ['Arousal Gels Creams and Balms', 'Female Arousal', 'Silicone-Based'],
        'Platinum Silicone-Based Personal Lubricant 3.1 oz.',
      ).productType,
    ).toBe('Arousal Gel')
  })

  it('Classic + Cockring Sets + Vibrator Kits resolves to the generic Vibrator bucket, not Cock Ring (nalpac-sku 102053)', () => {
    expect(
      derive(['Classic', 'Cockring Sets', 'Vibrator Kits'], 'Lushe Egg & Textured Interchangeable Vibrator Purple')
        .productType,
    ).toBe('Vibrator')
  })

  it('a genuine vibrating cock ring keeps Cock Ring even with Vibrator Kits present (nalpac-sku 62602)', () => {
    expect(
      derive(
        ['Bullets and Eggs', 'Couples and Wearable', 'Vibrating Cockrings', 'Vibrator Kits'],
        'Fantasy C-Ringz Duo-Vibrating Super Ring Dual Bullet Purple',
      ).productType,
    ).toBe('Cock Ring')
  })

  it('Classic + Cockring Sets alone (no Vibrator Kits) still resolves to Cock Ring as before', () => {
    expect(derive(['Classic', 'Cockring Sets']).productType).toBe('Cock Ring')
  })
})

// Ticket #17600, from the 2026-10-24 Discontinued-retype audit: four more
// category/title collisions found while retyping the 894 active products that
// had been mistyped "Discontinued" (a pricing-group key, not a real type).
describe('category/title collisions (#17600)', () => {
  it('strap-on harness kits beat the dildo-shape categories they ship with (no "Strap On" category of their own)', () => {
    expect(
      derive(['Sets and Kits', 'Silicone Dildos and Dongs'], 'Booty Shorts Silicone Strap-On Harness with 6-Inch Dildo')
        .productType,
    ).toBe('Strap-On Harness')
    expect(
      derive(['Sets and Kits', 'Fabric'], 'Lace Envy Crotchless Strap-On Harness with Curved Dildo Set').productType,
    ).toBe('Strap-On Harness')
    expect(
      derive(['Realistic', 'Fabric'], 'Tomboii Nylon Boxer Briefs Strap-On Harness with Bullet Pockets').productType,
    ).toBe('Strap-On Harness')
  })

  it('a real dildo keeps its type when the title says nothing about a harness', () => {
    expect(derive(['Sets and Kits', 'Silicone Dildos and Dongs'], 'Ripple Silicone Dildo Set').productType)
      .toBe('Silicone Dildo')
  })

  it('masturbators/strokers beat the generic Non-Realistic dildo modifier when it is their only category', () => {
    expect(derive(['Non-Realistic'], 'Spring Fling 2 AM Twisting Stroker').productType).toBe('Stroker')
    expect(derive(['Non-Realistic'], 'Hotrod Rechargeable Warming Dual Motor Masturbator').productType).toBe('Stroker')
    expect(derive(['Non-Realistic'], 'Jock 10X Vibrating Double-Ended Masturbator TPE').productType).toBe('Stroker')
  })

  it('a non-realistic dildo with no stroker/masturbator wording keeps Dildo', () => {
    expect(derive(['Non-Realistic'], 'Glow in the Dark Silicone Dildo').productType).toBe('Dildo')
  })

  it('Fantasy Dildos wins over the Plugs and Probes/Tails category it co-occurs with', () => {
    expect(
      derive(['Fantasy Dildos', 'Plugs and Probes'], 'Silicone Tantus Magma Fantasy Dildo 7-Inch').productType,
    ).toBe('Fantasy Dildo')
  })

  it('Plugs and Probes alone (no Fantasy Dildos) still resolves to Anal Plug as before', () => {
    expect(derive(['Plugs and Probes']).productType).toBe('Anal Plug')
  })

  it('G-Spot and Classic Slimline wins over the Prostate Toys category it co-occurs with', () => {
    expect(derive(['G-Spot and Classic Slimline', 'Prostate Toys'], 'AV23 Arched Ring G-Spot Vibrator Teal').productType)
      .toBe('G-Spot Vibrator')
  })

  it('Prostate Toys alone (no G-Spot category) still resolves to Prostate Massager as before', () => {
    expect(derive(['Prostate Toys']).productType).toBe('Prostate Massager')
  })

  it('Slings maps to Penis Extender for extender sheaths instead of Cock Ring', () => {
    expect(derive(['Slings'], 'Fat Boy Ultra Fat Penis Extender Sleeve').productType).toBe('Penis Extender')
    expect(
      derive(['Slings'], 'XXXPANDER Ribbed Penis Extender Sheath With Cockring & Anal Plug').productType,
    ).toBe('Penis Extender')
  })

  it('Slings without extender wording in the title still resolves to Cock Ring as before', () => {
    expect(derive(['Slings'], 'Leather Cock and Ball Sling').productType).toBe('Cock Ring')
  })
})

describe('modifier and noise categories', () => {
  it('pure modifiers alone do not resolve (fall to title)', () => {
    expect(derive(['Strap-on Compatible'], 'Ripple Silicone Dildo'))
      .toEqual({ productType: 'Dildo', matchedBy: 'title' })
    expect(derive(['Remote', 'Large'], 'Thumper Deluxe').productType).toBeNull()
  })

  it('sale and program tags are ignored', () => {
    expect(derive(['40% Off Sale', 'abs-altitude-2025', 'Wands']).productType).toBe('Wand Massager')
    expect(derive(['Top 100 Items'], 'Unbranded Thing').productType).toBeNull()
  })
})

describe('title fallback', () => {
  it('derives from title keywords when categories give nothing', () => {
    expect(derive([], 'Midnight Wand Massager')).toEqual({ productType: 'Wand Massager', matchedBy: 'title' })
    expect(derive([], 'Silk Cuffs Set').productType).toBe('Restraints')
    expect(derive([], 'Cherry Flavored Lube 4oz').productType).toBe('Lubricant')
    expect(derive([], 'XDIPX Gift Card').productType).toBe('Gift Card')
  })

  it('uses word boundaries (no substring surprises)', () => {
    // "engagement" must not trigger the \bgag\b rule; "game" resolves it.
    expect(derive([], 'The Engagement Party Game').productType).toBe('Adult Game')
    // "babydoll" must not trigger the \bdoll\b rule.
    expect(derive([], 'Lace Babydoll Set').productType).toBe('Babydoll / Chemise')
  })

  it('returns null when nothing matches', () => {
    expect(derive([], 'Mystery Box')).toEqual({ productType: null, matchedBy: null })
    expect(derive([], '')).toEqual({ productType: null, matchedBy: null })
  })
})
