/**
 * Post-production pass for the avatar (talking-head) pipeline, codified from
 * the proven 2026-07-24 recipe: audio-preserving concat of the OmniHuman
 * halves, punch-in cuts every ~3.5s, char-proportional burned captions
 * (DM Sans when the font resolves in this runtime), music bed, and a
 * -14 LUFS loudnorm.
 *
 * Buffer in, Buffer out, ffmpeg-static, every /tmp file scoped to one call and
 * unlinked in finally (same discipline as video-assembly.server.ts). Each step
 * degrades independently with a logged warning rather than failing the job:
 * the raw performance is always better shipped than a job bricked on a missing
 * font or a music API hiccup.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { generateMusic } from '~/lib/elevenlabs.server'
import { logVideoCost } from '~/lib/token-log.server'
import { fetchLogoPng } from '~/lib/video-assembly.server'
import { groupWordTimingsIntoCues, type WordTiming, type CaptionCue } from '~/lib/caption-timing'

const PUNCH_SEGMENT_SECONDS = 3.5
const PUNCH_ZOOM = 1.12
const MUSIC_BED_PROMPT =
  'Warm playful minimal indie pop background bed, light soft percussion, gentle upbeat energy, cozy and confident, instrumental only'

function tmp(name: string): string {
  return `/tmp/vpp-${randomBytes(6).toString('hex')}-${name}`
}

function cleanup(paths: string[]): void {
  for (const p of paths) {
    try { if (existsSync(p)) unlinkSync(p) } catch { /* non-fatal */ }
  }
}

function ff(args: string[], timeout = 300_000): void {
  execFileSync(ffmpegPath!, args, { timeout, stdio: 'pipe' })
}

/** Duration in seconds; works for audio and video (ffmpeg -f null probe). */
export function probeMediaDurationSeconds(path: string): number {
  const r = spawnSync(ffmpegPath!, ['-i', path, '-f', 'null', '-'], { timeout: 30_000, encoding: 'utf8' })
  const m = (r.stderr ?? '').match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
  if (!m) return 0
  return +m[1]! * 3600 + +m[2]! * 60 + +m[3]! + +m[4]! / 100
}

/**
 * Concat clips into one 1080x1920 30fps H.264/AAC video with AUDIO PRESERVED.
 * (video-assembly's concatAndNormalize drops audio; the avatar halves carry
 * their speech track and the seam doubles as a punch-in cut.) Every input must
 * have an audio stream, which OmniHuman outputs always do.
 */
