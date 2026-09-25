/**
 * Coverage for the rolling-window mix report (ticket #10271). Pure function,
 * no DB: every case constructs rows directly and asserts on
 * `computeSocialMixReport`'s output.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CEILING_ZONES,
  CLOSE_CROP_SCALES,
  MID_ZONES,
  PLUG_ZONE,
  computeSocialMixReport,
  computeSocialMixReportBundle,
  formatSocialMixReportLines,
  getSocialMixReport,
  type SocialMixReportRow,
} from './social-mix-report.server'
import { BODY_ZONES, CROP_SCALES } from './social-scene-vocab'

function row(over: Partial<SocialMixReportRow> = {}): SocialMixReportRow {
  return {
    id: 1,
    platform: 'instagram',
    mediaKind: 'image',
    shopifyProductId: null,
    mediaUrls: ['https://cdn.example/a.jpg'],
    bodyZone: null,
    contactMode: null,
    cropScale: null,
    sceneLocation: null,
    castSlugs: null,
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
    // #10340: the new lines degrade the same way.
    expect(report.lines.contactModeWindow.status).toBe('unknown')
    expect(report.lines.castRotation.status).toBe('unknown')
    expect(report.lines.castVolume.status).toBe('unknown')
    expect(report.lines.wideCeiling.status).toBe('unknown')
    expect(report.lines.plug.status).toBe('unknown')
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

// ── Ticket #10340: the §3.2b/§3.2c caps that were left unmeasured ─────────

describe('computeSocialMixReport, cast rotation and volume (§3.2b)', () => {
  it('flags BREACH when one face carries 3 of 5 consecutive cast frames', () => {
    const rows = [
      row({ id: 1, castSlugs: ['nadia'] }),
      row({ id: 2, castSlugs: ['nadia'] }),
      row({ id: 3, castSlugs: ['juno'] }),
      row({ id: 4, castSlugs: ['nadia'] }),
      row({ id: 5, castSlugs: ['juno'] }),
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.castRotation.status).toBe('breach')
    expect(report.lines.castRotation.detail).toContain('nadia')
  })

  it('reads ok when no face carries more than 2 of any 5 consecutive cast frames', () => {
    const rows = [
      row({ id: 1, castSlugs: ['nadia'] }),
      row({ id: 2, castSlugs: ['juno'] }),
      row({ id: 3, castSlugs: ['nadia'] }),
      row({ id: 4, castSlugs: ['juno'] }),
      row({ id: 5, castSlugs: ['remy'] }),
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.castRotation.status).toBe('ok')
  })

  it('checks every sliding window, not only the newest five cast frames', () => {
    const rows = [
      row({ id: 1, castSlugs: ['remy'] }),
      row({ id: 2, castSlugs: ['juno'] }),
      row({ id: 3, castSlugs: ['nadia'] }),
      row({ id: 4, castSlugs: ['nadia'] }),
      row({ id: 5, castSlugs: ['juno'] }),
      row({ id: 6, castSlugs: ['nadia'] }),
    ]
    // The newest 5 (ids 1-5) hold nadia twice; ids 2-6 hold her three times.
    const report = computeSocialMixReport(rows)
    expect(report.lines.castRotation.status).toBe('breach')
  })

  it('flags BREACH above 4 cast frames per rolling 14 and stays ok at 4', () => {
    const cast = (id: number) => row({ id, castSlugs: ['juno'] })
    const bare = (id: number) => row({ id, castSlugs: [] })
    const atCap = [cast(1), cast(2), cast(3), cast(4), ...Array.from({ length: 10 }, (_, i) => bare(10 + i))]
    expect(computeSocialMixReport(atCap).lines.castVolume.status).toBe('ok')

    const overCap = [cast(5), ...atCap]
    const report = computeSocialMixReport(overCap)
    expect(report.lines.castVolume.status).toBe('breach')
    expect(report.lines.castVolume.detail).toContain('5 / 14')
  })

  it('treats an empty cast_slugs array as a known cast-free frame, not UNKNOWN', () => {
    const report = computeSocialMixReport([row({ id: 1, castSlugs: [] }), row({ id: 2, castSlugs: [] })])
    expect(report.lines.castVolume.status).toBe('ok')
    expect(report.lines.castVolume.detail).toContain('0 / 14')
    expect(report.lines.castRotation.status).toBe('ok')
  })
})

describe('computeSocialMixReport, wide ceiling frame (§3.2c)', () => {
  it('flags BREACH when every ceiling frame in the last 7 is a tight crop', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      row({ id: i + 1, bodyZone: 'hip-hollow', cropScale: i === 0 ? 'macro' : 'close' }),
    )
    const report = computeSocialMixReport(rows)
    expect(report.lines.wideCeiling.status).toBe('breach')
    expect(report.lines.wideCeiling.detail).toContain('0 / 7')
  })

  it('reads ok when one ceiling frame in the last 7 is wide enough to read a location', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      row({ id: i + 1, bodyZone: 'sternum', cropScale: i === 3 ? 'medium' : 'close' }),
    )
    expect(computeSocialMixReport(rows).lines.wideCeiling.status).toBe('ok')
  })

  it('counts a wide-scale ceiling frame toward the floor (ticket #11452)', () => {
    // The art director tags true location-establishing ceiling frames 'wide',
    // not 'medium' -- WIDE_CEILING_SCALES used to hold only 'medium', which
    // zeroed the floor against every real ceiling-tier asset in the library.
    const rows = Array.from({ length: 7 }, (_, i) =>
      row({ id: i + 1, bodyZone: 'stomach', cropScale: i === 3 ? 'wide' : 'close' }),
    )
    const report = computeSocialMixReport(rows)
    expect(report.lines.wideCeiling.status).toBe('ok')
    expect(report.lines.wideCeiling.detail).toContain('1 / 7')
  })

  it('does not count a medium crop at a mid zone as a wide ceiling frame', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      row({ id: i + 1, bodyZone: 'forearm', cropScale: 'medium' }),
    )
    expect(computeSocialMixReport(rows).lines.wideCeiling.status).toBe('breach')
  })

  it('degrades to UNKNOWN when crop_scale is unpopulated across the window', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ id: i + 1, bodyZone: 'sternum' }))
    expect(computeSocialMixReport(rows).lines.wideCeiling.status).toBe('unknown')
  })
})

describe('computeSocialMixReport, plug between the cheeks (§3.2c)', () => {
  it('reads ok at one gluteal-cleft frame per rolling 7', () => {
    const rows = [row({ id: 1, bodyZone: 'gluteal-cleft' }), row({ id: 2, bodyZone: 'sternum' })]
    const report = computeSocialMixReport(rows)
    expect(report.lines.plug.status).toBe('ok')
    expect(report.lines.plug.detail).toContain('1 / 7')
  })

  it('flags BREACH at two, and counts the zone as ceiling tier', () => {
    const rows = [
      row({ id: 1, bodyZone: 'gluteal-cleft' }),
      row({ id: 2, bodyZone: 'gluteal-cleft' }),
      row({ id: 3, bodyZone: 'hip-hollow' }),
      row({ id: 4, bodyZone: 'sternum' }),
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.plug.status).toBe('breach')
    expect(report.lines.ceiling.detail).toContain('4 / 7')
    expect(report.lines.ceiling.status).toBe('ok')
  })
})

describe('computeSocialMixReport, contact-mode window (§3.2c)', () => {
  it('flags a repeat inside 5 consecutive on-skin frames', () => {
    const rows = [
      row({ id: 1, contactMode: 'resting' }),
      row({ id: 2, contactMode: 'held' }),
      row({ id: 3, contactMode: 'resting' }),
    ]
    expect(computeSocialMixReport(rows).lines.contactModeWindow.status).toBe('breach')
  })

  it('reads ok when five consecutive on-skin frames rotate the contact mode', () => {
    const modes = ['resting', 'held', 'pressed', 'drawn', 'worn']
    const rows = modes.map((m, i) => row({ id: i + 1, contactMode: m }))
    expect(computeSocialMixReport(rows).lines.contactModeWindow.status).toBe('ok')
  })

  it('ignores a repeat that falls outside the window of 5', () => {
    const modes = ['resting', 'held', 'pressed', 'drawn', 'worn', 'resting']
    const rows = modes.map((m, i) => row({ id: i + 1, contactMode: m }))
    expect(computeSocialMixReport(rows).lines.contactModeWindow.status).toBe('ok')
  })
})

describe('computeSocialMixReport, retired nape zone (§3.2c)', () => {
  it('no longer scores a nape frame as mid', () => {
    const rows = [row({ id: 1, bodyZone: 'nape' }), row({ id: 2, bodyZone: 'inner-wrist' })]
    const report = computeSocialMixReport(rows)
    expect(report.lines.mid.detail).toContain('1 / 7')
  })
})

describe('getSocialMixReport, defensive fallback', () => {
  it('degrades to an all-UNKNOWN bundle instead of throwing when loadRows fails', async () => {
    const loadRows = vi.fn().mockRejectedValue(new Error('column "body_zone" does not exist'))
    const loadRemovals = vi.fn().mockResolvedValue({ instagram: 0, x: 0 })
    const bundle = await getSocialMixReport({ loadRows, loadRemovals })
    // #10478 defect 1: a read failure must NOT render as "in band". Every
    // line is UNKNOWN, and UNKNOWN is not ok, so the headline alarms.
    expect(bundle.anyBreach).toBe(true)
    expect(bundle.worstStatus).toBe('unknown')
    for (const report of [bundle.instagram, bundle.x]) {
      for (const line of Object.values(report.lines)) {
        expect(line.status).toBe('unknown')
        expect(line.detail).not.toContain('BREACH')
      }
    }
  })

  it('computes normally when loadRows succeeds, one report per fenced feed', async () => {
    const loadRows = vi.fn().mockResolvedValue([
      row({ id: 1, mediaUrls: ['a.jpg', 'b.jpg'] }),
      row({ id: 2, platform: 'x' }),
    ])
    const loadRemovals = vi.fn().mockResolvedValue({ instagram: 0, x: 2 })
    const bundle = await getSocialMixReport({ loadRows, loadRemovals })
    expect(loadRows).toHaveBeenCalledWith(60)
    expect(bundle.instagram.sampleSize).toBe(1)
    expect(bundle.x.sampleSize).toBe(1)
    expect(bundle.instagram.lines.removals.status).toBe('ok')
    expect(bundle.x.lines.removals.status).toBe('breach')
    expect(bundle.x.lines.removals.detail).toContain('2 platform-attributed removal')
  })

  it('degrades only the removals line when the removal count cannot be read', async () => {
    const loadRows = vi.fn().mockResolvedValue([row({ id: 1 })])
    const loadRemovals = vi.fn().mockRejectedValue(new Error('timeout'))
    const bundle = await getSocialMixReport({ loadRows, loadRemovals })
    expect(bundle.instagram.lines.removals.status).toBe('unknown')
    expect(bundle.instagram.sampleSize).toBe(1)
  })
})

describe('formatSocialMixReportLines', () => {
  it('prints one line per report line with an explicit status marker', () => {
    const report = computeSocialMixReport([row(), row(), row()])
    const lines = formatSocialMixReportLines(report)
    expect(lines).toHaveLength(18)
    for (const line of lines) expect(line).toMatch(/^\[mix-report\] instagram /)
    // Everything in this all-null fixture is either UNKNOWN (enrichment
    // columns absent) or a hard floor breach (0 carousels, 0 product-free
    // rows against the 1-post floor is moot here since window < 14).
    expect(lines.some(l => l.includes('UNKNOWN'))).toBe(true)
  })
})

// --- Ticket #10478: the report reads honest ---------------------------------

describe('computeSocialMixReport, UNKNOWN alarms (#10478 defect 1)', () => {
  it('sets anyBreach on an all-UNKNOWN window instead of reading clean', () => {
    const rows = Array.from({ length: 21 }, (_, i) => row({ id: i }))
    const report = computeSocialMixReport(rows)
    // Every axis column is null here, which is the exact production state
    // (281 rows, 0 carrying any axis). The old anyBreach tested only for
    // 'breach', and this window reported no drift at all.
    expect(report.anyBreach).toBe(true)
    expect(report.worstStatus).toBe('breach')
    expect(report.lines.coverage.status).toBe('breach')
    expect(report.lines.coverage.detail).toContain('0 / 7')
    expect(report.lines.coverage.detail).toContain('floor 7')
  })

  it('separates "unknown" from "breach" in worstStatus', () => {
    // A clean fortnight: every cap inside its band and all four axes on the
    // last 7. The only non-ok lines left are the ones with no backing data at
    // all (educational, lube-treatment, cast_slugs, the removal count), so
    // the headline must read UNKNOWN rather than BREACH. Both alarm, and the
    // owner needs to know which one he is looking at.
    const zones = ['hip-hollow', 'sternum', 'stomach', 'small-of-back', 'inner-wrist', 'forearm', 'behind-knee']
    const modes = ['resting', 'self-held', 'other-held', 'drawn', 'worn', 'balanced', 'resting']
    const crops = ['medium', 'wide', 'macro', 'wide', 'medium', 'wide', 'close']
    const rows: SocialMixReportRow[] = zones.map((zone, i) => row({
      id: i + 1,
      bodyZone: zone,
      contactMode: modes[i]!,
      cropScale: crops[i]!,
      sceneLocation: `room-${i + 1}`,
      shopifyProductId: 'gid://shopify/Product/1',
      // One carousel clears the rolling-14 floor of 1.
      ...(i === 0 ? { mediaUrls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'] } : {}),
    }))
    // Rows 8-14: product-free non-skin frames, which is what holds the
    // product-forward share inside its 6-7 band over the rolling 14.
    for (let i = 7; i < 14; i++) {
      rows.push(row({ id: i + 1, bodyZone: 'none', contactMode: 'none', cropScale: 'wide', sceneLocation: `room-${i + 1}` }))
    }

    const report = computeSocialMixReport(rows)
    expect(report.lines.coverage.status).toBe('ok')
    expect(Object.values(report.lines).filter(l => l.status === 'breach')).toEqual([])
    expect(report.worstStatus).toBe('unknown')
    expect(report.anyBreach).toBe(true)
  })
})

describe('computeSocialMixReport, the "none" sentinel (#10478 defect 4)', () => {
  it('does not read two consecutive non-skin frames as a zone repeat', () => {
    // The live bug: the art director emits bodyZone 'none' for a frame with
    // no bare skin, and any non-null zone counted as an on-skin frame, so two
    // honest non-skin posts in a row produced REPEAT FOUND and a false BREACH.
    const rows = [
      row({ id: 1, bodyZone: 'none', contactMode: 'none' }),
      row({ id: 2, bodyZone: 'none', contactMode: 'none' }),
      row({ id: 3, bodyZone: 'hip-hollow', contactMode: 'resting' }),
    ]
    const report = computeSocialMixReport(rows)
    expect(report.lines.bodyZoneWindow.status).toBe('ok')
    expect(report.lines.bodyZoneWindow.detail).toContain('no repeat')
    expect(report.lines.contactModeWindow.status).toBe('ok')
  })

  it('still counts a "none" row as a KNOWN zone, so the window is not UNKNOWN', () => {
    const rows = [row({ id: 1, bodyZone: 'none' }), row({ id: 2, bodyZone: 'none' })]
    const report = computeSocialMixReport(rows)
    // Known, so ceiling/mid compute (at 0) rather than degrading to UNKNOWN:
    // "no on-skin frame this week" is an answer, not a missing column.
    expect(report.lines.ceiling.status).not.toBe('unknown')
    expect(report.lines.ceiling.detail).toContain('0 / 7')
  })

  it('never scores "none" as a charge tier or as the plug placement', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ id: i, bodyZone: 'none' }))
    const report = computeSocialMixReport(rows)
    expect(report.lines.plug.detail).toContain('0 / 7')
    expect(report.lines.plug.status).toBe('ok')
  })
})

describe('computeSocialMixReport, video dilution (#10478 defect 2)', () => {
  it('keeps video rows out of the stills windows and prints them on their own line', () => {
    // Four reels and three on-skin stills, all three tight. With the reels in
    // the denominator the close-crop count reads 3 of 7 and sits under the
    // cap; the stills-only window is what the cap is actually about.
    const rows = [
      row({ id: 1, mediaKind: 'video' }),
      row({ id: 2, mediaKind: 'video' }),
      row({ id: 3, mediaKind: 'video' }),
      row({ id: 4, mediaKind: 'video' }),
      row({ id: 5, bodyZone: 'hip-hollow', cropScale: 'macro' }),
      row({ id: 6, bodyZone: 'sternum', cropScale: 'close' }),
      row({ id: 7, bodyZone: 'stomach', cropScale: 'macro' }),
    ]
    const report = computeSocialMixReport(rows)
    expect(report.sampleSize).toBe(3)
    expect(report.lines.videoRows.detail).toContain('4 / 7')
    expect(report.lines.videoRows.status).toBe('unknown')
    // Three close crops among three stills, and two of them consecutive.
    expect(report.lines.closeCrop.status).toBe('breach')
  })

  it('infers a video row from an .mp4 media URL on a pre-086 row with no media_kind', () => {
    const rows = [row({ id: 1, mediaKind: null, mediaUrls: ['https://cdn.example/reel.mp4'] })]
    const report = computeSocialMixReport(rows)
    expect(report.sampleSize).toBe(0)
    expect(report.lines.videoRows.detail).toContain('1 / 7')
  })

  it('reads ok on the video line when the newest 7 are all stills', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ id: i }))
    expect(computeSocialMixReport(rows).lines.videoRows.status).toBe('ok')
  })

  it('counts a NULL media_kind row as a still, which is 271 of the 281 live rows', () => {
    // Production 2026-09-20: media_kind is NULL on 271 of 281 rows and no row
    // anywhere carries 'video'. A `media_kind != 'video'` filter would be NULL
    // for every one of those rows, drop them all, and empty every window. NULL
    // here means "kind not recorded", the pre-086 default, and it is a still.
    const rows = Array.from({ length: 7 }, (_, i) => row({
      id: i + 1,
      mediaKind: null,
      mediaUrls: ['https://cdn.example/still.jpg'],
      bodyZone: 'hip-hollow',
      cropScale: 'macro',
    }))
    const report = computeSocialMixReport(rows)
    expect(report.sampleSize).toBe(7)
    expect(report.lines.videoRows.status).toBe('ok')
    expect(report.lines.videoRows.detail).toContain('0 / 7')
    // The window is populated, so the close-crop cap actually fires.
    expect(report.lines.closeCrop.status).toBe('breach')
  })

  it('never lets a NULL media_kind feed the scene-axis coverage line', () => {
    // Two different nulls: "kind not recorded" (historical, benign) and "axis
    // never supplied" (the decay #10479 fixes). Only the second may alarm.
    const covered = row({
      id: 1, mediaKind: null,
      bodyZone: 'hip-hollow', contactMode: 'resting', cropScale: 'medium', sceneLocation: 'bedroom-loft',
    })
    const report = computeSocialMixReport(Array.from({ length: 7 }, (_, i) => ({ ...covered, id: i + 1 })))
    expect(report.lines.coverage.detail).toContain('7 / 7')
    expect(report.lines.coverage.status).toBe('ok')
  })
})

describe('computeSocialMixReportBundle, per platform (#10478 defect 3)', () => {
  it('computes Instagram and X separately rather than averaging one into the other', () => {
    const rows = [
      // X: three consecutive close crops, a real cap problem on the surface
      // that cannot label sensitive media.
      row({ id: 1, platform: 'x', bodyZone: 'hip-hollow', cropScale: 'macro' }),
      row({ id: 2, platform: 'x', bodyZone: 'sternum', cropScale: 'close' }),
      row({ id: 3, platform: 'x', bodyZone: 'stomach', cropScale: 'macro' }),
      // Instagram: one wide ceiling frame, nothing tight.
      row({ id: 4, bodyZone: 'hip-hollow', cropScale: 'medium' }),
    ]
    const bundle = computeSocialMixReportBundle(rows)
    expect(bundle.instagram.platform).toBe('instagram')
    expect(bundle.x.platform).toBe('x')
    expect(bundle.instagram.sampleSize).toBe(1)
    expect(bundle.x.sampleSize).toBe(3)
    expect(bundle.x.lines.closeCrop.status).toBe('breach')
    expect(bundle.instagram.lines.closeCrop.status).toBe('ok')
    expect(bundle.anyBreach).toBe(true)
  })

  it('prints platform-labelled lines for both feeds', () => {
    const lines = formatSocialMixReportLines(
      computeSocialMixReportBundle([row(), row({ id: 2, platform: 'x' })]),
    )
    expect(lines.some(l => l.startsWith('[mix-report] instagram '))).toBe(true)
    expect(lines.some(l => l.startsWith('[mix-report] x '))).toBe(true)
    expect(lines).toHaveLength(36)
  })
})

// --- Ticket #10480: one vocabulary, no drift --------------------------------

describe('the report classifies only against the shared vocabulary (#10480)', () => {
  it('CEILING_ZONES, MID_ZONES and PLUG_ZONE are all subsets of BODY_ZONES', () => {
    for (const zone of CEILING_ZONES) expect(BODY_ZONES as readonly string[]).toContain(zone)
    for (const zone of MID_ZONES) expect(BODY_ZONES as readonly string[]).toContain(zone)
    expect(BODY_ZONES as readonly string[]).toContain(PLUG_ZONE)
  })

  it('CLOSE_CROP_SCALES is a subset of CROP_SCALES', () => {
    for (const scale of CLOSE_CROP_SCALES) expect(CROP_SCALES as readonly string[]).toContain(scale)
  })

  it('a zone the vocabulary refuses can never reach a charge tier', () => {
    // `hip_hollow` is the exact typo #10480 exists to stop: it used to pass a
    // length-only validator, persist, and then match nothing.
    expect(BODY_ZONES as readonly string[]).not.toContain('hip_hollow')
    expect(CEILING_ZONES.has('hip_hollow')).toBe(false)
    expect(MID_ZONES.has('hip_hollow')).toBe(false)
  })
})
