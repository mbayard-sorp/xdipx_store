// X publisher alt-text wiring (ticket #4204). The gate scans `altText` and
// `social_posts.alt_text` is stored on the draft (migration 085), but nothing
// ever uploaded it to X: this covers the new `setMediaAltText` call this
// ticket adds to `xPublisher.publish`. Mocks `~/lib/twitter.server` at the
// module boundary the same way the other admin.socials tests do.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const uploadMediaFromUrl = vi.fn(async (_url: string): Promise<string | null> => 'media-1')
const uploadVideoFromUrl = vi.fn(async (_url: string, _opts?: { mediaType?: string }): Promise<string> => 'video-media-1')
const postTweet = vi.fn(async (_text: string, _mediaIds?: string[]) => ({ id: 'tweet-1', text: 'posted' }))
const setMediaAltText = vi.fn(
  async (_mediaId: string, _altText: string): Promise<{ ok: true } | { ok: false; detail: string }> => ({ ok: true }),
)

vi.mock('~/lib/twitter.server', () => ({
  uploadMediaFromUrl,
  uploadVideoFromUrl,
  postTweet,
  setMediaAltText,
}))

import { xPublisher } from './x.server'

function setConfigured() {
  vi.stubEnv('X_API_KEY', 'k')
  vi.stubEnv('X_API_SECRET', 's')
  vi.stubEnv('X_ACCESS_TOKEN', 't')
  vi.stubEnv('X_ACCESS_TOKEN_SECRET', 'ts')
}