export async function concatWithAudio(clips: Buffer[]): Promise<Buffer> {
  if (!clips.length) throw new Error('concatWithAudio: no clips')
  if (clips.length === 1) return clips[0]!
  const inputs = clips.map((_, i) => tmp(`cat-${i}.mp4`))
  const output = tmp('cat-out.mp4')
  try {
    clips.forEach((c, i) => writeFileSync(inputs[i]!, c))
    const norm = clips
      .map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[v${i}]`)
      .join(';')
    const pairs = clips.map((_, i) => `[v${i}][${i}:a]`).join('')
    ff([
      '-y',
      ...inputs.flatMap(p => ['-i', p]),
      '-filter_complex', `${norm};${pairs}concat=n=${clips.length}:v=1:a=1[outv][outa]`,
      '-map', '[outv]', '-map', '[outa]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '19',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      output,
    ])
    return readFileSync(output)
  } finally {
    cleanup([...inputs, output])
  }
}

// ── Post-pass steps ──────────────────────────────────────────────────────────

/** Alternate full-frame / 1.12x punch-in segments every ~3.5s (zoom crop biased toward the face, not center). */
function applyPunchIns(inPath: string, outPath: string, durationSeconds: number, work: string[]): void {
  const n = Math.ceil(durationSeconds / PUNCH_SEGMENT_SECONDS)
  if (n < 2) {
    ff(['-y', '-i', inPath, '-c', 'copy', outPath])
    return
  }
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const start = i * PUNCH_SEGMENT_SECONDS
    const len = Math.min(PUNCH_SEGMENT_SECONDS, durationSeconds - start)
    if (len <= 0.2) break
    const part = tmp(`seg-${i}.mp4`)
    work.push(part)
    parts.push(part)
    const z = PUNCH_ZOOM
    const vf = i % 2 === 1
      ? `crop=iw/${z}:ih/${z}:(iw-iw/${z})/2:(ih-ih/${z})*0.35,scale=1080:1920,setsar=1`
      : 'scale=1080:1920,setsar=1'
    ff(['-y', '-ss', start.toFixed(2), '-t', len.toFixed(2), '-i', inPath, '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-c:a', 'aac', '-b:a', '160k', part])
  }
  const listFile = tmp('concat.txt')
  work.push(listFile)
  writeFileSync(listFile, parts.map(p => `file '${p}'`).join('\n'))
  ff(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath])
}

/** DM Sans variable woff2 shipped with the app's @fontsource dependency; freetype in ffmpeg-static reads it on most builds. */
function resolveCaptionFontFile(): string | null {
  try {
    const req = createRequire(import.meta.url)
    const p = req.resolve('@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2')
    return existsSync(p) ? p : null
  } catch {
    return null
  }
}

/** Char-proportional cues across the video — the pre-timestamps fallback recipe. */
function proportionalCues(phrases: string[], durationSeconds: number): CaptionCue[] {
  const totalChars = phrases.reduce((s, p) => s + p.length, 0)
  if (!totalChars) return []
  let t = 0
  return phrases.map(p => {
    const w = (p.length / totalChars) * durationSeconds
    const cue = { text: p, start: t, end: t + w }
    t += w
    return cue
  })
}

/**
 * Burn caption cues (each with explicit start/end seconds). Word-timed cues
 * come from ElevenLabs with-timestamps via caption-timing.ts; the
 * char-proportional fallback builds cues from phrase lengths. Tries DM Sans
 * first, then the runtime's fontconfig default.
 */
function burnCaptions(inPath: string, outPath: string, cues: CaptionCue[], work: string[]): void {
  if (!cues.length) throw new Error('burnCaptions: no cues')
  const buildFilters = (fontFile: string | null): string => {
    const filters: string[] = []
    cues.forEach((cue, i) => {
      const file = tmp(`cap-${i}.txt`)
      work.push(file)
      writeFileSync(file, cue.text)
      const fontArg = fontFile ? `fontfile=${fontFile}:` : ''
      filters.push(
        `drawtext=${fontArg}textfile=${file}:fontsize=52:fontcolor=white:borderw=3:bordercolor=black@0.65:x=(w-text_w)/2:y=h*0.78:enable='between(t,${cue.start.toFixed(2)},${cue.end.toFixed(2)})'`,
      )
    })
    return filters.join(',')
  }
  const fontFile = resolveCaptionFontFile()
  try {
    ff(['-y', '-i', inPath, '-vf', buildFilters(fontFile), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-c:a', 'copy', outPath])
  } catch (err) {
    if (!fontFile) throw err
    console.warn('[video-postpass] DM Sans fontfile failed, retrying with fontconfig default:', err instanceof Error ? err.message.slice(0, 200) : err)
    ff(['-y', '-i', inPath, '-vf', buildFilters(null), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-c:a', 'copy', outPath])
  }
}

/** Music bed at -20dB with fades, mixed under speech, then -14 LUFS loudnorm. Falls back to loudnorm-only when music generation fails. */
async function addMusicAndLoudnorm(
  inPath: string,
  outPath: string,
  durationSeconds: number,
  work: string[],
  costRef?: { sku: string; refId: string },
): Promise<void> {
  let musicPath: string | null = null
  try {
    const music = await generateMusic({
      prompt: MUSIC_BED_PROMPT,
      durationMs: Math.ceil(durationSeconds * 1000),
      instrumental: true,
    })
    musicPath = tmp('bed.mp3')
    work.push(musicPath)
    writeFileSync(musicPath, music)
    // Token-log only (best-effort): music spend attributes to the video team's
    // budget via the 'video-' feature prefix; job costUsd is not threaded back
    // through the post pass, and all ceiling checks happen pre-assembly.
    if (costRef) {
      void logVideoCost({
        feature: 'video-music',
        model: 'elevenlabs/music',
        seconds: Math.ceil(durationSeconds),
        caller: 'video-postpass',
        sku: costRef.sku,
        refId: costRef.refId,
      })
    }
  } catch (err) {
    console.warn('[video-postpass] music bed generation failed, loudnorm only:', err instanceof Error ? err.message.slice(0, 200) : err)
  }
  if (musicPath) {
    ff([
      '-y', '-i', inPath, '-i', musicPath,
      '-filter_complex',
      `[1:a]volume=0.10,afade=t=in:d=1,afade=t=out:st=${Math.max(0, durationSeconds - 1.5).toFixed(2)}:d=1.5[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0[mix];[mix]loudnorm=I=-14:TP=-1.5:LRA=11[out]`,
      '-map', '0:v', '-map', '[out]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      outPath,
    ])
  } else {
    ff([
      '-y', '-i', inPath,
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      outPath,
    ])
  }
}

export interface PostPassOpts {
  /** Caption phrases in speech order (captionPhrases(presenterLine)); empty skips the caption burn. */
  phrases: string[]
  /**
   * Real word timings from TTS time (scriptJson.wordTimings). When present the
   * caption burn uses cue-grouped real timings; absent falls back to the
   * char-proportional phrase recipe.
   */
  wordTimings?: WordTiming[]
  /** Attribution for the music-bed spend log (job sku + jobId). Absent = unlogged (legacy behavior). */
  costRef?: { sku: string; refId: string }
}

/** Run the full post pass. Each step falls back to its input on failure so a degraded master still ships. */
export async function runPostPass(video: Buffer, opts: PostPassOpts): Promise<Buffer> {
  const work: string[] = []
  const inPath = tmp('in.mp4')
  work.push(inPath)
  try {
    writeFileSync(inPath, video)
    const durationSeconds = probeMediaDurationSeconds(inPath)
    if (durationSeconds <= 0) {
      console.warn('[video-postpass] could not probe duration, skipping post pass')
      return video
    }

    let current = inPath
    try {
      const punched = tmp('punched.mp4')
      work.push(punched)
      applyPunchIns(current, punched, durationSeconds, work)
      current = punched
    } catch (err) {
      console.warn('[video-postpass] punch-ins failed, continuing without:', err instanceof Error ? err.message.slice(0, 200) : err)
    }

    const cues = opts.wordTimings?.length
      ? groupWordTimingsIntoCues(opts.wordTimings)
      : proportionalCues(opts.phrases, durationSeconds)
    if (cues.length) {
      try {
        const captioned = tmp('captioned.mp4')
        work.push(captioned)
        burnCaptions(current, captioned, cues, work)
        current = captioned
      } catch (err) {
        console.warn('[video-postpass] captions failed, continuing without:', err instanceof Error ? err.message.slice(0, 200) : err)
      }
    }

    try {
      const out = tmp('out.mp4')
      work.push(out)
      await addMusicAndLoudnorm(current, out, durationSeconds, work, opts.costRef)
      return readFileSync(out)
    } catch (err) {
      console.warn('[video-postpass] loudness stage failed, shipping previous step:', err instanceof Error ? err.message.slice(0, 200) : err)
      return current === inPath ? video : readFileSync(current)
    }
  } finally {
    cleanup(work)
  }
}

// ── End card ─────────────────────────────────────────────────────────────────

/**
 * 1.5s closing card: paper ground, centered logo, one whitelist CTA line
 * (ENDCARD_CTA_WHITELIST in team-keys). Composited with sharp, rendered to a
 * silent 1080x1920 clip, appended by the caller via concatWithAudio. Gated by
 * the video_endcard_enabled valve; any failure means the video ships without.
 */
export async function buildEndCard(opts: { ctaLine: string; durationSeconds?: number }): Promise<Buffer> {
  const duration = opts.durationSeconds ?? 1.5
  const work: string[] = []
  const cardPng = tmp('endcard.png')
  const output = tmp('endcard.mp4')
  work.push(cardPng, output)
  try {
    const logo = await fetchLogoPng()
    const logoLayer = logo
      ? [{ input: await sharp(logo).resize(360, 360, { fit: 'inside' }).png().toBuffer(), top: 780, left: 360 }]
      : []
    // CTA as SVG text: DM Sans if the viewer has it, sans-serif otherwise —
    // sharp rasterizes with its own fontconfig, independent of ffmpeg's.
    const cta = opts.ctaLine.replace(/[<>&]/g, '')
    const ctaSvg = Buffer.from(
      `<svg width="1080" height="120"><text x="540" y="80" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="56" fill="#1A1418">${cta}</text></svg>`,
    )
    const card = await sharp({
      create: { width: 1080, height: 1920, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite([
        ...logoLayer.map(l => ({ input: l.input, top: l.top, left: Math.round((1080 - 360) / 2) })),
        { input: ctaSvg, top: 1220, left: 0 },
      ])
      .png()
      .toBuffer()
    writeFileSync(cardPng, card)
    ff([
      '-y',
      '-loop', '1', '-t', duration.toFixed(2), '-i', cardPng,
      '-f', 'lavfi', '-t', duration.toFixed(2), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map', '0:v', '-map', '1:a',
      '-vf', 'scale=1080:1920,setsar=1,fps=30',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '19',
      '-c:a', 'aac', '-b:a', '160k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      output,
    ])
    return readFileSync(output)
  } finally {
    cleanup(work)
  }
}
