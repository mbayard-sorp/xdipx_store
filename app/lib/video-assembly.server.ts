/**
 * ffmpeg helpers for the video pipeline — poster extraction, watermarking,
 * audio muxing, duration probing, and (fast-follow) multi-clip concat.
 *
 * Buffer in, Buffer out. Every /tmp file is scoped to a single call and
 * unlinked in finally — nothing here may rely on /tmp surviving between
 * requests or cron ticks (Vercel instances are ephemeral); durable bytes live
 * in Blob (blob.server.ts). Factored from api.ltx.upload.tsx /
 * api.ltx.add-audio.tsx, which now import from here.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { getSiteSettings } from '~/lib/sanity.server'

function tmp(name: string): string {
  return `/tmp/va-${randomBytes(6).toString('hex')}-${name}`
}

function cleanup(paths: string[]): void {
  for (const p of paths) {
    try { if (existsSync(p)) unlinkSync(p) } catch { /* non-fatal */ }
  }
}

/** Extract a poster JPEG from `atSeconds` in (default 1s — motion has settled, not blurry frame 0). */
export async function extractPoster(video: Buffer, atSeconds = 1): Promise<Buffer> {
  const input = tmp('poster-in.mp4')
  const output = tmp('poster.jpg')
  try {
    writeFileSync(input, video)
    execFileSync(ffmpegPath!, [
      '-y',
      '-ss', String(atSeconds),
      '-i', input,
      '-frames:v', '1',
      '-q:v', '3',
      output,
    ], { timeout: 30_000 })
    return readFileSync(output)
  } finally {
    cleanup([input, output])
  }
}

/** Duration in seconds via ffmpeg stderr (ffmpeg-static ships no ffprobe). */
export async function probeDurationSeconds(video: Buffer): Promise<number> {
  const input = tmp('probe.mp4')
  try {
    writeFileSync(input, video)
    let stderr = ''
    try {
      execFileSync(ffmpegPath!, ['-i', input, '-f', 'null', '-'], { timeout: 30_000 })
    } catch (err) {
      // ffmpeg writes stream info to stderr and exits non-zero with -f null
      stderr = err instanceof Error && 'stderr' in err ? String((err as { stderr?: unknown }).stderr ?? '') : ''
    }
    const m = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr)
    if (!m) return 0
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100
  } finally {
    cleanup([input])
  }
}

// ── Watermark ────────────────────────────────────────────────────────────────

let logoCache: { buffer: Buffer; ts: number } | null = null
const LOGO_CACHE_TTL = 1000 * 60 * 60

/** Exported for the end-card builder (video-postpass) — same 1h cache. */
export async function fetchLogoPng(): Promise<Buffer | null> {
  if (logoCache && Date.now() - logoCache.ts < LOGO_CACHE_TTL) return logoCache.buffer
  const settings = await getSiteSettings()
  if (!settings?.logoUrl) return null
  const res = await fetch(settings.logoUrl)
  if (!res.ok) return null
  const buffer = Buffer.from(await res.arrayBuffer())
  logoCache = { buffer, ts: Date.now() }
  return buffer
}

/**
 * Overlay the xdipx logo bottom-right at 35% opacity. This is a deliberate
 * post-production branding overlay — distinct from the "no text in generated
 * frames" rule, which is about the MODEL inventing text, not about branding
 * added in post. Falls back to the original video on any failure.
 */
export async function applyWatermark(video: Buffer): Promise<Buffer> {
  const input = tmp('wm-in.mp4')
  const overlay = tmp('wm-logo.png')
  const output = tmp('wm-out.mp4')
  try {
    const logo = await fetchLogoPng()
    if (!logo) return video

    const preparedLogo = await sharp(logo)
      .resize(160)
      .ensureAlpha()
      .composite([{
        input: Buffer.from([255, 255, 255, Math.round(255 * 0.35)]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      }])
      .png()
      .toBuffer()

    writeFileSync(input, video)
    writeFileSync(overlay, preparedLogo)
    execFileSync(ffmpegPath!, [
      '-y',
      '-i', input,
      '-i', overlay,
      '-filter_complex', 'overlay=W-w-20:H-h-20',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      output,
    ], { timeout: 60_000 })
    return existsSync(output) ? readFileSync(output) : video
  } catch (err) {
    console.warn('[video-assembly] watermark failed, returning original:', err instanceof Error ? err.message : err)
    return video
  } finally {
    cleanup([input, overlay, output])
  }
}

/**
 * Mux an audio track onto a video (video stream copied). The video's duration
 * always wins: shorter audio is padded with silence (apad + -shortest ends at
 * the video), longer audio is cut at the video's end.
 */
export async function muxAudio(video: Buffer, audio: Buffer): Promise<Buffer> {
  const videoIn = tmp('mux-v.mp4')
  const audioIn = tmp('mux-a.mp3')
  const output = tmp('mux-out.mp4')
  try {
    writeFileSync(videoIn, video)
    writeFileSync(audioIn, audio)
    execFileSync(ffmpegPath!, [
      '-y',
      '-i', videoIn,
      '-i', audioIn,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy',
      '-af', 'apad',
      '-c:a', 'aac',
      '-shortest',
      '-movflags', '+faststart',
      output,
    ], { timeout: 60_000 })
    return readFileSync(output)
  } finally {
    cleanup([videoIn, audioIn, output])
  }
}

/**
 * Replace a clip's audio with silence, dropping whatever it carried (used to
 * strip model-invented dialogue that no gate has read — ticket #3996). The video
 * stream is copied; the original audio is discarded and a silent stereo AAC
 * track of the same length takes its place.
 *
 * We keep a (silent) audio stream rather than using `-an` on purpose: a
 * stream-less file breaks `concatWithAudio` (which maps `[i:a]` for the end
 * card) and leaves the watermark's `-c:a copy` with nothing to copy. A silent
 * track is the same result to a viewer and safe through the rest of assembly.
 */
export async function stripAudio(video: Buffer): Promise<Buffer> {
  const videoIn = tmp('strip-v.mp4')
  const output = tmp('strip-out.mp4')
  try {
    writeFileSync(videoIn, video)
    execFileSync(ffmpegPath!, [
      '-y',
      '-i', videoIn,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      '-movflags', '+faststart',
      output,
    ], { timeout: 60_000 })
    return readFileSync(output)
  } finally {
    cleanup([videoIn, output])
  }
}

// ── Multi-aspect masters ─────────────────────────────────────────────────────

export type AspectMaster = '1:1' | '4:5'

const ASPECT_DIMENSIONS: Record<AspectMaster, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
}

