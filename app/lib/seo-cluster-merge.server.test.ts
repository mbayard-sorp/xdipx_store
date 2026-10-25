/**
 * Ticket #17788: `applySeoClusterMergeMap` is the server-side executor for an
 * approved seoCluster merge map, called both by the team-API route
 * (api.team.seo-cluster-merge.tsx) and by scripts/merge-seo-clusters.ts. These
 * tests pin dry-run vs apply behavior against a stubbed Sanity client so the
 * logic stays identical to what the original CLI-only script did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
const patchSetCommit = vi.fn()
const patchMock = vi.fn(() => ({ set: (data: Record<string, unknown>) => ({ commit: () => patchSetCommit(data) }) }))
const txPatch = vi.fn()
const txCommit = vi.fn()
/** Flips to simulate an unconfigured Sanity client (see the last describe block). */
const h = vi.hoisted(() => ({ clientConfigured: true }))

vi.mock('~/lib/sanity.server', () => ({
  getClient: () =>
    h.clientConfigured
      ? {
          fetch: fetchMock,
          patch: patchMock,
          // Real @sanity/client transactions return `this` from `.patch()` so
          // calls chain (`tx = tx.patch(...)`); mirror that here instead of a
          // one-shot function, or the second `.patch()` in a loop returns
          // undefined and the subsequent `.commit()` throws.
          transaction: () => {
            const tx = {
              patch: (id: string, builder: (p: { set(data: Record<string, unknown>): unknown }) => unknown) => {
                txPatch(id, builder)
                return tx
              },
              commit: () => txCommit(),
            }
            return tx
          },
        }
      : null,
}))

import { applySeoClusterMergeMap, isSeoClusterMergeMap } from './seo-cluster-merge.server'

beforeEach(() => {
  fetchMock.mockReset()
  patchSetCommit.mockReset()
  patchMock.mockClear()
  txPatch.mockReset()
  txCommit.mockReset()
  h.clientConfigured = true
})

describe('isSeoClusterMergeMap', () => {
  it('accepts a well-shaped array', () => {
    expect(isSeoClusterMergeMap([{ canonical: 'a', absorb: ['b'] }])).toBe(true)
    expect(isSeoClusterMergeMap([{ canonical: 'a', absorb: ['b'], newTitle: 'A' }])).toBe(true)
  })

  it('rejects non-arrays and malformed entries', () => {
    expect(isSeoClusterMergeMap(null)).toBe(false)
    expect(isSeoClusterMergeMap('nope')).toBe(false)
    expect(isSeoClusterMergeMap([{ canonical: 'a' }])).toBe(false)
    expect(isSeoClusterMergeMap([{ absorb: ['b'] }])).toBe(false)
    expect(isSeoClusterMergeMap([{ canonical: 'a', absorb: ['b', 1] }])).toBe(false)
  })
})

describe('applySeoClusterMergeMap — dry run', () => {
  it('reports counts without writing', async () => {
    // Driven via a mockResolvedValueOnce chain, in the exact call order
    // applySeoClusterMergeMap issues them, rather than sniffing GROQ text.
    fetchMock
      .mockResolvedValueOnce({ _id: 'canon-1', slug: 'canonical-a', title: 'Canonical A', status: 'active' }) // canonical lookup
      .mockResolvedValueOnce({ _id: 'absorb-1', slug: 'old-a', title: 'Old A', status: 'active' }) // absorbee lookup
      .mockResolvedValueOnce(['kw1', 'kw2']) // repointReferences page 1 (non-empty -> dry run short-circuits to count)
      .mockResolvedValueOnce(5) // count() for dry-run keyword refs
      .mockResolvedValueOnce([{ _id: 'holder-1', related: [{ _key: 'k1', _ref: 'absorb-1' }] }]) // relatedClusters holders

    const result = await applySeoClusterMergeMap(
      [{ canonical: 'canonical-a', absorb: ['old-a'] }],
      { apply: false },
    )

    expect(result.applied).toBe(false)
    expect(result.entries).toHaveLength(1)
    const entry = result.entries[0]!
    expect(entry.canonicalFound).toBe(true)
    expect(entry.absorbed).toHaveLength(1)
    expect(entry.absorbed[0]).toMatchObject({
      slug: 'old-a',
      found: true,
      keywordRefsRepointed: 5,
      relatedClustersHoldersRepointed: 1,
      archived: false,
    })
    expect(result.totals).toEqual({ keywordRefsRepointed: 5, clustersArchived: 0 })
    // Dry run never writes.
    expect(patchSetCommit).not.toHaveBeenCalled()
    expect(txCommit).not.toHaveBeenCalled()
  })

  it('flags a missing canonical without throwing', async () => {
    fetchMock.mockResolvedValueOnce(null)
    const result = await applySeoClusterMergeMap([{ canonical: 'ghost', absorb: ['x'] }], { apply: false })
    expect(result.entries[0]).toEqual({ canonical: 'ghost', canonicalFound: false, absorbed: [] })
  })

  it('skips an already-archived absorb slug', async () => {
    fetchMock
      .mockResolvedValueOnce({ _id: 'canon-1', slug: 'canonical-a', title: 'Canonical A', status: 'active' })
      .mockResolvedValueOnce({ _id: 'absorb-1', slug: 'old-a', title: 'Old A', status: 'archived' })

    const result = await applySeoClusterMergeMap([{ canonical: 'canonical-a', absorb: ['old-a'] }], { apply: false })
    expect(result.entries[0]!.absorbed[0]).toMatchObject({ slug: 'old-a', alreadyArchived: true, archived: false })
  })
})

