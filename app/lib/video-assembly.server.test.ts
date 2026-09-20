// Coverage for extractFrames (ticket #10485): the post-render vision gate
// needs to sample the RENDERED clip, not only the seed still, so this exists
// to generalize extractPoster's single-frame extraction into a sampled set.
// Uses a real ffmpeg-generated synthetic clip (lavfi testsrc) rather than a
// checked-in fixture binary, exercised through the same ffmpeg-static binary
// the module itself shells out to.
import { execFileSync } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import ffmpegPath from 'ffmpeg-static'
import { describe, it, expect } from 'vitest'
import { extractFrames, probeDurationSeconds } from './video-assembly.server'

function makeTestVideo(durationSeconds: number): Buffer {
  const output = `/tmp/va-test-${randomBytes(6).toString('hex')}.mp4`
  try {
    execFileSync(ffmpegPath!, [
      '-y',
      '-f', 'lavfi', '-i', `testsrc=duration=${durationSeconds}:size=64x64:rate=5`,
      '-pix_fmt', 'yuv420p',
      output,
    ], { timeout: 30_000 })
    return readFileSync(output)
  } finally {
    try { unlinkSync(output) } catch { /* non-fatal */ }
  }
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

describe('extractFrames', () => {
  it('samples starting at 1s and steps by everyNSeconds across a real clip', async () => {
    const video = makeTestVideo(9)
    const duration = await probeDurationSeconds(video)
    expect(duration).toBeGreaterThan(8)

    const frames = await extractFrames(video, 2, 12)

    // 9s clip, 1s start, 2s step, 0.1s margin: 1, 3, 5, 7 (9 - 0.1 excludes the next step).
    expect(frames.map(f => f.atSeconds)).toEqual([1, 3, 5, 7])
    for (const f of frames) {
      expect(isJpeg(f.buffer)).toBe(true)
      expect(f.buffer.length).toBeGreaterThan(0)
    }
  }, 30_000)

  it('caps at maxFrames on a long clip', async () => {
    const video = makeTestVideo(30)
    const frames = await extractFrames(video, 2, 5)
    expect(frames).toHaveLength(5)
    expect(frames.map(f => f.atSeconds)).toEqual([1, 3, 5, 7, 9])
  }, 30_000)

  it('yields exactly one frame at 1s on a clip too short for a second sample', async () => {
    const video = makeTestVideo(1.5)
    const frames = await extractFrames(video, 2, 12)
    expect(frames.map(f => f.atSeconds)).toEqual([1])
  }, 30_000)
})
