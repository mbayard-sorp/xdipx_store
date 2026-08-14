/**
 * Ad Studio batch generator — zeely-style: pick a product, get a batch of ad
 * creative variants (static images in 1:1 / 4:5 / 9:16, plus any approved
 * pipeline video recorded as a 9:16 video variant), parked under an
 * ad_campaigns PROPOSAL for owner review in /admin/ad-studio.
 *
 * Policy-first by construction (docs/ads-policy.md is binding): every creative
 * carries a policy_check; generation uses the PAID register look (education /
 * wellness framing, product-as-object, real product photo via Kontext, no
 * presenter, no desire-forward staging) so the organic-9 and paid-3-4 tracks
 * can never cross. Spend logs under feature 'ads-creative' -> team ads budget.
 */

import { randomUUID } from 'node:crypto'
import { eq, desc, inArray } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adCreatives, mediaAssets, adCampaigns } from '../../db/schema'
import { falGenerate, falConfigured } from '~/lib/fal.server'
import { blobPut } from '~/lib/blob.server'
import { logImageCost } from '~/lib/token-log.server'
import { estimateImageCostUsd } from '~/lib/model-pricing.server'
import { getProductByHandle } from '~/lib/shopify.server'
import { createAdCampaign } from '~/lib/team.server'

export const AD_FORMATS = ['1:1', '4:5', '9:16'] as const
export type AdFormat = (typeof AD_FORMATS)[number]

const FORMAT_TO_IMAGE_SIZE: Record<AdFormat, string> = {
  '1:1': 'square_hd',
  '4:5': 'portrait_4_3', // closest supported ratio; ffmpeg-free approximation
  '9:16': 'portrait_16_9',
}

/**
 * The paid-register scene scaffold. Deliberately NOT the organic desire-forward
 * register: paid runs education/mechanism framing at charter intensity 3-4.
 */
function buildAdPrompt(angle: string): string {
  return (
    `Clean editorial product photograph for a wellness advertisement: the product from the reference image ` +
    `presented as a designed object on a bright paper backdrop with a subtle coral tint, soft high-key studio light, ` +
    `sharp focus, generous negative space for ad copy overlay. ${angle} ` +
    `No people, no hands, no text, no words, no letters, no watermark, no logo.`
  )
}

const AD_ANGLES = [
  'Minimal centered composition, product floating with a soft shadow.',
  'Three-quarter angle on a low pedestal, architectural feel.',
  'Flat lay from above with a single soft prop shadow.',
]

export interface GenerateAdBatchArgs {
  productHandle: string
  /** Owner-supplied compliance note; required, mirrored onto every creative. */
  policyCheck: string
  /** Target platform for the PROPOSAL row (google is the viable mainstream lane). */
  platform: 'google' | 'meta' | 'tiktok' | 'other'
  objective?: string
}

export interface GeneratedCreative {
  id: number
  format: string
  blobUrl: string
}

export async function generateAdBatch(args: GenerateAdBatchArgs): Promise<{ campaignId: number; creatives: GeneratedCreative[]; costUsd: number }> {
  if (!falConfigured()) throw new Error('FAL_KEY is not configured')
  if (args.policyCheck.trim().length < 20) {
    throw new Error('policyCheck must be a substantive compliance note (>= 20 chars) citing docs/ads-policy.md')
  }
  const product = await getProductByHandle(args.productHandle)
  if (!product) throw new Error(`Product '${args.productHandle}' not found`)
  const refImageUrl = product.images[0]?.url
  if (!refImageUrl) throw new Error(`Product '${args.productHandle}' has no image (real photography is a hard gate)`)

  const batchId = `adb-${randomUUID().slice(0, 8)}`
  const campaignId = await createAdCampaign({
    platform: args.platform,
    name: `${product.title} creative batch ${batchId}`,
    objective: args.objective ?? 'traffic',
    policyCheck: args.policyCheck,
    creativeJson: { batchId, productHandle: args.productHandle, source: 'ad-studio' },
  })

  const creatives: GeneratedCreative[] = []
  let images = 0
  let costKeyUsed = 'fal/flux-kontext-dev'
  for (const format of AD_FORMATS) {
    const angle = AD_ANGLES[creatives.length % AD_ANGLES.length]!
    const { buffers, costKey, requestId } = await falGenerate({
      prompt: buildAdPrompt(angle),
      count: 1,
      imageSize: FORMAT_TO_IMAGE_SIZE[format],
      refImageUrl,
      telemetry: { feature: 'ads-creative', caller: 'ad-creative', sku: args.productHandle },
    })
    costKeyUsed = costKey
    const buf = buffers[0]
    if (!buf) continue
    const { url } = await blobPut(`ads/${campaignId}/${format.replace(':', 'x')}-${images}.jpg`, buf, { contentType: 'image/jpeg' })
    const [asset] = await db.insert(mediaAssets).values({
      kind: 'image',
      purpose: 'ad_static',
      blobUrl: url,
      contentType: 'image/jpeg',
      sourceModel: costKey,
      costUsd: String(estimateImageCostUsd(costKey, 1)),
    }).returning({ id: mediaAssets.id })
    if (!asset) continue
    const [creative] = await db.insert(adCreatives).values({
      adCampaignId: campaignId,
      format,
      assetId: asset.id,
      hookCopy: null,
      policyCheck: args.policyCheck,
    }).returning({ id: adCreatives.id })
    if (creative) creatives.push({ id: creative.id, format, blobUrl: url })
    // One spend row per image, each carrying its own fal request_id (one
    // falGenerate call per format), so an owner can resolve a fal request id to
    // the exact ad creative it produced. ref_id `<batchId>#<format>` names the
    // file; batch-level attribution is unaffected (/admin/usage groups by
    // batch_id, and the batch total is the sum of these per-image rows).
    void logImageCost({
      feature: 'ads-creative',
      model: costKey,
      count: 1,
      caller: 'ad-creative.server',
      sku: args.productHandle,
      refId: `${batchId}#${format}`,
      ...(requestId ? { requestId } : {}),
    })
    images++
  }

  const costUsd = estimateImageCostUsd(costKeyUsed, images)
  return { campaignId, creatives, costUsd }
}

