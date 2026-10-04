// renderAndUploadSocialCard (ticket #13368): the New-in carousel's packshot
// card and the typographic save-close plate. No AI model call, so no
// generate-and-retry loop and no `social-images` spend row -- just render,
// rehost, ingest, and record a vision-gate verdict, same ingest contract as
// every other generated social asset. `buildSocialCardFilename` and
// `tagIncompleteVisionVerdict` are left REAL (from `./social-media.server`,
// cheap, no heavy deps); only the renderer, the Shopify rehost, the library
// ingest, and the vision gate are mocked.
import { describe, it, expect, vi, afterEach } from 'vitest'

describe('renderAndUploadSocialCard', () => {
  afterEach(() => {
    vi.doUnmock('./og-card.server')
    vi.doUnmock('./shopify.server')
    vi.doUnmock('./social-asset-library.server')
    vi.doUnmock('./social-vision-gate.server')
    vi.restoreAllMocks()
    vi.resetModules()
  })

  function mockRenderDeps(opts: { verdictPass?: boolean } = {}) {
    const renderSocialCard = vi.fn(async () => Buffer.from([1, 2, 3]))
    vi.doMock('./og-card.server', () => ({ renderSocialCard }))
    const uploadMoodImageToShopifyFilesWithId = vi.fn(async (_buffer: Buffer, _filename: string) => ({
      url: 'https://cdn.shopify.com/files/social-card-stroker-20261004-2-ab12cd.jpg',
      fileId: 'gid://shopify/GenericFile/1',
    }))
    vi.doMock('./shopify.server', () => ({ uploadMoodImageToShopifyFilesWithId }))
    const tryIngestSocialAsset = vi.fn(async () => ({ id: 777 }))
    vi.doMock('./social-asset-library.server', () => ({ tryIngestSocialAsset }))
    const recordVisionVerdict = vi.fn(async () => {})
    const runVisionGate = vi.fn(async () => ({
      pass: opts.verdictPass ?? true,
      checks: null,
      notes: '',
      checkedAt: '2026-10-04T00:00:00.000Z',
      checkCompleted: true,
      legibleText: 'STROKER',
      skinMarks: '',
    }))
    vi.doMock('./social-vision-gate.server', () => ({ runVisionGate, recordVisionVerdict }))
    return { renderSocialCard, uploadMoodImageToShopifyFilesWithId, tryIngestSocialAsset, runVisionGate, recordVisionVerdict }
  }

  it('fetches the product image, renders, rehosts, ingests, and vision-gates a packshot card', async () => {
    const deps = mockRenderDeps()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9, 9, 9]), {
      status: 200, headers: { 'content-type': 'image/jpeg' },
    })))
    vi.resetModules()

    const { renderAndUploadSocialCard } = await import('./social-card.server')
    const result = await renderAndUploadSocialCard({
      op: 'packshot-card',
      handle: 'womanizer-next-sage',
      imageUrl: 'https://cdn.shopify.com/files/womanizer-next-sage.jpg',
      kicker: 'stroker',
      line: 'built around the thing that actually closes the gap.',
      slideIndex: 2,
      slideCount: 5,
      tone: 'coral',
    })

    expect(deps.renderSocialCard).toHaveBeenCalledWith(expect.objectContaining({
      line: 'built around the thing that actually closes the gap.',
      kicker: 'stroker',
      tone: 'coral',
      productImage: { data: Buffer.from([9, 9, 9]), contentType: 'image/jpeg' },
    }))
    expect(deps.uploadMoodImageToShopifyFilesWithId).toHaveBeenCalled()
    const [, filename] = deps.uploadMoodImageToShopifyFilesWithId.mock.calls[0]!
    expect(filename).toMatch(/^social-card-womanizer-next-sage-/)
    expect(deps.tryIngestSocialAsset).toHaveBeenCalledWith(expect.objectContaining({
      archetype: 'packshot-card',
      productHandle: 'womanizer-next-sage',
      source: 'generated',
    }))
    expect(deps.runVisionGate).toHaveBeenCalledWith(result.url)
    expect(deps.recordVisionVerdict).toHaveBeenCalledWith(777, expect.objectContaining({ pass: true }))
    expect(result).toEqual(expect.objectContaining({
      url: 'https://cdn.shopify.com/files/social-card-stroker-20261004-2-ab12cd.jpg',
      assetId: 777,
    }))
  })

  it('renders a plate op with no product image, and never fetches', async () => {
    const deps = mockRenderDeps()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()

    const { renderAndUploadSocialCard } = await import('./social-card.server')
    await renderAndUploadSocialCard({
      op: 'plate',
      line: 'save this for the next time someone says women are harder to please.',
      slideIndex: 6,
      slideCount: 6,
      tone: 'plum',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(deps.renderSocialCard).toHaveBeenCalledWith(expect.not.objectContaining({ productImage: expect.anything() }))
  })

  it('throws when packshot-card is called with no imageUrl', async () => {
    mockRenderDeps()
    vi.resetModules()
    const { renderAndUploadSocialCard } = await import('./social-card.server')
    await expect(renderAndUploadSocialCard({
      op: 'packshot-card', handle: 'pom', line: 'x', slideIndex: 1, slideCount: 1,
    })).rejects.toThrow(/imageUrl/)
  })

  it('still records a failing vision-gate verdict rather than throwing', async () => {
    const deps = mockRenderDeps({ verdictPass: false })
    vi.resetModules()
    const { renderAndUploadSocialCard } = await import('./social-card.server')
    const result = await renderAndUploadSocialCard({
      op: 'plate', line: 'x', slideIndex: 1, slideCount: 1,
    })
    expect(result.visionVerdict?.pass).toBe(false)
    expect(deps.recordVisionVerdict).toHaveBeenCalledWith(777, expect.objectContaining({ pass: false }))
  })

  it('builds the real social-card-* filename via the un-mocked buildSocialCardFilename', async () => {
    const deps = mockRenderDeps()
    vi.resetModules()
    const { renderAndUploadSocialCard } = await import('./social-card.server')
    const { isGeneratedSocialAsset, isRenderedCardAsset } = await import('./social-media.server')

    await renderAndUploadSocialCard({ op: 'plate', line: 'x', slideIndex: 1, slideCount: 1 })

    const [, filename] = deps.uploadMoodImageToShopifyFilesWithId.mock.calls[0]!
    expect(filename as string).toMatch(/^social-card-plate-\d{8}-1-[0-9a-f]{6}\.jpg$/)
    expect(isGeneratedSocialAsset(filename as string)).toBe(true)
    expect(isRenderedCardAsset(filename as string)).toBe(true)
  })
})
