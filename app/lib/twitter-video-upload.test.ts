// X chunked video upload (Phase 3): INIT / APPEND / FINALIZE / STATUS at the
// fetch boundary. `social-publish/x.server.test.ts` mocks `twitter.server`
// wholesale, so the wire shape and the segment boundaries are only covered here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  uploadVideoFromUrl,
  videoSegmentRanges,
  X_VIDEO_SEGMENT_BYTES,
  X_VIDEO_MAX_BYTES,
} from './twitter.server'

const MB5 = 5 * 1024 * 1024
const UPLOAD = 'https://upload.x.com/1.1/media/upload.json'
const BLOB = 'https://blob.example/clip.mp4?token=abc'

interface Call {
  url: string
  method: string
  command: string
  fields: Record<string, string>
  mediaBytes?: number | undefined
  auth?: string | undefined
}

/** Pull the multipart fields (and the binary `media` part's length) out of a body. */
function parseMultipart(body: Buffer, contentType: string): { fields: Record<string, string>; mediaBytes?: number | undefined } {
  const boundary = contentType.split('boundary=')[1]!
  const delim = Buffer.from(`--${boundary}`)
  const fields: Record<string, string> = {}
  let mediaBytes: number | undefined
  let pos = body.indexOf(delim)
  while (pos !== -1) {
    const next = body.indexOf(delim, pos + delim.length)
    if (next === -1) break
    const part = body.subarray(pos + delim.length + 2, next - 2) // strip leading \r\n and trailing \r\n
    const headerEnd = part.indexOf('\r\n\r\n')
    const header = part.subarray(0, headerEnd).toString('latin1')
    const content = part.subarray(headerEnd + 4)
    const name = /name="([^"]+)"/.exec(header)![1]!
    if (/filename=/.test(header)) mediaBytes = content.length
    else fields[name] = content.toString('utf8')
    pos = next
  }
  return { fields, mediaBytes }
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * A fake X upload host plus a fake Blob store. `statusSequence` is what STATUS
 * answers, one entry per poll; `finalizeInfo` is FINALIZE's processing_info.
 */
function fakeX(opts: {
  videoBytes: number
  finalizeInfo?: unknown
  statusSequence?: unknown[]
  failOn?: { command: string; status: number; body: string }
  contentLength?: string
}) {
  const calls: Call[] = []
  const statuses = [...(opts.statusSequence ?? [])]
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('https://blob.example/')) {
      const headers: Record<string, string> = { 'content-type': 'video/mp4' }
      if (opts.contentLength) headers['content-length'] = opts.contentLength
      return new Response(new Uint8Array(opts.videoBytes), { status: 200, headers })
    }
    const headers = (init?.headers ?? {}) as Record<string, string>
    if (method === 'GET') {
      const u = new URL(url)
      const command = u.searchParams.get('command')!
      calls.push({ url, method, command, fields: Object.fromEntries(u.searchParams), auth: headers.Authorization })
      return jsonRes({ media_id_string: 'm-1', processing_info: statuses.shift() })
    }
    const { fields, mediaBytes } = parseMultipart(init!.body as Buffer, headers['Content-Type']!)
    const command = fields.command!
    calls.push({ url, method, command, fields, mediaBytes, auth: headers.Authorization })
    if (opts.failOn?.command === command) return new Response(opts.failOn.body, { status: opts.failOn.status })
    if (command === 'INIT') return jsonRes({ media_id_string: 'm-1', expires_after_secs: 86400 })
    if (command === 'APPEND') return new Response(null, { status: 204 })
    if (command === 'FINALIZE') {
      return jsonRes({ media_id_string: 'm-1', ...(opts.finalizeInfo ? { processing_info: opts.finalizeInfo } : {}) })
    }
    return new Response('unexpected', { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

const noSleep = vi.fn(async (_ms: number) => {})

describe('videoSegmentRanges', () => {
  it('keeps exactly 5 MB in one segment', () => {
    expect(videoSegmentRanges(MB5)).toEqual([[0, MB5]])
  })

  it('splits 5 MB + 1 byte into two segments, the second one byte long', () => {
    expect(videoSegmentRanges(MB5 + 1)).toEqual([[0, MB5], [MB5, MB5 + 1]])
  })

  it('segments are contiguous and cover every byte', () => {
    const total = 3 * MB5 + 12345
    const ranges = videoSegmentRanges(total)
    expect(ranges).toHaveLength(4)
    expect(ranges[0]![0]).toBe(0)
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1])
    expect(ranges.at(-1)![1]).toBe(total)
    expect(X_VIDEO_SEGMENT_BYTES).toBe(MB5)
  })
})

