import { describe, expect, it } from 'vitest'
import {
  NO_EXECUTOR_KINDS,
  facetTotal,
  fmtAge,
  sumFacetCount,
  truncationNote,
  type TicketFacetRow,
} from './ticket-queue-view'

const OPEN_STATUSES = ['proposed', 'approved', 'in_progress', 'pr_open', 'in_review', 'verified', 'blocked']

// A facet set shaped like the real audit numbers: 230+ open rows spread
// across kinds, with the offsite-pitch `strategy` rows sitting at 14 in
// `approved`, plus closed history that must never count as open.
const FACETS: TicketFacetRow[] = [
  { status: 'proposed', kind: 'code', team: 'product', assignee: null, n: 7 },
  { status: 'approved', kind: 'code', team: 'product', assignee: 'agent:rr7-engineer', n: 56 },
  { status: 'pr_open', kind: 'code', team: 'product', assignee: 'agent:rr7-engineer', n: 32 },
  { status: 'blocked', kind: 'code', team: 'product', assignee: null, n: 6 },
  { status: 'approved', kind: 'instructions', team: 'homepage', assignee: null, n: 78 },
  { status: 'approved', kind: 'strategy', team: 'strategy', assignee: null, n: 14 },
  { status: 'approved', kind: 'process', team: 'content', assignee: null, n: 22 },
  { status: 'approved', kind: 'program', team: 'social', assignee: null, n: 2 },
  { status: 'approved', kind: 'promo', team: 'social', assignee: null, n: 1 },
  { status: 'verified', kind: 'instructions', team: 'homepage', assignee: null, n: 1 },
  // Closed history: must be excluded from every open total.
  { status: 'applied', kind: 'code', team: 'product', assignee: null, n: 162 },
  { status: 'dismissed', kind: 'process', team: 'content', assignee: null, n: 51 },
]

describe('facetTotal', () => {
  it('sums every open status when no status filter is set', () => {
    const openSum = FACETS.filter(f => OPEN_STATUSES.includes(f.status)).reduce((s, f) => s + f.n, 0)
    expect(facetTotal(FACETS, { status: '', kind: '', team: '', assignee: '' }, OPEN_STATUSES)).toBe(openSum)
  })

  it('excludes applied/dismissed rows from the open total', () => {
    const total = facetTotal(FACETS, { status: '', kind: '', team: '', assignee: '' }, OPEN_STATUSES)
    // 162 applied + 51 dismissed = 213 rows that must not be counted.
    const grandTotal = FACETS.reduce((s, f) => s + f.n, 0)
    expect(total).toBeLessThan(grandTotal)
    expect(grandTotal - total).toBe(162 + 51)
  })

  it('an explicit status filter overrides the default open set', () => {
    expect(facetTotal(FACETS, { status: 'blocked', kind: '', team: '', assignee: '' }, OPEN_STATUSES)).toBe(6)
  })

  it('narrows by kind and team together, the same fields the picker exposes', () => {
    expect(facetTotal(FACETS, { status: '', kind: 'strategy', team: 'strategy', assignee: '' }, OPEN_STATUSES)).toBe(14)
    // Wrong team for that kind returns nothing, proving both conditions apply.
    expect(facetTotal(FACETS, { status: '', kind: 'strategy', team: 'homepage', assignee: '' }, OPEN_STATUSES)).toBe(0)
  })
})

describe('sumFacetCount', () => {
  it('sums the no-executor kinds across proposed+approved, matching the audit\'s ~48 figure', () => {
    // process 22 + program 2 + promo 1 + strategy 14 = 39 in this fixture,
    // the shape of the real 48 (this fixture is deliberately smaller).
    const n = sumFacetCount(FACETS, { kinds: NO_EXECUTOR_KINDS, statuses: ['proposed', 'approved'] })
    expect(n).toBe(22 + 2 + 1 + 14)
  })

  it('with no filters, sums every row including closed history', () => {
    const grandTotal = FACETS.reduce((s, f) => s + f.n, 0)
    expect(sumFacetCount(FACETS)).toBe(grandTotal)
  })

  it('a kind with a null value never matches a kind filter', () => {
    const withNullKind: TicketFacetRow[] = [{ status: 'approved', kind: null, team: 'homepage', assignee: null, n: 5 }]
    expect(sumFacetCount(withNullKind, { kinds: ['process'] })).toBe(0)
  })
})

describe('fmtAge', () => {
  const now = new Date('2026-08-15T12:00:00Z')

  it('renders <1h for anything inside the last hour', () => {
    expect(fmtAge(new Date('2026-08-15T11:30:00Z'), now)).toBe('<1h')
  })

  it('renders whole hours under 48h', () => {
    expect(fmtAge(new Date('2026-08-15T02:00:00Z'), now)).toBe('10h')
  })

  it('renders whole days at 48h and beyond', () => {
    expect(fmtAge(new Date('2026-08-13T12:00:00Z'), now)).toBe('2d')
  })

  it('matches the audit: a row filed 26 days ago reads 26d, not "today"', () => {
    expect(fmtAge(new Date('2026-07-19T16:15:53.903Z'), now)).toBe('26d')
  })

  it('returns an em dash for null input', () => {
    expect(fmtAge(null, now)).toBe('—')
  })

  it('returns an em dash for a bad/future timestamp rather than a negative age', () => {
    expect(fmtAge(new Date('2026-08-16T00:00:00Z'), now)).toBe('—')
  })
})

describe('truncationNote', () => {
  it('is null when the table shows everything', () => {
    expect(truncationNote(49, 49)).toBeNull()
    expect(truncationNote(60, 49)).toBeNull()
  })

  it('names the true total when the table is capped, the audit\'s 49-of-230 case', () => {
    const note = truncationNote(49, 230)
    expect(note).not.toBeNull()
    expect(note).toContain('49')
    expect(note).toContain('230')
  })
})
