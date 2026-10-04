/**
 * Client-safe shapes for the Ad Studio Creatives tab. No server imports.
 */
import type { FeedbackView } from '~/lib/ad-idea-types'
import type { GatesJson } from '~/lib/ad-render-rules'

export type ExportStateKind = 'none' | 'not-built' | 'building' | 'ready' | 'failed' | 'in-platform'

export interface ExportStateView {
  kind: ExportStateKind
  /** Stored export file (Search CSV, banner zip) for the Download action when kind is ready. Null for a Meta payload-only draft. */
  downloadUrl?: string | null
  message?: string | null
  /** The exporter this lane uses, from the registry. */
  exporter?: 'google-editor-csv' | 'meta-paused-draft' | 'banner-zip' | null
  /** Filename of the stored export. */
  filename?: string | null
  /** A Meta paused draft payload is stored and can be viewed. */
  hasPayload?: boolean
  /** What Retry re-runs when kind is failed: the render or the export build. */
  retry?: 'render' | 'export'
  /** Hearted, finished and exportable: the Build action may render. */
  canBuild?: boolean
  /** Meta ad id once the paused draft exists in the platform. */
  externalId?: string | null
  /** Ads Manager deep link for that ad. */
  externalUrl?: string | null
}

export interface CreativeListItem {
  id: number
  ideaId: number | null
  ideaTitle: string | null
  conceptSlug: string | null
  lane: string
  registerTier: string
  format: string
  width: number | null
  height: number | null
  slogan: string | null
  headlines: string[]
  status: string
  /** Null until rendered (queued, rendering, text-only). */
  assetUrl: string | null
  products: Array<{ handle: string; title?: string }>
  gates: GatesJson | null
  /** Render ledger line shown for queued, rendering, skipped and failed rows. */
  renderState: string | null
  renderNote: string | null
  export: ExportStateView
  feedback: FeedbackView | null
  createdAt: string
}

export const CREATIVE_VIEWS = ['to-rate', 'hearted', 'exported', 'all'] as const
export type CreativeView = typeof CREATIVE_VIEWS[number]
export const CREATIVE_PAGE = 12
export const CREATIVE_PAGE_MAX = 60
