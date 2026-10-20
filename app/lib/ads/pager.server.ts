/**
 * The ads pager (ticket #16432, plan §9.8 "Pages").
 *
 * pageOwner(reason, detail) files an owner blocker keyed by the reason
 * through owner-blockers.server's fileBlocker, the same path token-health
 * and the health step use. That is the only owner email path the store has:
 * the blocker list reaches the owner through the blocker email and the
 * digest's Needs Mike list. There is no SMS page yet. Re-filing the same key
 * updates the open row instead of adding one, so an hourly check that keeps
 * seeing the same problem keeps one blocker.
 *
 * runPagerChecks() runs in the hourly /cron/ads-insights pass, after the
 * applier. What it pages, and what it leaves to someone else:
 *
 * - An ad rejection or account restriction in the mirror: any entity whose
 *   effective_status is DISAPPROVED or WITH_ISSUES, one page per entity.
 * - Today's spend at least 1.5x ads_media_daily_cap_cents, from the ad-level
 *   rows of ad_platform_insights_daily. One page per UTC day.
 * - No Lead event for 6h while today's spend is above $5. Only when the
 *   lead_events_6h sample says a Lead ledger exists (detail.ledger === true).
 *   Today it does not, so this check stays quiet instead of paging on a zero
 *   that means "not counted".
 * - R7: ad-rules.server files its spend-guard blocker through pageOwner.
 * - L3: health.server files ads-funnel-break with a self-clearing probe.
 * - The Shopify Growth campaign: health.server files ads-growth-campaign-active.
 * - Ad-account payment failure or restriction: health-snapshots.server reads
 *   account_status every hour and files ads-meta-account-status through
 *   pageOwner (ticket #16686).
 *
 * Not built, reported in `skipped` on every run:
 * - CURIOUS15 redemptions ahead of leads, and any use of HKK1P6EV0AEJ.
 *   Nothing in the store reads discount-code redemptions: order_attribution
 *   has no code column, and no Shopify read pulls an order's discount codes.
 */
import type { BlockerInput } from '~/lib/owner-blockers-core'

export const PAGE_KEY_PREFIX = 'ads-page-'
export const REJECTED_STATUSES = ['DISAPPROVED', 'WITH_ISSUES'] as const
export const SPEND_PAGE_MULTIPLE = 1.5
export const NO_LEAD_SPEND_FLOOR_CENTS = 500
export const LEAD_EVENTS_KEY = 'lead_events_6h'

export const PAGER_NOT_BUILT = [
  'CURIOUS15 ahead of leads and HKK1P6EV0AEJ use: nothing reads discount-code redemptions',
] as const

export interface PageDetail {
  title: string
  detail: string
  whereToGo?: string
  unblocks?: string
  /** Overrides the ads-page-<reason> key, for a page that already had one. */
  dedupeKey?: string
  priority?: number
  sourceRef?: string
  /** decision by default: no probe can say a page is over, so the owner closes it. */
  category?: 'decision' | 'approval'
  source?: 'sweep' | 'agent'
}

export type FileBlockerFn = (input: BlockerInput) => Promise<{ id: number; created: boolean; reopened: boolean }>

export interface PageOutcome {
  key: string
  filed: boolean
  id?: number
  error?: string
}

async function defaultFileBlocker(input: BlockerInput) {
  const { fileBlocker } = await import('~/lib/owner-blockers.server')
  return fileBlocker(input)
}

