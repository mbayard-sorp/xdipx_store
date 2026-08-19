/**
 * scripts/gen-social-image.ts
 *
 * Generate one social image, rehost it to Shopify Files, and print the
 * permanent URL for `social_posts.mediaUrls`. Budget-gated. Run by the social
 * routine / media-manager via Bash, one invocation per image (ticket #2734).
 *
 * This is the social sibling of `gen-homepage-image.ts` and `gen-notebook-art.ts`.
 * Its absence is why every Instagram draft written after 2026-08-09 carried a
 * bare Nalpac SKU packshot: the charter had retired packshot-only stills that
 * same day, and a packshot was the only image the routine could reach.
 *
 * Usage:
 *   npx tsx scripts/gen-social-image.ts \
 *     --prompt "..." --handle we-vibe-chorus --archetype scene --mood nightstand \
 *     [--platform instagram|tiktok|x] [--ref-image <shopify-product-photo-url>] \
 *     [--no-ref --no-ref-reason "metaphor hook, no product target"] \
 *     [--slide 2] [--date 2026-08-12] [--images-so-far 3] \
 *     [--only fal|imagen] [--caller social-media-manager] [--dry-run]
 *
 * --ref-image is REQUIRED unless --no-ref is given with a reason, mirroring the
 * homepage rule: an image meant to show a real SKU must place the real SKU via
 * FLUX Kontext, not a model-invented lookalike. Genuinely product-free art
 * (metaphor hooks, typography plates) is the legitimate --no-ref case.
 *
 * Aspect defaults to 1080x1350 (4:5) for Instagram, because the profile grid
 * crops tiles to 3:4 and the subject has to survive both that and a 1:1 centre
 * crop. TikTok defaults to 1080x1920, X to 1600x900 (16:9, its timeline-native
 * single-image ratio).
 *
 * Sequence:
 *   1. Gate re-check — GET /api/team/gate?team=social. Refuses (exit 0) when
 *      the team is disabled, out of budget, or over the image cap (the gate
 *      enforces `social_team_max_images` server-side since ticket #3678).
 *   2. Image cap. Uses the gate's own maxImagesPerDay/imagesToday (counted
 *      against feature 'social-images'); falls back to SOCIAL_MAX_IMAGES_DEFAULT
 *      only when talking to an older server that omits the field. The DOLLAR
 *      cap is enforced either way: the gate sums spend on 'social-%' features.
 *   3. --dry-run prints the resolved plan and exits without generating.
 *   4. Generate + rehost to Shopify Files.
 *   5. POST the spend row once — this script is its single owner. Spend posts
 *      for every BILLED generation, rehosted or not (#887).
 *   6. Print one JSON manifest line.
 *
 * Never run without the gate passing: this costs real money per image.
 */

// Load env FIRST — shopify.server / db.server read env at module eval.
import './_load-env'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/**
 * Fallback image cap, used only when the gate response OMITS maxImagesPerDay
 * (an older server). Derived from the server-side default rather than standing
 * alone (#3678), so the script and the gate can never disagree about what the
 * unset cap is. A gate that reports 0 is an owner-configured "no images" and
 * is honored, not treated as unset.
 */
import { SOCIAL_MAX_IMAGES_DEFAULT } from '~/lib/team-keys'
// Type-only: erased at runtime, so importing it never loads shopify.server /
// db.server into the sandbox. Generation + rehost now run SERVER-SIDE via
// POST /api/team/social-image (ticket #4133), where the Shopify Admin token
// lives. The sandbox never touches the Admin API or its token.
import type { GenerateSocialImageResult, GenerateCastCompositeResult } from '~/lib/social-media.server'

const ARCHETYPES = ['scene', 'cast', 'metaphor', 'macro', 'plate']

/**
 * Feed-native sizes. Instagram is 4:5; the grid crops it to 3:4.
 *
 * X is 16:9, not a crop of the Instagram frame. X renders a single image in the
 * timeline at 16:9 and crops anything taller, which takes the top and bottom off
 * a 4:5 cast composite: the product in the hand is exactly what a centre crop
 * loses. Owner direction 2026-08-19 is that X posts carry a cast image, so X
 * needs its own generation rather than a re-crop of IG key art.
 */
