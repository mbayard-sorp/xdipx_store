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
// ---------------------------------------------------------------------------

const UTM_SOURCE: Readonly<Record<string, string>> = {
  meta: 'facebook',
  google: 'google',
  microsoft: 'bing',
  snap: 'snapchat',
  adult: 'adnetwork',
  newsletter: 'newsletter',
  owned: 'owned',
}

const UTM_MEDIUM: Readonly<Record<string, string>> = {
  newsletter: 'sponsor',
  owned: 'owned',
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

export function utmParamsFor(idea: Pick<ExportIdea, 'id' | 'conceptSlug' | 'lane'>, creativeId: number | null): Record<string, string> {
  return {
    utm_source: UTM_SOURCE[idea.lane] ?? idea.lane,
    utm_medium: UTM_MEDIUM[idea.lane] ?? 'paid',
    utm_campaign: utmCampaignFor(idea),
    utm_content: utmContentFor({ creativeId, ideaId: idea.id }),
  }
}

/** The idea's destination with the lane's four UTMs, replacing any utm_* it carried. */
export function withUtms(destination: string, idea: Pick<ExportIdea, 'id' | 'conceptSlug' | 'lane'>, creativeId: number | null): string {
  const u = new URL(destination)
  for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k)
  for (const [k, v] of Object.entries(utmParamsFor(idea, creativeId))) u.searchParams.set(k, v)
  return u.toString()
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
