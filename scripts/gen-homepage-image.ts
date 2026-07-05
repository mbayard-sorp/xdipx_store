/**
 * scripts/gen-homepage-image.ts
 *
 * Generate one fal.ai/Imagen editorial image and place it on a homepage
 * surface (Sanity `singleton.homepage`), budget-gated. Run by the
 * media-manager agent via its Bash tool — one invocation per image.
 *
 * Usage:
 *   npx tsx scripts/gen-homepage-image.ts \
 *     --prompt "..." --alt "..." \
 *     --target tile --block-key <blockKey> --tile-key <tileKey> \
 *     [--only fal|imagen] [--caller media-manager/wayfinder] \
 *     [--images-so-far 3] [--dry-run]
 *
 * Sequence:
 *   1. Gate re-check — GET /api/homepage-team/gate. Refuses (exit 0, prints
 *      {skipped:true}) if disabled or remainingCents<=0.
 *   2. Cap check — homepage_team_max_images vs --images-so-far (the caller's
 *      own running counter for this routine invocation; the server-side gate
 *      also enforces the same cap from api_token_log, this is a fast local
 *      short-circuit so the routine doesn't burn a gate round-trip per image).
 *   3. --dry-run prints the resolved plan and exits without generating.
 *   4. generateAndPlaceHomepageImage() — generate, upload to Sanity, patch.
 *   5. On successful placement, POST /api/homepage-team/spend once (this
 *      script is the SINGLE owner of the image spend row — generateImage()
 *      is called with logCost:false internally so the cost isn't double
 *      logged).
 *   6. Print one JSON manifest line.
 *
 * Never run without the gate passing — this costs real money per image.
 */

// Load env FIRST — generateAndPlaceHomepageImage/db.server read env at module
// eval, before any other import gets a chance to run.
import './_load-env'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main() {
  const prompt      = arg('prompt')
  const alt         = arg('alt')
  const targetKind  = arg('target') as 'block' | 'tile' | 'promo' | undefined
  const blockKey    = arg('block-key')
  const tileKey     = arg('tile-key')
  const only        = arg('only') as 'fal' | 'imagen' | undefined
  const caller      = arg('caller') ?? 'media-manager'
  const imagesSoFar = Number(arg('images-so-far') ?? '0')
  const runId       = arg('run-id')
  const dryRun      = hasFlag('dry-run')

  if (!prompt || !alt || !targetKind || !blockKey) {
    console.error('Usage: gen-homepage-image.ts --prompt <p> --alt <a> --target block|tile|promo --block-key <k> [--tile-key <k>] [--only fal|imagen] [--caller <c>] [--images-so-far <n>] [--run-id <n>] [--dry-run]')
    process.exit(1)
  }
  if (targetKind === 'tile' && !tileKey) {
    console.error('--tile-key is required when --target tile')
    process.exit(1)
  }

  const BASE_URL = (process.env['BASE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')
  const TEAM_TOKEN = process.env['HOMEPAGE_TEAM_TOKEN'] ?? process.env['CRON_SECRET'] ?? ''
  const teamHeaders = { 'x-team-secret': TEAM_TOKEN, 'content-type': 'application/json' }

  // ── 1. Gate re-check ──────────────────────────────────────────────────────
  // --run-id excludes the caller's own running row from the concurrency guard;
  // without it the gate refuses mid-run with run_in_progress.
  const gateUrl = `${BASE_URL}/api/homepage-team/gate${runId && /^\d+$/.test(runId) ? `?excludeRun=${runId}` : ''}`
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

  // ── 2. Cap check (local counter passed by the routine) ───────────────────
  const cap = gateJson.maxImagesPerDay ?? 12
  if (imagesSoFar >= cap) {
    console.log(JSON.stringify({ skipped: true, reason: 'max_images' }))
    process.exit(0)
  }

  const target =
    targetKind === 'tile'   ? { kind: 'tileImage' as const, blockKey, tileKey: tileKey! } :
    targetKind === 'promo'  ? { kind: 'promoImage' as const, blockKey } :
    { kind: 'blockImage' as const, blockKey }

  // ── 3. Dry run — print the plan, no generation, no spend ─────────────────
  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      plan: { prompt, alt, target, only: only ?? 'fal-then-imagen', caller },
    }))
    process.exit(0)
  }

  // ── 4. Generate + place (imported after the gate/dry-run short-circuits so
  //      a skipped/dry-run invocation never pays the db.server module-eval
  //      cost when it doesn't need to). ──────────────────────────────────────
  const { generateAndPlaceHomepageImage } = await import('~/lib/homepage-media.server')

  const manifest = await generateAndPlaceHomepageImage({
    prompt,
    alt,
    target,
    caller,
    ...(only ? { gen: { only } } : {}),
  })

  // ── 5. Post spend once — this script is the single owner of the row ──────
  let spendPosted = false
  if (manifest.placed && manifest.provider !== 'none') {
    const spendRes = await fetch(`${BASE_URL}/api/homepage-team/spend`, {
      method: 'POST',
      headers: teamHeaders,
      body: JSON.stringify({
        kind: 'image',
        model: manifest.model,
        count: 1,
        feature: 'homepage-images',
        caller,
      }),
    })
    spendPosted = spendRes.ok
  }

  // ── 6. Print the manifest ─────────────────────────────────────────────────
  console.log(JSON.stringify({
    asset: manifest.placed
      ? { url: manifest.url, alt: manifest.alt, assetId: manifest.assetId, kind: 'image' }
      : null,
    target: manifest.target,
    source: { provider: manifest.provider, model: manifest.model, prompt },
    spend: { posted: spendPosted, model: manifest.model, count: 1 },
    placed: manifest.placed,
  }))
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
