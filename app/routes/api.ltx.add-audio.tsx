/**
 * api.ltx.add-audio.tsx
 *
 * Adds audio to an existing LTX video:
 *   1. Generate audio via ElevenLabs (voiceover, sfx, or music)
 *   2. Mux audio + video with ffmpeg
 *   3. Update KV with new video path
 *   4. Return updated preview URL
 */

import type { ActionFunctionArgs } from 'react-router'
import { writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { requireAdmin } from '~/lib/session.server'
import { apiError } from '~/lib/api-error.server'
import { kvGet, kvSet, KV_KEYS } from '~/lib/kv.server'
import {
  generateVoiceover,
  generateSoundEffect,
  generateMusic,
  type AudioType,
} from '~/lib/elevenlabs.server'

import ffmpegPath from 'ffmpeg-static'

interface LtxKVState {
  status:         'complete' | 'error'
  enhancedPrompt: string
  productId:      string
  productName:    string
  videoPaths?:    string[]
  videoUrls?:     string[]
  startedAt:      number
}

const VALID_AUDIO_TYPES = new Set<AudioType>(['voiceover', 'sfx', 'music'])

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form      = await request.formData()
  const token     = form.get('token') as string
  const audioType = form.get('audioType') as AudioType
  const audioText = form.get('audioText') as string

  if (!token) {
    return Response.json({ error: 'Missing token' }, { status: 400 })
  }
  if (!VALID_AUDIO_TYPES.has(audioType)) {
    return Response.json({ error: 'audioType must be "voiceover", "sfx", or "music"' }, { status: 400 })
  }
  if (!audioText?.trim()) {
    return Response.json({ error: 'Audio text/prompt is required' }, { status: 400 })
  }

  // ── Read KV state ─────────────────────────────────────────────────────────
  const state = await kvGet<LtxKVState>(KV_KEYS.ltxOperation(token))
  if (!state || state.status !== 'complete' || !state.videoPaths) {
    return Response.json({ error: 'Operation not found, not complete, or expired' }, { status: 404 })
  }

  // Always read from the original video (not a previous mix)
  const originalPath = `/tmp/ltx-${token}-0.mp4`
  if (!existsSync(originalPath)) {
    return Response.json({ error: 'Original video file not found' }, { status: 404 })
  }

  // ── Step 1: Generate audio via ElevenLabs ─────────────────────────────────
  let audioBuffer: Buffer
  try {
    // Detect video duration for music/sfx length matching
    const durationSec = getVideoDuration(originalPath)

    if (audioType === 'voiceover') {
      audioBuffer = await generateVoiceover({ text: audioText })
    } else if (audioType === 'sfx') {
      audioBuffer = await generateSoundEffect({
        prompt: audioText,
        durationSeconds: Math.min(Math.round(durationSec), 30),
      })
    } else {
      audioBuffer = await generateMusic({
        prompt: audioText,
        durationMs: Math.round(durationSec * 1000),
        instrumental: true,
      })
    }
  } catch (err) {
    return apiError(`ltx.add-audio:${audioType}`, err, 'Audio generation failed', 502)
  }

  // ── Step 2: Save audio to /tmp ────────────────────────────────────────────
  const audioPath = `/tmp/ltx-${token}-audio.mp3`
  writeFileSync(audioPath, audioBuffer)

  // ── Step 3: Mux audio + video with ffmpeg ─────────────────────────────────
  const mixedPath = `/tmp/ltx-${token}-0-mixed.mp4`
  try {
    execFileSync(ffmpegPath!, [
      '-y',                    // overwrite output
      '-i', originalPath,      // video input
      '-i', audioPath,         // audio input
      '-c:v', 'copy',         // copy video stream (no re-encoding)
      '-c:a', 'aac',          // encode audio to AAC
      '-b:a', '128k',         // audio bitrate
      '-shortest',            // stop at shorter stream
      '-movflags', '+faststart',
      mixedPath,
    ], { timeout: 30_000 })
  } catch (err) {
    return apiError('ltx.add-audio:ffmpeg', err, 'Audio muxing failed', 500)
  }

  if (!existsSync(mixedPath)) {
    return Response.json({ error: 'Muxed video was not created' }, { status: 500 })
  }

  // ── Step 4: Update KV with mixed video path ──────────────────────────────
  const videoUrl = `/api/ltx/preview/${token}/0`

  await kvSet(KV_KEYS.ltxOperation(token), {
    ...state,
    videoPaths: [mixedPath],
    videoUrls:  [videoUrl],
    hasAudio:   true,
    audioType,
  }, 3600)

  return Response.json({
    ok: true,
    videoUrl,
    audioType,
  })
}

// ─── Helper: get video duration via ffprobe ─────────────────────────────────

function getVideoDuration(filePath: string): number {
  try {
    // ffmpeg-static only provides ffmpeg, not ffprobe
    // Use ffmpeg to extract duration from stderr
    execFileSync(ffmpegPath!, [
      '-i', filePath,
      '-f', 'null', '-',
    ], { timeout: 10_000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return 8 // fallback — ffmpeg exits non-zero above, caught below
  } catch (err: unknown) {
    // ffmpeg writes info to stderr and exits with error when using -f null
    const stderr = (err as { stderr?: string }).stderr ?? ''
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
    if (match) {
      const [, h, m, s] = match
      return parseInt(h!, 10) * 3600 + parseInt(m!, 10) * 60 + parseInt(s!, 10)
    }
    return 8 // fallback to 8 seconds
  }
}
