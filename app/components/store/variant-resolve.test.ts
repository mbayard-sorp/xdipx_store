import { describe, it, expect } from 'vitest'
import type { ProductVariant } from '~/types'
import { resolveVariant } from './VariantSelector'

// Minimal ProductVariant factory — only the fields resolveVariant reads.
function v(id: string, opts: Record<string, string>): ProductVariant {
  return {
    id,
    title: Object.values(opts).join(' / '),
    selectedOptions: Object.entries(opts).map(([name, value]) => ({ name, value })),
    price: '0',
    compareAtPrice: null,
    availableForSale: true,
    quantityAvailable: 1,
  } as ProductVariant
}

describe('resolveVariant — add-to-cart SKU resolution', () => {
  // Color + Size two-axis product (the exact PDP shape the bug report calls out).
  const colorSize = [
    v('gid://red-s', { Color: 'Red', Size: 'S' }),
    v('gid://red-m', { Color: 'Red', Size: 'M' }),
    v('gid://blue-s', { Color: 'Blue', Size: 'S' }),
    v('gid://blue-m', { Color: 'Blue', Size: 'M' }),
  ]
  const names = ['Color', 'Size']

  it('resolves the exact SKU when every axis is chosen', () => {
    expect(resolveVariant(colorSize, { Color: 'Blue', Size: 'M' }, names)?.id).toBe('gid://blue-m')
    expect(resolveVariant(colorSize, { Color: 'Red', Size: 'S' }, names)?.id).toBe('gid://red-s')
  })

  it('returns undefined for an empty selection (never falls back to variants[0])', () => {
    expect(resolveVariant(colorSize, {}, names)).toBeUndefined()
  })

  it('returns undefined for a partial selection (only one axis chosen)', () => {
    expect(resolveVariant(colorSize, { Size: 'M' }, names)).toBeUndefined()
    expect(resolveVariant(colorSize, { Color: 'Blue' }, names)).toBeUndefined()
  })

  it('does not resolve to variants[0] when optionNames is empty', () => {
    // Regression: matches(v, {}) is vacuously true for every variant, so an
    // empty optionNames list must not let an empty selection resolve.
    expect(resolveVariant(colorSize, {}, [])).toBeUndefined()
  })

  it('does not resolve to an arbitrary variant when optionNames omits an axis', () => {
    // optionNames lists only Size, but the variants also carry Color. A Size-only
    // selection matches BOTH Red/M and Blue/M as a subset; the exact-match guard
    // must reject it rather than silently returning the first one.
    expect(resolveVariant(colorSize, { Size: 'M' }, ['Size'])).toBeUndefined()
  })

  it('resolves a single-axis size product exactly', () => {
    const sizeOnly = [v('gid://l', { Size: 'L' }), v('gid://medium', { Size: 'Medium' })]
    expect(resolveVariant(sizeOnly, { Size: 'Medium' }, ['Size'])?.id).toBe('gid://medium')
    expect(resolveVariant(sizeOnly, { Size: 'L' }, ['Size'])?.id).toBe('gid://l')
    expect(resolveVariant(sizeOnly, {}, ['Size'])).toBeUndefined()
  })
})
