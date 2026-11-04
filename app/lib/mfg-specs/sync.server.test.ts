import { describe, it, expect } from 'vitest'
import { isFirstPartyMaterialDoc } from './sync.server'

describe('isFirstPartyMaterialDoc — the xdipx.material write gate (#19981)', () => {
  it('rejects a description-parse-v1 doc even with a material value', () => {
    // extractFromDescription never actually sets material, but the gate
    // should not trust sourceVersion alone if it ever did.
    expect(isFirstPartyMaterialDoc({ sourceVersion: 'description-parse-v1', material: 'Silicone' })).toBe(false)
  })

  it('rejects no doc at all (sku 78048: not in the Nalpac feed)', () => {
    expect(isFirstPartyMaterialDoc(null)).toBe(false)
  })

  it('rejects a nalpac-csv-v1 doc with no material column populated', () => {
    expect(isFirstPartyMaterialDoc({ sourceVersion: 'nalpac-csv-v1' })).toBe(false)
    expect(isFirstPartyMaterialDoc({ sourceVersion: 'nalpac-csv-v1', material: '' })).toBe(false)
    expect(isFirstPartyMaterialDoc({ sourceVersion: 'nalpac-csv-v1', material: '   ' })).toBe(false)
  })

  it('accepts a nalpac-csv-v1 doc with a real material value', () => {
    expect(isFirstPartyMaterialDoc({ sourceVersion: 'nalpac-csv-v1', material: 'Silicone' })).toBe(true)
  })
})
