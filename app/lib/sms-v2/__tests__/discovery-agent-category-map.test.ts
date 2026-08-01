import { describe, expect, it } from 'vitest'
import { categoryToDial } from '../discovery-agent-tools.server'

// The model-facing category vocabulary includes friendly nouns ('wand',
// 'plug') that are NOT productTypeDial values. Passing them straight through
// as a dial filter guarantees zero results, so the mapping must translate
// them to real dial + subtype pairs.
describe('categoryToDial', () => {
  it('maps wand to vibrator + wand subtype', () => {
    expect(categoryToDial('wand')).toEqual({ productTypeDial: 'vibrator', productSubtypeDial: 'wand' })
  })

  it('maps plug to anal + plug subtype', () => {
    expect(categoryToDial('plug')).toEqual({ productTypeDial: 'anal', productSubtypeDial: 'plug' })
  })

  it('passes through real dial values', () => {
    expect(categoryToDial('vibrator')).toEqual({ productTypeDial: 'vibrator' })
    expect(categoryToDial('lube')).toEqual({ productTypeDial: 'lube' })
    expect(categoryToDial('wear')).toEqual({ productTypeDial: 'wear' })
    expect(categoryToDial('cock-ring')).toEqual({ productTypeDial: 'cock-ring' })
  })

  it('is case- and whitespace-insensitive', () => {
    expect(categoryToDial(' Wand ')).toEqual({ productTypeDial: 'vibrator', productSubtypeDial: 'wand' })
  })

  it('drops unknown values instead of guaranteeing zero results', () => {
    expect(categoryToDial('gizmo')).toBeUndefined()
    expect(categoryToDial('')).toBeUndefined()
    expect(categoryToDial(undefined)).toBeUndefined()
  })
})
