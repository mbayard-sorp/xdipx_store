import { describe, expect, it } from 'vitest'
import { shopifyImageSrcSetFmt } from './shopify-image'

describe('shopifyImageSrcSetFmt', () => {
  const url = 'https://cdn.shopify.com/s/files/1/0000/0001/products/example.jpg'

  it('produces a 360w candidate alongside the rest of the rail widths', () => {
    const srcSet = shopifyImageSrcSetFmt(url, 'avif', [240, 360, 480, 640])
    expect(srcSet).toBeDefined()
    const candidates = srcSet!.split(', ')
    expect(candidates).toHaveLength(4)

    const candidate360 = candidates.find(c => c.endsWith(' 360w'))
    expect(candidate360).toBeDefined()
    expect(candidate360).toContain('width=360&format=avif')
  })

  it('keeps candidates in the same order as the input widths', () => {
    const srcSet = shopifyImageSrcSetFmt(url, 'avif', [240, 360, 480, 640])
    const widths = srcSet!.split(', ').map(c => c.split(' ')[1])
    expect(widths).toEqual(['240w', '360w', '480w', '640w'])
  })

  it('returns undefined for non-Shopify CDN urls', () => {
    expect(shopifyImageSrcSetFmt('https://example.com/img.jpg', 'avif', [360])).toBeUndefined()
  })
})
