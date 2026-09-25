import { describe, expect, it } from 'vitest'
import { deriveCastTarget } from './cast-target.server'
import { PRODUCT_TYPE_DIALS } from '~/types'

describe('deriveCastTarget — top-level defaults (ADR-015 §1)', () => {
  const expected: Record<string, 'male' | 'female' | 'universal'> = {
    vibrator: 'female',
    dildo: 'female',
    anal: 'universal',
    bondage: 'universal',
    'cock-ring': 'male',
    stroker: 'male',
    couples: 'universal',
    harness: 'universal',
    extender: 'male',
    pump: 'male',
    lube: 'universal',
    massage: 'universal',
    enhancer: 'universal',
    wear: 'universal',
    condom: 'universal',
    wellness: 'universal',
    novelty: 'universal',
    'book-media': 'universal',
    'sex-machine': 'universal',
  }

  it('covers every top-level ProductTypeDial value', () => {
    expect(Object.keys(expected).sort()).toEqual([...PRODUCT_TYPE_DIALS].sort())
  })

  for (const [dial, want] of Object.entries(expected)) {
    it(`${dial} (no subtype) -> ${want}`, () => {
      expect(deriveCastTarget(dial, null)).toBe(want)
    })
  }
})

describe('deriveCastTarget — inverting subtype overrides (ADR-015 §1)', () => {
  it('dildo/packer -> male (inverts the female default)', () => {
    expect(deriveCastTarget('dildo', 'packer')).toBe('male')
  })

  it('dildo/silicone (non-inverting subtype) stays at the female default', () => {
    expect(deriveCastTarget('dildo', 'silicone')).toBe('female')
  })

  it('anal/prostate -> male (inverts the universal default)', () => {
    expect(deriveCastTarget('anal', 'prostate')).toBe('male')
  })

  it('anal/plug (non-inverting subtype) stays universal', () => {
    expect(deriveCastTarget('anal', 'plug')).toBe('universal')
  })

  it('extender/strap-on -> universal (inverts the male default)', () => {
    expect(deriveCastTarget('extender', 'strap-on')).toBe('universal')
  })

  it('extender/sling (non-inverting subtype) stays at the male default', () => {
    expect(deriveCastTarget('extender', 'sling')).toBe('male')
  })

  it('enhancer/male-arousal -> male (inverts the universal default)', () => {
    expect(deriveCastTarget('enhancer', 'male-arousal')).toBe('male')
  })

  it('enhancer/female-arousal -> female (inverts the universal default)', () => {
    expect(deriveCastTarget('enhancer', 'female-arousal')).toBe('female')
  })

  it('enhancer/oral (non-inverting subtype) stays universal', () => {
    expect(deriveCastTarget('enhancer', 'oral')).toBe('universal')
  })

  it('wear/mens-underwear -> male (inverts the universal default)', () => {
    expect(deriveCastTarget('wear', 'mens-underwear')).toBe('male')
  })

  for (const subtype of ['panty', 'bra-panty-set', 'bodysuit-teddy', 'bodystocking', 'hosiery', 'pasty', 'plus-queen']) {
    it(`wear/${subtype} -> female (inverts the universal default)`, () => {
      expect(deriveCastTarget('wear', subtype)).toBe('female')
    })
  }

  it('wear/apparel (non-inverting subtype) stays universal', () => {
    expect(deriveCastTarget('wear', 'apparel')).toBe('universal')
  })

  it('wellness/kegel -> female (inverts the universal default)', () => {
    expect(deriveCastTarget('wellness', 'kegel')).toBe('female')
  })

  it('wellness/aftercare (non-inverting subtype) stays universal', () => {
    expect(deriveCastTarget('wellness', 'aftercare')).toBe('universal')
  })
})

describe('deriveCastTarget — fail-safe fallback', () => {
  it('returns universal for a null/undefined type dial', () => {
    expect(deriveCastTarget(null)).toBe('universal')
    expect(deriveCastTarget(undefined)).toBe('universal')
  })

  it('returns universal for an unrecognized type dial rather than throwing', () => {
    expect(deriveCastTarget('not-a-real-dial')).toBe('universal')
  })

  it('ignores a subtype that has no override entry for its type', () => {
    expect(deriveCastTarget('vibrator', 'wand')).toBe('female')
  })
})
