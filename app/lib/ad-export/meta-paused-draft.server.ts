/**
 * Meta paused draft: the full Marketing API payload set for one creative or one
 * idea (campaign, ad set, image upload, creative, ad), every object PAUSED.
 *
 * BUILD is pure and always safe. It writes a payload plus a human-readable
 * preview into ad_creatives.export_payload and touches nothing on Meta.
 *
 * PUSH is the only code in the export registry that can reach a platform. It
 * refuses with `spend_disabled` unless ads_spend_enabled is true, refuses with
 * `not_configured` unless META_ADS_ACCESS_TOKEN (alias META_ACCESS_TOKEN),
 * META_AD_ACCOUNT_ID and META_PAGE_ID exist, re-asserts that every object is
 * PAUSED with age_min 25 before it sends a byte, and can never create anything
 * ACTIVE. Only the owner flips an ad live, in Ads Manager (ads-policy.md M4).
 * Push is not reachable from the team token: only the admin route action calls it.
 *
 * THE MCP ALTERNATIVE. The Meta Ads MCP is a connector the owner authorizes in a
 * chat session, not a server-side credential, and the daily routine never
 * carries it. In an owner-authorized session an agent can run the SAME payloads
 * through ads_creative_upload_media (the adimages step), ads_create_campaign,
 * ads_create_ad_set, ads_create_creative and ads_create_ad, each with status
 * PAUSED, and then record the ad id on the creative. Same safety rule: valve on,
 * PAUSED only, one advertiser page, 25+.
 */
import { META_OBJECT_STATUS, MetaPushError, fitsMetaDescription, type MetaDraftPayload, type MetaDraftAd } from './meta-payload'
import { ExportRefusal, withUtms, type ExportBuild, type ExportCreative, type ExportIdea } from './common'
import { META_HEADLINE_MAX, metaIssues, type MetaCopy } from './policy'

export * from './meta-payload'

export const META_GRAPH_VERSION_DEFAULT = 'v23.0'
const BE_CPA_FALLBACK_CENTS = 1500
const MIN_DAILY_CENTS = 100

export interface MetaBuildInput {
  idea: ExportIdea
  creatives: ExportCreative[]
  dailyCapCents: number
  /** M5: handle membership in the curated subset, or null when the subset is not loaded here. */
  inSubset?: ((handle: string) => boolean) | null
  pageIdConfigured?: boolean
  graphVersion?: string
  now?: Date
}

/** Daily budget: the idea's break-even CPA (one purchase's worth a day), floored at $1, never above the daily valve. */
export function metaDailyBudget(idea: Pick<ExportIdea, 'breakEven' | 'audience'>, capCents: number): { cents: number; source: string } {
  const be = idea.breakEven
  const explicit = idea.audience?.['daily_budget_cents']
  let base = BE_CPA_FALLBACK_CENTS
  let source = 'default break-even CPA ($15, research E.2)'
  if (typeof explicit === 'number' && explicit > 0) { base = explicit; source = 'idea audience.daily_budget_cents' }
  else if (be && typeof be['cpa_cents'] === 'number') { base = be['cpa_cents'] as number; source = 'idea break-even CPA' }
  else if (be && typeof be['cpa'] === 'number') { base = Math.round((be['cpa'] as number) * 100); source = 'idea break-even CPA' }
  const cents = Math.max(MIN_DAILY_CENTS, Math.min(Math.trunc(base), Math.max(MIN_DAILY_CENTS, capCents)))
  return { cents, source: cents < base ? `${source}, capped by the daily valve` : source }
}

export function metaObjective(idea: Pick<ExportIdea, 'audience'>): 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC' {
  return idea.audience?.['objective'] === 'sales' ? 'OUTCOME_SALES' : 'OUTCOME_TRAFFIC'
}

function pickHeadline(idea: ExportIdea, c: ExportCreative): string {
  const own = idea.headlines.find(h => h !== c.slogan && h.length <= META_HEADLINE_MAX)
  return own ?? c.slogan ?? idea.headlines[0] ?? idea.title
}

