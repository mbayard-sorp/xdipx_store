/**
 * Lightweight `ad_creatives` rows for owner-built ads (ticket #18774,
 * supersedes #16701).
 *
 * An ad the owner builds directly in Ads Manager (or through the Meta MCP),
 * outside the Ad Studio proposal pipeline, gets a mirror row in
 * `ad_platform_entities` the next entity sync, but no `ad_creatives` row --
 * nothing in that pipeline ever creates one. Every per-ad consumer downstream
 * is keyed off `ad_creatives`, not the mirror: `insights.server.ts`'s
 * `planCreativeMetrics` buckets an ad with no linked creative into one
 * anonymous account-level row per day (by design, so the P&L spend total is
 * never short a cent), `ad-rules.server.ts`'s `loadRulesWindow` reads
 * `ad_creatives` directly and never sees the mirror at all, and every summary
 * built from either is blind to the ad as an individual thing. The spend and
 * clicks are already sitting in `ad_platform_insights_daily`, pulled hourly;
 * the gap is purely that nothing turns a mirrored ad into the row the rest of
 * the pipeline keys on.
 *
 * This creates exactly that row, once per owner-built ad, and nothing else:
 * - one shared placeholder `ad_campaigns` row per external campaign (so the
 *   NOT NULL `ad_campaigns_id` FK is satisfied without inventing a fake
 *   AI-authored campaign -- `policyCheck` says plainly that it is mirrored,
 *   not proposed),
 * - one shared placeholder `media_assets` row, reused for every owner-built
 *   creative (the console never renders this image; it exists only to
 *   satisfy `ad_creatives.asset_id`'s NOT NULL FK),
 * - one `ad_creatives` row per ad, `external_ad_id` set to the ad's own
 *   external id.
 *
 * Setting `external_ad_id` is what makes this work with no other code
 * change: `insights.server.ts`'s `creativeIdsForAds` already matches on it on
 * every hourly pull, so the very next pull after this runs moves that ad's
 * spend and clicks from the account-level bucket onto its own creative row,
 * and `ad-rules.server.ts`'s `loadRulesWindow` already selects every
 * `ad_creatives` row unconditionally, so the next rules pass evaluates it.
 *
 * Deliberately invents no destination-url or utm_content guess and claims no
 * revenue: an owner-built campaign's order attribution can use a convention
 * the existing utm_content/external_ad_id order match never covers (Advent26
 * attributes orders by a Shopify cart attribute, not a tagged URL --
 * `docs/store-team/ads-live-campaigns.md`), so `net_revenue_cents`/ROAS for
 * these rows reads honestly as 0 until that is wired separately.
 *
 * QA (bounce on ticket #18774's first PR) caught that reading a real, honest
 * 0 is not the same as "stays quiet": `netRoas()` returns an actual `0`, not
 * `null`, whenever spend is positive, so R1 (0 orders at 2x break-even spend)
 * and R6 (ROAS under break-even in two windows) would eventually fire a false
 * pause/brake against these rows, and only R5's scale threshold (which needs
 * ROAS *above* break-even) happens to stay quiet on its own. So `exportPayload:
 * { ownerBuilt: true }` set below also marks `revenueAttributed: false` on the
 * `CreativeRuleInput` these rows produce (`ad-rules.server.ts`'s
 * `loadRulesWindow`), and `ad-rules-core.ts` gates R1, R3 and R6 off that flag
 * explicitly. R2 (CTR) and R8 (frequency) do not read revenue and are
 * unaffected; R7 (account spend) is unaffected because it never reads orders
 * or ROAS at all.
 *
 * Never touches the protected apply/mutate paths (`ad-platform-apply.server.ts`,
 * `ads/channels/*\/mutate.server.ts`) or any valve. A rule that fires for one
 * of these creatives still only proposes through the ordinary
 * `POST /api/team/ad-action` path, exactly as for any synced creative.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db as defaultDb, type DB } from '~/lib/db.server'
import { adCampaigns, adCreatives, adPlatformEntities, mediaAssets } from '../../../db/schema'

/** One ad-level mirror row with no linked creative yet. */
export interface MirrorAdRow {
  platform: string
  externalId: string
  parentExternalId: string | null
  name: string | null
  status: string | null
  effectiveStatus: string | null
}

/** A campaign-level mirror row, named plainly so the placeholder campaign reads sensibly. */
export interface MirrorCampaignRow {
  externalId: string
  platform: string
  name: string | null
  objective: string | null
}

const PLACEHOLDER_ASSET_MARKER = 'owner-built-ad-creative-placeholder'

/** An ad still worth a creative row for: live, or paused recently enough that it might resume. Anything else (archived, deleted, missing) is not. */
const ELIGIBLE_STATUSES = new Set(['ACTIVE', 'PAUSED'])

