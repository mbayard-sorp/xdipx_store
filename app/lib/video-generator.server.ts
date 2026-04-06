/**
 * video-generator.server.ts
 *
 * Final import step — generates a 10-second product ad video and attaches it
 * to the Shopify product as primary media, plus exports frame 0 as a thumbnail.
 *
 * Pipeline:
 *   1. Generate narrator script + reactions via Claude
 *   2. Synthesize VO audio via ElevenLabs (Rachel → Bella → Erin → fallback)
 *   3. Render 300-frame / 30fps vertical video via Remotion (1080×1920)
 *   4. Export frame 0 as JPEG thumbnail
 *   5. Staged upload to Shopify → productCreateMedia → poll READY
 *   6. Upload thumbnail as product featured image
 *   7. Set video as primary media (home hero + PDP)
 *   8. Clean up temp files
 *
 * Set VIDEO_REVIEW_MODE=true in .env to pause after step 1 for human review.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { generateVideoContent } from './claude.server'
import { getSiteSettings } from './sanity.server'
import {
  createStagedVideoUpload,
  attachVideoToProduct,
  pollMediaReady,
  setMediaAsPrimary,
  uploadThumbnailToProduct,
} from './shopify.server'

// Sanity logo URL — fallback if CMS is unavailable
const LOGO_FALLBACK = 'https://cdn.sanity.io/images/0nlwk8cf/production/810b2316459824c033570e91758281e33633fb0c-149x60.svg'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VideoGenerationInput {
  productId: string          // Shopify GID, e.g. gid://shopify/Product/123
  productName: string
  imageUrls: string[]        // at least 1 Shopify CDN URL (cycles if < 2)
  category: string
  tagline?: string
  brand: string
  dealPrice?: number
  msrp?: number
  fullStory?: string
  worksForHim?: string
  worksForHer?: string
  featureBullets?: string[]
  specifications?: string
  whatsInTheBox?: string     // boxContents joined as a string
  durationSeconds?: number   // video length — defaults to 10s (300 frames @ 30fps)
}

export interface VideoGenerationResult {
  narrator_script: string
  format_chosen: string
  format_rationale: string
  elevenlabs_voice_used: string
  music_prompt_used: string | null
  shopify_media_asset_id: string
  thumbnail_set: { home_page: boolean; pdp: boolean }
  status: 'complete' | 'review_pause' | 'error'
  error?: string
}

// ─── ElevenLabs voice selection ───────────────────────────────────────────────

const PREFERRED_VOICES = [
  { name: 'Rachel', id: '21m00Tcm4TlvDq8ikWAM' },
  { name: 'Bella',  id: 'EXAVITQu4vr4xnSDxMaL' },
  { name: 'Erin',   id: 'o1DAT1dzAFpMmOZxRZHj' },
]

async function resolveVoiceId(apiKey: string): Promise<{ name: string; id: string }> {
  const cached = process.env['ELEVENLABS_VOICE_ID']
  if (cached) {
    const known = PREFERRED_VOICES.find(v => v.id === cached)
    return known ?? { name: 'Cached', id: cached }
  }

  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  })
  if (!res.ok) throw new Error(`ElevenLabs /voices failed: ${res.status}`)
  const { voices } = await res.json() as {
    voices: { voice_id: string; name: string; labels: Record<string, string>; settings?: { stability: number } }[]
  }

  for (const preferred of PREFERRED_VOICES) {
    if (voices.some(v => v.voice_id === preferred.id)) return preferred
  }

  const female = voices
    .filter(v => v.labels?.['gender'] === 'female' && v.settings?.stability !== undefined)
    .sort((a, b) => (b.settings?.stability ?? 0) - (a.settings?.stability ?? 0))
  if (female[0]) return { name: female[0].name, id: female[0].voice_id }

  throw new Error('ElevenLabs: no suitable female voice found')
}

// ─── Step 2: ElevenLabs TTS ───────────────────────────────────────────────────

async function synthesizeVO(script: string, voiceName: string, voiceId: string, outputPath: string): Promise<void> {
  const apiKey = process.env['ELEVENLABS_API_KEY']
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set')

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: script,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.75,
        style: 0.40,
        use_speaker_boost: true,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`ElevenLabs TTS failed (${res.status}) for voice ${voiceName}: ${body}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  writeFileSync(outputPath, buffer)
  console.log(`[video-generator] VO audio saved: ${outputPath} (${buffer.length} bytes)`)
}

// ─── Step 2b: Music prompt derivation + ElevenLabs Music Generation ──────────

function deriveMusicPrompt(category: string): string {
  const cat = category.toLowerCase()
  if (cat.includes('couple'))                    return 'playful bedroom pop, warm synths, slow tempo, intimate and fun, no lyrics'
  if (cat.includes('him') || cat.includes('strok')) return 'confident lo-fi beat, deep bass, smooth, understated cool, no lyrics'
  if (cat.includes('her') || cat.includes('vibrat')) return 'bright synth-pop, upbeat, empowering, slightly cheeky, no lyrics'
  if (cat.includes('lube'))                      return 'smooth jazz parody, overly suave, slightly comedic, warm, no lyrics'
  return 'quirky upbeat indie pop, curious and warm, light percussion, no lyrics'
}

async function generateMusic(musicPrompt: string, durationSeconds: number, outputPath: string): Promise<void> {
  const apiKey = process.env['ELEVENLABS_API_KEY']
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set')

  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: musicPrompt,
      duration_seconds: Math.min(durationSeconds + 2, 22), // slight buffer, API max ~22s
      prompt_influence: 0.4,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`ElevenLabs music generation failed (${res.status}): ${body}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  writeFileSync(outputPath, buffer)
  console.log(`[video-generator] Music saved: ${outputPath} (${buffer.length} bytes)`)
}

// ─── Step 3+4: Remotion render + thumbnail ────────────────────────────────────

async function renderVideo(
  input: VideoGenerationInput,
  voAudioFile: string,
  musicAudioFile: string | null,
  narratorScript: string,
  reactionText: string[],
  endTagline: string,
  ctaWord: string,
  logoUrl: string,
  outputPath: string,
  thumbPath: string,
): Promise<void> {
  const { bundle } = await import('@remotion/bundler')
  const { renderMedia, renderStill, selectComposition } = await import('@remotion/renderer')

  const entryPoint = join(process.cwd(), 'remotion/index.ts')
  const bundleOutDir = join(process.cwd(), '.remotion-bundle')

  console.log('[video-generator] Bundling Remotion project...')
  const serveUrl = await bundle({ entryPoint, outDir: bundleOutDir })

  // Write VO and music audio directly into bundle public dir (bundle() may use cache)
  const voBundlePublicDir = join(bundleOutDir, 'public')
  mkdirSync(voBundlePublicDir, { recursive: true })
  const voSourcePath = join(process.cwd(), 'remotion/public', voAudioFile)
  writeFileSync(join(voBundlePublicDir, voAudioFile), readFileSync(voSourcePath))
  console.log('[video-generator] VO file written to bundle public dir')

  if (musicAudioFile) {
    const musicSourcePath = join(process.cwd(), 'remotion/public', musicAudioFile)
    if (existsSync(musicSourcePath)) {
      writeFileSync(join(voBundlePublicDir, musicAudioFile), readFileSync(musicSourcePath))
      console.log('[video-generator] Music file written to bundle public dir')
    }
  }

  const durationSeconds = input.durationSeconds ?? 10
  const totalDurationInFrames = Math.max(240, Math.min(1800, Math.round(durationSeconds * 30)))

  const inputProps = {
    productId:   input.productId,
    productName: input.productName,
    imageUrls:   input.imageUrls,
    voAudioFile,
    narratorScript,
    reactionText,
    endTagline,
    ctaWord,
    logoUrl,
    totalDurationInFrames,
    ...(input.brand         ? { brand:         input.brand }         : {}),
    ...(input.dealPrice     ? { dealPrice:     input.dealPrice }     : {}),
    ...(input.msrp          ? { msrp:          input.msrp }          : {}),
    ...(musicAudioFile      ? { musicAudioFile }                     : {}),
  }

  console.log('[video-generator] Selecting composition...')
  const composition = await selectComposition({
    serveUrl,
    id: 'ProductAd',
    inputProps,
  })

  // Export frame 0 as JPEG thumbnail
  console.log('[video-generator] Exporting frame 0 as thumbnail...')
  await renderStill({
    composition,
    serveUrl,
    output: thumbPath,
    inputProps,
    frame: 0,
    imageFormat: 'jpeg',
    jpegQuality: 90,
  })
  console.log(`[video-generator] Thumbnail saved: ${thumbPath}`)

  console.log('[video-generator] Rendering video...')
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
  })

  console.log(`[video-generator] Render complete: ${outputPath}`)
}

// ─── Step 5: Shopify staged video upload ─────────────────────────────────────

async function uploadVideoToShopify(
  shopifyProductGid: string,
  productName: string,
  videoPath: string,
): Promise<{ mediaId: string; ready: boolean }> {
  const videoBuffer = readFileSync(videoPath)
  const filename = `xdipx-product-ad-${Date.now()}.mp4`

  console.log('[video-generator] Creating Shopify staged upload...')
  const staged = await createStagedVideoUpload(filename, videoBuffer.length)

  console.log('[video-generator] Uploading video to staged URL...')
  const form = new FormData()
  for (const param of staged.parameters) {
    form.append(param.name, param.value)
  }
  form.append('file', new Blob([videoBuffer], { type: 'video/mp4' }), filename)

  const uploadRes = await fetch(staged.url, { method: 'POST', body: form })
  if (!uploadRes.ok) {
    throw new Error(`Staged video upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  }

  console.log('[video-generator] Attaching video to Shopify product...')
  const altText = `${productName} — xdipx daily deal`
  const mediaId = await attachVideoToProduct(shopifyProductGid, staged.resourceUrl, altText)
  console.log(`[video-generator] Media created: ${mediaId}`)

  console.log('[video-generator] Polling for media READY status (max 90s)...')
  const ready = await pollMediaReady(shopifyProductGid, mediaId)
  if (!ready) {
    console.warn('[video-generator] Media not READY after 90s — continuing async')
  }

  return { mediaId, ready }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateProductVideo(
  input: VideoGenerationInput,
): Promise<VideoGenerationResult> {
  const { productId, productName } = input
  const numericId = productId.replace('gid://shopify/Product/', '')
  const tmpVoPath    = `/tmp/vo_${numericId}.mp3`
  const tmpVideoPath = `/tmp/product_${numericId}.mp4`
  const tmpThumbPath = `/tmp/thumb_${numericId}.jpg`
  const remotionPublicDir = join(process.cwd(), 'remotion/public')
  const voFilename = `vo_${numericId}.mp3`
  const remotionVoPath = join(remotionPublicDir, voFilename)

  // ── Step 0: Fetch logo from Sanity ──────────────────────────────────────────
  let logoUrl = LOGO_FALLBACK
  try {
    const settings = await getSiteSettings()
    if (settings?.logoUrl) logoUrl = settings.logoUrl
  } catch {
    console.warn('[video-generator] Could not fetch logo from Sanity — using fallback')
  }
  console.log(`[video-generator] Logo URL: ${logoUrl}`)

  // ── Step 1: Generate narrator script + reactions ─────────────────────────────
  console.log('[video-generator] Step 1: Generating narrator script via Claude...')
  const content = await generateVideoContent({
    title:    input.productName,
    brand:    input.brand,
    category: input.category,
    ...(input.tagline        ? { tagline:        input.tagline }        : {}),
    ...(input.dealPrice      ? { dealPrice:      input.dealPrice }      : {}),
    ...(input.msrp           ? { msrp:           input.msrp }           : {}),
    ...(input.fullStory      ? { fullStory:      input.fullStory }      : {}),
    ...(input.worksForHim    ? { worksForHim:    input.worksForHim }    : {}),
    ...(input.worksForHer    ? { worksForHer:    input.worksForHer }    : {}),
    ...(input.featureBullets ? { featureBullets: input.featureBullets } : {}),
    ...(input.specifications ? { specifications: input.specifications } : {}),
    ...(input.whatsInTheBox  ? { whatsInTheBox:  input.whatsInTheBox }  : {}),
  })

  console.log(`[video-generator] Format: ${content.format}`)
  console.log(`[video-generator] Rationale: ${content.formatRationale}`)
  console.log(`[video-generator] Narrator script: ${content.narratorScript}`)
  console.log(`[video-generator] Reactions: ${JSON.stringify(content.reactionText)}`)
  console.log(`[video-generator] End tagline: ${content.endTagline}`)

  if (process.env['VIDEO_REVIEW_MODE'] === 'true') {
    console.log('[video-generator] VIDEO_REVIEW_MODE=true — pausing for human review.')
    return {
      narrator_script:        content.narratorScript,
      format_chosen:          content.format,
      format_rationale:       content.formatRationale,
      elevenlabs_voice_used:  '(not yet synthesized — review mode)',
      music_prompt_used:      null,
      shopify_media_asset_id: '',
      thumbnail_set: { home_page: false, pdp: false },
      status: 'review_pause',
    }
  }

  // ── Step 2: Voice + Music synthesis (parallel) ──────────────────────────────
  console.log('[video-generator] Step 2: Synthesizing VO + music with ElevenLabs (parallel)...')
  const apiKey = process.env['ELEVENLABS_API_KEY']
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set in environment')

  const voice = await resolveVoiceId(apiKey)
  console.log(`[video-generator] Using voice: ${voice.name} (${voice.id})`)

  const durationSeconds = input.durationSeconds ?? 10
  const musicPrompt = deriveMusicPrompt(input.category)
  const tmpMusicPath = `/tmp/music_${numericId}.mp3`
  const musicFilename = `music_${numericId}.mp3`
  const remotionMusicPath = join(remotionPublicDir, musicFilename)

  let musicAudioFile: string | null = null

  const [voResult, musicResult] = await Promise.allSettled([
    synthesizeVO(content.narratorScript, voice.name, voice.id, tmpVoPath),
    generateMusic(musicPrompt, durationSeconds, tmpMusicPath),
  ])

  if (voResult.status === 'rejected') {
    console.error('[video-generator] ElevenLabs TTS failed — aborting:', voResult.reason)
    throw voResult.reason
  }

  if (musicResult.status === 'rejected') {
    console.warn('[video-generator] Music generation failed (non-fatal) — continuing without music:', musicResult.reason)
  } else {
    musicAudioFile = musicFilename
    console.log(`[video-generator] Music prompt used: "${musicPrompt}"`)
  }

  mkdirSync(remotionPublicDir, { recursive: true })
  writeFileSync(remotionVoPath, readFileSync(tmpVoPath))
  if (musicAudioFile && existsSync(tmpMusicPath)) {
    writeFileSync(remotionMusicPath, readFileSync(tmpMusicPath))
  }

  // ── Step 3+4: Render + thumbnail ────────────────────────────────────────────
  console.log('[video-generator] Step 3: Rendering video with Remotion...')
  try {
    await renderVideo(
      input,
      voFilename,
      musicAudioFile,
      content.narratorScript,
      content.reactionText,
      content.endTagline,
      content.ctaWord,
      logoUrl,
      tmpVideoPath,
      tmpThumbPath,
    )
  } catch (err) {
    if (existsSync(remotionVoPath)) unlinkSync(remotionVoPath)
    if (musicAudioFile && existsSync(remotionMusicPath)) unlinkSync(remotionMusicPath)
    console.error('[video-generator] Remotion render failed — aborting:', err)
    throw err
  }

  if (existsSync(remotionVoPath)) unlinkSync(remotionVoPath)
  if (musicAudioFile && existsSync(remotionMusicPath)) unlinkSync(remotionMusicPath)

  // ── Step 5: Shopify video upload ─────────────────────────────────────────────
  console.log('[video-generator] Step 4: Uploading video to Shopify...')
  let mediaId: string
  let ready: boolean

  try {
    const result = await uploadVideoToShopify(productId, productName, tmpVideoPath)
    mediaId = result.mediaId
    ready = result.ready
  } catch (err) {
    console.error('[video-generator] Shopify video upload failed — product left intact:', err)
    throw err
  }

  let thumbnailSet = { home_page: false, pdp: false }
  if (ready) {
    try {
      await setMediaAsPrimary(productId, mediaId)
      thumbnailSet = { home_page: true, pdp: true }
      console.log('[video-generator] Video set as primary media')
    } catch (err) {
      console.warn('[video-generator] Could not set video as primary (non-fatal):', err)
    }
  }

  // ── Step 6: Upload thumbnail image ───────────────────────────────────────────
  if (existsSync(tmpThumbPath)) {
    console.log('[video-generator] Step 5: Uploading thumbnail to Shopify...')
    try {
      const thumbBuffer = readFileSync(tmpThumbPath)
      const thumbFilename = `xdipx-thumb-${Date.now()}.jpg`
      await uploadThumbnailToProduct(productId, thumbBuffer, thumbFilename, `${productName} — xdipx daily deal`)
      console.log('[video-generator] Thumbnail uploaded to Shopify')
    } catch (err) {
      console.warn('[video-generator] Thumbnail upload failed (non-fatal):', err)
    }
  }

  // ── Cleanup /tmp ────────────────────────────────────────────────────────────
  for (const path of [tmpVoPath, tmpMusicPath, tmpVideoPath, tmpThumbPath]) {
    try { if (existsSync(path)) unlinkSync(path) } catch { /* non-fatal */ }
  }

  const result: VideoGenerationResult = {
    narrator_script:        content.narratorScript,
    format_chosen:          content.format,
    format_rationale:       content.formatRationale,
    elevenlabs_voice_used:  voice.name,
    music_prompt_used:      musicAudioFile ? musicPrompt : null,
    shopify_media_asset_id: mediaId,
    thumbnail_set:          thumbnailSet,
    status: 'complete',
  }

  console.log('[video-generator] Complete:', JSON.stringify(result, null, 2))
  return result
}
