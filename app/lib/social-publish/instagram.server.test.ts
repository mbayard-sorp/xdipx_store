// Instagram carousel publishing (ticket #2026). Mocks the Graph API at the
// fetch layer: item containers -> parent CAROUSEL container -> media_publish.
// Container polls return FINISHED on the first tick (no sleep), so no timers.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { instagramPublisher } from './instagram.server'

interface Captured { path: string; params: Record<string, string> }

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Install a fake Graph API. `statusByContainer` overrides a container's poll
 * result (default FINISHED). Returns the captured POST calls for assertions.
 */
function installFakeGraph(statusByContainer: Record<string, string> = {}): Captured[] {
  vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
  vi.stubEnv('IG_BUSINESS_ACCOUNT_ID', 'ig-1')
  const calls: Captured[] = []
  let itemCounter = 0

  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'

    if (method === 'POST') {
      const params = Object.fromEntries(new URLSearchParams(String(init?.body)))
      calls.push({ path: url.pathname, params })
      if (url.pathname.endsWith('/media_publish')) return jsonResponse({ id: 'published-1' })
      if (params['is_carousel_item'] === 'true') return jsonResponse({ id: `item-${itemCounter++}` })
      if (params['media_type'] === 'CAROUSEL') return jsonResponse({ id: 'carousel-1' })
      return jsonResponse({ id: 'single-1' })
    }

    // GET status poll: /{version}/{containerId}
    const containerId = url.pathname.split('/').pop() ?? ''
    return jsonResponse({ status_code: statusByContainer[containerId] ?? 'FINISHED' })
  }))

  return calls
}

describe('instagramPublisher carousel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('assembles children in order and publishes one carousel post', async () => {
    const calls = installFakeGraph()
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'carousel', imageUrls: ['a.jpg', 'b.jpg', 'c.jpg'] },
      caption: 'three slides',
    })

    expect(result).toEqual({ ok: true, externalPostId: 'published-1' })

    const carouselCreate = calls.find(c => c.params['media_type'] === 'CAROUSEL')
    expect(carouselCreate?.params['children']).toBe('item-0,item-1,item-2')
    expect(carouselCreate?.params['caption']).toBe('three slides')

    // Item containers carry no caption; caption lives only on the parent.
    const items = calls.filter(c => c.params['is_carousel_item'] === 'true')
    expect(items).toHaveLength(3)
    expect(items.every(c => c.params['caption'] === undefined)).toBe(true)
  })

  it('fails the whole post terminally if any item container ERRORs', async () => {
    const calls = installFakeGraph({ 'item-1': 'ERROR' })
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'carousel', imageUrls: ['a.jpg', 'b.jpg', 'c.jpg'] },
      caption: 'oops',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('error')
      expect(result.detail).toMatch(/rejected the media/)
    }
    // Never assembled the parent carousel and never published.
    expect(calls.some(c => c.params['media_type'] === 'CAROUSEL')).toBe(false)
    expect(calls.some(c => c.path.endsWith('/media_publish'))).toBe(false)
  })

  it('rejects a carousel with fewer than two images before any API call', async () => {
    const calls = installFakeGraph()
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'carousel', imageUrls: ['only.jpg'] },
      caption: 'lonely',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toMatch(/needs 2-10 images/)
    expect(calls).toHaveLength(0)
  })

  it('leaves the single-image path unchanged', async () => {
    const calls = installFakeGraph()
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'one still',
    })
    expect(result).toEqual({ ok: true, externalPostId: 'published-1' })
    expect(calls.some(c => c.params['media_type'] === 'CAROUSEL')).toBe(false)
    const create = calls.find(c => c.path.endsWith('/media') && !c.path.endsWith('/media_publish'))
    expect(create?.params['image_url']).toBe('a.jpg')
  })

  it('returns not_configured without env keys', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', '')
    vi.stubEnv('IG_BUSINESS_ACCOUNT_ID', '')
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'carousel', imageUrls: ['a.jpg', 'b.jpg'] },
      caption: 'x',
    })
    expect(result).toEqual({ ok: false, reason: 'not_configured' })
  })
})

/**
 * Product tags (ticket #3744). Same fake-Graph convention, extended with the
 * available_catalog_product_search read and an optional refusal of tagged
 * container creation, so the degrade path is exercised end to end.
 */
function installFakeGraphWithCatalog(opts: {
  catalogMatches?: Array<{ product_id: number; name: string }>
  rejectTaggedContainers?: boolean
} = {}): Captured[] {
  vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
  vi.stubEnv('IG_BUSINESS_ACCOUNT_ID', 'ig-1')
  const calls: Captured[] = []
  let itemCounter = 0

  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'

    if (method === 'POST') {
      const params = Object.fromEntries(new URLSearchParams(String(init?.body)))
      calls.push({ path: url.pathname, params })
      if (params['product_tags'] && opts.rejectTaggedContainers) {
        return jsonResponse({ error: { message: 'Product tagging not enabled for this account', code: 10 } })
      }
      if (url.pathname.endsWith('/media_publish')) return jsonResponse({ id: 'published-1' })
      if (params['is_carousel_item'] === 'true') return jsonResponse({ id: `item-${itemCounter++}` })
      if (params['media_type'] === 'CAROUSEL') return jsonResponse({ id: 'carousel-1' })
      return jsonResponse({ id: 'single-1' })
    }

    if (url.pathname.endsWith('/available_catalog_product_search')) {
      calls.push({ path: url.pathname, params: Object.fromEntries(url.searchParams) })
      return jsonResponse({ data: opts.catalogMatches ?? [] })
    }

    return jsonResponse({ status_code: 'FINISHED' })
  }))

  return calls
}

