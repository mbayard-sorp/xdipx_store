/**
 * Coverage for the rolling-window mix report (ticket #10271). Pure function,
 * no DB: every case constructs rows directly and asserts on
 * `computeSocialMixReport`'s output.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  computeSocialMixReport,
  formatSocialMixReportLines,
  getSocialMixReport,
  type SocialMixReportRow,
} from './social-mix-report.server'

function row(over: Partial<SocialMixReportRow> = {}): SocialMixReportRow {
  return {
    id: 1,
    shopifyProductId: null,
    mediaUrls: ['https://cdn.example/a.jpg'],
    bodyZone: null,
    contactMode: null,
    cropScale: null,
    sceneLocation: null,
    ...over,
  }
}

describe('computeSocialMixReport, the 2026-09-10..09-19 regression shape (ticket #10271)', () => {
  it('reproduces the observed drift as BREACH on ceiling, product-forward, and product-free', () => {
    // 21 rows, newest first (index 0 = most recently posted), matching the
    // real query order (`orderBy(desc(postedAt))`).
    const rows: SocialMixReportRow[] = []

    // Most recent post: the one self-described ceiling frame in the window.
    rows.push(row({ id: 21, bodyZone: 'hip-hollow' }))
    // Five more posts inside the last-7 charge window, on-skin but in a zone
    // §3.2b/#10272 do not assign a tier to, so body_zone is "known" (the
    // ceiling/mid line is not UNKNOWN) without inflating the ceiling count.
    for (let i = 0; i < 5; i++) rows.push(row({ id: 20 - i, bodyZone: 'top-of-thigh' }))
    // Rest of the last-14 window: zero product-forward (matches the ticket's
    // own "0 product-forward in 14" finding), all product-free, no body zone.
    while (rows.length < 14) rows.push(row({ id: 100 - rows.length }))
    // Older rows outside the last-14 window (product-forward, to round the
    // fixture out to 21 total, matching the ticket's "21 posted" shape).
    while (rows.length < 21) rows.push(row({ id: 200 - rows.length, shopifyProductId: 'gid://shopify/Product/1' }))

    const report = computeSocialMixReport(rows)
    expect(report.sampleSize).toBe(21)

    expect(report.lines.ceiling.status).toBe('breach')
    expect(report.lines.ceiling.detail).toContain('BREACH')

    expect(report.lines.productForward.status).toBe('breach')
    expect(report.lines.productForward.detail).toContain('0 / 14')
    expect(report.lines.productForward.detail).toContain('BREACH')

    expect(report.lines.productFree.status).toBe('breach')
    expect(report.lines.productFree.detail).toContain('14 / 14')
    expect(report.lines.productFree.detail).toContain('BREACH')

    expect(report.anyBreach).toBe(true)
  })
})

describe('computeSocialMixReport, UNKNOWN instead of a guess', () => {
  it('prints UNKNOWN for every enrichment-dependent line when no row carries the column', () => {
    const rows = Array.from({ length: 21 }, (_, i) => row({ id: i }))
    const report = computeSocialMixReport(rows)

    expect(report.lines.ceiling.status).toBe('unknown')
    expect(report.lines.mid.status).toBe('unknown')
    expect(report.lines.closeCrop.status).toBe('unknown')
    expect(report.lines.bodyZoneWindow.status).toBe('unknown')
    expect(report.lines.locationWindow.status).toBe('unknown')
    // Educational and lube-treatment have no backing column at all, ever.
    expect(report.lines.educational.status).toBe('unknown')
    expect(report.lines.lubeTreatment.status).toBe('unknown')

    // None of these are guessed as a false "0" -- confirm no BREACH fires
    // from an absent column.
    expect(report.lines.ceiling.detail).not.toContain('BREACH')
    expect(report.lines.bodyZoneWindow.detail).not.toContain('BREACH')
  })

  it('never derives a line from caption/imageBrief prose (rows carry no such field at all)', () => {
    // Type-level guarantee: SocialMixReportRow has no caption/tweetText/
    // imageBrief field, so there is nothing for this function to read
    // prose from even by accident.
    const r = row()
    expect('tweetText' in r).toBe(false)
    expect('imageBrief' in r).toBe(false)
  })
})

describe('computeSocialMixReport, close crop', () => {
  it('flags BREACH when the cap of 3 per rolling 7 is exceeded', () => {
    const rows = [
      row({ id: 1, cropScale: 'macro' }),
      row({ id: 2, cropScale: 'medium' }),
      row({ id: 3, cropScale: 'close' }),
      row({ id: 4, cropScale: 'medium' }),
      row({ id: 5, cropScale: 'macro' }),
      row({ id: 6, cropScale: 'macro' }),
      row({ id: 7, cropScale: 'medium' }),
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.closeCrop.status).toBe('breach')
    expect(report.lines.closeCrop.detail).toContain('4 / 7')
  })

  it('flags BREACH on two consecutive close crops even under the count cap', () => {
    const rows = [
      row({ id: 1, cropScale: 'macro' }),
      row({ id: 2, cropScale: 'close' }),
      row({ id: 3, cropScale: 'medium' }),
      row({ id: 4, cropScale: 'medium' }),
      row({ id: 5, cropScale: 'medium' }),
      row({ id: 6, cropScale: 'medium' }),
      row({ id: 7, cropScale: 'medium' }),
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.closeCrop.status).toBe('breach')
    expect(report.lines.closeCrop.detail).toContain('two consecutive')
  })

  it('reads ok inside the cap with no consecutive pair', () => {
    const rows = [
      row({ id: 1, cropScale: 'macro' }),
      row({ id: 2, cropScale: 'medium' }),
      row({ id: 3, cropScale: 'close' }),
      row({ id: 4, cropScale: 'medium' }),
      row({ id: 5, cropScale: 'medium' }),
      row({ id: 6, cropScale: 'medium' }),
      row({ id: 7, cropScale: 'medium' }),
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.closeCrop.status).toBe('ok')
  })
})

describe('computeSocialMixReport, body-zone and location windows', () => {
  it('flags BREACH when a body zone repeats inside 5 consecutive on-skin frames', () => {
    const rows = [
      row({ id: 1, bodyZone: 'sternum' }),
      row({ id: 2, bodyZone: 'nape' }),
      row({ id: 3, bodyZone: 'hip-hollow' }),
      row({ id: 4, bodyZone: 'forearm' }),
      row({ id: 5, bodyZone: 'sternum' }), // repeats id:1's zone within the 5-window
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.bodyZoneWindow.status).toBe('breach')
    expect(report.lines.bodyZoneWindow.detail).toContain('REPEAT FOUND')
  })

  it('reads ok when 5 consecutive on-skin frames carry 5 distinct zones', () => {
    const rows = [
      row({ id: 1, bodyZone: 'sternum' }),
      row({ id: 2, bodyZone: 'nape' }),
      row({ id: 3, bodyZone: 'hip-hollow' }),
      row({ id: 4, bodyZone: 'forearm' }),
      row({ id: 5, bodyZone: 'ankle' }),
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.bodyZoneWindow.status).toBe('ok')
  })

  it('flags BREACH when a location repeats inside 8 located frames, skipping unlocated rows', () => {
    const rows = [
      row({ id: 1, sceneLocation: 'bedroom-loft' }),
      row({ id: 2 }), // no location, does not consume a slot in the window
      row({ id: 3, sceneLocation: 'bathroom-spa' }),
      row({ id: 4, sceneLocation: 'kitchen-morning' }),
      row({ id: 5, sceneLocation: 'living-room' }),
      row({ id: 6, sceneLocation: 'hotel-balcony' }),
      row({ id: 7, sceneLocation: 'car-backseat' }),
      row({ id: 8, sceneLocation: 'poolside' }),
      row({ id: 9, sceneLocation: 'bedroom-loft' }), // repeats id:1's location within the 8-window
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.locationWindow.status).toBe('breach')
  })
})

describe('computeSocialMixReport, carousel floor', () => {
  it('flags BREACH when no carousel posted in the last 14', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row({ id: i, mediaUrls: ['https://cdn.example/one.jpg'] }))
    const report = computeSocialMixReport(rows)
    expect(report.lines.carousel.status).toBe('breach')
    expect(report.lines.carousel.detail).toContain('0 / 14')
  })

  it('reads ok when at least one carousel posted in the last 14', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row({ id: i, mediaUrls: ['https://cdn.example/one.jpg'] }))
    rows[3]!.mediaUrls = ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg', 'https://cdn.example/c.jpg']
    const report = computeSocialMixReport(rows)
    expect(report.lines.carousel.status).toBe('ok')
  })
})

describe('computeSocialMixReport, lube-treatment', () => {
  it('is always UNKNOWN: no column exists to compute it from', () => {
    const rows = [row(), row(), row()]
    const report = computeSocialMixReport(rows)
    expect(report.lines.lubeTreatment.status).toBe('unknown')
  })
})

describe('getSocialMixReport, defensive fallback', () => {
  it('degrades to an all-UNKNOWN report instead of throwing when loadRows fails', async () => {
    const loadRows = vi.fn().mockRejectedValue(new Error('column "body_zone" does not exist'))
    const report = await getSocialMixReport({ loadRows })
    expect(report.anyBreach).toBe(false)
    for (const line of Object.values(report.lines)) {
      expect(line.status).toBe('unknown')
      expect(line.detail).not.toContain('BREACH')
    }
  })

  it('computes normally when loadRows succeeds', async () => {
    const loadRows = vi.fn().mockResolvedValue([
      row({ id: 1, mediaUrls: ['a.jpg', 'b.jpg'] }),
    ])
    const report = await getSocialMixReport({ loadRows })
    expect(loadRows).toHaveBeenCalledWith(60)
    expect(report.sampleSize).toBe(1)
  })
})

describe('formatSocialMixReportLines', () => {
  it('prints one line per report line with an explicit status marker', () => {
    const report = computeSocialMixReport([row(), row(), row()])
    const lines = formatSocialMixReportLines(report)
    expect(lines).toHaveLength(10)
    for (const line of lines) expect(line).toMatch(/^\[mix-report\] /)
    // Everything in this all-null fixture is either UNKNOWN (enrichment
    // columns absent) or a hard floor breach (0 carousels, 0 product-free
    // rows against the 1-post floor is moot here since window < 14).
    expect(lines.some(l => l.includes('UNKNOWN'))).toBe(true)
  })
})
