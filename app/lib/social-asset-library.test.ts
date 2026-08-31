// Social image library ingest + membership (Social Studio v2 Phase 2, #4937).
// Every seam is injected: no Sanity, no database.
import { describe, it, expect, vi } from 'vitest'
import {
  ingestSocialAsset,
  tryIngestSocialAsset,
  isLibraryMember,
  allMediaAreLibraryMembers,
  markPicked,
  tryMarkPickedByUrls,
  stripUrlQuery,
  aspectFromDimensions,
  type SocialAssetLibraryDeps,
  type SocialMediaAssetInsert,
  type SocialMediaAssetRow,
} from './social-asset-library.server'

const CDN = 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files'
const SANITY = { assetId: 'image-abc123-1080x1350-jpg', url: 'https://cdn.sanity.io/images/p/d/abc123-1080x1350.jpg' }

function fakeRow(row: SocialMediaAssetInsert, id = 7): SocialMediaAssetRow {
  return {
    id,
    sanityAssetId: row.sanityAssetId ?? null,
    url: row.url,
    width: row.width ?? null,
    height: row.height ?? null,
    aspect: row.aspect ?? null,
    mimeType: row.mimeType ?? null,
    bytes: row.bytes ?? null,
    source: row.source ?? 'generated',
    provider: row.provider ?? null,
    model: row.model ?? null,
    prompt: row.prompt ?? null,
    negativePrompt: row.negativePrompt ?? null,
    archetype: row.archetype ?? null,
    productHandle: row.productHandle ?? null,
    shopifyProductId: row.shopifyProductId ?? null,
    castSlugs: row.castSlugs ?? null,
    tags: row.tags ?? null,
    generationBatchId: row.generationBatchId ?? null,
    isPicked: row.isPicked ?? false,
    postId: row.postId ?? null,
    createdBy: row.createdBy ?? 'system',
    createdAt: new Date('2026-08-22T00:00:00Z'),
    updatedAt: null,
    archivedAt: null,
    archivedBy: null,
    purgedAt: null,
    shopifyFileId: row.shopifyFileId ?? null,
    visionVerdict: row.visionVerdict ?? null,
    visionVerdictAt: row.visionVerdictAt ?? null,
  }
}

function deps(over: Partial<SocialAssetLibraryDeps> = {}): SocialAssetLibraryDeps & { inserted: SocialMediaAssetInsert[] } {
  const inserted: SocialMediaAssetInsert[] = []
  return {
    inserted,
    uploadToSanity: vi.fn(async () => SANITY),
    insertAsset: vi.fn(async (row: SocialMediaAssetInsert) => { inserted.push(row); return fakeRow(row) }),
    findByUrl: vi.fn(async () => false),
    findIdsByUrls: vi.fn(async () => []),
    setPicked: vi.fn(async () => {}),
    fetchBuffer: vi.fn(async () => Buffer.from('fetched')),
    readDimensions: vi.fn(async () => ({ width: 1080, height: 1350 })),
    ...over,
  }
}

describe('ingestSocialAsset', () => {
  it('uploads to Sanity and writes a row with the provenance fields', async () => {
    const d = deps()
    const buffer = Buffer.from('jpegbytes')
    const row = await ingestSocialAsset({
      buffer,
      filename: 'social-rosales-cast-maya-20260822-1.jpg',
      contentType: 'image/jpeg',
      url: `${CDN}/social-rosales-cast-maya-20260822-1.jpg?v=1`,
      source: 'generated',
      provider: 'fal',
      model: 'fal/flux-kontext',
      prompt: 'Maya holding the product',
      archetype: 'cast',
      productHandle: 'rosales',
      castSlugs: ['maya'],
      generationBatchId: 'batch-1',
      createdBy: 'social-media-manager',
    }, d)

    expect(d.uploadToSanity).toHaveBeenCalledWith(buffer, 'social-rosales-cast-maya-20260822-1.jpg', 'image/jpeg')
    expect(d.inserted).toHaveLength(1)
    const w = d.inserted[0]!
    expect(w.sanityAssetId).toBe(SANITY.assetId)
    // The Shopify url is what the gate checks, so that is what the row indexes under.
    expect(w.url).toBe(`${CDN}/social-rosales-cast-maya-20260822-1.jpg?v=1`)
    expect(w.source).toBe('generated')
    expect(w.provider).toBe('fal')
    expect(w.model).toBe('fal/flux-kontext')
    expect(w.prompt).toBe('Maya holding the product')
    expect(w.archetype).toBe('cast')
    expect(w.productHandle).toBe('rosales')
    expect(w.castSlugs).toEqual(['maya'])
    expect(w.generationBatchId).toBe('batch-1')
    expect(w.isPicked).toBe(false)
    expect(w.createdBy).toBe('social-media-manager')
    expect(w.width).toBe(1080)
    expect(w.height).toBe(1350)
    expect(w.aspect).toBe('4:5')
    expect(w.mimeType).toBe('image/jpeg')
    expect(w.bytes).toBe(buffer.byteLength)
    expect(row.id).toBe(7)
  })

  it('indexes under the Sanity url when no rehost url is given, and fetches a sourceUrl', async () => {
    const d = deps()
    await ingestSocialAsset({ sourceUrl: 'https://example.com/a.png', filename: 'a.png', source: 'upload' }, d)
    expect(d.fetchBuffer).toHaveBeenCalledWith('https://example.com/a.png')
    expect(d.inserted[0]!.url).toBe(SANITY.url)
    expect(d.inserted[0]!.createdBy).toBe('system')
  })

  it('throws without a buffer or sourceUrl', async () => {
    await expect(ingestSocialAsset({ filename: 'x.jpg', source: 'upload' }, deps())).rejects.toThrow()
  })
})