export function metaCopyFor(idea: ExportIdea, c: ExportCreative): MetaCopy {
  const base = idea.destinationUrl
  if (!base || !/^https?:\/\//.test(base)) throw new ExportRefusal('policy', `Idea #${idea.id} has no destination URL.`)
  const [primary, second] = idea.body
  const description = second && fitsMetaDescription(second) ? second : null
  return {
    headline: pickHeadline(idea, c),
    primaryText: primary ?? idea.oneLiner ?? idea.headlines[0] ?? idea.title,
    description,
    destination: withUtms(base, idea, c.id),
  }
}

export function buildMetaDraft(input: MetaBuildInput): ExportBuild {
  const { idea, creatives } = input
  if (idea.lane !== 'meta') throw new ExportRefusal('mixed_lanes', `Idea #${idea.id} is lane ${idea.lane}, not meta.`)
  const now = input.now ?? new Date()
  const issues: string[] = []
  const warnings = new Set<string>()
  const budget = metaDailyBudget(idea, input.dailyCapCents)
  const objective = metaObjective(idea)

  const ads: MetaDraftAd[] = []
  for (const c of creatives) {
    const copy = metaCopyFor(idea, c)
    const handle = idea.products[0]?.handle ?? null
    const res = metaIssues({ idea, creative: c, copy, inSubset: input.inSubset ?? null, handle })
    for (const i of res.issues) issues.push(`Creative #${c.id}: ${i}`)
    for (const w of res.warnings) warnings.add(w)
    const file = `xdipx-${c.id}-${c.format.replace(':', 'x')}.png`
    ads.push({
      creativeId: c.id,
      format: c.format,
      image: { step: 'adimages', assetUrl: c.assetUrl ?? '', filename: file, width: c.width, height: c.height },
      adCreative: {
        name: `xdipx c${c.id} ${c.format}`.slice(0, 100),
        object_story_spec: {
          page_id: '{{META_PAGE_ID}}',
          link_data: {
            image_hash: '{{image_hash}}',
            link: copy.destination,
            message: copy.primaryText,
            name: copy.headline,
            ...(copy.description ? { description: copy.description } : {}),
            call_to_action: { type: 'SHOP_NOW', value: { link: copy.destination } },
          },
        },
      },
      ad: {
        name: `xdipx ad c${c.id} ${c.format}`.slice(0, 100),
        status: META_OBJECT_STATUS,
        adset_id: '{{adset_id}}',
        creative: { creative_id: '{{creative_id}}' },
      },
      preview: { headline: copy.headline, primaryText: copy.primaryText, description: copy.description, link: copy.destination },
    })
  }
  if (issues.length) throw new ExportRefusal('policy', issues)

  const payload: MetaDraftPayload = {
    version: 1,
    exporter: 'meta-paused-draft',
    status: 'ready',
    apiVersion: input.graphVersion ?? META_GRAPH_VERSION_DEFAULT,
    ideaId: idea.id,
    builtAt: now.toISOString(),
    safety: { everyObjectStatus: META_OBJECT_STATUS, ageMin: 25, countries: ['US'], specialAdCategories: [], neverActive: true },
    pageIdConfigured: input.pageIdConfigured ?? false,
    budget: { dailyCents: budget.cents, capCents: input.dailyCapCents, source: budget.source },
    campaign: {
      name: idea.title.slice(0, 120),
      objective,
      status: META_OBJECT_STATUS,
      special_ad_categories: [],
      buying_type: 'AUCTION',
      is_adset_budget_sharing_enabled: false,
    },
    adSet: {
      name: `${idea.title.slice(0, 80)} US 25+`,
      campaign_id: '{{campaign_id}}',
      status: META_OBJECT_STATUS,
      daily_budget: budget.cents,
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'WEBSITE',
      targeting: {
        age_min: 25,
        age_max: 65,
        geo_locations: { countries: ['US'] },
        targeting_automation: { advantage_audience: 0 },
      },
    },
    ads,
    preview: [],
    warnings: [...warnings],
    mcpEquivalent: ['ads_creative_upload_media', 'ads_create_campaign', 'ads_create_ad_set', 'ads_create_creative', 'ads_create_ad'],
  }
  if (objective === 'OUTCOME_SALES') payload.warnings.push('Objective is sales but the ad set optimizes for link clicks until pixel purchase volume exists.')
  payload.preview = previewLines(payload)
  MetaPushError.assertSafe(payload)

  const destinations: Record<number, string> = {}
  for (const a of ads) destinations[a.creativeId] = a.preview.link
  return {
    exporter: 'meta-paused-draft',
    kind: 'meta-paused-draft',
    filename: `meta-paused-draft-idea-${idea.id}.json`,
    contentType: 'application/json',
    payloadJson: payload,
    destinations,
    summary: {
      lines: [
        `Meta paused draft: 1 campaign (${objective}), 1 ad set (US, 25+, $${(budget.cents / 100).toFixed(2)}/day), ${ads.length} ad${ads.length === 1 ? '' : 's'}`,
        'Every object is PAUSED. Nothing was sent to Meta.',
      ],
      counts: { campaigns: 1, adSets: 1, ads: ads.length },
      warnings: payload.warnings,
    },
  }
}

function previewLines(p: MetaDraftPayload): string[] {
  const lines = [
    `Campaign "${p.campaign.name}": ${p.campaign.objective}, ${p.campaign.status}, no special ad categories`,
    `Ad set: US, age ${p.adSet.targeting.age_min}+, automatic placements, optimize for link clicks, $${(p.adSet.daily_budget / 100).toFixed(2)} a day (${p.budget.source}), ${p.adSet.status}`,
  ]
  for (const a of p.ads) {
    lines.push(`Ad c${a.creativeId} (${a.format}): "${a.preview.headline}" / ${a.preview.primaryText}${a.preview.description ? ` / ${a.preview.description}` : ''}`)
    lines.push(`  Link ${a.preview.link}, button Shop now, ${a.ad.status}`)
  }
  lines.push(`Page: ${p.pageIdConfigured ? 'META_PAGE_ID is set' : 'META_PAGE_ID is not set yet'}. One advertiser page, xdipx.`)
  return lines
}