/**
 * Derive a 1:1 or 4:5 master from the finished 1080x1920 9:16 final. The crop
 * uses the same face-biased vertical anchor as the punch-in step (0.35 of the
 * spare height instead of center), so a talking head stays framed. Deriving
 * from the FINAL means captions, end card, and watermark carry over free.
 * Audio is stream-copied.
 */
export async function renderAspectMaster(video: Buffer, aspect: AspectMaster): Promise<Buffer> {
  const { width, height } = ASPECT_DIMENSIONS[aspect]
  const input = tmp('aspect-in.mp4')
  const output = tmp(`aspect-${aspect.replace(':', 'x')}.mp4`)
  try {
    writeFileSync(input, video)
    execFileSync(ffmpegPath!, [
      '-y',
      '-i', input,
      '-vf', `crop=${width}:${height}:(iw-${width})/2:(ih-${height})*0.35,setsar=1`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '19',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      output,
    ], { timeout: 120_000 })
    return readFileSync(output)
  } finally {
    cleanup([input, output])
  }
}

export const ASPECT_MASTER_SIZES = ASPECT_DIMENSIONS

/**
 * Extract the FINAL frame from a clip, for multi-scene 'last-frame' scene
 * continuity (Phase 3, video-pipeline.server.ts): the next scene's
 * image-to-video input is the previous scene's last frame rather than a
 * freshly composed one, so motion reads as one continuous shot across the
 * cut. RunPod's worker returns lastFrameUrl directly in its result, so this
 * helper is only needed for fal providers, which hand back just the finished
 * mp4. Seeks near (not exactly) the end — `-sseof -0.1` — because seeking to
 * the reported duration can land past the last decodable frame on some fal
 * encodes and produce a black/empty still.
 */
export async function extractLastFrame(video: Buffer): Promise<Buffer> {
  const input = tmp('lastframe-in.mp4')
  const output = tmp('lastframe.jpg')
  try {
    writeFileSync(input, video)
    execFileSync(ffmpegPath!, [
      '-y',
      '-sseof', '-0.1',
      '-i', input,
      '-update', '1',
      '-frames:v', '1',
      '-q:v', '3',
      output,
    ], { timeout: 30_000 })
    return readFileSync(output)
  } finally {
    cleanup([input, output])
  }
}

/**
 * Concat clips into one 1080x1920 9:16 H.264/AAC video, re-encoding and
 * normalizing (clips from different fal models never share codec/fps/res).
 * Fast-follow surface for multi-clip formulas; the MVP pipeline is single-clip.
 */
export async function concatAndNormalize(clips: Buffer[]): Promise<Buffer> {
  if (!clips.length) throw new Error('concatAndNormalize: no clips')
  if (clips.length === 1) return clips[0]!
  const inputs = clips.map((_, i) => tmp(`cat-${i}.mp4`))
  const output = tmp('cat-out.mp4')
  try {
    clips.forEach((c, i) => writeFileSync(inputs[i]!, c))
    const inputArgs = inputs.flatMap(p => ['-i', p])
    const norm = clips
      .map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[v${i}]`)
      .join(';')
    const concatInputs = clips.map((_, i) => `[v${i}]`).join('')
    execFileSync(ffmpegPath!, [
      '-y',
      ...inputArgs,
      '-filter_complex', `${norm};${concatInputs}concat=n=${clips.length}:v=1:a=0[outv]`,
      '-map', '[outv]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
      '-movflags', '+faststart',
      output,
    ], { timeout: 180_000 })
    return readFileSync(output)
  } finally {
    cleanup([...inputs, output])
  }
}
