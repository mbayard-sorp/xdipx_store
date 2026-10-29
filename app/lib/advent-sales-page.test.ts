import { describe, expect, it } from 'vitest'
import { ADVENT_CALENDARS, ADVENT_ORDER, adventByHandle, adventStepUp, isAdventKey, isAdventSalesSlug } from './advent-sales-page'
import { bridgeSlugFromPath } from './bridge-host.server'

describe('advent sales page', () => {
  it('is a slug the bridge host gate can reach', () => {
    expect(bridgeSlugFromPath('/advents26')).toBe('advents26')
    expect(isAdventSalesSlug('advents26')).toBe(true)
    expect(isAdventSalesSlug('ADVENTS26')).toBe(true)
    expect(isAdventSalesSlug('advents27')).toBe(false)
  })

  it('only buys the five calendar handles', () => {
    for (const k of ADVENT_ORDER) expect(adventByHandle(ADVENT_CALENDARS[k].handle)?.key).toBe(k)
    expect(adventByHandle('some-other-product')).toBeNull()
    expect(adventByHandle('')).toBeNull()
  })

  it('accepts only known calendar keys from ?c=', () => {
    expect(isAdventKey('couples-24')).toBe(true)
    expect(isAdventKey('couples-25')).toBe(false)
    expect(isAdventKey(null)).toBe(false)
  })


  it('carries no em dashes in customer copy', () => {
    expect(JSON.stringify(ADVENT_CALENDARS)).not.toContain(String.fromCharCode(0x2014))
  })

  describe('step up to Luxury', () => {
    const prices = { 'indulge-12': 129, 'romance-7': 139, 'womanizer-24': 109, 'couples-24': 219, 'luxury-24': 369 }

    it('prices the step from Couples with the one added brand', () => {
      expect(adventStepUp('couples-24', prices)).toEqual({
        to: 'luxury-24',
        extraPrice: 150,
        extraValue: 299.98,
        extraDoors: 0,
        addedBrands: ['Arcwave'],
      })
    })

    it('counts the extra doors from a shorter calendar', () => {
      const s = adventStepUp('romance-7', prices)
      expect(s?.extraPrice).toBe(230)
      expect(s?.extraValue).toBe(617.75)
      expect(s?.extraDoors).toBe(17)
      expect(s?.addedBrands).toEqual(['Womanizer', 'Arcwave'])
    })

    it('never pitches Luxury on the Luxury view or without both prices', () => {
      expect(adventStepUp('luxury-24', prices)).toBeNull()
      expect(adventStepUp('couples-24', { 'couples-24': 219 })).toBeNull()
      expect(adventStepUp('couples-24', { 'luxury-24': 369 })).toBeNull()
    })

    it('stays quiet when the extra value would not beat the extra spend', () => {
      expect(adventStepUp('couples-24', { ...prices, 'luxury-24': 600 })).toBeNull()
      expect(adventStepUp('couples-24', { ...prices, 'luxury-24': 200 })).toBeNull()
    })
  })
})
