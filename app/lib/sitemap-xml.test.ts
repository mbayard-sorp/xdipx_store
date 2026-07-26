import { describe, expect, it } from 'vitest'
import {
  RECRAWL_EPOCH, applyHealth, chunkSegments, floorLastmod, newestLastmod,
  renderSitemapIndex, renderUrlset, type SitemapUrl, type UrlHealth,
} from '~/lib/sitemap-xml'

const url = (loc: string, lastmod?: string): SitemapUrl => ({
  loc, lastmod, changefreq: 'daily', priority: '0.9',
})

const health = (dead: string[] = [], stale: string[] = []): UrlHealth => ({
  dead: new Set(dead), stale: new Set(stale),
})

describe('floorLastmod', () => {
  it('raises a lastmod older than the floor', () => {
    expect(floorLastmod('2026-05-16', RECRAWL_EPOCH)).toBe(RECRAWL_EPOCH)
  })

  it('leaves a newer lastmod alone', () => {
    expect(floorLastmod('2026-07-21', RECRAWL_EPOCH)).toBe('2026-07-21')
  })

  it('supplies the floor when there is no lastmod at all', () => {
    expect(floorLastmod(undefined, RECRAWL_EPOCH)).toBe(RECRAWL_EPOCH)
  })
})

describe('applyHealth', () => {
  it('drops dead URLs', () => {
    const out = applyHealth(
      [url('https://xdipx.com/products/gone'), url('https://xdipx.com/products/live')],
      health(['https://xdipx.com/products/gone']),
    )
    expect(out.map(u => u.loc)).toEqual(['https://xdipx.com/products/live'])
  })

  it('floors the lastmod of a stale-verdict URL so Google has a recrawl signal', () => {
    const out = applyHealth(
      [url('https://xdipx.com/products/stale', '2026-05-16')],
      health([], ['https://xdipx.com/products/stale']),
    )
    expect(out[0]!.lastmod).toBe(RECRAWL_EPOCH)
  })

  it('does not backdate a stale URL that has since genuinely changed', () => {
    const out = applyHealth(
      [url('https://xdipx.com/products/stale', '2026-07-21')],
      health([], ['https://xdipx.com/products/stale']),
    )
    expect(out[0]!.lastmod).toBe('2026-07-21')
  })

  it('leaves healthy URLs untouched', () => {
    const input = [url('https://xdipx.com/products/fine', '2026-05-16')]
    expect(applyHealth(input, health())).toEqual(input)
  })
})

describe('newestLastmod', () => {
  it('picks the max and ignores undefined', () => {
    expect(newestLastmod([url('a', '2026-05-16'), url('b'), url('c', '2026-07-21')])).toBe('2026-07-21')
  })

  it('is undefined when nothing carries a lastmod', () => {
    expect(newestLastmod([url('a'), url('b')])).toBeUndefined()
  })
})

describe('chunkSegments', () => {
  it('numbers segments from 1 and keeps the remainder', () => {
    const urls = Array.from({ length: 5 }, (_, i) => url(`https://xdipx.com/products/p${i}`))
    const segments = chunkSegments('products', urls, 2)
    expect(segments.map(s => s.name)).toEqual(['products-1', 'products-2', 'products-3'])
    expect(segments.map(s => s.urls.length)).toEqual([2, 2, 1])
  })

  it('gives each segment its own newest lastmod', () => {
    const segments = chunkSegments('products', [
      url('a', '2026-05-16'), url('b', '2026-06-13'),
      url('c', '2026-07-21'),
    ], 2)
    expect(segments.map(s => s.lastmod)).toEqual(['2026-06-13', '2026-07-21'])
  })

  it('returns nothing for an empty list', () => {
    expect(chunkSegments('products', [], 1000)).toEqual([])
  })
})

describe('renderUrlset', () => {
  it('emits lastmod only when present and escapes entities', () => {
    const xml = renderUrlset([
      url('https://xdipx.com/products/a&b', '2026-06-13'),
      url('https://xdipx.com/products/c'),
    ])
    expect(xml).toContain('<loc>https://xdipx.com/products/a&amp;b</loc>')
    expect(xml).toContain('<lastmod>2026-06-13</lastmod>')
    expect(xml.match(/<lastmod>/g)).toHaveLength(1)
    expect(xml.match(/<url>/g)).toHaveLength(2)
  })

  it('nests image entries inside their url block', () => {
    const xml = renderUrlset([{
      ...url('https://xdipx.com/products/a', '2026-06-13'),
      images: [{ loc: 'https://cdn.example/a.jpg', title: 'A & B' }],
    }])
    expect(xml).toContain('<image:loc>https://cdn.example/a.jpg</image:loc>')
    expect(xml).toContain('<image:title>A &amp; B</image:title>')
  })
})

describe('renderSitemapIndex', () => {
  it('points at /sitemaps/{name}.xml with per-segment lastmod', () => {
    const xml = renderSitemapIndex([
      { name: 'pages', urls: [], lastmod: '2026-07-26' },
      { name: 'products-1', urls: [], lastmod: undefined },
    ])
    expect(xml).toContain('<sitemapindex')
    expect(xml).toContain('<loc>https://xdipx.com/sitemaps/pages.xml</loc>')
    expect(xml).toContain('<lastmod>2026-07-26</lastmod>')
    expect(xml).toContain('<loc>https://xdipx.com/sitemaps/products-1.xml</loc>')
    expect(xml.match(/<lastmod>/g)).toHaveLength(1)
  })
})
