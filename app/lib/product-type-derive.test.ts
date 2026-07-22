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
