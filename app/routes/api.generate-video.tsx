/**
 * api.generate-video.tsx
 *
 * Generates a product video (narrator script → ElevenLabs → Remotion render).
 * Also exports frame 0 as a JPEG thumbnail.
 * Does NOT upload to Shopify — returns a preview token the client uses to
 * stream the file from /api/video-preview/:token.
 *
 * Called by the admin Video Settings section.
 */

import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { generateVideoContent, type VOFormat } from '~/lib/claude.server'
import { getSiteSettings } from '~/lib/sanity.server'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const LOGO_FALLBACK = 'https://cdn.sanity.io/images/0nlwk8cf/production/810b2316459824c033570e91758281e33633fb0c-149x60.svg'

// Temp preview dir — videos expire after 30 min (cleanup handled lazily)
const PREVIEW_DIR = join(process.cwd(), '.video-previews')

const VALID_FORMATS = new Set<VOFormat>([
  'sitcom_sketch', 'fake_testimonial', 'educational', 'breaking_news', 'absurdist_narrator',
])

const KNOWN_VOICES: Record<string, { id: string; name: string }> = {
  Rachel: { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
  Bella:  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella'  },
  Erin:   { id: 'o1DAT1dzAFpMmOZxRZHj', name: 'Erin'   },
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form        = await request.formData()
  const productId   = form.get('productId')   as string
  const productName = form.get('productName') as string
  const brand       = form.get('brand')       as string
  const category    = form.get('category')    as string
  const tagline     = (form.get('tagline')    as string) || undefined
  const dealPrice   = parseFloat(form.get('dealPrice') as string) || undefined
  const msrp        = parseFloat(form.get('msrp')      as string) || undefined
  const imageUrls   = JSON.parse((form.get('imageUrls') as string) || '[]') as string[]
  const rawDuration = parseFloat(form.get('durationSeconds') as string)
  const durationSeconds = Number.isFinite(rawDuration) ? Math.max(8, Math.min(60, rawDuration)) : 10
  const totalDurationInFrames = Math.round(durationSeconds * 30)

  const customPrompt    = (form.get('customPrompt')    as string) || undefined
  const fullStory       = (form.get('fullStory')       as string) || undefined
  const worksForHim     = (form.get('worksForHim')     as string) || undefined
  const worksForHer     = (form.get('worksForHer')     as string) || undefined
  const specifications  = (form.get('specifications')  as string) || undefined
  const whatsInTheBox   = (form.get('whatsInTheBox')   as string) || undefined
  const featureBullets  = form.get('featureBullets')
    ? JSON.parse(form.get('featureBullets') as string) as string[]
    : undefined

  // Admin-pinned format + voice
  const rawFormat  = form.get('format') as string | null
  const forceFormat: VOFormat | undefined =
    rawFormat && rawFormat !== 'custom' && VALID_FORMATS.has(rawFormat as VOFormat) ? (rawFormat as VOFormat) : undefined
  const customFormatText = rawFormat === 'custom' ? ((form.get('customFormatText') as string) || undefined) : undefined
  const rawVoice       = (form.get('voice') as string) || 'Bella'
  const selectedVoice  = KNOWN_VOICES[rawVoice] ?? KNOWN_VOICES['Bella']!

  if (!productId || !productName || !brand || !category) {
    return Response.json({ error: 'Missing required fields: productId, productName, brand, category' }, { status: 400 })
  }
  if (imageUrls.length === 0) {
    return Response.json({ error: 'At least one imageUrl is required' }, { status: 400 })
  }

  // ── Step 1: Fetch logo ──────────────────────────────────────────────────────
  let logoUrl = LOGO_FALLBACK
  try {
    const settings = await getSiteSettings()
    if (settings?.logoUrl) logoUrl = settings.logoUrl
  } catch { /* fallback */ }

  // ── Step 2: Generate narrator script + reactions via Claude ─────────────────
  const content = await generateVideoContent({
    title:    productName,
    brand,
    category,
    ...(tagline        ? { tagline }        : {}),
    ...(dealPrice      ? { dealPrice }      : {}),
    ...(msrp           ? { msrp }           : {}),
    ...(fullStory      ? { fullStory }      : {}),
    ...(worksForHim    ? { worksForHim }    : {}),
    ...(worksForHer    ? { worksForHer }    : {}),
    ...(specifications ? { specifications } : {}),
    ...(whatsInTheBox  ? { whatsInTheBox }  : {}),
    ...(featureBullets ? { featureBullets } : {}),
    ...(customPrompt   ? { customPrompt }   : {}),
    ...(forceFormat    ? { forceFormat }    : {}),
    ...(customFormatText ? { customFormatDescription: customFormatText } : {}),
  })

  // ── Step 3: ElevenLabs VO + Music synthesis (parallel) ──────────────────────
  const { bundle } = await import('@remotion/bundler')
  const { renderMedia, renderStill, selectComposition } = await import('@remotion/renderer')

  const apiKey = process.env['ELEVENLABS_API_KEY']
  if (!apiKey) return Response.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

  const voiceId   = selectedVoice.id
  const voiceName = selectedVoice.name

  const token            = randomBytes(16).toString('hex')
  const tmpVoPath        = `/tmp/vo_preview_${token}.mp3`
  const tmpMusicPath     = `/tmp/music_preview_${token}.mp3`
  const tmpVideoPath     = `/tmp/video_preview_${token}.mp4`
  const tmpThumbPath     = `/tmp/thumb_preview_${token}.jpg`
  const remotionPublicDir = join(process.cwd(), 'remotion/public')
  const voFilename        = `vo_preview_${token}.mp3`
  const musicFilename     = `music_preview_${token}.mp3`
  const remotionVoPath    = join(remotionPublicDir, voFilename)
  const remotionMusicPath = join(remotionPublicDir, musicFilename)

  // Derive music prompt from category
  function deriveMusicPrompt(cat: string): string {
    const c = cat.toLowerCase()
    if (c.includes('couple'))                      return 'playful bedroom pop, warm synths, slow tempo, intimate and fun, no lyrics'
    if (c.includes('him') || c.includes('strok'))  return 'confident lo-fi beat, deep bass, smooth, understated cool, no lyrics'
    if (c.includes('her') || c.includes('vibrat')) return 'bright synth-pop, upbeat, empowering, slightly cheeky, no lyrics'
    if (c.includes('lube'))                        return 'smooth jazz parody, overly suave, slightly comedic, warm, no lyrics'
    return 'quirky upbeat indie pop, curious and warm, light percussion, no lyrics'
  }
  const musicPrompt = deriveMusicPrompt(category)

  const [voResult, musicResult] = await Promise.allSettled([
    // VO synthesis
    fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: content.narratorScript,
        model_id: 'eleven_turbo_v2',
        voice_settings: { stability: 0.35, similarity_boost: 0.75, style: 0.40, use_speaker_boost: true },
      }),
    }),
    // Music generation
    fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: musicPrompt,
        duration_seconds: Math.min(durationSeconds + 2, 22),
        prompt_influence: 0.4,
      }),
    }),
  ])

  // VO is required — abort if failed
  if (voResult.status === 'rejected') {
    return Response.json({ error: `ElevenLabs VO failed: ${voResult.reason}` }, { status: 502 })
  }
  if (!voResult.value.ok) {
    return Response.json({ error: `ElevenLabs VO failed: ${voResult.value.status}` }, { status: 502 })
  }

  const voBuffer = Buffer.from(await voResult.value.arrayBuffer())
  writeFileSync(tmpVoPath, voBuffer)

  // Music is optional — continue without it on failure
  let musicAudioFile: string | null = null
  if (musicResult.status === 'fulfilled' && musicResult.value.ok) {
    const musicBuffer = Buffer.from(await musicResult.value.arrayBuffer())
    writeFileSync(tmpMusicPath, musicBuffer)
    musicAudioFile = musicFilename
  } else {
    console.warn('[generate-video] Music generation failed (non-fatal) — continuing without music')
  }

  mkdirSync(remotionPublicDir, { recursive: true })
  writeFileSync(remotionVoPath, voBuffer)
  if (musicAudioFile && existsSync(tmpMusicPath)) {
    writeFileSync(remotionMusicPath, readFileSync(tmpMusicPath))
  }

  // ── Step 4: Remotion render + frame 0 thumbnail ─────────────────────────────
  const entryPoint  = join(process.cwd(), 'remotion/index.ts')
  const bundleOutDir = join(process.cwd(), '.remotion-bundle')

  const serveUrl = await bundle({ entryPoint, outDir: bundleOutDir })

  const voBundlePublicDir = join(bundleOutDir, 'public')
  mkdirSync(voBundlePublicDir, { recursive: true })
  writeFileSync(join(voBundlePublicDir, voFilename), voBuffer)
  if (musicAudioFile && existsSync(tmpMusicPath)) {
    writeFileSync(join(voBundlePublicDir, musicFilename), readFileSync(tmpMusicPath))
  }

  const inputProps = {
    productId,
    productName,
    imageUrls,
    voAudioFile:          voFilename,
    narratorScript:       content.narratorScript,
    reactionText:         content.reactionText,
    endTagline:           content.endTagline,
    ctaWord:              content.ctaWord,
    logoUrl,
    totalDurationInFrames,
    ...(brand          ? { brand }          : {}),
    ...(dealPrice      ? { dealPrice }      : {}),
    ...(msrp           ? { msrp }           : {}),
    ...(musicAudioFile ? { musicAudioFile } : {}),
  }

  const composition = await selectComposition({ serveUrl, id: 'ProductAd', inputProps })

  // Export frame 0 as JPEG thumbnail — hard cut, no fade, fully composed
  await renderStill({
    composition,
    serveUrl,
    output: tmpThumbPath,
    inputProps,
    frame: 0,
    imageFormat: 'jpeg',
    jpegQuality: 90,
  })

  await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: tmpVideoPath, inputProps })

  // ── Step 5: Move to preview dir ─────────────────────────────────────────────
  mkdirSync(PREVIEW_DIR, { recursive: true })

  const previewVideoPath = join(PREVIEW_DIR, `${token}.mp4`)
  writeFileSync(previewVideoPath, readFileSync(tmpVideoPath))

  // Store thumbnail alongside video (same token, .jpg extension)
  const previewThumbPath = join(PREVIEW_DIR, `${token}.jpg`)
  if (existsSync(tmpThumbPath)) {
    writeFileSync(previewThumbPath, readFileSync(tmpThumbPath))
  }

  // Cleanup tmp files + remotion public assets
  for (const p of [tmpVoPath, tmpMusicPath, tmpVideoPath, tmpThumbPath, remotionVoPath, remotionMusicPath]) {
    try { if (existsSync(p)) (await import('node:fs')).unlinkSync(p) } catch { /* ok */ }
  }
  return Response.json({
    ok: true,
    token,
    previewUrl:      `/api/video-preview/${token}`,
    narratorScript:  content.narratorScript,
    reactionText:    content.reactionText,
    endTagline:      content.endTagline,
    format:          content.format,
    formatRationale: content.formatRationale,
    voiceName,
  })
}
