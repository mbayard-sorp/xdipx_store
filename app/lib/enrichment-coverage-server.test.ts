// Regression test for ticket #20593: computeEnrichmentCoverage()'s Admin
// GraphQL query fetched product metafields with the Storefront-only
// `metafields(identifiers: [...])` argument, which the Admin API rejects with
// "Field 'metafields' doesn't accept argument 'identifiers'". Every call
// failed, so the admin dashboard's Refresh action and the weekly SEO report's
// Step 6 enrichment-coverage number were silently non-functional.
//
// The working form (same pattern already used elsewhere in
// shopify.server.ts, e.g. findVariantsBySkus) is fully-qualified
// "namespace.key" strings passed as `keys:`, with no separate `namespace:`
// argument, read off the connection's `.nodes`. Queried that way, Shopify
// returns `key` in the qualified "xdipx.tagline" form, so the mapper must
// normalize back to the bare key before tallyCoverage can match it against
// ENRICHMENT_FIELDS.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('~/lib/kv.server', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}))

function stubAdmin(nodes: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({
      data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('computeEnrichmentCoverage', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('queries product metafields with the Admin connection shape, not the Storefront identifiers argument', async () => {
    const fetchSpy = stubAdmin([])
    const { computeEnrichmentCoverage } = await import('~/lib/enrichment-coverage.server')
    await computeEnrichmentCoverage()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string) as { query: string }
    expect(body.query).not.toMatch(/metafields\s*\(\s*identifiers/)
    const argList = body.query.match(/metafields\(([\s\S]*?)\)\s*\{\s*nodes/)?.[1] ?? ''
    expect(argList).not.toBe('')
    const usesNamespaceArg = /\bnamespace:\s*"xdipx"/.test(argList)
    const usesKeysArg = /\bkeys:\s*\[/.test(argList)
    expect(usesKeysArg).toBe(true)
    expect(usesNamespaceArg && usesKeysArg).toBe(false)
    expect(argList).toMatch(/"xdipx\.tagline"/)
    expect(body.query).toMatch(/nodes\s*\{\s*namespace\s+key\s+value\s*\}/)
  })

  it('normalizes qualified metafield keys back to bare keys before tallying', async () => {
    stubAdmin([
      {
        id: 'gid://shopify/Product/1',
        description: 'A full rewritten description.',
        metafields: {
          nodes: [
            { namespace: 'xdipx', key: 'xdipx.tagline', value: 'Made for slow evenings' },
            { namespace: 'xdipx', key: 'xdipx.mood_tags', value: '["playful"]' },
          ],
        },
      },
    ])
    const { computeEnrichmentCoverage } = await import('~/lib/enrichment-coverage.server')
    const result = await computeEnrichmentCoverage()

    expect(result.totalProducts).toBe(1)
    const tagline = result.fields.find(f => f.key === 'tagline')
    expect(tagline?.covered).toBe(1)
    const moodTags = result.fields.find(f => f.key === 'mood_tags')
    expect(moodTags?.covered).toBe(1)
  })

  it('handles a product with no matching metafields without throwing', async () => {
    stubAdmin([
      { id: 'gid://shopify/Product/2', description: null, metafields: { nodes: [] } },
    ])
    const { computeEnrichmentCoverage } = await import('~/lib/enrichment-coverage.server')
    const result = await computeEnrichmentCoverage()

    expect(result.totalProducts).toBe(1)
    expect(result.fields.find(f => f.key === 'tagline')?.covered).toBe(0)
  })
})
