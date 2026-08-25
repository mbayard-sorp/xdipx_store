/**
 * Library archive lifecycle (ticket #5426, reversible half only). Covers:
 *   - assessArchiveEligibility: pure usage-guard predicate, no DB.
 *   - parseLibraryFilters: archived defaults to false (active library only).
 *   - The Composer picker (LibraryPickerModal.libraryPickerUrl) inherits that
 *     same default, since it fetches through the same route loader
 *     (parseLibraryFilters + listLibraryAssets) as the grid. This is the
 *     ticket's stated risk: "if it is wrong, archiving does nothing."
 *   - listLibraryAssets: the built WHERE clause actually carries the
 *     archived_at condition, rendered to SQL text via a detached PgDialect
 *     (no live DB needed) so the assertion is on real drizzle output, not a
 *     hand-typed guess.
 */
import { describe, it, expect, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const whereCalls = vi.hoisted(() => [] as unknown[])

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          whereCalls.push(cond)
          return { orderBy: () => ({ limit: async () => [] }) }
        },
        // Facet subquery: awaited directly, no .where() call — just needs
        // to resolve to one row shaped like the facet select.
        then: (resolve: (v: unknown[]) => void) =>
          resolve([{ tags: [], products: [], casts: [], archetypes: [], sources: [] }]),
      }),
    }),
  },
}))

import { assessArchiveEligibility, listLibraryAssets, parseLibraryFilters, type AssetUsage } from './social-studio.server'
import { libraryPickerUrl } from '~/components/admin/social/LibraryPickerModal'

const dialect = new PgDialect()
function renderWhere(cond: unknown): string {
  return dialect.sqlToQuery(cond as Parameters<PgDialect['sqlToQuery']>[0]).sql
}

function usage(over: Partial<AssetUsage>): AssetUsage {
  return { postId: 1, platform: 'instagram', status: 'draft', reviewStatus: 'pending_review', via: 'slide', ...over }
}

describe('assessArchiveEligibility', () => {
  it('allows archiving with no usage at all', () => {
    const v = assessArchiveEligibility([])
    expect(v.eligible).toBe(true)
    expect(v.reason).toBeNull()
    expect(v.warning).toBeNull()
  })

  it('refuses when used by a pending_review draft, naming the post', () => {
    const v = assessArchiveEligibility([usage({ postId: 42, platform: 'instagram', status: 'draft', reviewStatus: 'pending_review' })])
    expect(v.eligible).toBe(false)
    expect(v.reason).toContain('#42')
    expect(v.reason).toContain('instagram')
  })

  it('refuses when used by an approved (possibly scheduled) draft', () => {
    const v = assessArchiveEligibility([usage({ postId: 7, status: 'draft', reviewStatus: 'approved' })])
    expect(v.eligible).toBe(false)
    expect(v.reason).toContain('#7')
  })

  it('refuses when the post is in-flight (publishing)', () => {
    const v = assessArchiveEligibility([usage({ postId: 9, status: 'publishing', reviewStatus: 'approved' })])
    expect(v.eligible).toBe(false)
    expect(v.reason).toContain('#9')
    expect(v.reason).toContain('publishing')
  })

  it('allows, with a warning naming the post, when only usage is posted', () => {
    const v = assessArchiveEligibility([usage({ postId: 3, status: 'posted', reviewStatus: 'approved' })])
    expect(v.eligible).toBe(true)
    expect(v.warning).toContain('#3')
  })

  it('allows without a warning for rejected/needs_changes/failed/deleted-only usage', () => {
    for (const s of [
      { status: 'draft', reviewStatus: 'rejected' },
      { status: 'draft', reviewStatus: 'needs_changes' },
      { status: 'failed', reviewStatus: 'pending_review' },
      { status: 'deleted', reviewStatus: 'approved' },
    ]) {
      const v = assessArchiveEligibility([usage(s)])
      expect(v.eligible).toBe(true)
    }
  })

  it('a single blocking usage refuses even alongside non-blocking usages', () => {
    const v = assessArchiveEligibility([
      usage({ postId: 1, status: 'posted', reviewStatus: 'approved' }),
      usage({ postId: 2, status: 'draft', reviewStatus: 'pending_review' }),
    ])
    expect(v.eligible).toBe(false)
    expect(v.reason).toContain('#2')
  })
})

describe('parseLibraryFilters archived default', () => {
  it('defaults archived to false (active library only) with no ?archived param', () => {
    const f = parseLibraryFilters(new URL('https://x.test/admin/socials/library'))
    expect(f.archived).toBe(false)
  })

  it('archived=1 flips to the archived view', () => {
    const f = parseLibraryFilters(new URL('https://x.test/admin/socials/library?archived=1'))
    expect(f.archived).toBe(true)
  })

  it('any other archived value stays false', () => {
    const f = parseLibraryFilters(new URL('https://x.test/admin/socials/library?archived=0'))
    expect(f.archived).toBe(false)
  })
})

describe('Composer picker inherits the archived default', () => {
  it('libraryPickerUrl carries no archived param, so parseLibraryFilters resolves archived:false, same as the grid', () => {
    const url = libraryPickerUrl('lace')
    expect(url.startsWith('/admin/socials/library?select=1')).toBe(true)
    const parsed = new URL(url, 'https://x.test')
    expect(parsed.searchParams.get('archived')).toBeNull()
    const f = parseLibraryFilters(parsed)
    expect(f.archived).toBe(false)
  })
})

describe('listLibraryAssets WHERE clause', () => {
  it('excludes archived rows by default (archived_at is null)', async () => {
    whereCalls.length = 0
    await listLibraryAssets(parseLibraryFilters(new URL('https://x.test/admin/socials/library')))
    expect(whereCalls).toHaveLength(1)
    const rendered = renderWhere(whereCalls[0])
    expect(rendered).toContain('archived_at')
    expect(rendered).toContain('is null')
  })

  it('shows only archived rows when ?archived=1 (archived_at is not null)', async () => {
    whereCalls.length = 0
    await listLibraryAssets(parseLibraryFilters(new URL('https://x.test/admin/socials/library?archived=1')))
    const rendered = renderWhere(whereCalls[0])
    expect(rendered).toContain('archived_at')
    expect(rendered).toContain('is not null')
  })
})
