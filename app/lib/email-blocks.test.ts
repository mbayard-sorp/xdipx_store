import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CTA_WHITELIST,
  EMAIL_LOGO_DISPLAY_WIDTH,
  EMAIL_NAV_DEFAULT,
  navBlock,
  dealsBlock,
  emmaNoteBlock,
  footerBlock,
  headerBlock,
  heroBlock,
  newInGridBlock,
  seasonalBlock,
  yourAddOnsBlock,
  type CtaLabel,
  type DealItem,
  type GridItem,
} from './email-blocks'

const EM_DASH = '—'
const EN_DASH = '–'
const CTA: CtaLabel = 'Show me'

const GRID_ITEMS: GridItem[] = [
  { name: 'The Compass Wand', href: 'https://xdipx.com/products/the-compass-wand', imageUrl: 'https://cdn.shopify.com/a.jpg' },
  { name: 'Slow Hands Lube', href: 'https://xdipx.com/products/slow-hands-lube', imageUrl: 'https://cdn.shopify.com/b.jpg' },
  { name: 'Quiet Hour Wear', href: 'https://xdipx.com/products/quiet-hour-wear', imageUrl: 'https://cdn.shopify.com/c.jpg' },
]

const DEAL_ITEMS: DealItem[] = [
  { name: 'The Compass Wand', href: 'https://xdipx.com/products/the-compass-wand', imageUrl: 'https://cdn.shopify.com/a.jpg', badge: "Today's pick" },
  { name: 'Slow Hands Lube', href: 'https://xdipx.com/products/slow-hands-lube', imageUrl: 'https://cdn.shopify.com/b.jpg' },
]

function allBlocks(): string[] {
  return [
    headerBlock(),
    navBlock(),
    heroBlock({ productName: 'The Compass Wand', headline: 'Right where you left it.', imageUrl: 'https://cdn.shopify.com/a.jpg', href: 'https://xdipx.com/products/the-compass-wand', cta: CTA }),
    newInGridBlock(GRID_ITEMS),
    dealsBlock(DEAL_ITEMS),
    seasonalBlock({ headline: 'Slow season, started early.', body: 'A few new pairings for the colder evenings.', imageUrl: 'https://cdn.shopify.com/seasonal.jpg', href: 'https://xdipx.com/vault', cta: 'Take a peek →' }),
    yourAddOnsBlock(),
    emmaNoteBlock('Start slow. There is no schedule and no wrong answer here.'),
    footerBlock(),
  ]
}

