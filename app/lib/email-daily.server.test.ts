/**
 * assembleDailyEmail composes email-blocks.ts into one send; isSendDay
 * resolves the Tue/Thu/Sat default against a marketing_calendar override.
 * db.server is mocked the way video-calendar.server.test.ts does it, so the
 * one test that exercises the no-rows-supplied path never touches a real DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queue: unknown[][] = []

vi.mock('./db.server', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    for (const k of ['from', 'where']) c[k] = () => c
    c['then'] = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? []).then(res, rej)
    return c
  }
  return { db: { select: () => chain() } }
})

import {
  assembleDailyEmail,
  isSendDay,
  isSendDayDefault,
  isWithinDraftWindow,
  resolveSendOverride,
  type EmailDealProduct,
  type EmailSection,
  type MarketingCalendarCampaignRow,
} from './email-daily.server'

beforeEach(() => { queue.length = 0 })

const DATE = '2026-11-05'
const CAMPAIGN = 'daily-20261105'

const DEAL_RESTRICTED: EmailDealProduct = {
  handle: 'map-wand', name: 'MAP Wand', imageUrl: 'https://cdn.shopify.com/a.jpg',
  price: '$39.99', compareAtPrice: '$59.99', mapRestricted: true,
}
const DEAL_OPEN: EmailDealProduct = {
  handle: 'open-wand', name: 'Open Wand', imageUrl: 'https://cdn.shopify.com/b.jpg',
  price: '$24.99', compareAtPrice: '$34.99', mapRestricted: false,
}

function fixtureSections(): EmailSection[] {
  return [
    { kind: 'hero', headline: 'Right where you left it.', cta: 'Show me', product: { handle: 'the-compass-wand', name: 'The Compass Wand', imageUrl: 'https://cdn.shopify.com/hero.jpg' } },
    { kind: 'newInGrid', products: [{ handle: 'slow-hands-lube', name: 'Slow Hands Lube', imageUrl: 'https://cdn.shopify.com/c.jpg' }] },
    { kind: 'deals', products: [DEAL_RESTRICTED, DEAL_OPEN] },
    { kind: 'seasonal', headline: 'Slow season.', body: 'A few new pairings.', imageUrl: 'https://cdn.shopify.com/seasonal.jpg', cta: 'Take a peek →', path: '/vault' },
    { kind: 'yourAddOns' },
    { kind: 'emmaNote', note: 'Start slow. There is no schedule here.' },
    { kind: 'notebookCard', items: [{ title: 'Warm it first', dek: 'Thirty seconds changes everything.', slug: 'warm-it-first', imageUrl: 'https://cdn.shopify.com/nb.jpg' }] },
    { kind: 'tip', kicker: 'Tip', title: 'Warm it first', body: 'Thirty seconds in a warm towel.', product: { handle: 'slow-hands-lube', name: 'Slow Hands Lube', imageUrl: 'https://cdn.shopify.com/c.jpg' } },
    { kind: 'byline', opts: { name: 'Emma', role: 'xdipx guide' } },
    { kind: 'dealCode', code: 'SLOWSEASON', headline: 'A code for two weeks.', terms: 'Through Nov 20. One use per customer.', path: '/vault' },
    { kind: 'goodBetterBest', kicker: 'Good, better, best', title: 'Restraints', body: 'Three ways in.', tiers: [
      { tier: 'good', handle: 'cuffs-good', name: 'Cuffs Good', price: '$16.99', imageUrl: 'https://cdn.shopify.com/g.jpg', line: 'Soft lining.' },
      { tier: 'better', handle: 'cuffs-better', name: 'Cuffs Better', price: '$37.99', imageUrl: 'https://cdn.shopify.com/b2.jpg', line: 'Quick release.' },
      { tier: 'best', handle: 'cuffs-best', name: 'Cuffs Best', price: '$62.99', imageUrl: 'https://cdn.shopify.com/b3.jpg', line: 'Leather, lined.' },
    ] },
    { kind: 'featuredBrand', brand: 'Slow Hands', line: 'Every formula is glycerin-free.', products: [{ handle: 'slow-hands-lube', name: 'Slow Hands Lube', imageUrl: 'https://cdn.shopify.com/c.jpg' }] },
  ]
}

describe('assembleDailyEmail', () => {
  const result = assembleDailyEmail({ date: DATE, subject: 'Test send', sections: fixtureSections() })

  it('gives every product/section href all four UTM params with the right campaign and content values', () => {
    const hrefs = [...result.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h): h is string => h !== undefined)
    const expected = [
      'hero-the-compass-wand', 'newin-slow-hands-lube', 'deals-map-wand', 'deals-open-wand',
      'seasonal-vault', 'notebook-warm-it-first', 'tip-slow-hands-lube', 'dealcode-vault',
      'gbb-good-cuffs-good', 'gbb-better-cuffs-better', 'gbb-best-cuffs-best', 'brand-slow-hands-lube',
    ]
    for (const content of expected) {
      const href = hrefs.find((h) => h.includes(`utm_content=${content}`))
      expect(href, `no href found for utm_content=${content}`).toBeDefined()
      expect(href).toContain('utm_source=klaviyo')
      expect(href).toContain('utm_medium=email')
      expect(href).toContain(`utm_campaign=${CAMPAIGN}`)
    }
  })

  it('carries the same UTM-tagged links in the plain-text body', () => {
    expect(result.text).toContain(`utm_campaign=${CAMPAIGN}`)
    expect(result.text).toContain('hero-the-compass-wand')
    // Plain text never HTML-escapes the ampersand.
    expect(result.text).not.toContain('&amp;')
  })

  it('renders no struck/compare price for the map_restricted deal, and does for the open one', () => {
    expect(result.html).not.toMatch(/\$59\.99/)
    expect(result.html).toContain('$34.99')
  })

  it('contains no countdown or urgency language from the charter ban list', () => {
    expect(result.html.toLowerCase()).not.toMatch(/\b(hurry|last chance|ends? (tonight|today|soon)|while supplies last|limited time|only \d+ left|act now)\b/)
  })

  it('never uses "buy now" or the "sexy" adjective', () => {
    expect(result.html.toLowerCase()).not.toMatch(/\bbuy now\b/)
    expect(result.html.toLowerCase()).not.toMatch(/\bsexy\b/)
  })
})

describe('isSendDayDefault', () => {
  it('is true only for Tue/Thu/Sat', () => {
    const week: Record<string, boolean> = {
      '2026-11-02': false, // Monday
      '2026-11-03': true,  // Tuesday
      '2026-11-04': false, // Wednesday
      '2026-11-05': true,  // Thursday
      '2026-11-06': false, // Friday
      '2026-11-07': true,  // Saturday
      '2026-11-08': false, // Sunday
    }
    for (const [date, expected] of Object.entries(week)) {
      expect(isSendDayDefault(date), date).toBe(expected)
    }
  })
})

// Modeled on the real marketing_calendar rows (fetched 2026-11-01): row 50
// (string "MM-DD ..." sends, supersedes nothing) and row 58 (object sends
// with full dates, assetsJson.supersedes: 50).
const ROW_50: MarketingCalendarCampaignRow = {
  id: 50, eventDate: '2026-10-31',
  assetsJson: { endDate: '2026-12-01', sends: ['10-31 costume final day', '11-03 wand curriculum'] },
}
const ROW_58: MarketingCalendarCampaignRow = {
  id: 58, eventDate: '2026-11-01',
  assetsJson: {
    endDate: '2026-12-01', supersedes: 50,
    sends: [{ send: '2026-11-01', job: 'Kickoff' }, { send: '2026-11-05', job: 'Explore' }],
  },
}

describe('resolveSendOverride', () => {
  it('returns null (defer to default) when no row covers the date', () => {
    expect(resolveSendOverride([], DATE)).toBeNull()
    expect(resolveSendOverride([ROW_58], '2026-09-01')).toBeNull()
  })

  it('a covering row\'s dated sends override the default', () => {
    expect(resolveSendOverride([ROW_58], '2026-11-05')).toBe(true) // listed send, not a Tue/Thu/Sat
    expect(resolveSendOverride([ROW_58], '2026-11-02')).toBe(false) // covered, not listed
  })

  it('ignores a row that a later row supersedes', () => {
    // Row 50 lists 11-03 as a send; row 58 supersedes it and does not list 11-03.
    expect(resolveSendOverride([ROW_50, ROW_58], '2026-11-03')).toBe(false)
  })

  it('an explicit offCadence date is never a send day even if listed', () => {
    const row: MarketingCalendarCampaignRow = {
      id: 1, eventDate: '2026-11-01',
      assetsJson: { endDate: '2026-11-30', sends: ['11-27 Black Friday'], offCadence: ['2026-11-27'] },
    }
    expect(resolveSendOverride([row], '2026-11-27')).toBe(false)
  })
})

describe('isSendDay', () => {
  it('falls back to the Tue/Thu/Sat default with no campaign rows', async () => {
    expect(await isSendDay('2026-11-03', [])).toBe(true)
    expect(await isSendDay('2026-11-02', [])).toBe(false)
  })

  it('a dated-send override wins over the default', async () => {
    expect(await isSendDay('2026-11-05', [ROW_58])).toBe(true)
    expect(await isSendDay('2026-11-02', [ROW_58])).toBe(false)
  })

  it('reads the live table when no rows are supplied', async () => {
    queue.push([{ id: 58, eventDate: ROW_58.eventDate, assetsJson: ROW_58.assetsJson }])
    expect(await isSendDay('2026-11-05')).toBe(true)
  })
})

describe('isWithinDraftWindow', () => {
  it('allows a send date within one day of today, either direction', () => {
    expect(isWithinDraftWindow('2026-11-05', '2026-11-04')).toBe(true)
    expect(isWithinDraftWindow('2026-11-05', '2026-11-05')).toBe(true)
    expect(isWithinDraftWindow('2026-11-05', '2026-11-06')).toBe(true)
  })

  it('refuses a send date more than one day out', () => {
    expect(isWithinDraftWindow('2026-11-05', '2026-11-03')).toBe(false)
    expect(isWithinDraftWindow('2026-11-05', '2026-11-08')).toBe(false)
  })
})
