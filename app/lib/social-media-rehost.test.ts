// rehostSocialImage (ticket #13370): lets the social lane reuse a Notebook
// post's own hero image as its Instagram/X echo post image instead of
// generating a fresh frame. Same rehost + ingest + vision-gate contract as
// `renderAndUploadSocialCard` (see social-card.server.test.ts); `sharp` is
// left REAL (native, no network) so the crop-to-aspect behavior is exercised
// against an actual decodable image, and only the Shopify rehost, the
// library ingest, and the vision gate are mocked.
import { describe, it, expect, vi, afterEach } from 'vitest'
import sharp from 'sharp'

describe('rehostSocialImage', () => {
  afterEach(() => {
    vi.doUnmock('./shopify.server')
    vi.doUnmock('./social-asset-library.server')
    vi.doUnmock('./social-vision-gate.server')
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function tinyJpeg(width = 100, height = 60): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } } })
      .jpeg()
      .toBuffer()
  }

  function mockRehostDeps(opts: { verdictPass?: boolean } = {}) {
    const uploadMoodImageToShopifyFilesWithId = vi.fn(async (_buffer: Buffer, filename: string) => ({
      url: `https://cdn.shopify.com/files/${filename}`,
      fileId: 'gid://shopify/GenericFile/1',
    }))
    vi.doMock('./shopify.server', () => ({ uploadMoodImageToShopifyFilesWithId }))
    const tryIngestSocialAsset = vi.fn(async () => ({ id: 888 }))
    vi.doMock('./social-asset-library.server', () => ({ tryIngestSocialAsset }))
    const recordVisionVerdict = vi.fn(async () => {})
    const runVisionGate = vi.fn(async () => ({
      pass: opts.verdictPass ?? true,
      checks: null,
      notes: '',
      checkedAt: '2026-10-06T00:00:00.000Z',
      checkCompleted: true,
      legibleText: '',
      skinMarks: '',
    }))
    vi.doMock('./social-vision-gate.server', () => ({ runVisionGate, recordVisionVerdict }))
    return { uploadMoodImageToShopifyFilesWithId, tryIngestSocialAsset, runVisionGate, recordVisionVerdict }
  }

  it('fetches a cdn.sanity.io hero, rehosts, ingests with provenance tags, and vision-gates it', async () => {
    const deps = mockRehostDeps()
    const source = await tinyJpeg()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('https://cdn.sanity.io/images/proj/ds/hero.jpg')
      return new Response(new Uint8Array(source), { status: 200 })
    }))
    vi.resetModules()

    const { rehostSocialImage } = await import('./social-media.server')
    const result = await rehostSocialImage({
      sourceUrl: 'https://cdn.sanity.io/images/proj/ds/hero.jpg',
      slug: 'why-lube-matters',
    })

    expect(deps.uploadMoodImageToShopifyFilesWithId).toHaveBeenCalled()
    const [, filename] = deps.uploadMoodImageToShopifyFilesWithId.mock.calls[0]!
    expect(filename).toMatch(/^social-notebook-why-lube-matters-\d{8}\.jpg$/)
    expect(deps.tryIngestSocialAsset).toHaveBeenCalledWith(expect.objectContaining({
      archetype: 'notebook-echo',
      source: 'upload',
      tags: ['source:notebook-hero', 'blog-slug:why-lube-matters'],
    }))
    expect(deps.runVisionGate).toHaveBeenCalledWith(result.url)
    expect(deps.recordVisionVerdict).toHaveBeenCalledWith(888, expect.objectContaining({ pass: true }))
    expect(result).toEqual(expect.objectContaining({ assetId: 888 }))
    expect(result.url).toBe(`https://cdn.shopify.com/files/${filename}`)
  })

  it('accepts a cdn.shopify.com sourceUrl too', async () => {
    mockRehostDeps()
    const source = await tinyJpeg()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(source), { status: 200 })))
    vi.resetModules()

    const { rehostSocialImage } = await import('./social-media.server')
    await expect(rehostSocialImage({
      sourceUrl: 'https://cdn.shopify.com/s/files/1/0/0/files/already-hosted.jpg',
      slug: 'a-post',
    })).resolves.toEqual(expect.objectContaining({ assetId: 888 }))
  })

  it('refuses a sourceUrl on a host outside the allowlist, without fetching', async () => {
    mockRehostDeps()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()

    const { rehostSocialImage } = await import('./social-media.server')
    await expect(rehostSocialImage({
      sourceUrl: 'https://evil.example.com/hero.jpg',
      slug: 'a-post',
    })).rejects.toThrow(/not on the allowlist/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('crops to the requested aspect', async () => {
    mockRehostDeps()
    // A wide 4:3 source, cover-cropped down to 4:5 (portrait) and 16:9 (landscape).
    const source = await tinyJpeg(800, 600)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(source), { status: 200 })))
    vi.resetModules()

    const { rehostSocialImage } = await import('./social-media.server')
    const result = await rehostSocialImage({
      sourceUrl: 'https://cdn.sanity.io/images/proj/ds/hero.jpg',
      slug: 'a-post',
      aspect: '4:5',
    })
    expect(result.url).toMatch(/-4x5-\d{8}\.jpg$/)
  })

  it('names the aspect-less filename when no aspect is requested', async () => {
    mockRehostDeps()
    const source = await tinyJpeg()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(source), { status: 200 })))
    vi.resetModules()

    const { rehostSocialImage } = await import('./social-media.server')
    const result = await rehostSocialImage({
      sourceUrl: 'https://cdn.sanity.io/images/proj/ds/hero.jpg',
      slug: 'a-post',
    })
    expect(result.url).not.toMatch(/-4x5-|-16x9-/)
  })

  it('throws a clear error on a non-2xx fetch rather than ingesting garbage', async () => {
    mockRehostDeps()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    vi.resetModules()

    const { rehostSocialImage } = await import('./social-media.server')
    await expect(rehostSocialImage({
      sourceUrl: 'https://cdn.sanity.io/images/proj/ds/missing.jpg',
      slug: 'a-post',
    })).rejects.toThrow(/fetch sourceUrl failed.*404/)
  })

  it('still records a failing vision-gate verdict rather than throwing', async () => {
    const deps = mockRehostDeps({ verdictPass: false })
    const source = await tinyJpeg()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(source), { status: 200 })))
    vi.resetModules()

    const { rehostSocialImage } = await import('./social-media.server')
    const result = await rehostSocialImage({
      sourceUrl: 'https://cdn.sanity.io/images/proj/ds/hero.jpg',
      slug: 'a-post',
    })
    expect(result.visionVerdict.pass).toBe(false)
    expect(deps.recordVisionVerdict).toHaveBeenCalledWith(888, expect.objectContaining({ pass: false }))
  })

  it('the resulting filename satisfies isGeneratedSocialAsset directly (legacy prefix)', async () => {
    mockRehostDeps()
    const source = await tinyJpeg()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(source), { status: 200 })))
    vi.resetModules()

    const { rehostSocialImage, isGeneratedSocialAsset } = await import('./social-media.server')
    const result = await rehostSocialImage({
      sourceUrl: 'https://cdn.sanity.io/images/proj/ds/hero.jpg',
      slug: 'a-post',
    })
    expect(isGeneratedSocialAsset(result.url)).toBe(true)
  })
})