describe('tryIngestSocialAsset', () => {
  it('swallows a Sanity throw and returns null', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({ uploadToSanity: vi.fn(async () => { throw new Error('Sanity down') }) })
    const out = await tryIngestSocialAsset({ buffer: Buffer.from('x'), filename: 'x.jpg', source: 'generated' }, d)
    expect(out).toBeNull()
    expect(d.insertAsset).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
    expect(String(err.mock.calls[0]?.[0])).toContain('[social-library]')
    err.mockRestore()
  })
})

describe('membership', () => {
  it('ignores query strings when looking a url up', async () => {
    const d = deps({ findByUrl: vi.fn(async (bare: string) => bare === `${CDN}/social-x-1.jpg`) })
    expect(await isLibraryMember(`${CDN}/social-x-1.jpg?v=1775408527`, d)).toBe(true)
    expect(d.findByUrl).toHaveBeenCalledWith(`${CDN}/social-x-1.jpg`)
    expect(await isLibraryMember(`${CDN}/other.jpg?v=1`, d)).toBe(false)
    expect(await isLibraryMember('', d)).toBe(false)
  })

  it('allMediaAreLibraryMembers fails closed on an empty list and needs every url', async () => {
    const d = deps({ findByUrl: vi.fn(async (bare: string) => bare.endsWith('/a.jpg')) })
    expect(await allMediaAreLibraryMembers([], d)).toBe(false)
    expect(await allMediaAreLibraryMembers(null, d)).toBe(false)
    expect(await allMediaAreLibraryMembers([`${CDN}/a.jpg?v=2`], d)).toBe(true)
    expect(await allMediaAreLibraryMembers([`${CDN}/a.jpg`, `${CDN}/b.jpg`], d)).toBe(false)
  })
})

describe('picking', () => {
  it('markPicked forwards ids and post id, and skips an empty list', async () => {
    const d = deps()
    await markPicked([], 3, d)
    expect(d.setPicked).not.toHaveBeenCalled()
    await markPicked([1, 2], 3, d)
    expect(d.setPicked).toHaveBeenCalledWith([1, 2], 3)
  })

  it('tryMarkPickedByUrls resolves ids by bare url and never throws', async () => {
    const d = deps({ findIdsByUrls: vi.fn(async () => [{ id: 9, url: `${CDN}/a.jpg` }]) })
    const ids = await tryMarkPickedByUrls([`${CDN}/a.jpg?v=1`], 42, d)
    expect(d.findIdsByUrls).toHaveBeenCalledWith([`${CDN}/a.jpg`])
    expect(ids).toEqual([9])
    expect(d.setPicked).toHaveBeenCalledWith([9], 42)

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = deps({ findIdsByUrls: vi.fn(async () => { throw new Error('db down') }) })
    expect(await tryMarkPickedByUrls([`${CDN}/a.jpg`], 42, bad)).toEqual([])
    err.mockRestore()
  })
})

describe('helpers', () => {
  it('stripUrlQuery and aspectFromDimensions', () => {
    expect(stripUrlQuery(`${CDN}/a.jpg?v=1#x`)).toBe(`${CDN}/a.jpg`)
    expect(aspectFromDimensions(1080, 1350)).toBe('4:5')
    expect(aspectFromDimensions(1920, 1080)).toBe('16:9')
    expect(aspectFromDimensions(0, 10)).toBeUndefined()
  })
})
