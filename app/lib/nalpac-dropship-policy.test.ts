// The cases below are real rows from the Nalpac main feed (2026-10-09).
import { describe, it, expect } from 'vitest'
import { dropshipRestriction, isNalpacMapVerifiedBrand } from './nalpac-dropship-policy'

const row = (brand: string, title: string, sub: string, sku = '1') =>
  ({ brand, titles: [title], subCategories: [sub], skus: [sku] })

describe('dropshipRestriction', () => {
  it('blocks every Crave product (brick and mortar only)', () => {
    expect(dropshipRestriction(row('Crave', 'Crave Duet Flex Black', 'Clitoral Stimulators'))).toMatch(/brick and mortar/)
  })

  it('blocks restricted-brand pills, supplements, shots and gummies', () => {
    expect(dropshipRestriction(row('Swiss Navy', 'Swiss Navy Climax For Her 60ct', 'Female Arousal,Pills'))).not.toBeNull()
    expect(dropshipRestriction(row('Doc Johnson', 'Spanish Fly Sex Liquid Cotton Candy 1 oz.', 'Shots Honeys and Nectars'))).not.toBeNull()
    expect(dropshipRestriction(row('Swiss Navy', 'Swiss Navy Yummy Cummy Gummy 60ct', 'Gummies and Edibles'))).not.toBeNull()
    expect(dropshipRestriction(row('Zeus', 'Zeus Plus Male Supplement Gummies Wildberry 2pk', 'Counter Displays,Gummies and Edibles,Male Arousal'))).not.toBeNull()
    expect(dropshipRestriction(row('Promescent', 'VitaFLUX for Men Supplement Pills 180-Count', 'Male Arousal,Pills'))).not.toBeNull()
    expect(dropshipRestriction(row('Bijoux Indiscrets', 'Orgasm Glow Supplement 60 Capsules', '30% Off Sale,Female Arousal,Pills'))).not.toBeNull()
  })

  it('leaves the rest of a restricted brand line alone', () => {
    expect(dropshipRestriction(row('Swiss Navy', 'Swiss Navy Water Based Lubricant 4 oz', 'Water Based Lubricants'))).toBeNull()
    expect(dropshipRestriction(row('Doc Johnson', 'Ease Throat Relaxing Spray Double Chocolate 2 oz.', 'Desensitizers and Relaxers'))).toBeNull()
    expect(dropshipRestriction(row('Promescent', 'Promescent Climax Control Spray', 'Desensitizers and Relaxers'))).toBeNull()
  })

  it('does not block supplements from unrestricted brands', () => {
    expect(dropshipRestriction(row('Rock Solid', 'Rock Solid Load Sperm Volume Supplement 60 Capsules', 'Pills'))).toBeNull()
    expect(dropshipRestriction(row('Nasstoys', 'Spanish Fly Liquid 1oz. (Cherry)', 'Shots Honeys and Nectars'))).toBeNull()
  })

  it('blocks the Elixir pheromone items Nalpac cited (98510 sits under Body Care)', () => {
    expect(dropshipRestriction(row('Elixir', 'Elixir Magnetic Lip Gloss with Pheromones 0.17 oz.', 'Body Care', '98510'))).not.toBeNull()
    expect(dropshipRestriction(row('Elixir', 'Elixir Magnetic Rose Mist with Pheromones 1 oz.', 'Perfumes Colognes and Pheromone Fragrances', '98509'))).not.toBeNull()
    expect(dropshipRestriction(row('Elixir', 'Elixir Hybrid Lubricant', 'Hybrid Lubricants', '98593'))).toBeNull()
  })

  it('blocks Adam & Eve Fleshlight and any store-restricted title', () => {
    expect(dropshipRestriction(row('Adam & Eve', "Adam's Quickshot By Fleshlight (Restricted to A&E Stores)", 'Non-Realistic'))).not.toBeNull()
    expect(dropshipRestriction(row('Adam &amp; Eve', 'Adam & Eve Trainer by Fleshlight', 'Non-Realistic'))).not.toBeNull()
    expect(dropshipRestriction(row('Adam & Eve', 'Adam & Eve Slim Lady Rabbit', 'Rabbit Vibrators'))).toBeNull()
  })

  it('matches brands case-insensitively and checks every sub-category cell', () => {
    expect(dropshipRestriction({ brand: ' swiss navy ', titles: ['MaxSize'], subCategories: ['Male Arousal', 'Top Supplements'], skus: [] })).not.toBeNull()
  })
})

describe('isNalpacMapVerifiedBrand', () => {
  it('matches the verification list under both feed and vendor spellings', () => {
    for (const v of ['Lovense', 'Playground', 'Hello Playground', 'SVibe', 'Snail Vibe', 'spareparts', 'Gun Oil']) {
      expect(isNalpacMapVerifiedBrand(v)).toBe(true)
    }
    expect(isNalpacMapVerifiedBrand('Blush')).toBe(false)
    expect(isNalpacMapVerifiedBrand('')).toBe(false)
    expect(isNalpacMapVerifiedBrand(null)).toBe(false)
  })
})