describe('xPublisher alt text', () => {
  beforeEach(() => {
    setConfigured()
    uploadMediaFromUrl.mockClear()
    postTweet.mockClear()
    setMediaAltText.mockClear()
    setMediaAltText.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('uploads alt text for the first image after media upload, before posting', async () => {
    const result = await xPublisher.publish({
      postId: 1,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'hello',
      altText: 'a bottle of lube on a nightstand',
    })

    expect(result).toEqual({ ok: true, externalPostId: 'tweet-1' })
    expect(setMediaAltText).toHaveBeenCalledWith('media-1', 'a bottle of lube on a nightstand')
    // Uploaded before the tweet is posted, so a failed post never leaves an
    // orphaned untagged upload as the last write.
    const uploadOrder = setMediaAltText.mock.invocationCallOrder[0]!
    const postOrder = postTweet.mock.invocationCallOrder[0]!
    expect(uploadOrder).toBeLessThan(postOrder)
  })

  it('attaches alt text to only the first image of a carousel', async () => {
    await xPublisher.publish({
      postId: 2,
      media: { kind: 'carousel', imageUrls: ['a.jpg', 'b.jpg'] },
      caption: 'two slides',
      altText: 'the pair',
    })

    expect(setMediaAltText).toHaveBeenCalledTimes(1)
    expect(setMediaAltText).toHaveBeenCalledWith('media-1', 'the pair')
  })

  it('publishes with no alt-text call when the draft has none', async () => {
    const result = await xPublisher.publish({
      postId: 3,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'no alt',
    })

    expect(result).toEqual({ ok: true, externalPostId: 'tweet-1' })
    expect(setMediaAltText).not.toHaveBeenCalled()
  })

  it('degrades to publishing without alt text when the metadata call fails, and still posts', async () => {
    setMediaAltText.mockResolvedValueOnce({ ok: false, detail: 'X API POST ... 403' })

    const result = await xPublisher.publish({
      postId: 4,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'degrade me',
      altText: 'should not block the post',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.note).toMatch(/Alt text failed, published without it/)
    }
    expect(postTweet).toHaveBeenCalledWith('degrade me', ['media-1'])
  })

  it('never sends alt text as caption text', async () => {
    const result = await xPublisher.publish({
      postId: 5,
      media: { kind: 'image', imageUrl: 'a.jpg' },
      caption: 'the real caption',
      altText: 'this description must never appear in the tweet body',
    })

    expect(result.ok).toBe(true)
    expect(postTweet).toHaveBeenCalledWith('the real caption', ['media-1'])
  })
})

// Phase 3: X video through chunked upload. The transport (INIT/APPEND/FINALIZE/
// STATUS) is covered at the fetch boundary in `twitter-video-upload.test.ts`;
// this covers the adapter's branch: route video to the chunked uploader, post
// with its media id exactly as the image branch does, and never degrade a
// failed video upload to a text post.
describe('xPublisher video', () => {
  beforeEach(() => {
    setConfigured()
    uploadMediaFromUrl.mockClear()
    uploadVideoFromUrl.mockReset()
    uploadVideoFromUrl.mockResolvedValue('video-media-1')
    postTweet.mockClear()
    setMediaAltText.mockClear()
    setMediaAltText.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uploads the clip through the chunked path and posts it with the returned media id', async () => {
    const result = await xPublisher.publish({
      postId: 10,
      media: { kind: 'video', videoUrl: 'https://blob.example/clip.mp4?token=x', posterUrl: 'https://blob.example/p.jpg' },
      caption: 'the clip',
    })

    expect(result).toEqual({ ok: true, externalPostId: 'tweet-1' })
    expect(uploadVideoFromUrl).toHaveBeenCalledWith('https://blob.example/clip.mp4?token=x', { mediaType: 'video/mp4' })
    // The poster is not uploaded as a second media item: X takes one video.
    expect(uploadMediaFromUrl).not.toHaveBeenCalled()
    expect(postTweet).toHaveBeenCalledWith('the clip', ['video-media-1'])
  })

  it('fails the post, and never posts text-only, when the chunked upload throws', async () => {
    uploadVideoFromUrl.mockRejectedValueOnce(new Error('X video processing failed: InvalidMedia (code 1)'))

    const result = await xPublisher.publish({
      postId: 11,
      media: { kind: 'video', videoUrl: 'https://blob.example/clip.mp4?token=secret' },
      caption: 'the clip',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('error')
      expect(result.detail).toMatch(/InvalidMedia/)
      expect(result.detail).toMatch(/Not posting without the video/)
      // The Blob query string never lands in the row's error detail.
      expect(result.detail).not.toMatch(/secret/)
    }
    expect(postTweet).not.toHaveBeenCalled()
  })

  it('names the credits remedy when the upload hits a 402', async () => {
    uploadVideoFromUrl.mockRejectedValueOnce(new Error('X video INIT failed 402: {}'))
    const result = await xPublisher.publish({
      postId: 12,
      media: { kind: 'video', videoUrl: 'https://blob.example/clip.mp4' },
      caption: 'the clip',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toMatch(/credits are depleted/)
  })

  it('refuses a clip over 140 s before uploading anything', async () => {
    const result = await xPublisher.publish({
      postId: 13,
      media: { kind: 'video', videoUrl: 'https://blob.example/long.mp4', durationSec: 141 },
      caption: 'too long',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toMatch(/141s; X accepts at most 140s/)
    expect(uploadVideoFromUrl).not.toHaveBeenCalled()
  })

  it('accepts a clip of exactly 140 s', async () => {
    const result = await xPublisher.publish({
      postId: 14,
      media: { kind: 'video', videoUrl: 'https://blob.example/edge.mp4', durationSec: 140 },
      caption: 'right at the line',
    })
    expect(result.ok).toBe(true)
  })

  it('refuses a clip over 512 MB before uploading anything', async () => {
    const result = await xPublisher.publish({
      postId: 15,
      media: { kind: 'video', videoUrl: 'https://blob.example/huge.mp4', sizeBytes: 512 * 1024 * 1024 + 1 },
      caption: 'too big',
    })
    expect(result.ok).toBe(false)
    expect(uploadVideoFromUrl).not.toHaveBeenCalled()
  })

  it('checks caption length before the billable video upload', async () => {
    const result = await xPublisher.publish({
      postId: 16,
      media: { kind: 'video', videoUrl: 'https://blob.example/clip.mp4' },
      caption: 'x'.repeat(281),
    })
    expect(result.ok).toBe(false)
    expect(uploadVideoFromUrl).not.toHaveBeenCalled()
  })

  it('attaches alt text to the video media id, and a failure there does not stop the post', async () => {
    setMediaAltText.mockResolvedValueOnce({ ok: false, detail: 'X API POST ... 400' })
    const result = await xPublisher.publish({
      postId: 17,
      media: { kind: 'video', videoUrl: 'https://blob.example/clip.mp4' },
      caption: 'the clip',
      altText: 'a woman holding a wand vibrator, talking to camera',
    })
    expect(setMediaAltText).toHaveBeenCalledWith('video-media-1', 'a woman holding a wand vibrator, talking to camera')
    expect(result.ok).toBe(true)
    expect(postTweet).toHaveBeenCalledWith('the clip', ['video-media-1'])
  })
})
