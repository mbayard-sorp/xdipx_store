/**
 * Render-and-ship a brand card: the New-in carousel's packshot card and the
 * typographic save-close plate (ticket #13368, routine-social-daily.md
 * Step 2.9a).
 *
 * Deliberately its OWN file, not folded into `social-media.server.ts`
 * alongside `generateAndUploadSocialImage`/`generateCastComposite`, even
 * though the shape (render/generate, rehost to Shopify Files, ingest a
 * `social_media_assets` row, vision-gate it) is the same contract. Reachability,
 * not taste: `social-media.server.ts` is imported (via `social-publish-gate
 * .server.ts` <- `social-publish-job.server.ts`) from `server/cron.ts`'s
 * dynamic `import('../app/lib/social-publish-run.server.js')`, which puts it
 * inside the dependency graph that `scripts/build-vercel.mjs` (a protected
 * path) bundles with plain esbuild to produce `server/vercel-entry.mjs`. That
 * bundle has no loader for `app/lib/og-card.server.ts`'s `?inline` TTF font
 * imports -- Vite's own build understands the `?inline` query, raw esbuild
 * does not -- so importing `renderSocialCard` from inside `social-media
 * .server.ts` broke that bundle outright (`No loader is configured for
 * ".ttf" files`).
 *
 * This file is imported ONLY from the route (`app/routes/api.team.social-
 * image.tsx`), which compiles into the React Router server build that the
 * esbuild pass keeps external (see that script's `externalize-rr-build`
 * plugin) and therefore never reaches the protected bundle at all. Keep it
 * that way: do not import this file from `social-media.server.ts`, `server/
 * cron.ts`, `server/webhooks.ts`, or anything else already reachable from
 * `server/index.ts`.
 */
import { buildSocialCardFilename, tagIncompleteVisionVerdict } from './social-media.server'
import { uploadMoodImageToShopifyFilesWithId } from './shopify.server'
import { tryIngestSocialAsset } from './social-asset-library.server'
import type { VisionVerdict } from './social-vision-gate.server'

export type SocialCardOp = 'packshot-card' | 'plate'

export interface RenderAndUploadSocialCardOpts {
  op: SocialCardOp
  /** Product handle, used only for the filename; `packshot-card` also requires `imageUrl`. */
  handle?: string
  /** The product's default image, already resolved by the caller (ticket #13368: "fetches the
   *  product default image from Shopify" happens at the route, where the handle is validated
   *  against Shopify once; this function only needs the bytes). Required for `packshot-card`,
   *  omitted for `plate`. */
  imageUrl?: string
  kicker?: string
  line: string
  slideIndex: number
  slideCount: number
  tone?: 'coral' | 'plum' | 'paper'
  caller?: string
}

export interface RenderAndUploadSocialCardResult {
  url: string
  filename: string
  assetId: number | null
  visionVerdict: VisionVerdict | null
}

/**
 * Render a brand card (packshot-card or plate op), rehost it to Shopify
 * Files under a `social-card-` filename, write its `social_media_assets`
 * row, and vision-gate it -- the same ingest + verdict contract every other
 * generated social asset goes through (`generateAndUploadSocialImage` in
 * `social-media.server.ts`), minus the generate-and-retry loop: this
 * renderer is deterministic, so a failing verdict has nothing to regenerate
 * into. The caller (the route) owns resolving `imageUrl` from a product
 * handle, same split as `generate`'s `refImageUrl` and `cast`'s
 * `productImageUrl`.
 */
export async function renderAndUploadSocialCard(
  opts: RenderAndUploadSocialCardOpts,
): Promise<RenderAndUploadSocialCardResult> {
  const { renderSocialCard } = await import('./og-card.server')
  const { runVisionGate, recordVisionVerdict } = await import('./social-vision-gate.server')

  let productImage: { data: Buffer; contentType: string } | undefined
  if (opts.op === 'packshot-card') {
    if (!opts.imageUrl) throw new Error('packshot-card requires imageUrl (the product\'s default image)')
    const res = await fetch(opts.imageUrl)
    if (!res.ok) throw new Error(`fetch product image failed: HTTP ${res.status}`)
    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    productImage = { data: Buffer.from(await res.arrayBuffer()), contentType }
  }

  const buffer = await renderSocialCard({
    line: opts.line,
    slideIndex: opts.slideIndex,
    slideCount: opts.slideCount,
    ...(opts.kicker ? { kicker: opts.kicker } : {}),
    ...(opts.tone ? { tone: opts.tone } : {}),
    ...(productImage ? { productImage } : {}),
  })

  const filename = buildSocialCardFilename({
    slideIndex: opts.slideIndex,
    ...(opts.handle ? { handle: opts.handle } : {}),
  })
  const { url, fileId } = await uploadMoodImageToShopifyFilesWithId(buffer, filename)

  const asset = await tryIngestSocialAsset({
    buffer,
    filename,
    contentType: 'image/jpeg',
    url,
    shopifyFileId: fileId,
    aspect: '4:5',
    source: 'generated',
    provider: 'rendered',
    model: 'og-card-satori',
    archetype: opts.op,
    ...(opts.handle ? { productHandle: opts.handle } : {}),
    isPicked: false,
    createdBy: opts.caller ?? 'social-media-manager',
  })

  // Every generated asset needs a recorded verdict before the publish gate
  // will let it ship (#6763) -- a rendered card is no exception, even though
  // it carries no body in frame to fail those checks on. No retry loop here:
  // unlike the generate op's `generateWithVisionGate`, this render is
  // deterministic, so a failing verdict (e.g. the product image itself
  // reading as unsafe) has nothing to regenerate into; the caller sees the
  // recorded verdict and decides.
  const verdict = await runVisionGate(url)
  if (asset?.id != null) {
    await recordVisionVerdict(asset.id, verdict)
    await tagIncompleteVisionVerdict(asset.id, verdict)
  }

  return { url, filename, assetId: asset?.id ?? null, visionVerdict: verdict }
}