export function pageKey(reason: string): string {
  return `${PAGE_KEY_PREFIX}${reason}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 80)
}

/**
 * Files one owner blocker for `reason`. Never throws: a page that cannot be
 * filed is logged and reported in the outcome, because every caller is a
 * cron step that must not fail its run over it.
 */
export async function pageOwner(
  reason: string,
  detail: PageDetail,
  deps: { fileBlocker?: FileBlockerFn | undefined } = {},
): Promise<PageOutcome> {
  const key = detail.dedupeKey ?? pageKey(reason)
  try {
    const r = await (deps.fileBlocker ?? defaultFileBlocker)({
      dedupeKey: key,
      title: detail.title,
      detail: detail.detail,
      unblocks: detail.unblocks ?? null,
      whereToGo: detail.whereToGo ?? 'https://xdipx.com/admin/ads',
      category: detail.category ?? 'decision',
      priority: detail.priority ?? 1,
      source: detail.source ?? 'sweep',
      sourceRef: detail.sourceRef ?? `ads:pager:${reason}`,
    })
    return { key, filed: true, id: r.id }
  } catch (err) {
    console.error('[ads/pager] could not file the page', key, err)
    return { key, filed: false, error: String(err).slice(0, 300) }
  }
}

// ---------------------------------------------------------------------------
// The hourly checks
// ---------------------------------------------------------------------------

export interface RejectedEntity {
  platform: string
  level: string
  externalId: string
  name: string | null
  effectiveStatus: string
}

export interface LeadEventsSample {
  value: number
  detail: Record<string, unknown> | null
}

export interface PagerStore {
  rejectedEntities(): Promise<RejectedEntity[]>
  /** Sum of ad-level spend for one UTC day, every platform. */
  spendForDay(day: string): Promise<number>
  latestLeadEvents(): Promise<LeadEventsSample | null>
}

export interface PagerDeps {
  store?: PagerStore
  dailyCapCents?: () => Promise<number>
  fileBlocker?: FileBlockerFn
  now?: () => Date
}

export interface PagerResult {
  pages: PageOutcome[]
  spendTodayCents: number
  dailyCapCents: number
  skipped: string[]
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

const LEVEL_WORD: Record<string, string> = { campaign: 'campaign', adset: 'ad set', ad: 'ad', creative: 'creative' }

async function drizzlePagerStore(): Promise<PagerStore> {
  const [{ db }, { adHealthSamples, adPlatformEntities, adPlatformInsightsDaily }, { and, desc, eq, inArray, sql }] = await Promise.all([
    import('~/lib/db.server'), import('../../../db/schema'), import('drizzle-orm'),
  ])
  return {
    async rejectedEntities() {
      const rows = await db.select({
        platform: adPlatformEntities.platform,
        level: adPlatformEntities.level,
        externalId: adPlatformEntities.externalId,
        name: adPlatformEntities.name,
        effectiveStatus: adPlatformEntities.effectiveStatus,
      }).from(adPlatformEntities).where(inArray(adPlatformEntities.effectiveStatus, [...REJECTED_STATUSES])).limit(50)
      return rows.map(r => ({ ...r, effectiveStatus: r.effectiveStatus ?? '' }))
    },
    async spendForDay(day) {
      const [row] = await db.select({ n: sql<number>`coalesce(sum(${adPlatformInsightsDaily.spendCents}), 0)::int` })
        .from(adPlatformInsightsDaily)
        .where(and(eq(adPlatformInsightsDaily.level, 'ad'), eq(adPlatformInsightsDaily.day, day)))
      return Number(row?.n ?? 0)
    },
    async latestLeadEvents() {
      const [row] = await db.select({ value: adHealthSamples.value, detail: adHealthSamples.detail })
        .from(adHealthSamples)
        .where(eq(adHealthSamples.key, LEAD_EVENTS_KEY))
        .orderBy(desc(adHealthSamples.sampledAt))
        .limit(1)
      return row ? { value: Number(row.value), detail: (row.detail as Record<string, unknown> | null) ?? null } : null
    },
  }
}

async function defaultDailyCap(): Promise<number> {
  const { getAdsMediaDailyCapCents } = await import('~/lib/ad-settings.server')
  return getAdsMediaDailyCapCents()
}

/** Runs every page check once. Each check files at most one page per key. */
export async function runPagerChecks(deps: PagerDeps = {}): Promise<PagerResult> {
  const now = (deps.now ?? (() => new Date()))()
  const day = now.toISOString().slice(0, 10)
  const store = deps.store ?? await drizzlePagerStore()
  const page = (reason: string, d: PageDetail) => pageOwner(reason, d, { fileBlocker: deps.fileBlocker })
  const pages: PageOutcome[] = []

  // Rejections and restrictions, one page per entity.
  for (const e of await store.rejectedEntities()) {
    const what = `${LEVEL_WORD[e.level] ?? e.level} ${e.name?.trim() || e.externalId}`
    pages.push(await page(`rejected-${e.platform}-${e.externalId}`, {
      title: `Ads: ${e.platform} marked ${what} ${e.effectiveStatus}`,
      detail: [
        `The entity mirror shows ${e.platform} ${LEVEL_WORD[e.level] ?? e.level} ${e.externalId}${e.name ? ` (${e.name})` : ''} with effective_status ${e.effectiveStatus}.`,
        'Plan §9.8 pages on any rejection or restriction. Read the review feedback in Ads Manager before anything else runs in that lane. Reopening a lane after a rejection is an owner decision (plan §9.4, tier C).',
      ].join('\n\n'),
      whereToGo: 'https://xdipx.com/admin/ads/tree, then the ad in Meta Ads Manager',
      unblocks: 'Delivery on the rejected entity, and the account standing behind it.',
    }))
  }

  // Spend at 1.5x the daily cap.
  const [spendTodayCents, dailyCapCents] = await Promise.all([
    store.spendForDay(day),
    (deps.dailyCapCents ?? defaultDailyCap)(),
  ])
  if (dailyCapCents > 0 && spendTodayCents >= dailyCapCents * SPEND_PAGE_MULTIPLE) {
    pages.push(await page(`spend-1-5x-${day}`, {
      title: `Ads: today's spend is ${usd(spendTodayCents)}, past 1.5x the ${usd(dailyCapCents)} daily cap`,
      detail: [
        `Ad-level spend for ${day} (UTC) reads ${usd(spendTodayCents)} across every channel. The daily cap is ${usd(dailyCapCents)}, so the page line of 1.5x is ${usd(Math.round(dailyCapCents * SPEND_PAGE_MULTIPLE))}.`,
        'Check the account spending cap in Ads Manager and what is live on /admin/ads/tree. R7 pauses everything on its own when its trigger is met; this page fires either way.',
      ].join('\n\n'),
      whereToGo: 'https://xdipx.com/admin/ads/tree, then Meta Ads Manager',
      unblocks: 'Spend above the cap you set.',
    }))
  }

  // No Lead event for 6h while money is going out. Silent without a Lead ledger.
  const skipped: string[] = [...PAGER_NOT_BUILT]
  const leads = await store.latestLeadEvents()
  if (leads?.detail?.['ledger'] !== true) {
    skipped.push('no Lead event in 6h: lead_events_6h has no ledger yet, so a 0 there means "not counted"')
  } else if (leads.value === 0 && spendTodayCents > NO_LEAD_SPEND_FLOOR_CENTS) {
    pages.push(await page(`no-lead-event-${day}`, {
      title: `Ads: no Lead event in 6 hours while today's spend is ${usd(spendTodayCents)}`,
      detail: [
        `meta-capi recorded 0 Lead events in the last 6 hours, and ad-level spend for ${day} (UTC) is ${usd(spendTodayCents)}, over the ${usd(NO_LEAD_SPEND_FLOOR_CENTS)} line in plan §9.8.`,
        'Either the lead page stopped taking signups or the Lead event stopped firing. Try one signup on curious.xdipx.com, then check Events Manager.',
      ].join('\n\n'),
      whereToGo: 'https://curious.xdipx.com, then Meta Events Manager',
      unblocks: 'Lead spend that Meta cannot optimize against.',
    }))
  }

  return { pages, spendTodayCents, dailyCapCents, skipped }
}
