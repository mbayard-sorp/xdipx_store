// X publisher alt-text wiring (ticket #4204). The gate scans `altText` and
// `social_posts.alt_text` is stored on the draft (migration 085), but nothing
// ever uploaded it to X: this covers the new `setMediaAltText` call this
// ticket adds to `xPublisher.publish`. Mocks `~/lib/twitter.server` at the
// module boundary the same way the other admin.socials tests do.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const uploadMediaFromUrl = vi.fn(async (_url: string): Promise<string | null> => 'media-1')
const postTweet = vi.fn(async (_text: string, _mediaIds?: string[]) => ({ id: 'tweet-1', text: 'posted' }))
const setMediaAltText = vi.fn(
  async (_mediaId: string, _altText: string): Promise<{ ok: true } | { ok: false; detail: string }> => ({ ok: true }),
)

vi.mock('~/lib/twitter.server', () => ({
  uploadMediaFromUrl,
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
