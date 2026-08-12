/**
 * scripts/gen-notebook-art.ts
 *
 * Generate Notebook editorial art (masthead, category headers, series covers,
 * spot illustrations) per docs/notebook-team/image-brief.md, then upload a
 * reviewed keeper to its Sanity home. Run by the media-manager agent or the
 * store owner — one invocation per asset.
 *
 * The vision gate is manual by design (see the image brief): generation and
 * upload are two separate steps so every asset gets eyeballed before it ships.
 *
 *   # Step 1 — generate candidates to a local dir (no upload):
 *   npx tsx scripts/gen-notebook-art.ts --surface category --slug care \
 *     [--prompt "..."] [--alt "..."] [--count 2] [--save-dir .notebook-art] \
 *     [--only fal|imagen] [--ref-image <url>] [--dry-run]
 *
 *   # Step 2 — after review, upload the chosen file and patch the target doc:
 *   npx tsx scripts/gen-notebook-art.ts --surface category --slug care \
 *     --upload .notebook-art/category-care-1.png --alt "..."
 *
 *   # Hero cast-plus-product composite (--cast <castSlug> on --surface hero):
 *   # routes through composeSceneFrame() (packaging-strip + identity-hold), NOT
 *   # generateImage, so a supplier's branded carton never lands in frame.
 *   npx tsx scripts/gen-notebook-art.ts --surface hero --slug <post-slug> \
 *     --cast priya --count 2 --prompt "..."
 *
 * Surfaces → Sanity targets:
 *   masthead → singleton.notebookSettings.mastheadImage (+ mastheadImageAlt)
 *   category → blogCategoryExtras.<slug>.headerImage    (+ headerImageAlt)
 *   series   → blogSeries.<slug>.coverImage             (+ coverImageAlt)
 *   hero     → blogPost (by <slug>) .heroImage          (+ heroImageAlt)
 *   spot     → no Sanity target; local files only (drop into posts via Studio)
 *
 * Env: FAL_KEY (or Imagen creds) for generation; SANITY_PROJECT_ID +
 * SANITY_API_TOKEN (write) for --upload. Cost logs via the standard
 * generateImage() logImageCost path (feature 'notebook-images').
 */

// Load env FIRST — generate-image/sanity.server read env at module eval.
import './_load-env'

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { HERO_TARGET, resizeToExactCover } from '~/lib/hero-image-resize'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

type Surface = 'masthead' | 'category' | 'series' | 'spot' | 'hero'

// Shared prompt prefix from the image brief — every surface prepends this.
const SHARED_PREFIX =
  'Bright warm editorial photograph on a pure white paper background, soft ' +
  'directional daylight, magazine art direction, calm and unembarrassed mood, ' +
  'coral / plum / sage / warm-neutral palette, generous negative space, ' +
  'tasteful and non-explicit, no text, no tableware, no clinical staging, ' +
  'not moody, not dark. '

/**
 * fal's FLUX Kontext (ref-image) endpoint has no image_size param and only takes
 * a string aspect (resolution_mode; see fal.server.ts). fal now maps a
 * {width,height} object to the nearest aspect, but each surface still carries an
 * explicit string enum for the --ref-image path so the intended aspect is stated
 * outright rather than inferred from pixels.
 */
type KontextAspect = 'landscape_16_9' | 'landscape_4_3' | 'portrait_4_3' | 'portrait_16_9' | 'square_hd'

interface SurfaceSpec {
  size: { width: number; height: number }
  /** Nearest fal image_size enum to `size`, used when --ref-image is set. */
  aspect: KontextAspect
  defaultPrompt: (slug?: string) => string
}

const CATEGORY_MOTIFS: Record<string, string> = {
  'guides':
    'a warm inviting getting-started still life, a single approachable adult wellness product resting in soft coral daylight on white, a cropped open hand nearby suggesting first contact, confident and welcoming, a soft coral tint through the daylight',
  'comparisons':
    'two adult wellness products side by side in balanced warm-violet plum-tinted daylight on white, a considered this-or-that symmetry, thoughtful and decisive, a soft plum tint through the daylight',
  'care':
    'calm maintenance still life, a clean adult wellness product beside a soft cloth and a plant leaf in cool sage-green daylight on white, water droplets suggesting freshly cleaned, quiet botanical and tidy, a soft sage tint through the daylight',
  'wellness-basics':
    'a foundational material study, a single body-safe material sample of silicone glass or steel in plain warm daylight on paper-neutral white, textural and honest, steady and evergreen, no strong color push',
}

