// Owner direction 2026-08-22: an admin-callable path to regenerate a social
// image or redraft a caption from owner feedback, instead of waiting for the
// next daily routine run. These tests cover the pure parts (prompt assembly,
// stamp format) plus the retry/gate wiring of reworkCaption and
// ownerApprovePost, with the generator, Claude, and Shopify calls mocked.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))
const generateAndUploadSocialImageMock = vi.hoisted(() => vi.fn())
const generateWithSystemMock = vi.hoisted(() => vi.fn())
const getProductsByIdsMock = vi.hoisted(() => vi.fn())
const getProductHandleByIdMock = vi.hoisted(() => vi.fn())
const runDeterministicPublishChecksMock = vi.hoisted(() => vi.fn())
const recentCaptionsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]))

vi.mock('./db.server', () => ({ db: dbMock }))
vi.mock('./social-media.server', () => ({
  generateAndUploadSocialImage: generateAndUploadSocialImageMock,
}))
vi.mock('./claude.server', () => ({ generateWithSystem: generateWithSystemMock }))
vi.mock('./shopify.server', () => ({
  getProductsByIds: getProductsByIdsMock,
  getProductHandleById: getProductHandleByIdMock,
}))
vi.mock('./social-publish-gate.server', async () => {
  const actual = await vi.importActual<typeof import('./social-publish-gate.server')>('./social-publish-gate.server')
  return { ...actual, runDeterministicPublishChecks: runDeterministicPublishChecksMock }
})
vi.mock('./social-publish-approve.server', async () => {
  const actual = await vi.importActual<typeof import('./social-publish-approve.server')>('./social-publish-approve.server')
  return {
    ...actual,
    dbApproveRepo: { ...actual.dbApproveRepo, recentCaptions: recentCaptionsMock },
  }
})

import {
  buildImageRegenPrompt,
  buildCaptionReworkSystemPrompt,
  buildCaptionReworkUserContent,
  buildOwnerApprovalStamp,
  parseCaptionReworkJson,
  regenerateSocialImage,
  reworkCaption,
  createOwnerReworkRow,
  ownerApprovePost,
} from './social-admin-rework.server'
import { decideManualPublish } from './social-publish/manual-publish-gate.server'
import { parseGateStamp } from './social-publish-approve.server'

const BASE_ROW = {
  id: 61,
  platform: 'instagram',
  postType: 'manual',
  tweetText: 'ok, a detail about silicone nobody mentions',
  editedText: null as string | null,
  mediaUrls: ['https://cdn.shopify.com/s/files/1/social-rosales-1.jpg'],
  altText: null as string | null,
  imageBrief: null as string | null,
  subject: null as string | null,
  shopifyProductId: null as string | null,
  feedback: null as string | null,
}

function selectReturning(row: unknown) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => (row ? [row] : []),
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  recentCaptionsMock.mockResolvedValue([])
})

// ── Pure: prompt assembly ────────────────────────────────────────────────────

describe('buildImageRegenPrompt', () => {
  it('prefers imageBrief, appends product title, feedback, and standing rules', () => {
    const p = buildImageRegenPrompt({
      imageBrief: 'jade at a sunlit bathroom sink, sleeves pushed up',
      subject: 'ignored subject',
      captionFirstLine: 'ignored caption',
      productTitle: 'The Rosales Wand',
      feedback: 'less clinical, warmer light',
    })
    expect(p).toContain('jade at a sunlit bathroom sink')
    expect(p).toContain('Featuring the real product: The Rosales Wand.')
    expect(p).toContain('Owner feedback (binding instruction): less clinical, warmer light')
    expect(p).toContain('No text anywhere in the image.')
  })

  it('falls back to subject, then caption first line, when imageBrief is absent', () => {
    const p1 = buildImageRegenPrompt({ subject: 'a quiet nightstand moment', feedback: 'x' })
    expect(p1).toContain('a quiet nightstand moment')

    const p2 = buildImageRegenPrompt({ captionFirstLine: 'ok, a detail nobody mentions', feedback: 'x' })
    expect(p2).toContain('ok, a detail nobody mentions')
  })

  it('never drops the feedback or the standing rules even with nothing else set', () => {
    const p = buildImageRegenPrompt({ feedback: 'make it warmer' })
    expect(p).toContain('a warm, editorial scene for the post')
    expect(p).toContain('make it warmer')
    expect(p).toContain('Skin is licensed; nudity never.')
  })
})

