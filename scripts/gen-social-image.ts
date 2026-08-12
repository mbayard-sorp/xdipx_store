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
 *     [--platform instagram|tiktok] [--ref-image <shopify-product-photo-url>] \
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
 * crop. TikTok defaults to 1080x1920.
 *
 * Sequence:
 *   1. Gate re-check — GET /api/team/gate?team=social. Refuses (exit 0) when
 *      the team is disabled or out of budget.
 *   2. Image cap. Prefers the gate's own maxImagesPerDay; falls back to a
 *      conservative local default because `social_team_max_images` is not
 *      wired server-side yet (ticket #2735). The DOLLAR cap is real and
 *      enforced either way: the gate sums spend on `feature LIKE 'social-%'`.
 *   3. --dry-run prints the resolved plan and exits without generating.
 *   4. Generate + rehost to Shopify Files.
 *   5. POST the spend row once — this script is its single owner.
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
 * Fallback image cap, used only while the gate reports 0 because
 * `social_team_max_images` has no server-side key yet. Deliberately well under
 * what $5/day of generation would buy, so the local default can never be the
 * thing that overspends: the dollar gate remains the real ceiling.
 */
const LOCAL_IMAGE_CAP_FALLBACK = 12

const ARCHETYPES = ['scene', 'cast', 'metaphor', 'macro', 'plate']

/** Feed-native sizes. Instagram is 4:5; the grid crops it to 3:4. */
const PLATFORM_SIZE: Record<string, { width: number; height: number }> = {
  instagram: { width: 1080, height: 1350 },
  tiktok:    { width: 1080, height: 1920 },
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
  const noRef       = hasFlag('no-ref')
  const noRefReason = arg('no-ref-reason')
  const slide       = arg('slide') ? Number(arg('slide')) : undefined
  const date        = arg('date') ?? new Date().toISOString().slice(0, 10)
  const only        = arg('only') as 'fal' | 'imagen' | undefined
  const caller      = arg('caller') ?? 'social-media-manager'
  const imagesSoFar = Number(arg('images-so-far') ?? '0')
  const runId       = arg('run-id')
  const dryRun      = hasFlag('dry-run')

  if (!prompt || !handle || !archetype || !mood) {
    console.error('Usage: gen-social-image.ts --prompt <p> --handle <h> --archetype scene|cast|metaphor|macro|plate --mood <m> [--platform instagram|tiktok] [--ref-image <url>] [--no-ref --no-ref-reason "<why>"] [--slide <n>] [--date YYYY-MM-DD] [--images-so-far <n>] [--only fal|imagen] [--caller <c>] [--run-id <n>] [--dry-run]')
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

  // ── 1. Gate re-check ──────────────────────────────────────────────────────
  const gateUrl = `${BASE_URL}/api/team/gate?team=social${runId && /^\d+$/.test(runId) ? `&excludeRun=${runId}` : ''}`
  const gateRes = await fetch(gateUrl, { headers: teamHeaders })
  const gateJson = await gateRes.json().catch(() => ({})) as {
    ok?: boolean
    reason?: string
    remainingCents?: number
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
  // Prefer the server's number the moment it becomes real (ticket #2735); until
  // then it reports 0 for social, which means "unset", not "none allowed".
  const serverCap = gateJson.maxImagesPerDay ?? 0
  const cap = serverCap > 0 ? serverCap : LOCAL_IMAGE_CAP_FALLBACK
  const capSource = serverCap > 0 ? 'gate' : 'local_fallback_social_team_max_images_unwired'
  if (imagesSoFar >= cap) {
    console.log(JSON.stringify({ skipped: true, reason: 'max_images', cap, capSource }))
    process.exit(0)
  }

  const imageSize = PLATFORM_SIZE[platform]!

  // ── 3. Dry run ────────────────────────────────────────────────────────────
  if (dryRun) {
    const { buildSocialAssetFilename } = await import('~/lib/social-media.server')
    console.log(JSON.stringify({
      dryRun: true,
      plan: {
        prompt, handle, archetype, mood, platform, imageSize, date,
        ...(slide ? { slide } : {}),
        filename: buildSocialAssetFilename({ handle, archetype: archetype as never, mood, date, ...(slide ? { slide } : {}) }),
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
    const { generateCastComposite } = await import('~/lib/social-media.server')
    const result = await generateCastComposite({
      prompt,
      handle,
      mood,
      date,
      presenterImageUrl: presenter,
      productImageUrl: refImage!,
      scale: scale!,
      count: Number(arg('candidates') ?? '2'),
      caller,
    })

    let spendPosted = true
    for (const cost of result.costs) {
      const res = await fetch(`${BASE_URL}/api/homepage-team/spend`, {
        method: 'POST',
        headers: teamHeaders,
        body: JSON.stringify({
          kind: 'image', model: cost.costKey, count: cost.count,
          feature: 'social-images', caller,
        }),
      })
      if (!res.ok) spendPosted = false
    }

    console.log(JSON.stringify({
      assets: result.urls.map((url, i) => ({
        url, filename: result.filenames[i], kind: 'image', archetype: 'cast', platform,
      })),
      provider: 'fal',
      stages: result.costs,
      scale,
      spendPosted, cap, capSource,
    }))
    process.exit(0)
  }

  // ── 4. Generate + rehost (imported after the short-circuits so a skipped or
  //      dry run never pays the shopify/db module-eval cost) ────────────────
  const { generateAndUploadSocialImage } = await import('~/lib/social-media.server')

  const result = await generateAndUploadSocialImage({
    prompt,
    handle,
    archetype: archetype as never,
    mood,
    date,
    imageSize,
    caller,
    // This script owns the spend row; logging inside would double-count and
    // trip the daily cap at half budget.
    logCost: false,
    ...(slide ? { slide } : {}),
    ...(refImage ? { refImageUrl: refImage } : {}),
    ...(only ? { only } : {}),
  })

  // ── 5. Spend, once ────────────────────────────────────────────────────────
  let spendPosted = false
  if (result.url && result.provider !== 'none') {
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