const SERIES_MOTIFS: Record<string, string> = {
  'first-times':
    'an inviting low-stakes first-object composition in warm coral daylight, a cropped hand reaching or holding gently, open and reassuring, cover mood of you are welcome here',
  'how-it-works':
    'a slightly technical curious composition, an adult wellness product shown with an implied sense of mechanism, air motion and light suggesting how it functions, clean bright light, explanatory not clinical, cover mood of here is the trick',
  'field-notes':
    'a tidy still life of an adult wellness product with its care items, soft cloth, water, storage pouch, in calm sage daylight, practical and clean, cover mood of keep it well',
  'this-or-that':
    'a balanced two-object plum-tinted portrait composition, symmetry as identity, cover mood of pick the one that fits',
}

const SURFACES: Record<Surface, SurfaceSpec> = {
  masthead: {
    size: { width: 2400, height: 1000 },
    aspect: 'landscape_16_9',
    defaultPrompt: () =>
      `${SHARED_PREFIX}soft abstract editorial backdrop, blurred warm still life of light and paper textures, coral blushing into soft plum and sage at the edges, center almost white and empty, dreamy shallow depth of field, nothing in sharp focus, calm.`,
  },
  category: {
    size: { width: 2000, height: 800 },
    aspect: 'landscape_16_9',
    defaultPrompt: (slug) =>
      `${SHARED_PREFIX}${CATEGORY_MOTIFS[slug ?? ''] ?? 'a simple warm editorial still life'}, left third of the frame calm and near-empty for a title overlay.`,
  },
  series: {
    size: { width: 1200, height: 1500 },
    aspect: 'portrait_4_3',
    defaultPrompt: (slug) =>
      `${SHARED_PREFIX}portrait editorial magazine cover, ${SERIES_MOTIFS[slug ?? ''] ?? 'a composed characterful single-subject still life'}, subject in the lower two-thirds, upper third calm for a title.`,
  },
  spot: {
    size: { width: 1200, height: 900 },
    aspect: 'landscape_4_3',
    defaultPrompt: () =>
      `${SHARED_PREFIX}single-subject editorial still life, one soft accent tint in the daylight, simple clean composition, room to breathe.`,
  },
  // Daily post hero (image-brief §0): the heroImage on every Notebook blogPost,
  // the highest-volume surface. Landscape ~4:3 (1200 x 900). The archetype
  // (product hero vs human hero) is decided per post by the hero router on the
  // post's category, which this script does not know, so the default prompt is a
  // safe generic editorial hero; the daily routine passes an explicit --prompt.
  hero: {
    size: { width: 1200, height: 900 },
    aspect: 'landscape_4_3',
    defaultPrompt: () =>
      `${SHARED_PREFIX}editorial hero photograph for a Notebook article, a clear single focal subject in soft directional daylight, calm negative space around the subject with room for a headline, unembarrassed and inviting.`,
  },
}

// ─── Hero cast-plus-product compositing (ticket #2752) ───────────────────────
//
// The daily hero can be a cast-plus-product composite instead of a plain
// text-to-image scene. It routes through composeSceneFrame() (the two-stage
// packaging-strip → identity-hold path), NOT generateImage({refImageUrls}),
// because the Shopify photos are box-plus-device composites and the multi-ref
// path has no carton-stripping stage — it would put a supplier's branded box in
// the cast member's hand. Triggered by --cast <slug> on --surface hero.

/** The post's hero product: the first blogProductEmbed with a defined handle
 *  (the same "first embedded product" the card projection uses). Prefers the
 *  published post over its draft. Null when the post embeds no product. */
async function resolveHeroProductHandle(slug: string): Promise<string | null> {
  const { getClient } = await import('~/lib/sanity.server')
  const client = getClient(true, true) // withToken + preview so an unpublished draft is visible
  if (!client) return null
  return client.fetch<string | null>(
    `*[_type == "blogPost" && slug.current == $slug]
       | order((_id in path("drafts.**")) asc)[0]
       .body[_type == "blogProductEmbed" && defined(productHandle)][0].productHandle`,
    { slug },
  )
}

async function resolveCastPhotoUrl(castSlug: string): Promise<string> {
  const { getApprovedCastMembers } = await import('~/lib/sanity.server')
  const cast = await getApprovedCastMembers()
  const member = cast.find(m => m.slug === castSlug)
  // Fail fast — never silently substitute another presenter for an unapproved
  // or misspelled cast slug (mirrors the video pipeline's presenter contract).
  if (!member) {
    throw new Error(`Cast member '${castSlug}' not found or not approved for use (castMember.active && approvedForUse)`)
  }
  return member.photoUrl
}

