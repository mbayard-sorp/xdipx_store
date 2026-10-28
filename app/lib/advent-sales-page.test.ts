import { describe, expect, it } from 'vitest'
import { ADVENT_CALENDARS, ADVENT_ORDER, adventByHandle, isAdventKey, isAdventSalesSlug } from './advent-sales-page'
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
})
