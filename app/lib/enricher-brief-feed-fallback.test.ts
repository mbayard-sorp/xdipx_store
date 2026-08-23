/**
 * Ticket #4887: gatherProductBrief must not ship a bare-title brief when the
 * Shopify product has no description. Some imported SKUs carry no
 * custom.original_description and no body_html, yet the Nalpac feed row for the
 * same SKU still has a real Product Description. Enriching from the title alone
 * produced wrong-identity products (a lip serum written up as a stroker), so the
 * gatherer now falls back to the feed row (cleanDescription applied) before
 * giving up.
 *
 * These tests drive the REAL gatherProductBrief with the Shopify snapshot query
 * (adminGraphQL), the deal_history lookup (db), and the feed fetch
 * (fetchAllNalpacFeeds) mocked; cleanDescription stays real so the feed text is
 * proven to be decoded (the CSV encodes apostrophes as "ft.").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adminGraphQL: vi.fn(),
  getPairingCandidates: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  fetchAllNalpacFeeds: vi.fn(),
  histRows: [] as Array<{ sku: string | null; brand: string | null; categories: unknown }>,
}))

vi.mock('~/lib/shopify.server', () => ({
  adminGraphQL: (...a: unknown[]) => mocks.adminGraphQL(...a),
  getPairingCandidates: (...a: unknown[]) => mocks.getPairingCandidates(...a),
}))

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.histRows),
        }),
      }),
    }),
  },
}))

vi.mock('~/lib/nalpac-feeds.server', () => ({
  fetchAllNalpacFeeds: (...a: unknown[]) => mocks.fetchAllNalpacFeeds(...a),
}))

import { gatherProductBrief } from '~/lib/enricher-brief.server'

function productResponse(descriptionHtml: string) {
  return {
    product: {
      id: 'gid://shopify/Product/98211',
      title: 'Mystery Product',
      handle: 'mystery-product',
      vendor: 'Acme',
      descriptionHtml,
      status: 'ACTIVE',
      productType: '',
      updatedAt: '2026-01-01T00:00:00Z',
      media: { edges: [] },
      metafields: { edges: [] },
      variants: { edges: [] },
    },
  }
}

function feedResult(sku: string, productDescription: string) {
  return {
    snapshots: new Map([[sku, { raw: { mainRow: { SKU: sku, 'Product Description': productDescription } } }]]),
  }
}

beforeEach(() => {
  mocks.adminGraphQL.mockReset()
  mocks.fetchAllNalpacFeeds.mockReset()
  mocks.getPairingCandidates.mockResolvedValue([])
  mocks.histRows = [{ sku: '98211', brand: 'Acme', categories: [] }]
})

describe('gatherProductBrief feed-description fallback (#4887)', () => {
  it('uses the cleaned Nalpac feed description when the Shopify description is empty', async () => {
    mocks.adminGraphQL.mockResolvedValue(productResponse('')) // no body_html, no variant descriptions
    // "ft." is the feed's apostrophe encoding; cleanDescription must decode it.
    mocks.fetchAllNalpacFeeds.mockResolvedValue(
      feedResult('98211', 'Itft.s a firm silicone plug, and itft.s whisper quiet.'),
    )

    const brief = await gatherProductBrief('98211')

    expect(mocks.fetchAllNalpacFeeds).toHaveBeenCalledOnce()
    expect(brief?.rawDescription).toBe("It's a firm silicone plug, and it's whisper quiet.")
  })

  it('prefers the Shopify description and never touches the feed when one exists', async () => {
    mocks.adminGraphQL.mockResolvedValue(productResponse('<p>Real Shopify copy here.</p>'))

    const brief = await gatherProductBrief('98211')

    expect(brief?.rawDescription).toContain('Real Shopify copy here.')
    expect(mocks.fetchAllNalpacFeeds).not.toHaveBeenCalled()
  })

  it('still returns a (thin) brief when neither Shopify nor the feed has a description', async () => {
    mocks.adminGraphQL.mockResolvedValue(productResponse(''))
    mocks.fetchAllNalpacFeeds.mockResolvedValue({ snapshots: new Map() })

    const brief = await gatherProductBrief('98211')

    expect(brief).not.toBeNull()
    expect(brief?.rawDescription).toBe('')
  })
})
