import { describe, it, expect } from 'vitest'
import { stripOptionToken, familyKey, groupProducts, type GroupableProduct } from './catalog-grouping'

describe('stripOptionToken', () => {
  it('strips a trailing flavor word after a dash', () => {
    expect(stripOptionToken('Screaming O 4B Bullet Vibrator - Strawberry')).toEqual({
      base: 'Screaming O 4B Bullet Vibrator',
      option: 'Strawberry',
    })
  })

  it('strips a trailing size unit', () => {
    expect(stripOptionToken('Swiss Navy Premium Silicone Lubricant 2oz')).toEqual({
      base: 'Swiss Navy Premium Silicone Lubricant',
      option: '2 oz',
    })
  })

  it('leaves a title with no removable suffix unchanged, option null', () => {
    expect(stripOptionToken('Screaming O 4B Bullet Vibrator')).toEqual({
      base: 'Screaming O 4B Bullet Vibrator',
      option: null,
    })
  })
})

describe('familyKey', () => {
  it('is the same for same-vendor products differing only by option suffix', () => {
    expect(familyKey('Screaming O', 'Screaming O 4B Bullet Vibrator - Strawberry'))
      .toBe(familyKey('Screaming O', 'Screaming O 4B Bullet Vibrator - Blueberry'))
  })

  it('differs across vendors even for an identical base title', () => {
    expect(familyKey('Vendor A', 'Travel Wand - Pink'))
      .not.toBe(familyKey('Vendor B', 'Travel Wand - Pink'))
  })
})

describe('groupProducts', () => {
  it('groups Screaming O 4B strawberry and blueberry despite differing title suffixes', () => {
    const products: GroupableProduct[] = [
      { handle: 'screaming-o-4b-bullet-vibrator-strawberry', vendor: 'Screaming O', title: 'Screaming O 4B Bullet Vibrator - Strawberry' },
      { handle: 'screaming-o-4b-bullet-vibrator-blueberry', vendor: 'Screaming O', title: 'Screaming O 4B Bullet Vibrator - Blueberry' },
    ]
    const { families, collisions } = groupProducts(products)
    expect(collisions).toEqual([])
    expect(families).toHaveLength(1)
    expect(families[0]!.members).toEqual(
      expect.arrayContaining([
        { handle: 'screaming-o-4b-bullet-vibrator-strawberry', title: 'Screaming O 4B Bullet Vibrator - Strawberry', option: 'Strawberry' },
        { handle: 'screaming-o-4b-bullet-vibrator-blueberry', title: 'Screaming O 4B Bullet Vibrator - Blueberry', option: 'Blueberry' },
      ]),
    )
  })

  it('groups Swiss Navy 1/2/4 oz with size options', () => {
    const products: GroupableProduct[] = [
      { handle: 'swiss-navy-lube-1oz', vendor: 'Swiss Navy', title: 'Swiss Navy Premium Silicone Lubricant 1oz' },
      { handle: 'swiss-navy-lube-2oz', vendor: 'Swiss Navy', title: 'Swiss Navy Premium Silicone Lubricant 2oz' },
      { handle: 'swiss-navy-lube-4oz', vendor: 'Swiss Navy', title: 'Swiss Navy Premium Silicone Lubricant 4oz' },
    ]
    const { families, collisions } = groupProducts(products)
    expect(collisions).toEqual([])
    expect(families).toHaveLength(1)
    const options = families[0]!.members.map(m => m.option).sort()
    expect(options).toEqual(['1 oz', '2 oz', '4 oz'])
  })

  it('never groups products from different vendors, even with matching titles', () => {
    const products: GroupableProduct[] = [
      { handle: 'a-travel-wand-pink', vendor: 'Vendor A', title: 'Travel Wand - Pink' },
      { handle: 'a-travel-wand-black', vendor: 'Vendor A', title: 'Travel Wand - Black' },
      { handle: 'b-travel-wand-pink', vendor: 'Vendor B', title: 'Travel Wand - Pink' },
      { handle: 'b-travel-wand-black', vendor: 'Vendor B', title: 'Travel Wand - Black' },
    ]
    const { families, collisions } = groupProducts(products)
    expect(collisions).toEqual([])
    expect(families).toHaveLength(2)
    expect(families.map(f => f.members.map(m => m.handle).sort())).toEqual(
      expect.arrayContaining([
        ['a-travel-wand-black', 'a-travel-wand-pink'],
        ['b-travel-wand-black', 'b-travel-wand-pink'],
      ]),
    )
  })

  it('reports two exact-duplicate titles as a collision instead of grouping them', () => {
    const products: GroupableProduct[] = [
      { handle: 'juicy-af-lube-2oz', vendor: 'Pipedream', title: 'Juicy AF Water-Based Personal Lubricant 2oz' },
      { handle: 'juicy-af-lube-2oz-2', vendor: 'Pipedream', title: 'Juicy AF Water-Based Personal Lubricant 2oz' },
    ]
    const { families, collisions } = groupProducts(products)
    expect(families).toEqual([])
    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.reason).toBe('duplicate-title')
    expect(collisions[0]!.members.map(m => m.handle).sort()).toEqual(
      ['juicy-af-lube-2oz', 'juicy-af-lube-2oz-2'],
    )
  })

  it('reports a collision when a member has no derivable option', () => {
    const products: GroupableProduct[] = [
      { handle: 'base-wand', vendor: 'Vendor C', title: 'Pulse Wand' },
      { handle: 'base-wand-pink', vendor: 'Vendor C', title: 'Pulse Wand - Pink' },
    ]
    const { families, collisions } = groupProducts(products)
    expect(families).toEqual([])
    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.reason).toBe('missing-option')
  })

  it('reports a collision when two different titles would derive the same option', () => {
    const products: GroupableProduct[] = [
      { handle: 'd-wand-pink-1', vendor: 'Vendor D', title: 'Pulse Wand - Pink' },
      { handle: 'd-wand-pink-2', vendor: 'Vendor D', title: 'Pulse Wand (Pink)' },
    ]
    const { families, collisions } = groupProducts(products)
    expect(families).toEqual([])
    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.reason).toBe('option-collision')
  })

  it('never groups a lone product (family of 1)', () => {
    const products: GroupableProduct[] = [
      { handle: 'solo-wand-pink', vendor: 'Vendor E', title: 'Solo Wand - Pink' },
    ]
    const { families, collisions } = groupProducts(products)
    expect(families).toEqual([])
    expect(collisions).toEqual([])
  })
})
