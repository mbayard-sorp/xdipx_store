/**
 * Shared pieces of the export registry: the subject shapes the exporters read,
 * the UTM scheme, and the refusal error. Pure (no db, no network), so every
 * exporter's builder is testable with plain objects.
 */
import type { GatesJson } from '~/lib/ad-render-rules'
import { GATE_ORDER } from '~/lib/ad-render-rules'
import type { ExporterId, ExportSummary } from './types'

export interface ExportIdea {
  id: number
  lane: string
  registerTier: string
  conceptSlug: string
  title: string
  oneLiner: string | null
  products: Array<{ handle: string; title?: string; displayTitle?: string }>
  headlines: string[]
  body: string[]
  audience: Record<string, unknown> | null
  destinationUrl: string | null
  breakEven: Record<string, unknown> | null
  policyCheck: string
  status: string
}

export interface ExportCreative {
  id: number
  ideaId: number
  lane: string
  registerTier: string
  format: string
  width: number | null
  height: number | null
  slogan: string | null
  status: string
  gates: GatesJson | null
  /** The rendered PNG; null for text-only rows. */
  assetUrl: string | null
  /** True when the plate (or the creative) was generated on skin. */
  onSkin: boolean
  /** Rendered idea copy for this creative, already read from the idea. */
  displayTitle?: string | null
}

/** What every builder returns. Exactly one of `bytes` and `payloadJson` is set. */
export interface ExportBuild {
  exporter: ExporterId
  kind: ExporterId
  filename: string
  contentType: string
  bytes?: Buffer
  payloadJson?: unknown
  summary: ExportSummary
  /** Google: 'google' or 'microsoft'. */
  variant?: string
  /** Per-creative UTM'd destination, written back to export_payload.destination_url. */
  destinations?: Record<number, string>
}

export type RefusalCode =
  | 'no_subjects'
  | 'mixed_lanes'
  | 'not_hearted'
  | 'gate_blocked'
  | 'policy'
  | 'no_asset'
  | 'no_keywords'
  | 'blob_not_configured'
  | 'not_found'

/** An export that refuses to build. `issues` is the list the owner reads. */
export class ExportRefusal extends Error {
  readonly code: RefusalCode
  readonly issues: string[]
  constructor(code: RefusalCode, issues: string[] | string) {
    const list = Array.isArray(issues) ? issues : [issues]
    super(list.join(' '))
    this.name = 'ExportRefusal'
    this.code = code
    this.issues = list
  }
}

// ---------------------------------------------------------------------------
// UTM scheme (owner runbook): source by platform, medium paid, campaign per idea,
// content per creative so Shopify order attribution can read it back (PR-G).
// The adult lane is the exception: source is the network, medium the placement
// (ticket #16685), so ExoClick and JuicyAds orders can be told apart.
// ---------------------------------------------------------------------------

const UTM_SOURCE: Readonly<Record<string, string>> = {
  meta: 'facebook',
  google: 'google',
  microsoft: 'bing',
  snap: 'snapchat',
  newsletter: 'newsletter',
  owned: 'owned',
}

const UTM_MEDIUM: Readonly<Record<string, string>> = {
  newsletter: 'sponsor',
  owned: 'owned',
}

/** The adult networks an adult-lane export can be addressed to. ExoClick is the default. */
export const ADULT_NETWORKS = ['exoclick', 'juicyads'] as const
export type AdultNetwork = typeof ADULT_NETWORKS[number]
export const DEFAULT_ADULT_NETWORK: AdultNetwork = 'exoclick'

/**
 * The single utm_source every adult banner carried before ticket #16685. Still
 * read as ExoClick (registry sourceAliases, server/webhooks.ts PAID_SOURCES) so
 * old links and old orders keep attributing. Never written any more.
 */
export const LEGACY_ADULT_UTM_SOURCE = 'adnetwork'

/**
 * Which network an adult idea is for. Read from idea.audience.network
 * ('exoclick', 'juicyads', or the channel id 'adult:exoclick'); anything else,
 * or nothing, is ExoClick, the network with a live adapter.
 */
export function adultNetworkFor(idea: { audience?: Record<string, unknown> | null }): AdultNetwork {
  const raw = idea.audience?.['network']
  const v = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/^adult:/, '') : ''
  return (ADULT_NETWORKS as readonly string[]).includes(v) ? (v as AdultNetwork) : DEFAULT_ADULT_NETWORK
}

/** Adult placement medium: 'native' for a native ad image, 'display' for every banner. */
export function adultMediumFor(format: string | null | undefined): 'display' | 'native' {
  return format && format.startsWith('native') ? 'native' : 'display'
}

function slugPart(s: string, max: number): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max)
}

export function utmCampaignFor(idea: Pick<ExportIdea, 'id' | 'conceptSlug'>): string {
  return `ad${idea.id}-${slugPart(idea.conceptSlug, 32) || 'idea'}`
}