describe('buildCaptionReworkSystemPrompt / buildCaptionReworkUserContent', () => {
  it('includes the vocabulary fence, no-sale rule, and the binding-feedback clause', () => {
    const s = buildCaptionReworkSystemPrompt()
    expect(s).toMatch(/vocabulary fence/i)
    expect(s).toMatch(/no sale attempt/i)
    expect(s).toMatch(/binding clause by clause/i)
    expect(s).toMatch(/never describes the picture/i)
  })

  it('carries the original caption, feedback, and product title', () => {
    const u = buildCaptionReworkUserContent({
      originalCaption: 'the old line',
      feedback: 'cut the second sentence',
      productTitle: 'The Rosales Wand',
    })
    expect(u).toContain('the old line')
    expect(u).toContain('cut the second sentence')
    expect(u).toContain('The Rosales Wand')
  })

  it('appends retry findings on a second pass', () => {
    const u = buildCaptionReworkUserContent({
      originalCaption: 'x', feedback: 'y', retryFindings: ['[caption-describes-image] narrates the photo'],
    })
    expect(u).toContain('caption-describes-image')
  })
})

describe('parseCaptionReworkJson', () => {
  it('parses a clean JSON reply', () => {
    const r = parseCaptionReworkJson('{"caption":"a line","altText":"a description","hashtags":["a","b"]}')
    expect(r).toEqual({ caption: 'a line', altText: 'a description', hashtags: ['a', 'b'] })
  })

  it('strips markdown fences', () => {
    const r = parseCaptionReworkJson('```json\n{"caption":"a","altText":"b","hashtags":[]}\n```')
    expect(r?.caption).toBe('a')
  })

  it('returns null on invalid JSON or a missing required field', () => {
    expect(parseCaptionReworkJson('not json')).toBeNull()
    expect(parseCaptionReworkJson('{"caption":"a"}')).toBeNull()
  })
})

// ── Pure: the owner-approval stamp ───────────────────────────────────────────

describe('buildOwnerApprovalStamp', () => {
  const now = new Date('2026-08-22T12:00:00Z')

  it('writes a PASS stamp with reviewer owner-studio, parseable by parseGateStamp', () => {
    const stamp = buildOwnerApprovalStamp({ productHandle: 'rosales' }, now)
    const parsed = parseGateStamp(stamp)
    expect(parsed).toEqual({ verdict: 'PASS', reviewer: 'owner-studio', day: '2026-08-22', productHandle: 'rosales' })
  })

  it('prepends the stamp ahead of any existing feedback', () => {
    const stamp = buildOwnerApprovalStamp({ existingFeedback: 'earlier note from the gate', productHandle: null }, now)
    expect(stamp.startsWith('[publish-gate PASS by owner-studio')).toBe(true)
    expect(stamp).toContain('earlier note from the gate')
  })

  // Locks in the finding documented in the module: neither decideManualPublish
  // nor postApprovedDraft restrict the stamp's reviewer to 'social-publish-gate',
  // so a stamp reviewed by 'owner-studio' is already recognised as a valid PASS.
  // No recogniser change was needed; this test is the proof.
  it('is accepted by decideManualPublish exactly like a social-publish-gate stamp', async () => {
    const stamp = buildOwnerApprovalStamp({ productHandle: 'rosales' }, now)
    const getValve = vi.fn(async () => true)
    const decision = await decideManualPublish({ feedback: stamp, isVideo: false }, getValve)
    expect(decision.ok).toBe(true)
  })
})