const PLATFORM_SIZE: Record<string, { width: number; height: number }> = {
  instagram: { width: 1080, height: 1350 },
  tiktok:    { width: 1080, height: 1920 },
  x:         { width: 1600, height: 900 },
}

async function main() {
  const prompt      = arg('prompt')
  const handle      = arg('handle')
  const archetype   = arg('archetype')
  const mood        = arg('mood')
  const platform    = arg('platform') ?? 'instagram'
  const refImage    = arg('ref-image')
  const presenter   = arg('presenter-image')
  const scale       = arg('scale')
  const extraRef    = arg('extra-ref')
  const noRef       = hasFlag('no-ref')
  const noRefReason = arg('no-ref-reason')
  const slide       = arg('slide') ? Number(arg('slide')) : undefined
  const date        = arg('date') ?? new Date().toISOString().slice(0, 10)
  const only        = arg('only') as 'atlas' | 'fal' | 'imagen' | undefined
  const caller      = arg('caller') ?? 'social-media-manager'
  const imagesSoFar = Number(arg('images-so-far') ?? '0')
  const runId       = arg('run-id')
  const dryRun      = hasFlag('dry-run')

  if (!prompt || !handle || !archetype || !mood) {
    console.error('Usage: gen-social-image.ts --prompt <p> --handle <h> --archetype scene|cast|metaphor|macro|plate --mood <m> [--platform instagram|tiktok|x] [--ref-image <url>] [--no-ref --no-ref-reason "<why>"] [--slide <n>] [--date YYYY-MM-DD] [--images-so-far <n>] [--only fal|imagen] [--caller <c>] [--run-id <n>] [--dry-run]')
    process.exit(1)
  }
  if (!ARCHETYPES.includes(archetype)) {
    console.error(`--archetype must be one of: ${ARCHETYPES.join(', ')}`)
    process.exit(1)
  }
  if (!PLATFORM_SIZE[platform]) {
    console.error(`--platform must be one of: ${Object.keys(PLATFORM_SIZE).join(', ')}`)
    process.exit(1)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('--date must be YYYY-MM-DD')
    process.exit(1)
  }
  // Ref-image-first, same rule the homepage runs: place the real product rather
  // than a lookalike. Product-free art is legitimate but must say so out loud.
  if (!refImage && !noRef) {
    console.error('--ref-image is required. For genuinely product-free art (metaphor hook, typography plate), pass --no-ref --no-ref-reason "<why>".')
    process.exit(1)
  }
  if (noRef && !noRefReason) {
    console.error('--no-ref requires --no-ref-reason "<why>" (echoed in the manifest)')
    process.exit(1)
  }
  // A cast composite needs BOTH references. With only the presenter, the model
  // preserves the presenter and invents the product, which is exactly the
  // failure this mode exists to fix.
  if (presenter && !refImage) {
    console.error('--presenter-image requires --ref-image <real shopify product photo>: a cast composite needs both references, or the product is invented.')
    process.exit(1)
  }
  if (presenter && archetype !== 'cast') {
    console.error('--presenter-image requires --archetype cast')
    process.exit(1)
  }
  // Required, not defaulted. A silent default would be wrong for most of the
  // catalog and wrong invisibly, which is exactly how a palm-sized toy shipped
  // vase-sized (#2761).
  if (presenter && !scale) {
    console.error('--presenter-image requires --scale palm|handheld|forearm|bottle (or a free-text clause relative to the hand). Omitting it renders the product the wrong size.')
    process.exit(1)
  }

  const BASE_URL = (process.env['BASE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')
  const TEAM_TOKEN = process.env['TEAM_TOKEN'] ?? process.env['HOMEPAGE_TEAM_TOKEN'] ?? process.env['CRON_SECRET'] ?? ''
  const teamHeaders = { 'x-team-secret': TEAM_TOKEN, 'content-type': 'application/json' }

  // Generation + rehost run server-side via POST /api/team/social-image, where
  // SHOPIFY_ADMIN_ACCESS_TOKEN lives (ticket #4133). A 403 is the server's own
  // budget gate closing between our step-1 check and this call: treat it as a
  // clean skip like step 1, not a failure. Any other non-2xx is a real error.
  async function callSocialImageRoute<T>(payload: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${BASE_URL}/api/team/social-image`, {
      method: 'POST',
      headers: teamHeaders,
      body: JSON.stringify(payload),
    })
    if (res.status === 403) {
      const j = await res.json().catch(() => ({})) as { reason?: string }
      console.log(JSON.stringify({ skipped: true, reason: j.reason ?? 'gated' }))
      process.exit(0)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.log(JSON.stringify({ error: true, reason: `social_image_route_http_${res.status}`, body: body.slice(0, 500) }))
      process.exit(1)
    }
    return res.json() as Promise<T>
  }

  // ── 1. Gate re-check ──────────────────────────────────────────────────────
  const gateUrl = `${BASE_URL}/api/team/gate?team=social${runId && /^\d+$/.test(runId) ? `&excludeRun=${runId}` : ''}`
  const gateRes = await fetch(gateUrl, { headers: teamHeaders })
  const gateJson = await gateRes.json().catch(() => ({})) as {
    ok?: boolean
    reason?: string
    remainingCents?: number
    imagesToday?: number
    maxImagesPerDay?: number
  }
  if (!gateRes.ok || !gateJson.ok) {
    console.log(JSON.stringify({ skipped: true, reason: gateJson.reason ?? `gate_http_${gateRes.status}` }))
    process.exit(0)
  }
  if ((gateJson.remainingCents ?? 0) <= 0) {
    console.log(JSON.stringify({ skipped: true, reason: 'over_budget' }))
    process.exit(0)
  }

  // ── 2. Image cap ──────────────────────────────────────────────────────────
  // The gate's number is real since #3678: `social_team_max_images` (default
  // SOCIAL_MAX_IMAGES_DEFAULT) counted against feature 'social-images'. A
  // reported 0 is an owner-configured "no images" and refuses; the local
  // fallback applies only when the field is absent entirely. The count is the
  // MAX of the server's imagesToday and the caller's own running counter, so
  // neither a cold KV counter nor a stale --images-so-far can under-count.
  const serverCap = typeof gateJson.maxImagesPerDay === 'number' ? gateJson.maxImagesPerDay : undefined
  const cap = serverCap ?? SOCIAL_MAX_IMAGES_DEFAULT
  const capSource = serverCap !== undefined ? 'gate' : 'local_fallback_gate_omitted_cap'
  const imagesCounted = Math.max(imagesSoFar, typeof gateJson.imagesToday === 'number' ? gateJson.imagesToday : 0)
  if (imagesCounted >= cap) {
    console.log(JSON.stringify({ skipped: true, reason: 'max_images', cap, capSource, imagesCounted }))
    process.exit(0)
  }

  const imageSize = PLATFORM_SIZE[platform]!

  // ── 3. Dry run ────────────────────────────────────────────────────────────
  if (dryRun) {
    const { buildSocialAssetFilename, socialAspectFromImageSize } = await import('~/lib/social-media.server')
    const aspect = socialAspectFromImageSize(imageSize)
    console.log(JSON.stringify({
      dryRun: true,
      plan: {
        prompt, handle, archetype, mood, platform, imageSize, aspect, date,
        ...(slide ? { slide } : {}),
        filename: buildSocialAssetFilename({ handle, archetype: archetype as never, mood, date, aspect, ...(slide ? { slide } : {}) }),
        only: presenter ? 'composeSceneFrame (qwen plate -> flux-2 lora edit)' : (only ?? 'fal-then-imagen'),
        ...(presenter ? { presenter, mode: 'cast-composite', scale } : {}),
        caller, cap, capSource,
        ...(refImage ? { refImage } : { noRefReason }),
      },
    }))
    process.exit(0)
  }

  // ── 4a. Cast composite (two-stage) ────────────────────────────────────────
  // A single reference image holds exactly one thing, so the single-ref path
  // below cannot hold a cast identity AND a real product at once: it preserves
  // the presenter and invents the product. Anything with a presenter goes
  // through composeSceneFrame instead, which takes both references.
  if (presenter) {
    const result = await callSocialImageRoute<GenerateCastCompositeResult>({
      op: 'cast',
      prompt,
      handle,
      mood,
      date,
      presenterImageUrl: presenter,
      productImageUrl: refImage!,
      scale: scale!,
      ...(extraRef ? { extraImageUrls: [extraRef] } : {}),
      count: Number(arg('candidates') ?? '2'),
      caller,
      ...(runId && /^\d+$/.test(runId) ? { runId: Number(runId) } : {}),
    })

    let spendPosted = true
    const postSpend = async (payload: Record<string, unknown>) => {
      const res = await fetch(`${BASE_URL}/api/homepage-team/spend`, {
        method: 'POST',
        headers: teamHeaders,
        body: JSON.stringify({ kind: 'image', feature: 'social-images', caller, ...payload }),
      })
      if (!res.ok) spendPosted = false
    }
    // Stage 2 (compositor) is the first cost entry; anything after it is the
    // stage-1 plate. Post ONE image row per surviving candidate carrying that
    // candidate's fal request id and its filename (as ref_id), so an owner can
    // resolve a fal request id to the exact social asset it produced. Any
    // billed candidate that failed to rehost has no file, so its spend is
    // posted once as a remainder row to keep the social-images total exact.
    const frameCostKey = result.costs[0]?.costKey ?? 'fal/flux-2-edit'
    const framesBilled = result.costs[0]?.count ?? result.urls.length
    for (let i = 0; i < result.urls.length; i++) {
      await postSpend({
        model: frameCostKey, count: 1, refId: result.filenames[i],
        ...(result.requestIds[i] ? { requestId: result.requestIds[i] } : {}),
      })
    }
    const remainder = framesBilled - result.urls.length
    if (remainder > 0) await postSpend({ model: frameCostKey, count: remainder })
    for (const plate of result.costs.slice(1)) {
      await postSpend({
        model: plate.costKey, count: plate.count,
        ...(result.plateRequestId ? { requestId: result.plateRequestId } : {}),
      })
    }

    console.log(JSON.stringify({
      assets: result.urls.map((url, i) => ({
        url, filename: result.filenames[i], requestId: result.requestIds[i] ?? null,
        kind: 'image', archetype: 'cast', platform,
      })),
      provider: 'fal',
      stages: result.costs,
      scale,
      spendPosted, cap, capSource,
    }))
    process.exit(0)
  }

  // ── 4. Generate + rehost, SERVER-SIDE (ticket #4133) ──────────────────────
  // The privileged rehost (Shopify Files, needs the Admin token) runs on the
  // server via the route below, not in this sandbox. The route generates with
  // logCost off, so this script stays the single owner of the spend row (#887).
  const result = await callSocialImageRoute<GenerateSocialImageResult>({
    op: 'generate',
    prompt,
    handle,
    archetype,
    mood,
    date,
    imageSize,
    caller,
    ...(slide ? { slide } : {}),
    ...(refImage ? { refImageUrl: refImage } : {}),
    ...(only ? { only } : {}),
    ...(runId && /^\d+$/.test(runId) ? { runId: Number(runId) } : {}),
  })

  // ── 5. Spend, once. Posted for every BILLED generation (provider !== 'none'),
  //      whether or not the rehost produced a usable asset: counting only on
  //      upload let a run that kept failing its vision gate spend real dollars
  //      without ever moving the number the cap enforces (#887). ─────────────
  let spendPosted = false
  if (result.provider !== 'none') {
    const spendRes = await fetch(`${BASE_URL}/api/homepage-team/spend`, {
      method: 'POST',
      headers: teamHeaders,
      body: JSON.stringify({
        kind: 'image',
        model: result.model,
        count: 1,
        feature: 'social-images',
        caller,
      }),
    })
    spendPosted = spendRes.ok
  }

  // ── 6. Manifest ───────────────────────────────────────────────────────────
  console.log(JSON.stringify({
    asset: result.url
      ? { url: result.url, filename: result.filename, kind: 'image', archetype, platform }
      : null,
    provider: result.provider,
    model: result.model,
    spendPosted,
    cap,
    capSource,
    ...(refImage ? {} : { noRefReason }),
  }))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