/** Record an approved pipeline video as a 9:16 video variant on a campaign. */
export async function attachVideoCreative(campaignId: number, blobUrl: string, policyCheck: string): Promise<number> {
  const [asset] = await db.insert(mediaAssets).values({
    kind: 'video',
    purpose: 'ad_video',
    blobUrl,
    contentType: 'video/mp4',
  }).returning({ id: mediaAssets.id })
  if (!asset) throw new Error('Asset insert failed')
  const [creative] = await db.insert(adCreatives).values({
    adCampaignId: campaignId,
    format: '9:16',
    assetId: asset.id,
    policyCheck,
  }).returning({ id: adCreatives.id })
  if (!creative) throw new Error('Creative insert failed')
  return creative.id
}

// ─── Reads + owner actions for /admin/ad-studio ──────────────────────────────

export interface CampaignWithCreatives {
  campaign: typeof adCampaigns.$inferSelect
  creatives: Array<{ id: number; format: string; status: string; hookCopy: string | null; blobUrl: string; kind: string }>
}

export async function listCampaignsWithCreatives(limit = 20): Promise<CampaignWithCreatives[]> {
  const campaigns = await db.select().from(adCampaigns).orderBy(desc(adCampaigns.createdAt)).limit(limit)
  if (!campaigns.length) return []
  const rows = await db
    .select({
      id: adCreatives.id,
      adCampaignId: adCreatives.adCampaignId,
      format: adCreatives.format,
      status: adCreatives.status,
      hookCopy: adCreatives.hookCopy,
      assetId: adCreatives.assetId,
    })
    .from(adCreatives)
    .where(inArray(adCreatives.adCampaignId, campaigns.map(c => c.id)))
  const assetIds = rows.map(r => r.assetId)
  const assets = assetIds.length
    ? await db.select({ id: mediaAssets.id, blobUrl: mediaAssets.blobUrl, kind: mediaAssets.kind }).from(mediaAssets).where(inArray(mediaAssets.id, assetIds))
    : []
  const assetById = new Map(assets.map(a => [a.id, a]))
  return campaigns.map(campaign => ({
    campaign,
    creatives: rows
      .filter(r => r.adCampaignId === campaign.id)
      .map(r => ({
        id: r.id,
        format: r.format,
        status: r.status,
        hookCopy: r.hookCopy,
        blobUrl: assetById.get(r.assetId)?.blobUrl ?? '',
        kind: assetById.get(r.assetId)?.kind ?? 'image',
      })),
  }))
}

export async function updateCreative(id: number, patch: { status?: 'approved' | 'rejected' | 'pushed'; hookCopy?: string }): Promise<void> {
  await db.update(adCreatives)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.hookCopy !== undefined ? { hookCopy: patch.hookCopy } : {}),
      updatedAt: new Date(),
    })
    .where(eq(adCreatives.id, id))
}

export async function getCampaign(id: number) {
  const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, id)).limit(1)
  return row ?? null
}