// ── regenerateSocialImage ────────────────────────────────────────────────────

describe('regenerateSocialImage', () => {
  it('builds a prompt from imageBrief + product title and rehosts via generateAndUploadSocialImage', async () => {
    dbMock.select.mockReturnValue(selectReturning({
      ...BASE_ROW,
      imageBrief: 'jade at a sunlit bathroom sink',
      shopifyProductId: 'gid://shopify/Product/123',
    }))
    getProductsByIdsMock.mockResolvedValue([{ title: 'The Rosales Wand', images: [{ url: 'https://cdn/rosales.jpg' }] }])
    getProductHandleByIdMock.mockResolvedValue('rosales')
    generateAndUploadSocialImageMock.mockResolvedValue({ url: 'https://cdn.shopify.com/social-rosales-2.jpg', filename: 'social-rosales-2.jpg', provider: 'atlas', model: 'atlas/seedream' })

    const r = await regenerateSocialImage({ postId: 61, feedback: 'warmer light', actor: 'owner-studio' })

    expect(r).toEqual({ ok: true, url: 'https://cdn.shopify.com/social-rosales-2.jpg', prompt: expect.stringContaining('jade at a sunlit bathroom sink') })
    expect(generateAndUploadSocialImageMock).toHaveBeenCalledWith(expect.objectContaining({
      handle: 'rosales',
      refImageUrl: 'https://cdn/rosales.jpg',
      logCost: true,
      imageSize: 'portrait_4_5',
      caller: 'owner-studio',
    }))
  })

  it('returns ok:false when the post does not exist', async () => {
    dbMock.select.mockReturnValue(selectReturning(null))
    const r = await regenerateSocialImage({ postId: 999, feedback: 'x', actor: 'owner-studio' })
    expect(r.ok).toBe(false)
  })

  it('returns ok:false when generation produces no url', async () => {
    dbMock.select.mockReturnValue(selectReturning({ ...BASE_ROW }))
    generateAndUploadSocialImageMock.mockResolvedValue({ url: null, filename: 'x', provider: 'none', model: 'none' })
    const r = await regenerateSocialImage({ postId: 61, feedback: 'x', actor: 'owner-studio' })
    expect(r.ok).toBe(false)
  })
})

// ── reworkCaption ─────────────────────────────────────────────────────────────