/** The ad's own best-known status: effective_status when the platform reports one, else status. */
function adStatus(ad: MirrorAdRow): string {
  return (ad.effectiveStatus ?? ad.status ?? '').toUpperCase()
}

/**
 * Pure filter: unlinked ads worth a placeholder creative. Exported so the
 * eligibility rule is testable without a database.
 */
export function selectEligibleAds(ads: readonly MirrorAdRow[]): MirrorAdRow[] {
  return ads.filter(a => ELIGIBLE_STATUSES.has(adStatus(a)))
}

/**
 * Pure walk from an ad up to its campaign's external id, through the mirror's
 * own parent-id chain (ad -> adset -> campaign). Returns null when either hop
 * is missing from what was mirrored this pass -- the caller skips the ad
 * rather than guessing, and picks it up again once the mirror has caught up.
 */
export function resolveCampaignExternalId(
  ad: MirrorAdRow,
  adsetParentByExternalId: ReadonlyMap<string, string | null>,
): string | null {
  if (!ad.parentExternalId) return null
  const campaignExternalId = adsetParentByExternalId.get(ad.parentExternalId)
  return campaignExternalId ?? null
}

export interface EnsureResult {
  campaignsCreated: number
  creativesCreated: number
  linked: number
  /** Eligible ads this pass could not resolve a campaign for (adset or campaign not yet mirrored); retried next sync. */
  skippedNoCampaign: number
}

const EMPTY_RESULT: EnsureResult = { campaignsCreated: 0, creativesCreated: 0, linked: 0, skippedNoCampaign: 0 }

/** The database half, behind an interface so the walk-and-create logic is testable without a database. */
export interface OwnerBuiltCreativesStore {
  /** Every ad-level mirror row with no linked creative yet, any status. */
  unlinkedAds(): Promise<MirrorAdRow[]>
  /** adset-level mirror rows for these external ids, `{externalId -> parentExternalId}`. */
  adsetParents(externalIds: string[]): Promise<Map<string, string | null>>
  /** campaign-level mirror rows for these external ids. */
  campaigns(externalIds: string[]): Promise<MirrorCampaignRow[]>
  /** `ad_campaigns.id` already keyed by `external_campaign_id`, for the ids asked about. */
  existingCampaignIds(externalCampaignIds: string[]): Promise<Map<string, number>>
  /** Insert one placeholder `ad_campaigns` row, return its id. */
  createCampaign(c: MirrorCampaignRow): Promise<number>
  /** The shared placeholder media asset id, creating it on first call ever. */
  placeholderAssetId(): Promise<number>
  /** Insert one placeholder `ad_creatives` row, return its id. */
  createCreative(c: { adCampaignId: number; assetId: number; ad: MirrorAdRow }): Promise<number>
  /** Link the mirror row to its new creative. */
  linkCreative(platform: string, externalId: string, creativeId: number): Promise<void>
}

export async function ensureOwnerBuiltCreatives(store: OwnerBuiltCreativesStore = drizzleOwnerBuiltCreativesStore()): Promise<EnsureResult> {
  const eligible = selectEligibleAds(await store.unlinkedAds())
  if (eligible.length === 0) return EMPTY_RESULT

  const adsetIds = [...new Set(eligible.map(a => a.parentExternalId).filter((x): x is string => !!x))]
  const adsetParentByExternalId = adsetIds.length ? await store.adsetParents(adsetIds) : new Map<string, string | null>()

  const campaignExtIds = [...new Set(eligible
    .map(a => resolveCampaignExternalId(a, adsetParentByExternalId))
    .filter((x): x is string => !!x))]
  const campaignRows = campaignExtIds.length ? await store.campaigns(campaignExtIds) : []
  const campaignByExtId = new Map(campaignRows.map(c => [c.externalId, c]))

  const existingCampaignIds = campaignExtIds.length ? await store.existingCampaignIds(campaignExtIds) : new Map<string, number>()
  const adCampaignIdByExtId = new Map(existingCampaignIds)
  let campaignsCreated = 0
  for (const extId of campaignExtIds) {
    if (adCampaignIdByExtId.has(extId)) continue
    const mirror = campaignByExtId.get(extId)
    if (!mirror) continue // the campaign itself was not in this pass's mirror; skip, retried next sync.
    const id = await store.createCampaign(mirror)
    adCampaignIdByExtId.set(extId, id)
    campaignsCreated++
  }

  let creativesCreated = 0
  let linked = 0
  let skippedNoCampaign = 0
  let assetId: number | null = null
  for (const ad of eligible) {
    const campaignExtId = resolveCampaignExternalId(ad, adsetParentByExternalId)
    const adCampaignId = campaignExtId ? adCampaignIdByExtId.get(campaignExtId) : undefined
    if (!adCampaignId) { skippedNoCampaign++; continue }
    if (assetId == null) assetId = await store.placeholderAssetId()

    const creativeId = await store.createCreative({ adCampaignId, assetId, ad })
    creativesCreated++
    await store.linkCreative(ad.platform, ad.externalId, creativeId)
    linked++
  }

  return { campaignsCreated, creativesCreated, linked, skippedNoCampaign }
}

