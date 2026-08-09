import { describe, expect, it } from 'vitest'
import { heroPreloadTag } from './image-preload'
import { shopifyImageUrl, shopifyImageSrcSet } from './shopify-image'

describe('heroPreloadTag', () => {
  const shopify = 'https://cdn.shopify.com/s/files/1/0000/0001/products/hero.jpg'

  it('preloads Shopify heroes as a plain width srcset, no inert format param', () => {
    // The Shopify CDN negotiates AVIF/WebP from the Accept header; a `&format=`
    // param is inert. OptimizedImage renders a width-only <img>, so the preload
    // must too, or it fetches a different URL than the browser selects.
    const tag = heroPreloadTag(shopify)
    expect(tag).not.toBeNull()
    expect(tag!.type).toBeUndefined()
    expect(tag!.href).not.toContain('format=')
    expect(tag!.imagesrcset).toBeDefined()
    expect(tag!.imagesrcset).not.toContain('format=')
  })

  it('is byte-identical to what OptimizedImage renders for the same hero', () => {
    // The contract this file exists to keep: the preloaded candidate must match
    // the <img> candidate exactly, so the LCP hero is a cache hit, not a refetch.
    const widths = [480, 640, 768, 1024, 1600]
    const tag = heroPreloadTag(shopify)
    expect(tag!.href).toBe(shopifyImageUrl(shopify, 1024))
    expect(tag!.imagesrcset).toBe(shopifyImageSrcSet(shopify, widths))
  })

  it('returns null for a missing hero url', () => {
    expect(heroPreloadTag(null)).toBeNull()
    expect(heroPreloadTag(undefined)).toBeNull()
  })
})
