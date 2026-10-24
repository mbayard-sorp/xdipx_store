import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CTA_WHITELIST,
  EMAIL_LOGO_DISPLAY_WIDTH,
  EMAIL_NAV_DEFAULT,
  bylineBlock,
  dealCodeBlock,
  dealsBlock,
  emmaNoteBlock,
  featuredBrandBlock,
  footerBlock,
  goodBetterBestBlock,
  headerBlock,
  heroBlock,
  navBlock,
  newInGridBlock,
  notebookCardBlock,
  seasonalBlock,
  tipBlock,
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
    notebookCardBlock(NOTEBOOK_ITEMS),
    tipBlock({ kicker: 'Tip', title: 'Warm it first', body: 'Thirty seconds in a warm (not hot) towel changes everything.', productHref: 'https://xdipx.com/products/slow-hands-lube', productTitle: 'Slow Hands Lube' }),
    bylineBlock({ name: 'Emma', role: 'xdipx guide', avatarUrl: 'https://cdn.shopify.com/emma-avatar.jpg' }),
    dealCodeBlock({ code: 'SLOWSEASON', headline: 'A code for the next two weeks.', terms: 'Valid through November 6. One use per customer.', href: 'https://xdipx.com/vault' }),
    goodBetterBestBlock(GBB_OPTS),
    featuredBrandBlock({ brand: 'Slow Hands', line: 'Every formula is glycerin-free.', items: GRID_ITEMS }),
    footerBlock(),
  ]
}

const NOTEBOOK_ITEMS = [
  { title: 'A short guide to warming lube', dek: 'Thirty seconds changes everything.', href: 'https://xdipx.com/vault/warming-lube', imageUrl: 'https://cdn.shopify.com/notebook-a.jpg' },
  { title: 'Reading your own signals', dek: 'A slower way to start.', href: 'https://xdipx.com/vault/reading-signals' },
]

const GBB_OPTS = {
  kicker: 'Good, better, best',
  title: 'The Compass family',
  body: 'Three ways in, same quiet design.',
  tiers: [
    { tier: 'good' as const, handle: 'the-compass-mini', name: 'The Compass Mini', price: '$39', imageUrl: 'https://cdn.shopify.com/gbb-good.jpg', line: 'Pocket-sized, three speeds.' },
    { tier: 'better' as const, handle: 'the-compass-wand', name: 'The Compass Wand', price: '$69', imageUrl: 'https://cdn.shopify.com/gbb-better.jpg', line: 'Full-size, app-free.' },
    { tier: 'best' as const, handle: 'the-compass-pro', name: 'The Compass Pro', price: '$109', imageUrl: 'https://cdn.shopify.com/gbb-best.jpg', line: 'Pressure sensing, travel case.' },
  ],
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

  it('notebook cards render at most two items, each with its title, dek and the whitelisted CTA', () => {
    const html = notebookCardBlock(NOTEBOOK_ITEMS)
    for (const item of NOTEBOOK_ITEMS) {
      expect(html).toContain(item.title)
      expect(html).toContain(item.dek)
      expect(html).toContain(item.href)
    }
    const ctas = [...html.matchAll(/class="x-plum"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1])
    expect(ctas.length).toBe(NOTEBOOK_ITEMS.length)
    for (const cta of ctas) expect(CTA_WHITELIST as readonly string[]).toContain(cta)
    // the second fixture item has no imageUrl; it still renders without an <img> for that card
    expect(html.match(/<img/g)?.length).toBe(1)
  })

  it('tip block renders the optional product link only when both productHref and productTitle are given', () => {
    const withLink = tipBlock({ kicker: 'Tip', title: 'Warm it first', body: 'Thirty seconds changes everything.', productHref: 'https://xdipx.com/products/slow-hands-lube', productTitle: 'Slow Hands Lube' })
    expect(withLink).toContain('Slow Hands Lube')
    expect(withLink).toContain('https://xdipx.com/products/slow-hands-lube')
    const withoutLink = tipBlock({ kicker: 'Tip', title: 'Warm it first', body: 'Thirty seconds changes everything.' })
    expect(withoutLink).not.toContain('<a href')
    expect(withoutLink).toContain('Warm it first')
  })

  it('byline block renders name and role, and only renders an avatar image when given one', () => {
    const withAvatar = bylineBlock({ name: 'Emma', role: 'xdipx guide', avatarUrl: 'https://cdn.shopify.com/emma.jpg' })
    expect(withAvatar).toContain('Emma')
    expect(withAvatar).toContain('xdipx guide')
    expect(withAvatar).toMatch(/<img[^>]*width="40"[^>]*height="40"[^>]*alt="Emma"/)
    const withoutAvatar = bylineBlock({ name: 'Jess', role: 'Cast member' })
    expect(withoutAvatar).not.toContain('<img')
  })

  it('deal code block renders the code and terms, no countdown language, and a whitelisted CTA', () => {
    const html = dealCodeBlock({ code: 'SLOWSEASON', headline: 'A code for the next two weeks.', terms: 'Valid through November 6. One use per customer.', href: 'https://xdipx.com/vault' })
    expect(html).toContain('SLOWSEASON')
    expect(html).toContain('Valid through November 6. One use per customer.')
    expect(html.toLowerCase()).not.toMatch(/hurry|ends soon|limited time|act now|while supplies last/)
    const ctas = [...html.matchAll(/class="x-btn-a"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1])
    expect(ctas.length).toBeGreaterThan(0)
    for (const cta of ctas) expect(CTA_WHITELIST as readonly string[]).toContain(cta)
  })

  it('good/better/best renders all three tiers, canonical product hrefs, and the lux tier on a plum-soft card', () => {
    const html = goodBetterBestBlock(GBB_OPTS)
    for (const t of GBB_OPTS.tiers) {
      expect(html).toContain(`https://xdipx.com/products/${t.handle}`)
      expect(html).toContain(t.name)
      expect(html).toContain(t.price)
    }
    expect(html).toContain('background-color:#F3E8FB')
    expect(html.match(/class="x-stack"/g)?.length).toBe(3)
  })

  it('featured brand renders the brand name, catalog-fact line, and caps the grid at four items', () => {
    const fiveItems: GridItem[] = [...GRID_ITEMS, { name: 'Fourth Item', href: 'https://xdipx.com/products/fourth', imageUrl: 'https://cdn.shopify.com/d.jpg' }, { name: 'Fifth Item', href: 'https://xdipx.com/products/fifth', imageUrl: 'https://cdn.shopify.com/e.jpg' }]
    const html = featuredBrandBlock({ brand: 'Slow Hands', line: 'Every formula is glycerin-free.', items: fiveItems })
    expect(html).toContain('Slow Hands')
    expect(html).toContain('Every formula is glycerin-free.')
    expect(html).not.toContain('Fifth Item')
    expect(html.match(/<img/g)?.length).toBe(4)
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