async function resolveProductPhotoUrl(handle: string): Promise<string> {
  const { getProductByHandle } = await import('~/lib/shopify.server')
  const product = await getProductByHandle(handle)
  const url = product?.images?.[0]?.url
  if (!url) throw new Error(`Product '${handle}' has no Shopify image to composite against`)
  return url
}

interface HeroRungResult {
  rung: string
  buffers: Buffer[]
  provider: string
  model: string
}

/**
 * Cast-plus-product composite hero with a fallback ladder (ticket #2752 DONE
 * WHEN 5): composite → one corrected retry → product at secondary scale →
 * simpler single-figure. If every rung yields nothing the caller holds the post
 * as a Sanity draft; a hero is never published heroless. Each composeSceneFrame
 * rung logs its own spend for BOTH the composite and (when built) the plate cost
 * key — composeSceneFrame does not log spend, so without this the notebook hero
 * would silently escape content_team_daily_cents. The single-figure rung logs
 * its own spend through generateImage()'s standard path.
 */
async function generateHeroComposite(slug: string, castSlug: string, opts: {
  prompt: string
  count: number
  saveDir: string
}): Promise<HeroRungResult | null> {
  const { composeSceneFrame, downloadFalAsset } = await import('~/lib/fal-video.server')
  const { logImageCost } = await import('~/lib/token-log.server')

  const presenterImageUrl = await resolveCastPhotoUrl(castSlug)
  const productHandle = await resolveHeroProductHandle(slug)
  const productImageUrl = productHandle ? await resolveProductPhotoUrl(productHandle) : null

  async function runComposite(prompt: string, count: number, rung: string): Promise<HeroRungResult> {
    const res = await composeSceneFrame({
      prompt,
      presenterImageUrl,
      ...(productImageUrl ? { productImageUrl } : {}),
      aspectRatio: '4:3',
      count,
    })
    // composeSceneFrame logs no spend of its own — bill both keys here.
    void logImageCost({ feature: 'notebook-images', model: res.costKey, count: res.urls.length, caller: `notebook-hero-composite/${rung}`, sku: productHandle ?? undefined })
    if (res.plate) {
      void logImageCost({ feature: 'notebook-images', model: res.plate.costKey, count: res.plate.count, caller: 'notebook-hero-composite/plate', sku: productHandle ?? undefined })
    }
    const buffers: Buffer[] = []
    for (const url of res.urls) {
      const raw = await downloadFalAsset(url)
      buffers.push(await resizeToExactCover(raw))
    }
    if (!buffers.length) throw new Error('composite produced no candidates')
    return { rung, buffers, provider: 'fal', model: res.costKey }
  }

  // Rung 4 — simpler single-figure, no product composite. Falls back to the
  // existing text-to-image hero generator so a hero still gets produced.
  async function runSingleFigure(): Promise<HeroRungResult> {
    const { generateImage } = await import('~/lib/generate-image.server')
    const res = await generateImage({
      prompt: `${SHARED_PREFIX}editorial hero portrait, a single relatable person in soft directional daylight, calm negative space for a headline, unembarrassed and inviting.`,
      count: opts.count,
      feature: 'notebook-images',
      caller: 'notebook-hero-composite/single-figure',
      imageSize: SURFACES.hero.size,
    })
    if (res.provider === 'none' || !res.buffers.length) throw new Error('single-figure generation produced no candidates')
    const buffers = await Promise.all(res.buffers.map(b => resizeToExactCover(b)))
    return { rung: 'single-figure', buffers, provider: res.provider, model: res.model }
  }

  const SECONDARY_SCALE_HINT =
    ' Stage the cast member as the primary subject and render the product at a smaller, secondary scale within the scene rather than oversized in hand.'

  const ladder: Array<() => Promise<HeroRungResult>> = [
    () => runComposite(opts.prompt, opts.count, 'composite'),
    () => runComposite(opts.prompt, 1, 'composite-retry'),
    () => runComposite(opts.prompt + SECONDARY_SCALE_HINT, 1, 'secondary-scale'),
    () => runSingleFigure(),
  ]

  for (const rung of ladder) {
    try {
      return await rung()
    } catch (err) {
      console.error(`[hero-composite] rung failed, trying next:`, err instanceof Error ? err.message : err)
    }
  }
  return null // every rung exhausted — caller holds the post as a Sanity draft
}