/** utm_content is the creative id; a text idea with no row yet falls back to `idea-<id>`. */
export function utmContentFor(args: { creativeId?: number | null; ideaId: number }): string {
  return args.creativeId ? String(args.creativeId) : `idea-${args.ideaId}`
}

export type UtmIdea = Pick<ExportIdea, 'id' | 'conceptSlug' | 'lane'> & { audience?: Record<string, unknown> | null }

export function utmParamsFor(idea: UtmIdea, creativeId: number | null, opts: { format?: string | null } = {}): Record<string, string> {
  const adult = idea.lane === 'adult'
  return {
    utm_source: adult ? adultNetworkFor(idea) : UTM_SOURCE[idea.lane] ?? idea.lane,
    utm_medium: adult ? adultMediumFor(opts.format) : UTM_MEDIUM[idea.lane] ?? 'paid',
    utm_campaign: utmCampaignFor(idea),
    utm_content: utmContentFor({ creativeId, ideaId: idea.id }),
  }
}

/**
 * ExoClick swaps this macro for its click id, which the conversion postback
 * echoes back (app/lib/exoclick-postback.server.ts). Appended raw: URL encoding
 * would break the braces and ExoClick would pass the macro through unexpanded.
 */
const EXOCLICK_CLICK_MACRO = 'exoclid={conversions_tracking}'

/** The idea's destination with the lane's four UTMs, replacing any utm_* it carried. */
export function withUtms(destination: string, idea: UtmIdea, creativeId: number | null, opts: { format?: string | null } = {}): string {
  const u = new URL(destination)
  for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k)
  for (const [k, v] of Object.entries(utmParamsFor(idea, creativeId, opts))) u.searchParams.set(k, v)
  const url = u.toString()
  return idea.lane === 'adult' && adultNetworkFor(idea) === 'exoclick' ? `${url}&${EXOCLICK_CLICK_MACRO}` : url
}

// ---------------------------------------------------------------------------
// Adult-lane landing rule (owner decision 2026-10-20): every adult banner lands
// directly on the canonical product page, https://xdipx.com/products/{slug},
// with the four UTMs. No bridge page, no collection, no homepage. One exception
// (owner decision 2026-10-29): an idea may point at a long-form sales page,
// https://curious.xdipx.com/{slug}. See docs/ads-policy.md.
// ---------------------------------------------------------------------------

export const CANONICAL_ORIGIN = 'https://xdipx.com'

const PRODUCT_PATH = /^\/products\/([a-z0-9][a-z0-9-]*)\/?$/i
const SALES_PAGE_ORIGIN = 'https://curious.xdipx.com'
const SALES_PAGE_PATH = /^\/[a-z0-9][a-z0-9-]{0,59}\/?$/i

/**
 * The page an adult banner lands on, without UTMs. A sales page has to be named
 * in `audience.salesPage`: a curious.xdipx.com destination alone is not enough,
 * because the paid-lane bridge pages live on that host too and an adult banner
 * must never land on one. Otherwise it uses the idea's destination when that is
 * an xdipx.com /products/{slug} page (so an idea can point at its second
 * product), then the first product's handle. Any other query string is dropped.
 * Null when none of those gives a page.
 */
export function adultLandingFor(
  idea: Pick<ExportIdea, 'destinationUrl' | 'products'> & { audience?: Record<string, unknown> | null },
): string | null {
  const salesPage = idea.audience?.['salesPage']
  if (typeof salesPage === 'string' && SALES_PAGE_PATH.test(`/${salesPage}`)) return `${SALES_PAGE_ORIGIN}/${salesPage.toLowerCase()}`
  if (idea.destinationUrl) {
    try {
      const u = new URL(idea.destinationUrl)
      const m = PRODUCT_PATH.exec(u.pathname)
      if (m && (u.hostname === 'xdipx.com' || u.hostname === 'www.xdipx.com')) return `${CANONICAL_ORIGIN}/products/${m[1]!.toLowerCase()}`
    } catch { /* fall through to the product handle */ }
  }
  const handle = idea.products?.[0]?.handle?.trim()
  return handle ? `${CANONICAL_ORIGIN}/products/${handle.toLowerCase()}` : null
}

/** True when a URL is a page an adult banner may land on: a canonical PDP or a sales page. */
export function isAdultLanding(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    if (u.hostname === 'curious.xdipx.com') return SALES_PAGE_PATH.test(u.pathname)
    return u.hostname === 'xdipx.com' && PRODUCT_PATH.test(u.pathname)
  } catch {
    return false
  }
}

/** Gate states that stop an export. A creative status of blocked stops it too. */
export function blockedGateReasons(gates: GatesJson | null): string[] {
  if (!gates) return []
  return GATE_ORDER.filter(n => gates[n]?.state === 'block').map(n => `${n} gate: ${gates[n].reason}`)
}

export function clip(s: string, n = 48): string {
  return s.length > n ? `${s.slice(0, n - 3)}...` : s
}

/** Safe filename part. */
export function fileSlug(s: string, max = 40): string {
  return slugPart(s, max) || 'export'
}
