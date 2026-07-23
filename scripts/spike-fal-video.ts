/**
 * Phase 0 spike — compose-then-animate validation, run manually.
 *
 * Proves the production recipe end to end for one product: compose 3 candidate
 * scene frames (Emma canonical photo + the real product photo via nano-banana
 * edit), then animate the first frame on one or two model tiers via the fal
 * queue API. Outputs land in --out for the owner's review; likeness hold and
 * drift across the clip are the questions being answered.
 *
 * Usage:
 *   npx tsx scripts/spike-fal-video.ts --out /tmp/video-spike [--handle slug] \
 *     [--models kling25-pro,veo31-fast]
 *
 * Cost: ~$0.12 frames + ~$0.35 (kling 5s) + ~$1.20 (veo31-fast 8s) per run.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env' })
loadEnv({ path: '.env.local' })

const FRAME_PROMPT =
  'Editorial product scene, archetype C in-situ bright. The woman from the first image stands in a warm, ' +
  'sunlit private bedroom holding the product from the second image toward the camera in her open palm, ' +
  'product large and sharply in focus at the center of the frame, her face soft and friendly behind it. ' +
  'Coral-tinted white paper tones, high-key daylight, premium lingerie-campaign styling, fully clothed in ' +
  'elevated loungewear. Vertical 9:16 composition. No text, no words, no letters, no watermark, no logo.'

const MOTION_PROMPT =
  'She holds the product steady toward the camera and talks about it warmly, natural relaxed hand motion, ' +
  'a small genuine smile. Camera holds on the product with a slow gentle push-in. Bright editorial lighting ' +
  'stays constant. She says: "This one keeps selling out, and reviewers will not stop talking about it. Take a peek."'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const outIdx = args.indexOf('--out')
  const outDir = outIdx >= 0 ? args[outIdx + 1]! : '/tmp/video-spike'
  const handleIdx = args.indexOf('--handle')
  const modelsIdx = args.indexOf('--models')
  const modelIds = (modelsIdx >= 0 ? args[modelsIdx + 1]! : 'kling25-pro,veo31-fast').split(',')

  mkdirSync(outDir, { recursive: true })

  const { getEditorPhotoUrl } = await import('../app/lib/sanity.server')
  const shopify = await import('../app/lib/shopify.server')
  const {
    composeSceneFrame, submitVideoRequest, getVideoRequestStatus, getVideoRequestResult,
    downloadFalAsset, VIDEO_MODELS, isVideoModelId,
  } = await import('../app/lib/fal-video.server')

  // Resolve the product: --handle, else the first sitemap product with an image.
  let handle = handleIdx >= 0 ? args[handleIdx + 1]! : ''
  let productImageUrl = ''
  if (handle) {
    const product = await shopify.getProductByHandle(handle)
    productImageUrl = product?.images?.[0]?.url ?? ''
  } else {
    const map = await shopify.getProductImagesForSitemap()
    for (const [h, imgs] of map) {
      const first = (imgs as { images?: { url: string }[] }).images?.[0]?.url
      if (first) { handle = h; productImageUrl = first; break }
    }
  }
  if (!handle || !productImageUrl) throw new Error('No product with an image found (pass --handle)')

  const emmaUrl = await getEditorPhotoUrl()
  if (!emmaUrl) throw new Error('Emma canonical photo not found (singleton.editor)')

  console.log(`Spike product: ${handle}`)
  console.log('Composing 3 scene frames (Emma + product)...')
  const frames = await composeSceneFrame({
    prompt: FRAME_PROMPT,
    presenterImageUrl: emmaUrl,
    productImageUrl,
    count: 3,
  })
  for (let i = 0; i < frames.urls.length; i++) {
    const buf = await downloadFalAsset(frames.urls[i]!)
    writeFileSync(join(outDir, `frame-${i + 1}.jpg`), buf)
    console.log(`  frame-${i + 1}.jpg`)
  }
  const chosenFrame = frames.urls[0]!

  for (const modelId of modelIds) {
    if (!isVideoModelId(modelId)) { console.warn(`skip unknown model ${modelId}`); continue }
    const spec = VIDEO_MODELS[modelId]
    const duration = spec.allowedDurations.includes(8) ? 8 : spec.allowedDurations[0]!
    console.log(`Submitting ${modelId} (${duration}s, ~$${(spec.ratePerSecondUsd * duration).toFixed(2)})...`)
    const handle2 = await submitVideoRequest(modelId, {
      prompt: MOTION_PROMPT,
      imageUrl: chosenFrame,
      durationSeconds: duration,
      aspect: '9:16',
      generateAudio: spec.nativeAudio,
    })
    const started = Date.now()
    for (;;) {
      await new Promise(r => setTimeout(r, 10_000))
      const { status } = await getVideoRequestStatus(handle2)
      const elapsed = Math.round((Date.now() - started) / 1000)
      process.stdout.write(`\r  ${modelId}: ${status} (${elapsed}s)   `)
      if (status === 'COMPLETED') {
        const result = await getVideoRequestResult(handle2)
        const buf = await downloadFalAsset(result.videoUrl)
        const file = join(outDir, `video-${modelId}.mp4`)
        writeFileSync(file, buf)
        console.log(`\n  saved ${file}`)
        break
      }
      if (status === 'FAILED') { console.log(`\n  ${modelId} FAILED`); break }
      if (elapsed > 600) { console.log(`\n  ${modelId} timed out after 10 min`); break }
    }
  }

  console.log('\nSpike complete. Review frames + clips for likeness hold and drift.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
