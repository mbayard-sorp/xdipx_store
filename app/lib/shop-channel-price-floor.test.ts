/**
 * Ticket #16390, owner direction 2026-10-19: Shop.app orders arrive as very
 * small baskets and the ~$12 acquisition cost makes a sub-$20 order a loss.
 * The owner removed 2,110 active sub-$20 products from the Shop publication
 * by hand, but `publishProductToXdipxChannels` (app/lib/shopify.server.ts)
 * published every new or re-enriched product to every XDIPX_PUBLICATION_NAMES
 * channel including Shop, with no price check, which would put them right
 * back.
 *
 * These tests drive the real `publishProductToXdipxChannels` with the global
 * `fetch` stubbed, asserting the actual `publishablePublish` /
 * `publishableUnpublish` input arrays rather than just that no error was
 * thrown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishProductToXdipxChannels, SHOP_CHANNEL_MIN_PRICE_USD } from './shopify.server'

const PUBLICATIONS = [
  { id: 'gid://shopify/Publication/1', name: 'Online Store' },
  { id: 'gid://shopify/Publication/180118913195', name: 'Shop' },
  { id: 'gid://shopify/Publication/3', name: 'Storefront Admin' },
  { id: 'gid://shopify/Publication/4', name: 'Shopify GraphiQL App' },
  { id: 'gid://shopify/Publication/5', name: 'Google & YouTube' },
  { id: 'gid://shopify/Publication/6', name: 'ChatGPT' },
  { id: 'gid://shopify/Publication/7', name: 'Point of Sale' },
]

function respond(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** Captures every GraphQL call's query+variables so a test can inspect them. */
function stubFetch(maxVariantPriceAmount: string | null) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { query: string; variables: Record<string, unknown> }
    calls.push(body)
    if (body.query.includes('GetPublicationsAndProductPrice')) {
      return respond({
        data: {
          publications: { edges: PUBLICATIONS.map(node => ({ node })) },
          product: maxVariantPriceAmount === null
            ? null
            : { priceRangeV2: { maxVariantPrice: { amount: maxVariantPriceAmount } } },
        },
      })
    }
    // publishablePublish / publishableUnpublish
    return respond({ data: { publishablePublish: { userErrors: [] }, publishableUnpublish: { userErrors: [] } } })
  }))
  return calls
}

function mutationInput(calls: Array<{ query: string; variables: Record<string, unknown> }>, mutationName: string): string[] {
  const call = calls.find(c => c.query.includes(mutationName))
  const input = call?.variables['input'] as Array<{ publicationId: string }> | undefined
  return (input ?? []).map(i => i.publicationId)
}

describe('Shop channel price floor (#16390)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(`keeps Shop off a product priced under $${SHOP_CHANNEL_MIN_PRICE_USD}`, async () => {
    const calls = stubFetch('14.99')
    await publishProductToXdipxChannels('gid://shopify/Product/555')
    const publish = mutationInput(calls, 'PublishProduct')
    const unpublish = mutationInput(calls, 'UnpublishProduct')
    expect(publish).not.toContain('gid://shopify/Publication/180118913195')
    expect(publish).toContain('gid://shopify/Publication/1') // Online Store unaffected
    expect(unpublish).toContain('gid://shopify/Publication/180118913195')
    expect(unpublish).toContain('gid://shopify/Publication/7') // Point of Sale still excluded
  })

  it(`keeps Shop for a product priced at or above $${SHOP_CHANNEL_MIN_PRICE_USD}`, async () => {
    const calls = stubFetch('20.00')
    await publishProductToXdipxChannels('gid://shopify/Product/556')
    const publish = mutationInput(calls, 'PublishProduct')
    const unpublish = mutationInput(calls, 'UnpublishProduct')
    expect(publish).toContain('gid://shopify/Publication/180118913195')
    expect(unpublish).not.toContain('gid://shopify/Publication/180118913195')
  })

  it('leaves Shop untouched when the product price cannot be read', async () => {
    const calls = stubFetch(null)
    await publishProductToXdipxChannels('gid://shopify/Product/557')
    const publish = mutationInput(calls, 'PublishProduct')
    expect(publish).toContain('gid://shopify/Publication/180118913195')
  })
})