describe('email-blocks', () => {
  it('renders table HTML with no svg and no link tag, for every block', () => {
    for (const html of allBlocks()) {
      expect(html).toMatch(/<(tr|table)[ >]/)
      expect(html.toLowerCase()).not.toContain('<svg')
      expect(html.toLowerCase()).not.toContain('<link')
    }
  })

  it('gives every image a width and an alt attribute', () => {
    for (const html of allBlocks()) {
      const imgs = html.match(/<img[^>]*>/g) ?? []
      for (const img of imgs) {
        expect(img).toMatch(/\swidth="\d+"/)
        expect(img).toMatch(/\salt="[^"]*"/)
      }
    }
  })

  it('contains no em-dash or en-dash anywhere', () => {
    for (const html of allBlocks()) {
      expect(html.includes(EM_DASH)).toBe(false)
      expect(html.includes(EN_DASH)).toBe(false)
    }
  })

  it('uses CTA labels only from the charter whitelist', () => {
    const hero = heroBlock({ productName: 'x', headline: 'x', imageUrl: 'https://cdn.shopify.com/a.jpg', href: 'https://xdipx.com/', cta: 'Show me' })
    const seasonal = seasonalBlock({ headline: 'x', body: 'x', imageUrl: 'https://cdn.shopify.com/a.jpg', href: 'https://xdipx.com/', cta: "I'll take it ♥" })
    for (const html of [hero, seasonal]) {
      const buttonLabels = [...html.matchAll(/class="x-btn-a"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1])
      expect(buttonLabels.length).toBeGreaterThan(0)
      for (const label of buttonLabels) {
        expect(CTA_WHITELIST as readonly string[]).toContain(label)
      }
    }
  })

  it('footer carries the unsubscribe tag and a postal address tag', () => {
    const html = footerBlock()
    expect(html).toContain("{% unsubscribe '")
    expect(html).toContain('{{ organization.full_address }}')
  })

  it('header links the logo image to the homepage with an explicit square width', () => {
    const html = headerBlock()
    expect(html).toContain(`width="${EMAIL_LOGO_DISPLAY_WIDTH}"`)
    expect(html).toContain(`height="${EMAIL_LOGO_DISPLAY_WIDTH}"`)
    expect(html).toContain('alt="xdipx"')
    expect(html).toMatch(/<a href="https:\/\/xdipx\.com\/"[^>]*><img/)
  })

  it('your-add-ons block guards every numbered slot and the headline behind {% if %}', () => {
    const html = yourAddOnsBlock()
    for (const n of [1, 2, 3]) {
      expect(html).toContain(`{% if profile.xdipx_addon_${n}_handle %}`)
      expect(html).toContain(`profile.xdipx_addon_${n}_why`)
    }
    expect(html).toContain('profile.xdipx_addons_kind == "owned"')
    expect(html).toContain('{% endif %}')
  })

  it('new-in grid and deals grid render every item with a linked image and name', () => {
    const grid = newInGridBlock(GRID_ITEMS)
    for (const item of GRID_ITEMS) {
      expect(grid).toContain(item.imageUrl)
      expect(grid).toContain(item.name)
    }
    const deals = dealsBlock(DEAL_ITEMS)
    expect(deals).toContain("Today's pick") // badge text passes through verbatim
  })

  it('the raster logo pair exists at the stated paths with the expected pixel widths', () => {
    // PNG IHDR: 8-byte signature, then a 4-byte chunk length, "IHDR", then
    // width (bytes 16-19) and height (bytes 20-23) as big-endian uint32.
    const pngDims = (path: string) => {
      const buf = readFileSync(path)
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    const base = pngDims('public/email/xdipx-logo.png')
    const retina = pngDims('public/email/xdipx-logo@2x.png')
    expect(base.width).toBe(EMAIL_LOGO_DISPLAY_WIDTH)
    expect(base.height).toBe(EMAIL_LOGO_DISPLAY_WIDTH)
    expect(retina.width).toBe(EMAIL_LOGO_DISPLAY_WIDTH * 2)
    expect(retina.height).toBe(EMAIL_LOGO_DISPLAY_WIDTH * 2)
  })

  describe('navBlock', () => {
    it('links every section of the site header, New first, as absolute https URLs', () => {
      const html = navBlock()
      const hrefs = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])
      expect(hrefs.map(([, t]) => t)).toEqual(EMAIL_NAV_DEFAULT.map((i) => i.title))
      expect(hrefs[0]).toEqual(['https://xdipx.com/new', 'New'])
      for (const [href] of hrefs) expect(href).toMatch(/^https:\/\/xdipx\.com\//)
    })

    it('appends a per-link UTM with nav-<slug> content, &amp;-joined after an existing query', () => {
      const html = navBlock(
        [{ title: 'Sale', url: '/collections/on-sale' }, { title: 'Notebook', url: 'https://xdipx.com/notebook?x=1' }],
        (c) => `utm_source=klaviyo&amp;utm_content=${c}`,
      )
      expect(html).toContain('href="https://xdipx.com/collections/on-sale?utm_source=klaviyo&amp;utm_content=nav-sale"')
      expect(html).toContain('href="https://xdipx.com/notebook?x=1&amp;utm_source=klaviyo&amp;utm_content=nav-notebook"')
    })

    it('renders the live menu when the assembler passes one', () => {
      const html = navBlock([{ title: 'Gifts', url: '/collections/gifts' }])
      expect(html).toContain('https://xdipx.com/collections/gifts')
      expect(html).not.toContain('Pleasure')
    })
  })
})