async function generate(surface: Surface, slug: string | undefined, opts: {
  prompt: string
  count: number
  saveDir: string
  only?: 'fal' | 'imagen'
  refImage?: string
}) {
  const { generateImage } = await import('~/lib/generate-image.server')
  const spec = SURFACES[surface]

  const res = await generateImage({
    prompt: opts.prompt,
    count: opts.count,
    feature: 'notebook-images',
    caller: `media-manager/notebook-${surface}`,
    // Text-to-image takes the exact pixel size; the Kontext ref-image path only
    // honors a string aspect enum, so send the nearest enum there instead of a
    // {width,height} object that would silently fall back to 16:9.
    imageSize: opts.refImage ? spec.aspect : spec.size,
    ...(opts.only ? { only: opts.only } : {}),
    ...(opts.refImage ? { refImageUrl: opts.refImage } : {}),
  })

  if (res.provider === 'none') {
    console.log(JSON.stringify({ generated: 0, provider: 'none', reason: 'no provider configured or both failed' }))
    process.exit(0)
  }

  mkdirSync(resolve(opts.saveDir), { recursive: true })
  const files = res.buffers.map((buf, i) => {
    const name = `${surface}${slug ? `-${slug}` : ''}-${i + 1}.png`
    const path = resolve(opts.saveDir, name)
    writeFileSync(path, buf)
    return path
  })

  console.log(JSON.stringify({
    generated: files.length,
    provider: res.provider,
    model: res.model,
    files,
    next: `Review against the image-brief vision checklist, then re-run with --upload <file> to publish the keeper.`,
  }))
}

async function upload(surface: Surface, slug: string | undefined, filePath: string, alt: string, prompt: string) {
  if (surface === 'spot') {
    console.error('--upload is not supported for --surface spot (spot art is placed per-post via Studio)')
    process.exit(1)
  }
  if ((surface === 'category' || surface === 'series' || surface === 'hero') && !slug) {
    console.error(`--slug is required for --surface ${surface}`)
    process.exit(1)
  }

  const { uploadBufferToSanity, sanityImageRef } = await import('~/lib/sanity.server')
  const { createClient } = await import('@sanity/client')

  const projectId = process.env['SANITY_PROJECT_ID']
  const token = process.env['SANITY_API_TOKEN']
  if (!projectId || !token) {
    console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN in .env')
    process.exit(1)
  }
  const client = createClient({
    projectId,
    dataset: process.env['SANITY_DATASET'] ?? 'production',
    apiVersion: '2024-10-01',
    useCdn: false,
    token,
  })

  const buffer = readFileSync(resolve(filePath))
  const { assetId, url } = await uploadBufferToSanity(buffer, basename(filePath), 'image/png')
  const imageRef = sanityImageRef(assetId, alt)

  if (surface === 'masthead') {
    await client.createIfNotExists({ _id: 'singleton.notebookSettings', _type: 'notebookSettings' })
    await client
      .patch('singleton.notebookSettings')
      .set({ mastheadImage: imageRef, mastheadImageAlt: alt })
      .commit()
    console.log(JSON.stringify({ placed: true, target: 'singleton.notebookSettings.mastheadImage', assetId, url }))
    return
  }

  if (surface === 'category') {
    // The extras doc references the real blogCategory — resolve it first so a
    // createIfNotExists never produces a dangling reference.
    const categoryId = await client.fetch<string | null>(
      `*[_type == "blogCategory" && slug.current == $slug][0]._id`,
      { slug },
    )
    if (!categoryId) {
      console.error(`No blogCategory with slug "${slug}" exists — create the category first.`)
      process.exit(1)
    }
    const docId = `blogCategoryExtras.${slug}`
    await client.createIfNotExists({
      _id: docId,
      _type: 'blogCategoryExtras',
      category: { _type: 'reference', _ref: categoryId },
    })
    await client.patch(docId).set({ headerImage: imageRef, headerImageAlt: alt }).commit()
    console.log(JSON.stringify({ placed: true, target: `${docId}.headerImage`, assetId, url }))
    return
  }

  if (surface === 'hero') {
    // The blogPost already exists (the content routine created it); resolve it by
    // slug and patch heroImage. Never createIfNotExists — that would mint an empty
    // post. Prefer the published doc over its draft (order puts non-drafts first).
    const postId = await client.fetch<string | null>(
      `*[_type == "blogPost" && slug.current == $slug] | order((_id in path("drafts.**")) asc)[0]._id`,
      { slug },
    )
    if (!postId) {
      console.error(`No blogPost with slug "${slug}" exists — create the post first.`)
      process.exit(1)
    }
    // Persist the composed prompt alongside the image, not just heroImage/alt.
    // The prompt existed in memory at generation time and used to be discarded on
    // upload, leaving blogPost.imagePrompt NULL on every published post — so a bad
    // hero could never be retro'd and the hero/embed audit only ever saw half its
    // inputs (ticket #2750). postId prefers the published doc when one exists, so
    // this writes to the same perspective heroImage already does.
    await client.patch(postId).set({ heroImage: imageRef, heroImageAlt: alt, imagePrompt: prompt }).commit()
    console.log(JSON.stringify({ placed: true, target: `${postId}.heroImage`, assetId, url, imagePrompt: prompt }))
    return
  }

  // series
  const docId = `blogSeries.${slug}`
  const existing = await client.fetch<string | null>(`*[_id == $id][0]._id`, { id: docId })
  if (!existing) {
    console.error(`No blogSeries doc "${docId}" exists — run scripts/seed-notebook-content.ts first.`)
    process.exit(1)
  }
  await client.patch(docId).set({ coverImage: imageRef, coverImageAlt: alt }).commit()
  console.log(JSON.stringify({ placed: true, target: `${docId}.coverImage`, assetId, url }))
}

