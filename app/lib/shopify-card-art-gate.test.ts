// Card-art doctrine gate (ticket #9675, design-critic run 905 P1: supplier
// packshots rendering as rail/grid card art breached design-doctrine.md
// §4.3's on-site imagery ceiling). xdipx.card_art_blocked must suppress a
// product's default image from every card-shaped conversion path, falling
// back to xdipx.mood_image_url when present and to no image otherwise.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _ttl: number, fn: () => unknown) => fn(),
  invalidateCache: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {},
}))

const mf = (entries: Record<string, string>) =>
  Object.entries(entries).map(([key, value]) => ({ namespace: 'xdipx', key, value }))

describe('nodeToVaultDeal card-art gate', () => {
  it('suppresses images entirely when blocked with no mood image', async () => {
    const { nodeToVaultDeal } = await import('~/lib/shopify.server')
    const deal = nodeToVaultDeal({
      id: 'gid://shopify/Product/1',
      handle: 'flagged-product',
      title: 'Flagged Product',
      vendor: 'test',
      tags: [],
      images: { edges: [{ node: { url: 'https://cdn.shopify.com/packshot.jpg', altText: null } }] },
      variants: { edges: [{ node: { id: 'gid://v1', price: { amount: '10.00' }, compareAtPrice: null, quantityAvailable: 5, availableForSale: true } }] },
      metafields: mf({ card_art_blocked: 'true' }),
    })
    expect(deal.images).toEqual([])
  })

  it('falls back to the reviewed mood image when blocked and one is set', async () => {
    const { nodeToVaultDeal } = await import('~/lib/shopify.server')
    const deal = nodeToVaultDeal({
      id: 'gid://shopify/Product/2',
      handle: 'flagged-with-mood',
      title: 'Flagged With Mood',
      vendor: 'test',
      tags: [],
      images: { edges: [{ node: { url: 'https://cdn.shopify.com/packshot.jpg', altText: null } }] },
      variants: { edges: [{ node: { id: 'gid://v2', price: { amount: '10.00' }, compareAtPrice: null, quantityAvailable: 5, availableForSale: true } }] },
      metafields: mf({ card_art_blocked: 'true', mood_image_url: 'https://cdn.shopify.com/mood.jpg' }),
    })
    expect(deal.images).toEqual([{ url: 'https://cdn.shopify.com/mood.jpg', altText: '' }])
  })

  it('passes images through unchanged when not blocked', async () => {
    const { nodeToVaultDeal } = await import('~/lib/shopify.server')
    const deal = nodeToVaultDeal({
      id: 'gid://shopify/Product/3',
      handle: 'clean-product',
      title: 'Clean Product',
      vendor: 'test',
      tags: [],
      images: { edges: [{ node: { url: 'https://cdn.shopify.com/packshot.jpg', altText: 'front' } }] },
      variants: { edges: [{ node: { id: 'gid://v3', price: { amount: '10.00' }, compareAtPrice: null, quantityAvailable: 5, availableForSale: true } }] },
      metafields: mf({}),
    })
    expect(deal.images).toEqual([{ url: 'https://cdn.shopify.com/packshot.jpg', altText: 'front' }])
  })
})

function stubStorefront(nodes: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: { nodes } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const productNode = (handle: string, metafields: { namespace: string; key: string; value: string }[]) => ({
  __typename: 'Product',
  id: `gid://shopify/Product/${handle}`,
  handle,
  title: handle,
  description: '',
  descriptionHtml: '',
  vendor: 'test',
  productType: '',
  tags: [],
  images: { edges: [{ node: { url: 'https://cdn.shopify.com/packshot.jpg', altText: null } }] },
  variants: { edges: [] },
  priceRange: { minVariantPrice: { amount: '1.00', currencyCode: 'USD' } },
  metafields,
})

describe('nodeToProduct card-art gate (via getProductsByIds)', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('suppresses the default image on the list/rail Product shape when blocked', async () => {
    stubStorefront([productNode('flagged', mf({ card_art_blocked: 'true' }))])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://flagged'])
    expect(product?.images).toEqual([])
  })

  it('leaves the default image alone when not blocked', async () => {
    stubStorefront([productNode('clean', mf({}))])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://clean'])
    expect(product?.images).toEqual([{ url: 'https://cdn.shopify.com/packshot.jpg', altText: '' }])
  })
})