// ---------------------------------------------------------------------------
// The Drizzle store.
// ---------------------------------------------------------------------------

export function drizzleOwnerBuiltCreativesStore(database: DB = defaultDb): OwnerBuiltCreativesStore {
  return {
    async unlinkedAds() {
      return database
        .select({
          platform: adPlatformEntities.platform, externalId: adPlatformEntities.externalId,
          parentExternalId: adPlatformEntities.parentExternalId, name: adPlatformEntities.name,
          status: adPlatformEntities.status, effectiveStatus: adPlatformEntities.effectiveStatus,
        })
        .from(adPlatformEntities)
        .where(and(eq(adPlatformEntities.level, 'ad'), isNull(adPlatformEntities.creativeId)))
    },

    async adsetParents(externalIds) {
      const rows = await database
        .select({ externalId: adPlatformEntities.externalId, parentExternalId: adPlatformEntities.parentExternalId })
        .from(adPlatformEntities)
        .where(and(eq(adPlatformEntities.level, 'adset'), inArray(adPlatformEntities.externalId, externalIds)))
      return new Map(rows.map(r => [r.externalId, r.parentExternalId]))
    },

    async campaigns(externalIds) {
      return database
        .select({
          externalId: adPlatformEntities.externalId, platform: adPlatformEntities.platform,
          name: adPlatformEntities.name, objective: adPlatformEntities.objective,
        })
        .from(adPlatformEntities)
        .where(and(eq(adPlatformEntities.level, 'campaign'), inArray(adPlatformEntities.externalId, externalIds)))
    },

    async existingCampaignIds(externalCampaignIds) {
      const rows = await database
        .select({ id: adCampaigns.id, externalCampaignId: adCampaigns.externalCampaignId })
        .from(adCampaigns)
        .where(inArray(adCampaigns.externalCampaignId, externalCampaignIds))
      const out = new Map<string, number>()
      for (const r of rows) if (r.externalCampaignId && !out.has(r.externalCampaignId)) out.set(r.externalCampaignId, r.id)
      return out
    },

    async createCampaign(c) {
      const [created] = await database.insert(adCampaigns).values({
        platform: c.platform,
        name: c.name ?? `Owner-built campaign ${c.externalId}`,
        objective: c.objective ?? 'unknown',
        status: 'launched',
        plannedDailyCents: 0,
        externalCampaignId: c.externalId,
        policyCheck:
          'Owner-built directly on the platform (docs/store-team/ads-live-campaigns.md); mirrored here for team ' +
          'visibility and evaluation, not an AI-proposed Ad Studio campaign, so no Ad Studio policy check applies.',
      }).returning({ id: adCampaigns.id })
      return created!.id
    },

    async placeholderAssetId() {
      const existing = await database
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(sql`${mediaAssets.provenance} ->> 'marker' = ${PLACEHOLDER_ASSET_MARKER}`)
        .limit(1)
      if (existing[0]) return existing[0].id
      const [created] = await database.insert(mediaAssets).values({
        kind: 'image',
        purpose: 'ad_static',
        blobUrl: '',
        contentType: 'application/octet-stream',
        provenance: {
          marker: PLACEHOLDER_ASSET_MARKER,
          note: 'Shared placeholder asset for owner-built ad_creatives rows (ticket #18774); never rendered anywhere.',
        },
      }).returning({ id: mediaAssets.id })
      return created!.id
    },

    async createCreative({ adCampaignId, assetId, ad }) {
      const [created] = await database.insert(adCreatives).values({
        adCampaignId,
        assetId,
        format: '1:1',
        status: 'pushed',
        policyCheck:
          'Owner-built ad, mirrored here for team visibility and evaluation (ticket #18774); not an Ad Studio ' +
          'render, so no Ad Studio policy check applies.',
        externalAdId: ad.externalId,
        exportPayload: { ownerBuilt: true, adName: ad.name },
        launchedAt: new Date(),
        pausedAt: adStatus(ad) === 'PAUSED' ? new Date() : null,
      }).returning({ id: adCreatives.id })
      return created!.id
    },

    async linkCreative(platform, externalId, creativeId) {
      await database.update(adPlatformEntities).set({ creativeId })
        .where(and(eq(adPlatformEntities.platform, platform), eq(adPlatformEntities.externalId, externalId)))
    },
  }
}
