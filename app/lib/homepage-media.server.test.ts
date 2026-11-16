// Regression coverage for the homepage image path's vision gate (ticket #10483).
// Incident: .claude/agents/homepage-art-director.md claimed media-manager
// "scores every generated image against the doctrine section 4 checklist
// before upload", but app/lib/homepage-media.server.ts generated and uploaded
// with nothing in between — no anatomy check, no imagery-ceiling check, on
// any owned-surface caller. These tests exercise the gate now wired between
// generate and upload.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VisionVerdict } from './social-vision-gate.server'

const generateImage = vi.fn()
vi.mock('~/lib/generate-image.server', () => ({
  generateImage: (...args: unknown[]) => generateImage(...args),
}))

const uploadBufferToSanity = vi.fn()
const sanityImageRef = vi.fn((assetId: string, alt: string) => ({ _type: 'image', asset: { _ref: assetId }, alt }))
const updateCmsBlock = vi.fn()
const updateCmsTileImage = vi.fn()
const updateCmsPromoImage = vi.fn()
vi.mock('~/lib/sanity.server', () => ({
  uploadBufferToSanity: (...args: unknown[]) => uploadBufferToSanity(...args),
  sanityImageRef: (...args: [string, string]) => sanityImageRef(...args),
  updateCmsBlock: (...args: unknown[]) => updateCmsBlock(...args),
  updateCmsTileImage: (...args: unknown[]) => updateCmsTileImage(...args),
  updateCmsPromoImage: (...args: unknown[]) => updateCmsPromoImage(...args),
}))

const gateImageBuffer = vi.fn()
vi.mock('~/lib/vision-gate-buffer.server', () => ({
  gateImageBuffer: (...args: unknown[]) => gateImageBuffer(...args),
}))

const PASS_VERDICT: VisionVerdict = {
  pass: true,
  checks: {
    limbCount: 'pass', handAnatomy: 'pass', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass', genitaliaAbsent: 'pass', anusNotVisible: 'pass', adultUnambiguous: 'pass',
  },
  notes: 'clean',
  checkedAt: '2026-09-20T00:00:00.000Z',
  checkCompleted: true,
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
  frontWaistbandRead: '',
}

const FAIL_VERDICT: VisionVerdict = {
  ...PASS_VERDICT,
  pass: false,
  checks: { ...PASS_VERDICT.checks!, nippleOccluded: 'fail' },
  notes: 'nipple visible',
}

const TARGET = { kind: 'blockImage' as const, blockKey: 'hero' }