describe('reworkCaption', () => {
  it('returns the redraft when the deterministic checks pass on the first attempt', async () => {
    dbMock.select.mockReturnValue(selectReturning({ ...BASE_ROW }))
    generateWithSystemMock.mockResolvedValue('{"caption":"a clean line","altText":"a clean description","hashtags":["a","b"]}')
    runDeterministicPublishChecksMock.mockResolvedValue({ findings: [], blocked: false, held: false })

    const r = await reworkCaption({ postId: 61, feedback: 'tighten it up', actor: 'owner-studio' })
    expect(r).toEqual({ ok: true, caption: 'a clean line', altText: 'a clean description', hashtags: ['a', 'b'] })
    expect(generateWithSystemMock).toHaveBeenCalledTimes(1)
  })

  it('retries once with findings appended, then succeeds', async () => {
    dbMock.select.mockReturnValue(selectReturning({ ...BASE_ROW }))
    generateWithSystemMock
      .mockResolvedValueOnce('{"caption":"that is jade in the photo","altText":"a","hashtags":[]}')
      .mockResolvedValueOnce('{"caption":"a fixed line","altText":"a fixed description","hashtags":[]}')
    runDeterministicPublishChecksMock
      .mockResolvedValueOnce({ findings: [{ check: 'caption-describes-image', severity: 'block', detail: 'narrates the photo' }], blocked: true, held: false })
      .mockResolvedValueOnce({ findings: [], blocked: false, held: false })

    const r = await reworkCaption({ postId: 61, feedback: 'fix it', actor: 'owner-studio' })
    expect(r).toEqual({ ok: true, caption: 'a fixed line', altText: 'a fixed description', hashtags: [] })
    expect(generateWithSystemMock).toHaveBeenCalledTimes(2)
    const secondCallUser = generateWithSystemMock.mock.calls[1]![0].user
    expect(secondCallUser).toContain('caption-describes-image')
  })

  it('returns ok:false listing findings when still blocked after the retry', async () => {
    dbMock.select.mockReturnValue(selectReturning({ ...BASE_ROW }))
    generateWithSystemMock.mockResolvedValue('{"caption":"still bad","altText":"a","hashtags":[]}')
    runDeterministicPublishChecksMock.mockResolvedValue({
      findings: [{ check: 'caption-describes-image', severity: 'block', detail: 'narrates the photo' }],
      blocked: true, held: false,
    })

    const r = await reworkCaption({ postId: 61, feedback: 'fix it', actor: 'owner-studio' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/caption-describes-image/)
    expect(generateWithSystemMock).toHaveBeenCalledTimes(2)
  })

  it('returns ok:false when the post does not exist', async () => {
    dbMock.select.mockReturnValue(selectReturning(null))
    const r = await reworkCaption({ postId: 999, feedback: 'x', actor: 'owner-studio' })
    expect(r.ok).toBe(false)
  })
})

// ── createOwnerReworkRow ──────────────────────────────────────────────────────

describe('createOwnerReworkRow', () => {
  it('inserts a new draft row copying platform/postType from the source', async () => {
    dbMock.select.mockReturnValue(selectReturning({ ...BASE_ROW, platform: 'x', postType: 'campaign' }))
    const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 77 }]) })
    dbMock.insert.mockReturnValue({ values })

    const r = await createOwnerReworkRow({
      fromPostId: 61,
      caption: 'the new caption',
      altText: 'the new alt text',
      mediaUrls: ['https://cdn/new.jpg'],
      actor: 'owner-studio',
    })

    expect(r).toEqual({ id: 77 })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'x',
      postType: 'campaign',
      tweetText: 'the new caption',
      altText: 'the new alt text',
      reworkedFrom: 61,
      status: 'draft',
      reviewStatus: 'pending_review',
      createdBy: 'owner-studio',
    }))
  })

  it('throws when the source row does not exist', async () => {
    dbMock.select.mockReturnValue(selectReturning(null))
    await expect(createOwnerReworkRow({
      fromPostId: 999, caption: 'x', mediaUrls: [], actor: 'owner-studio',
    })).rejects.toThrow(/999/)
  })
})

// ── ownerApprovePost ──────────────────────────────────────────────────────────

describe('ownerApprovePost', () => {
  it('approves and stamps the row when deterministic checks pass', async () => {
    dbMock.select.mockReturnValue(selectReturning({ ...BASE_ROW }))
    runDeterministicPublishChecksMock.mockResolvedValue({ findings: [], blocked: false, held: false })
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    dbMock.update.mockReturnValue({ set })

    const r = await ownerApprovePost({ postId: 61, actor: 'owner-studio' })
    expect(r).toEqual({ ok: true })
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      reviewStatus: 'approved',
      reviewedBy: 'owner-studio',
      feedback: expect.stringContaining('[publish-gate PASS by owner-studio'),
    }))
  })

  it('refuses to approve when a deterministic check blocks, and returns the findings', async () => {
    dbMock.select.mockReturnValue(selectReturning({ ...BASE_ROW }))
    runDeterministicPublishChecksMock.mockResolvedValue({
      findings: [{ check: 'caption-describes-image', severity: 'block', detail: 'narrates the photo' }],
      blocked: true, held: false,
    })

    const r = await ownerApprovePost({ postId: 61, actor: 'owner-studio' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.findings).toHaveLength(1)
    expect(dbMock.update).not.toHaveBeenCalled()
  })
})