describe('uploadVideoFromUrl', () => {
  beforeEach(() => {
    vi.stubEnv('X_API_KEY', 'k')
    vi.stubEnv('X_API_SECRET', 's')
    vi.stubEnv('X_ACCESS_TOKEN', 't')
    vi.stubEnv('X_ACCESS_TOKEN_SECRET', 'ts')
    noSleep.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('runs INIT, APPEND, FINALIZE, then polls STATUS until succeeded, and returns the media id', async () => {
    const { calls } = fakeX({
      videoBytes: 3_000_000,
      finalizeInfo: { state: 'pending', check_after_secs: 1 },
      statusSequence: [
        { state: 'in_progress', check_after_secs: 2, progress_percent: 40 },
        { state: 'succeeded', progress_percent: 100 },
      ],
    })

    const id = await uploadVideoFromUrl(BLOB, { mediaType: 'video/mp4', sleep: noSleep })

    expect(id).toBe('m-1')
    expect(calls.map(c => c.command)).toEqual(['INIT', 'APPEND', 'FINALIZE', 'STATUS', 'STATUS'])
    expect(calls[0]!.fields).toMatchObject({
      command: 'INIT',
      total_bytes: '3000000',
      media_type: 'video/mp4',
      media_category: 'tweet_video',
    })
    expect(calls[1]!.fields).toMatchObject({ command: 'APPEND', media_id: 'm-1', segment_index: '0' })
    expect(calls[1]!.mediaBytes).toBe(3_000_000)
    expect(calls[3]!.url).toBe(`${UPLOAD}?command=STATUS&media_id=m-1`)
    // Honors check_after_secs from each response, in order.
    expect(noSleep.mock.calls.map(c => c[0])).toEqual([1000, 2000])
    // Every X call is OAuth 1.0a signed, the same path as uploadMedia.
    for (const c of calls) expect(c.auth).toMatch(/^OAuth /)
  })

  it('returns straight after FINALIZE when X reports no processing_info', async () => {
    const { calls } = fakeX({ videoBytes: 1000 })
    await expect(uploadVideoFromUrl(BLOB, { sleep: noSleep })).resolves.toBe('m-1')
    expect(calls.map(c => c.command)).toEqual(['INIT', 'APPEND', 'FINALIZE'])
    expect(noSleep).not.toHaveBeenCalled()
  })

  it('sends exactly 5 MB as one APPEND', async () => {
    const { calls } = fakeX({ videoBytes: MB5 })
    await uploadVideoFromUrl(BLOB, { sleep: noSleep })
    const appends = calls.filter(c => c.command === 'APPEND')
    expect(appends).toHaveLength(1)
    expect(appends[0]!.mediaBytes).toBe(MB5)
  })

  it('sends 5 MB + 1 byte as two APPENDs with segment_index 0 and 1', async () => {
    const { calls } = fakeX({ videoBytes: MB5 + 1 })
    await uploadVideoFromUrl(BLOB, { sleep: noSleep })
    const appends = calls.filter(c => c.command === 'APPEND')
    expect(appends.map(a => a.fields.segment_index)).toEqual(['0', '1'])
    expect(appends.map(a => a.mediaBytes)).toEqual([MB5, 1])
  })

  it('throws with X\'s error when processing fails', async () => {
    fakeX({
      videoBytes: 1000,
      finalizeInfo: { state: 'pending', check_after_secs: 1 },
      statusSequence: [{ state: 'failed', error: { code: 1, name: 'InvalidMedia', message: 'Unsupported codec' } }],
    })
    await expect(uploadVideoFromUrl(BLOB, { sleep: noSleep }))
      .rejects.toThrow(/processing failed: InvalidMedia Unsupported codec \(code 1\)/)
  })

  it('throws when FINALIZE itself reports failed', async () => {
    fakeX({ videoBytes: 1000, finalizeInfo: { state: 'failed', error: { message: 'bad file' } } })
    await expect(uploadVideoFromUrl(BLOB, { sleep: noSleep })).rejects.toThrow(/processing failed: bad file/)
  })

  it('gives up at the 120 s processing cap rather than waiting forever', async () => {
    fakeX({
      videoBytes: 1000,
      finalizeInfo: { state: 'in_progress', check_after_secs: 50 },
      statusSequence: [
        { state: 'in_progress', check_after_secs: 50 },
        { state: 'in_progress', check_after_secs: 50 },
        { state: 'succeeded' },
      ],
    })
    await expect(uploadVideoFromUrl(BLOB, { sleep: noSleep })).rejects.toThrow(/gave up at the 120s cap/)
    // 50 + 50 = 100 s waited; the third 50 would cross 120, so it stops there.
    expect(noSleep).toHaveBeenCalledTimes(2)
  })

  it('throws on a non-2xx command with the status and body', async () => {
    const { calls } = fakeX({ videoBytes: 1000, failOn: { command: 'APPEND', status: 402, body: '{"title":"CreditsDepleted"}' } })
    await expect(uploadVideoFromUrl(BLOB, { sleep: noSleep })).rejects.toThrow(/APPEND failed 402: .*CreditsDepleted/)
    expect(calls.map(c => c.command)).toEqual(['INIT', 'APPEND'])
  })

  it('throws when INIT returns no media id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith('https://blob.example/')
        ? new Response(new Uint8Array(10), { status: 200 })
        : jsonRes({})))
    await expect(uploadVideoFromUrl(BLOB, { sleep: noSleep })).rejects.toThrow(/INIT returned no media_id_string/)
  })

  it('refuses a download whose declared size is over 512 MB, before INIT', async () => {
    const { calls } = fakeX({ videoBytes: 10, contentLength: String(X_VIDEO_MAX_BYTES + 1) })
    await expect(uploadVideoFromUrl(BLOB, { sleep: noSleep })).rejects.toThrow(/X accepts at most/)
    expect(calls).toHaveLength(0)
  })

  it('throws on a failed download without calling X', async () => {
    const fetchMock = vi.fn(async () => new Response('gone', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(uploadVideoFromUrl(BLOB, { sleep: noSleep })).rejects.toThrow(/Video download failed 404 for https:\/\/blob.example\/clip.mp4$/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