describe('applySeoClusterMergeMap — apply', () => {
  it('repoints references, archives the absorbee, and retitles the canonical', async () => {
    fetchMock
      .mockResolvedValueOnce({ _id: 'canon-1', slug: 'canonical-a', title: 'Old Title', status: 'active' }) // canonical
      .mockResolvedValueOnce({ _id: 'absorb-1', slug: 'old-a', title: 'Old A', status: 'active' }) // absorbee
      .mockResolvedValueOnce(['kw1', 'kw2']) // repointReferences page 1
      .mockResolvedValueOnce([]) // repointReferences page 2 (done)
      .mockResolvedValueOnce([]) // repointRelatedClusters holders
      .mockResolvedValueOnce(0) // post-repoint remaining count -> safe to archive

    const result = await applySeoClusterMergeMap(
      [{ canonical: 'canonical-a', absorb: ['old-a'], newTitle: 'New Title' }],
      { apply: true },
    )

    expect(result.applied).toBe(true)
    expect(patchSetCommit).toHaveBeenCalledWith({ title: 'New Title' }) // retitle
    expect(patchSetCommit).toHaveBeenCalledWith({ status: 'archived' }) // archive
    expect(txCommit).toHaveBeenCalledTimes(1) // one page of keyword repoints
    const absorbed = result.entries[0]!.absorbed[0]!
    expect(absorbed.archived).toBe(true)
    expect(absorbed.keywordRefsRepointed).toBe(2)
    expect(result.totals.clustersArchived).toBe(1)
  })

  it('does not archive when references remain after repoint', async () => {
    fetchMock
      .mockResolvedValueOnce({ _id: 'canon-1', slug: 'canonical-a', title: 'Canonical A', status: 'active' })
      .mockResolvedValueOnce({ _id: 'absorb-1', slug: 'old-a', title: 'Old A', status: 'active' })
      .mockResolvedValueOnce([]) // no keyword refs to page through
      .mockResolvedValueOnce([]) // no relatedClusters holders
      .mockResolvedValueOnce(3) // remaining > 0 post-repoint (shouldn't happen, but must fail closed)

    const result = await applySeoClusterMergeMap([{ canonical: 'canonical-a', absorb: ['old-a'] }], { apply: true })
    const absorbed = result.entries[0]!.absorbed[0]!
    expect(absorbed.archived).toBe(false)
    expect(absorbed.remainingRefsAfterRepoint).toBe(3)
    expect(absorbed.error).toMatch(/refs remain/)
    expect(result.totals.clustersArchived).toBe(0)
  })
})

describe('applySeoClusterMergeMap — client missing', () => {
  it('throws rather than silently no-op', async () => {
    h.clientConfigured = false
    await expect(
      applySeoClusterMergeMap([{ canonical: 'a', absorb: ['b'] }], { apply: false }),
    ).rejects.toThrow(/Sanity not configured/)
  })
})