describe('generateAndPlaceHomepageImage vision gate (ticket #10483)', () => {
  afterEach(() => vi.clearAllMocks())

  it('uploads and places a candidate that passes the gate on the first attempt', async () => {
    generateImage.mockResolvedValue({ buffers: [Buffer.from('img1')], provider: 'fal', model: 'fal/flux-dev' })
    gateImageBuffer.mockResolvedValue(PASS_VERDICT)
    uploadBufferToSanity.mockResolvedValue({ assetId: 'asset-1', url: 'https://cdn.sanity.io/asset-1.png' })

    const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
    const manifest = await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

    expect(manifest.placed).toBe(true)
    expect(manifest.assetId).toBe('asset-1')
    expect(gateImageBuffer).toHaveBeenCalledTimes(1)
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(uploadBufferToSanity).toHaveBeenCalledTimes(1)
  })

  it('regenerates once on a failing verdict and places the second, passing candidate', async () => {
    generateImage
      .mockResolvedValueOnce({ buffers: [Buffer.from('bad')], provider: 'fal', model: 'fal/flux-dev' })
      .mockResolvedValueOnce({ buffers: [Buffer.from('good')], provider: 'fal', model: 'fal/flux-dev' })
    gateImageBuffer
      .mockResolvedValueOnce(FAIL_VERDICT)
      .mockResolvedValueOnce(PASS_VERDICT)
    uploadBufferToSanity.mockResolvedValue({ assetId: 'asset-2', url: 'https://cdn.sanity.io/asset-2.png' })

    const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
    const manifest = await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

    expect(manifest.placed).toBe(true)
    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(gateImageBuffer).toHaveBeenCalledTimes(2)
    // Uploads the SECOND (passing) buffer, never the rejected first one.
    expect(uploadBufferToSanity).toHaveBeenCalledWith(Buffer.from('good'), expect.any(String), 'image/png')
  })

  it('never uploads when every candidate fails the gate within budget, but still carries a real provider so spend still posts (#887)', async () => {
    generateImage.mockResolvedValue({ buffers: [Buffer.from('bad')], provider: 'fal', model: 'fal/flux-dev' })
    gateImageBuffer.mockResolvedValue(FAIL_VERDICT)

    const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
    const manifest = await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

    expect(manifest.placed).toBe(false)
    expect(manifest.provider).toBe('fal')
    expect(manifest.reason).toContain('vision gate rejected every candidate')
    expect(generateImage).toHaveBeenCalledTimes(2) // budget: 2 attempts
    expect(gateImageBuffer).toHaveBeenCalledTimes(2)
    expect(uploadBufferToSanity).not.toHaveBeenCalled()
  })

  it('returns placed:false with provider "none" when generation itself comes back empty, without calling the gate', async () => {
    generateImage.mockResolvedValue({ buffers: [], provider: 'none', model: 'none' })

    const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
    const manifest = await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

    expect(manifest.placed).toBe(false)
    expect(manifest.provider).toBe('none')
    expect(gateImageBuffer).not.toHaveBeenCalled()
  })

  it('reports a reason and keeps provider real when upload fails after a billed, gate-passed generation', async () => {
    generateImage.mockResolvedValue({ buffers: [Buffer.from('good')], provider: 'fal', model: 'fal/flux-dev' })
    gateImageBuffer.mockResolvedValue(PASS_VERDICT)
    uploadBufferToSanity.mockRejectedValue(new Error('sanity upload 500'))

    const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
    const manifest = await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

    expect(manifest.placed).toBe(false)
    expect(manifest.provider).toBe('fal')
    expect(manifest.reason).toContain('sanity upload 500')
  })

  // Ticket #11856: the vision gate route hardcoded gate('content', runId) for
  // every caller, so a homepage candidate was judged against the unrelated
  // content team's run_in_progress lock. gateImageBuffer must be called with
  // the homepage team's own runId and 'homepage' so the remote fallback gates
  // on the right team.
  it('passes opts.runId and team "homepage" through to gateImageBuffer', async () => {
    generateImage.mockResolvedValue({ buffers: [Buffer.from('img1')], provider: 'fal', model: 'fal/flux-dev' })
    gateImageBuffer.mockResolvedValue(PASS_VERDICT)
    uploadBufferToSanity.mockResolvedValue({ assetId: 'asset-1', url: 'https://cdn.sanity.io/asset-1.png' })

    const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
    await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET, runId: 1099 })

    // ticket #20866: gateImageBuffer's new 5th arg is the real call-site
    // label forwarded to api_token_log.caller.
    expect(gateImageBuffer).toHaveBeenCalledWith(expect.any(Buffer), undefined, 1099, 'homepage', 'homepage-media')
  })

  it('still gates with team "homepage" when no runId is given', async () => {
    generateImage.mockResolvedValue({ buffers: [Buffer.from('img1')], provider: 'fal', model: 'fal/flux-dev' })
    gateImageBuffer.mockResolvedValue(PASS_VERDICT)
    uploadBufferToSanity.mockResolvedValue({ assetId: 'asset-1', url: 'https://cdn.sanity.io/asset-1.png' })

    const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
    await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

    expect(gateImageBuffer).toHaveBeenCalledWith(expect.any(Buffer), undefined, undefined, 'homepage', 'homepage-media')
  })

  // Ticket #22339: design-critic runs 1837/1967 both found the live Body
  // wayfinder door carrying invented baked-in label text including the word
  // "SEX" at display scale. The anatomy verdict alone (`verdict.pass`) never
  // looked at `legibleText`, so a door image passing every anatomy check
  // with a banned word baked into it sailed straight through to Sanity.
  describe('legible-baked-in-text check (ticket #22339)', () => {
    it('never uploads a candidate whose anatomy-clean verdict carries a charter-banned branding word', async () => {
      generateImage.mockResolvedValue({ buffers: [Buffer.from('bad')], provider: 'fal', model: 'fal/flux-dev' })
      gateImageBuffer.mockResolvedValue({ ...PASS_VERDICT, legibleText: 'SEX' })

      const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
      const manifest = await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

      expect(manifest.placed).toBe(false)
      expect(manifest.provider).toBe('fal')
      expect(manifest.reason).toContain('charter-banned branding word')
      expect(uploadBufferToSanity).not.toHaveBeenCalled()
    })

    it('never uploads a candidate whose anatomy-clean verdict reads as baked-in junk text', async () => {
      generateImage.mockResolvedValue({ buffers: [Buffer.from('bad')], provider: 'fal', model: 'fal/flux-dev' })
      gateImageBuffer.mockResolvedValue({ ...PASS_VERDICT, legibleText: 'Find your way in, today only, tap to shop.' })

      const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
      const manifest = await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

      expect(manifest.placed).toBe(false)
      expect(manifest.reason).toContain('text baked into the image')
      expect(uploadBufferToSanity).not.toHaveBeenCalled()
    })

    it('regenerates past a text-blocked first candidate and places a clean second one', async () => {
      generateImage
        .mockResolvedValueOnce({ buffers: [Buffer.from('bad')], provider: 'fal', model: 'fal/flux-dev' })
        .mockResolvedValueOnce({ buffers: [Buffer.from('good')], provider: 'fal', model: 'fal/flux-dev' })
      gateImageBuffer
        .mockResolvedValueOnce({ ...PASS_VERDICT, legibleText: 'SEXY' })
        .mockResolvedValueOnce(PASS_VERDICT)
      uploadBufferToSanity.mockResolvedValue({ assetId: 'asset-3', url: 'https://cdn.sanity.io/asset-3.png' })

      const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
      const manifest = await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

      expect(manifest.placed).toBe(true)
      expect(uploadBufferToSanity).toHaveBeenCalledWith(Buffer.from('good'), expect.any(String), 'image/png')
    })

    it('still places a candidate carrying an allowed short product wordmark', async () => {
      generateImage.mockResolvedValue({ buffers: [Buffer.from('img1')], provider: 'fal', model: 'fal/flux-dev' })
      gateImageBuffer.mockResolvedValue({ ...PASS_VERDICT, legibleText: 'Womanizer' })
      uploadBufferToSanity.mockResolvedValue({ assetId: 'asset-1', url: 'https://cdn.sanity.io/asset-1.png' })

      const { generateAndPlaceHomepageImage } = await import('./homepage-media.server')
      const manifest = await generateAndPlaceHomepageImage({ prompt: 'p', alt: 'a', target: TARGET })

      expect(manifest.placed).toBe(true)
      expect(uploadBufferToSanity).toHaveBeenCalled()
    })
  })
})