describe('instagramPublisher product tags (ticket #3744)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('tags a Shops-approved product on a feed photo', async () => {
    const calls = installFakeGraphWithCatalog({
      catalogMatches: [{ product_id: 999, name: 'Lace Set' }],
    })
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'a still',
      productTagHandle: 'lace-set',
    })
    expect(result).toEqual({ ok: true, externalPostId: 'published-1' })

    // The search query is the handle with hyphens as spaces.
    const search = calls.find(c => c.path.endsWith('/available_catalog_product_search'))
    expect(search?.params['q']).toBe('lace set')

    const create = calls.find(c => c.params['image_url'] === 'a.jpg')
    expect(JSON.parse(create?.params['product_tags'] ?? '[]')).toEqual([
      { product_id: '999', x: 0.5, y: 0.9 },
    ])
  })

  it('degrades to an untagged publish when the tagged container is refused', async () => {
    const calls = installFakeGraphWithCatalog({
      catalogMatches: [{ product_id: 999, name: 'Lace Set' }],
      rejectTaggedContainers: true,
    })
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'a still',
      productTagHandle: 'lace-set',
    })
    // The post is the point: it publishes, and the note says why untagged.
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.externalPostId).toBe('published-1')
      expect(result.note).toMatch(/published untagged/i)
    }
    const creates = calls.filter(c => c.params['image_url'] === 'a.jpg')
    expect(creates).toHaveLength(2)
    expect(creates[0]?.params['product_tags']).toBeDefined()
    expect(creates[1]?.params['product_tags']).toBeUndefined()
  })

  it('publishes untagged with the reason when no approved catalog match exists', async () => {
    const calls = installFakeGraphWithCatalog({ catalogMatches: [] })
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'a still',
      productTagHandle: 'rejected-product',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.note).toMatch(/No Shops-approved catalog match/)
    expect(calls.some(c => c.params['product_tags'])).toBe(false)
  })

  it('rides the tag on the first carousel slide only', async () => {
    const calls = installFakeGraphWithCatalog({
      catalogMatches: [{ product_id: 42, name: 'Wand' }],
    })
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'carousel', imageUrls: ['a.jpg', 'b.jpg'] },
      caption: 'two slides',
      productTagHandle: 'wand',
    })
    expect(result).toEqual({ ok: true, externalPostId: 'published-1' })
    const items = calls.filter(c => c.params['is_carousel_item'] === 'true')
    expect(items).toHaveLength(2)
    expect(items[0]?.params['product_tags']).toBeDefined()
    expect(items[1]?.params['product_tags']).toBeUndefined()
    // The parent CAROUSEL container never carries the tag.
    const parent = calls.find(c => c.params['media_type'] === 'CAROUSEL')
    expect(parent?.params['product_tags']).toBeUndefined()
  })

  it('never searches the catalog without a product handle', async () => {
    const calls = installFakeGraphWithCatalog({
      catalogMatches: [{ product_id: 999, name: 'Lace Set' }],
    })
    await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'a still',
    })
    expect(calls.some(c => c.path.endsWith('/available_catalog_product_search'))).toBe(false)
  })
})

/**
 * Alt text (accessibility description) on the media container, migration 085 /
 * ticket #5042. It rides a single image container, or the first carousel-item
 * container only (mirrors the product tag's "first slide only" convention);
 * Reels have no alt_text field. Same fake-Graph convention.
 */
describe('instagramPublisher alt text (ticket #5042)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('sends alt_text on a single image container', async () => {
    const calls = installFakeGraph()
    const result = await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'a still',
      altText: 'A matte silicone wand resting on a linen bedspread in warm light.',
    })
    expect(result).toEqual({ ok: true, externalPostId: 'published-1' })
    const create = calls.find(c => c.params['image_url'] === 'a.jpg')
    expect(create?.params['alt_text']).toBe(
      'A matte silicone wand resting on a linen bedspread in warm light.',
    )
  })

  it('rides the alt_text on the first carousel slide only', async () => {
    const calls = installFakeGraph()
    await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'carousel', imageUrls: ['a.jpg', 'b.jpg'] },
      caption: 'two slides',
      altText: 'Two angles of the same wand.',
    })
    const items = calls.filter(c => c.params['is_carousel_item'] === 'true')
    expect(items).toHaveLength(2)
    expect(items[0]?.params['alt_text']).toBe('Two angles of the same wand.')
    expect(items[1]?.params['alt_text']).toBeUndefined()
  })

  it('omits alt_text when none is supplied (unchanged behavior)', async () => {
    const calls = installFakeGraph()
    await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'a still',
    })
    const create = calls.find(c => c.params['image_url'] === 'a.jpg')
    expect(create?.params['alt_text']).toBeUndefined()
  })

  it('does not attach alt_text to a Reels video container', async () => {
    const calls = installFakeGraph()
    await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'video', videoUrl: 'a.mp4' },
      caption: 'a reel',
      altText: 'Should not ride a Reels container.',
    })
    const create = calls.find(c => c.params['media_type'] === 'REELS')
    expect(create?.params['alt_text']).toBeUndefined()
  })

  it('truncates alt_text to the 1000-char Graph API ceiling', async () => {
    const calls = installFakeGraph()
    await instagramPublisher.publish({
      postId: 1,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'a still',
      altText: 'x'.repeat(1500),
    })
    const create = calls.find(c => c.params['image_url'] === 'a.jpg')
    expect(create?.params['alt_text']).toHaveLength(1000)
  })
})
