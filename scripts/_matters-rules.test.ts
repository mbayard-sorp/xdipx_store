import { describe, expect, it } from 'vitest'
import { applyMattersRules, type RuleInput } from './_matters-rules'

/**
 * Regression fixtures for ticket #7870 (split from #7463): M-RCH-1 must not
 * tag a corded/plug-in product as Rechargeable off the corpus regex, which
 * previously false-matched on things like a USB-charged remote bundled with
 * a plug-in wand. Fixtures below use the five real handles that surfaced the
 * bug.
 */
function baseInput(overrides: Partial<RuleInput>): RuleInput {
  return {
    productType:       null,
    tags:              [],
    title:             '',
    bodyExcerpt:       '',
    nalpacDescription: '',
    vendor:            '',
    collections:       [],
    materials:         [],
    waterproof:        null,
    rechargeable:      null,
    detachableParts:   null,
    nonElectric:       null,
    lengthIn:          null,
    currentMatters:    [],
    currentAudience:   [],
    ...overrides,
  }
}

describe('M-RCH-1 corded/plug-in exclusion', () => {
  const cordedOrPlugInTitles = [
    'Magic Wand Plus Corded Intimate Massager',
    'Le Wand Plug-In Corded Wand Massager Sky',
    'Magic Wand Original Corded Massager',
    'Le Wand Plug-In Vibrating Massager',
    'Le Wand Classique Plug-In Wand Massager',
  ]

  for (const title of cordedOrPlugInTitles) {
    it(`does not tag Rechargeable for "${title}" even when the corpus mentions a USB-charged remote`, () => {
      const result = applyMattersRules(baseInput({
        title:       title.toLowerCase(),
        bodyExcerpt: 'includes a usb-charged wireless remote for hands-free control',
      }))
      expect(result.finalMatters).not.toContain('Rechargeable')
    })
  }

  it('does not tag Rechargeable for a corded title even when the spec boolean says rechargeable=true', () => {
    const result = applyMattersRules(baseInput({
      title:        'magic wand plus corded intimate massager',
      rechargeable: true,
    }))
    expect(result.finalMatters).not.toContain('Rechargeable')
  })

  it('still tags Rechargeable for a genuinely rechargeable product with no corded/plug-in title', () => {
    const result = applyMattersRules(baseInput({
      title:       'satisfyer pro 2 rechargeable air-pulse stimulator',
      bodyExcerpt: 'usb rechargeable, magnetic charging cable included',
    }))
    expect(result.finalMatters).toContain('Rechargeable')
  })

  it('still tags Rechargeable off the spec boolean for a non-corded product', () => {
    const result = applyMattersRules(baseInput({
      title:        'we-vibe sync app-controlled vibrator',
      rechargeable: true,
    }))
    expect(result.finalMatters).toContain('Rechargeable')
  })
})
