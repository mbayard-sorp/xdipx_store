/**
 * Phase 6a analytics helpers (#4914). Key shapes mirror what
 * social-engagement.server.ts persists to metrics_json, plus the raw API
 * names an older capture may have written.
 */
import { describe, it, expect } from 'vitest'
import {
  normaliseMetrics,
  interactionsOf,
  hasAnyMetric,
  viewsOrImpressions,
  buildAnalyticsCsv,
  csvCell,
  csvFilename,
  captionSnippet,
  parseRange,
  parseSort,
  parsePlatform,
  CSV_HEADER,
  type NormalisedMetrics,
} from './social-analytics'
import type { InstagramEngagementMetrics, XEngagementMetrics } from './social-engagement.server'

describe('normaliseMetrics', () => {
  it('reads the Instagram keys the capture persists', () => {
    const stored: InstagramEngagementMetrics = { reach: 120, likes: 14, comments: 3, saved: 9 }
    const m = normaliseMetrics('instagram', stored as Record<string, number>)
    expect(m).toEqual<NormalisedMetrics>({
      likes: 14, comments: 3, saves: 9, shares: null, views: null,
      reach: 120, impressions: null, replies: 3, reposts: null,
    })
  })

  it('reads the X keys the capture persists, bookmarks as saves, replies as comments', () => {
    const stored: XEngagementMetrics = { impressions: 800, likes: 21, replies: 4, reposts: 6, quotes: 1, bookmarks: 5 }
    const m = normaliseMetrics('x', stored as Record<string, number>)
    expect(m.likes).toBe(21)
    expect(m.saves).toBe(5)
    expect(m.replies).toBe(4)
    expect(m.comments).toBe(4)
    expect(m.reposts).toBe(6)
    expect(m.impressions).toBe(800)
    expect(m.views).toBeNull()
  })

  it('accepts raw Graph and X API names', () => {
    const ig = normaliseMetrics('instagram', { like_count: 2, comments_count: 1, shares: 7, views: 300, total_interactions: 40 })
    expect(ig.likes).toBe(2)
    expect(ig.comments).toBe(1)
    expect(ig.shares).toBe(7)
    expect(ig.views).toBe(300)
    const x = normaliseMetrics('x', { like_count: 3, reply_count: 2, retweet_count: 1, impression_count: 50, bookmark_count: 4 })
    expect(x).toMatchObject({ likes: 3, replies: 2, comments: 2, reposts: 1, impressions: 50, saves: 4 })
  })

  it('returns nulls, never zeros, for absent data', () => {
    expect(hasAnyMetric(normaliseMetrics('instagram', null))).toBe(false)
    expect(hasAnyMetric(normaliseMetrics('x', {}))).toBe(false)
    expect(normaliseMetrics('x', { likes: 'many' as unknown as number }).likes).toBeNull()
    expect(hasAnyMetric(normaliseMetrics('x', { likes: 0 }))).toBe(true)
  })
})

describe('interactionsOf', () => {
  it('sums likes, comments, saves, shares and reposts without double-counting replies', () => {
    const ig = normaliseMetrics('instagram', { reach: 100, likes: 10, comments: 2, saved: 3 })
    expect(interactionsOf(ig)).toBe(15)
    const x = normaliseMetrics('x', { impressions: 500, likes: 4, replies: 1, reposts: 2, bookmarks: 1 })
    expect(interactionsOf(x)).toBe(8)
  })

  it('prefers a platform-reported total_interactions', () => {
    const raw = { likes: 1, total_interactions: 77 }
    expect(interactionsOf(normaliseMetrics('instagram', raw), raw)).toBe(77)
  })

  it('views column falls back to impressions', () => {
    expect(viewsOrImpressions(normaliseMetrics('x', { impressions: 9 }))).toBe(9)
    expect(viewsOrImpressions(normaliseMetrics('instagram', { views: 4, impressions: 9 }))).toBe(4)
    expect(viewsOrImpressions(normaliseMetrics('instagram', {}))).toBeNull()
  })
})

describe('csv', () => {
  it('quotes commas, quotes and newlines per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""')
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(0)).toBe('0')
  })

  it('builds a BOM-prefixed CRLF file with a header and one row per post', () => {
    const csv = buildAnalyticsCsv([
      {
        id: 7,
        platform: 'instagram',
        postedAt: '2026-08-20T16:00:00.000Z',
        permalink: 'https://www.instagram.com/p/abc/',
        caption: 'Soft, warm, "just right", and then some',
        metrics: normaliseMetrics('instagram', { reach: 50, likes: 5, comments: 1, saved: 2 }),
        interactions: 8,
      },
      {
        id: 8,
        platform: 'x',
        postedAt: null,
        permalink: null,
        caption: 'two\nlines',
        metrics: normaliseMetrics('x', {}),
        interactions: 0,
      },
    ])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe(CSV_HEADER.join(','))
    expect(lines[1]).toBe('7,instagram,2026-08-20T16:00:00.000Z,https://www.instagram.com/p/abc/,"Soft, warm, ""just right"", and then some",5,1,2,,,50,,1,,8')
    expect(lines[2]).toBe('8,x,,,"two\nlines",,,,,,,,,,0')
    expect(lines[3]).toBe('')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('names the file by range and date', () => {
    expect(csvFilename(30, new Date('2026-08-22T18:00:00Z'))).toBe('xdipx-social-30d-2026-08-22.csv')
  })
})

describe('params and snippets', () => {
  it('parses range, sort and platform with safe defaults', () => {
    expect(parseRange('7')).toBe(7)
    expect(parseRange('90')).toBe(90)
    expect(parseRange('14')).toBe(30)
    expect(parseRange(null)).toBe(30)
    expect(parseSort('likes')).toBe('likes')
    expect(parseSort('drop table')).toBe('best')
    expect(parsePlatform('x')).toBe('x')
    expect(parsePlatform('tiktok')).toBe('all')
  })

  it('flattens whitespace and truncates with an ellipsis', () => {
    expect(captionSnippet('  a\n\n b  ')).toBe('a b')
    const long = 'x'.repeat(200)
    expect(captionSnippet(long, 20)).toHaveLength(20)
    expect(captionSnippet(long, 20).endsWith('…')).toBe(true)
  })
})