// Ticket #14190 — the class-level follow-on to #12611/#9675: card art must
// not default to whichever frame Shopify lists first. `Product.cardImage` is
// computed once at the same conversion point as the gate above.
const productNodeWithImages = (
  handle: string,
  images: { url: string; altText: string | null }[],
  metafields: { namespace: string; key: string; value: string }[] = [],
) => ({
  __typename: 'Product',
  id: `gid://shopify/Product/${handle}`,
  handle,
  title: handle,
  description: '',
  descriptionHtml: '',
  vendor: 'test',
  productType: '',
  tags: [],
  images: { edges: images.map(node => ({ node })) },
  variants: { edges: [] },
  priceRange: { minVariantPrice: { amount: '1.00', currencyCode: 'USD' } },
  metafields,
})

describe('nodeToProduct cardImage — bare-frame pick (ticket #14190)', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('a carton-first media list resolves cardImage to the bare sibling frame, not the carton', async () => {
    // Mirrors the Magic Wand Original evidence from the ticket: 53906A is the
    // retail carton ("LEGENDARY PLUG-IN POWER" printed on the box), 53906B is
    // the bare wand. `images[0]` stays the carton (never reordered); only
    // `cardImage` picks the bare sibling.
    stubStorefront([
      productNodeWithImages('magic-wand-original', [
        { url: 'https://cdn.shopify.com/53906A.jpg', altText: null },
        { url: 'https://cdn.shopify.com/53906B.jpg', altText: null },
      ]),
    ])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://magic-wand-original'])
    expect(product?.images[0]?.url).toBe('https://cdn.shopify.com/53906A.jpg')
    expect(product?.cardImage).toEqual({
      url: 'https://cdn.shopify.com/53906B.jpg',
      altText: '',
      fellBack: false,
    })
  })

  it('an explicit packaging filename/alt is excluded even when it is the only frame carrying no doubt', async () => {
    stubStorefront([
      productNodeWithImages('boxed-and-bare', [
        { url: 'https://cdn.shopify.com/retail-carton.jpg', altText: 'retail box' },
        { url: 'https://cdn.shopify.com/product-shot.jpg', altText: 'on white' },
      ]),
    ])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://boxed-and-bare'])
    expect(product?.cardImage).toEqual({
      url: 'https://cdn.shopify.com/product-shot.jpg',
      altText: 'on white',
      fellBack: false,
    })
  })

  it('a single-image product with a plain filename and no altText still gets a usable cardImage (nothing doubts it, so it is confirmed)', async () => {
    // Unlike `resolveBareProductReference` (deliberately more conservative),
    // `pickBareProductImage` has no special "sole entry" rule — a plain
    // filename with no packaging/Nalpac-doubt signal is simply unopposed.
    stubStorefront([
      productNodeWithImages('single-image-product', [
        { url: 'https://cdn.shopify.com/92310.jpg', altText: null },
      ]),
    ])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://single-image-product'])
    expect(product?.cardImage).toEqual({
      url: 'https://cdn.shopify.com/92310.jpg',
      altText: '',
      fellBack: false,
    })
  })

  it('a single UNLABELED Nalpac-style first frame ("<sku>A.jpg", no altText) is also an unconfirmed fallback', async () => {
    stubStorefront([
      productNodeWithImages('single-unlabeled-first-frame', [
        { url: 'https://cdn.shopify.com/53906A.jpg', altText: null },
      ]),
    ])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://single-unlabeled-first-frame'])
    expect(product?.cardImage).toEqual({
      url: 'https://cdn.shopify.com/53906A.jpg',
      altText: '',
      fellBack: true,
    })
  })

  it('card_art_blocked wins over the bare-frame pick: cardImage falls back to the reviewed mood image', async () => {
    stubStorefront([
      productNodeWithImages(
        'blocked-with-mood',
        [
          { url: 'https://cdn.shopify.com/53906A.jpg', altText: null },
          { url: 'https://cdn.shopify.com/53906B.jpg', altText: null },
        ],
        mf({ card_art_blocked: 'true', mood_image_url: 'https://cdn.shopify.com/mood.jpg' }),
      ),
    ])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://blocked-with-mood'])
    expect(product?.cardImage).toEqual({
      url: 'https://cdn.shopify.com/mood.jpg',
      altText: '',
      fellBack: true,
    })
  })

  it('card_art_blocked with no mood image leaves cardImage absent, same as images', async () => {
    stubStorefront([
      productNodeWithImages(
        'blocked-no-mood',
        [{ url: 'https://cdn.shopify.com/53906A.jpg', altText: null }],
        mf({ card_art_blocked: 'true' }),
      ),
    ])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://blocked-no-mood'])
    expect(product?.images).toEqual([])
    expect(product?.cardImage).toBeUndefined()
  })
})