async function main() {
  const surface = arg('surface') as Surface | undefined
  const slug = arg('slug')
  const alt = arg('alt')
  const count = Math.min(Math.max(1, Number(arg('count') ?? '1')), 4)
  const saveDir = arg('save-dir') ?? '.notebook-art'
  const uploadFile = arg('upload')
  const only = arg('only') as 'fal' | 'imagen' | undefined
  const refImage = arg('ref-image')
  const cast = arg('cast')
  const dryRun = hasFlag('dry-run')

  if (!surface || !(surface in SURFACES)) {
    console.error('Usage: gen-notebook-art.ts --surface masthead|category|series|hero|spot [--slug <slug>] [--prompt <p>] [--alt <a>] [--count N] [--save-dir <dir>] [--upload <file>] [--only fal|imagen] [--ref-image <url>] [--cast <castSlug>] [--dry-run]')
    process.exit(1)
  }
  if (cast && surface !== 'hero') {
    console.error('--cast is only valid with --surface hero (cast-plus-product compositing)')
    process.exit(1)
  }
  if ((surface === 'category' || surface === 'series' || surface === 'hero') && !slug) {
    console.error(`--slug is required for --surface ${surface}`)
    process.exit(1)
  }

  const prompt = arg('prompt') ?? SURFACES[surface].defaultPrompt(slug)

  if (uploadFile) {
    if (!alt) {
      console.error('--alt is required with --upload (Emma-voice alt text, descriptive and non-explicit)')
      process.exit(1)
    }
    await upload(surface, slug, uploadFile, alt, prompt)
    return
  }

  if (dryRun) {
    if (surface === 'hero' && cast) {
      console.log(JSON.stringify({
        dryRun: true,
        plan: {
          surface, slug, cast, prompt,
          route: 'composeSceneFrame',
          aspectRatio: '4:3',
          size: HERO_TARGET,
          count,
          saveDir,
          fallbackLadder: ['composite', 'composite-retry', 'secondary-scale', 'single-figure', 'hold-as-draft'],
        },
      }))
      process.exit(0)
    }
    console.log(JSON.stringify({
      dryRun: true,
      plan: {
        surface,
        ...(slug ? { slug } : {}),
        prompt,
        size: refImage ? SURFACES[surface].aspect : SURFACES[surface].size,
        count,
        saveDir,
        only: only ?? 'fal-then-imagen',
        ...(refImage ? { refImage } : {}),
      },
    }))
    process.exit(0)
  }

  // Cast-plus-product composite hero (ticket #2752). The chosen cast member is
  // passed by the caller; without --cast the hero stays the plain text-to-image
  // path below, unchanged.
  if (surface === 'hero' && cast) {
    const result = await generateHeroComposite(slug!, cast, { prompt, count, saveDir })
    if (!result) {
      console.log(JSON.stringify({
        generated: 0,
        provider: 'none',
        rung: 'hold-as-draft',
        heroless: true,
        next: 'Every fallback rung failed. Hold the post as a Sanity draft; never publish it heroless.',
      }))
      process.exit(0)
    }
    mkdirSync(resolve(saveDir), { recursive: true })
    const files = result.buffers.map((buf, i) => {
      const path = resolve(saveDir, `hero-${slug}-${i + 1}.png`)
      writeFileSync(path, buf)
      return path
    })
    console.log(JSON.stringify({
      generated: files.length,
      provider: result.provider,
      model: result.model,
      rung: result.rung,
      cast,
      files,
      next: 'Review against the image-brief vision checklist, then re-run with --upload <file> to publish the keeper.',
    }))
    return
  }

  await generate(surface, slug, {
    prompt,
    count,
    saveDir,
    ...(only ? { only } : {}),
    ...(refImage ? { refImage } : {}),
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
