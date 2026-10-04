/**
 * Client-safe shapes for the Ad Studio Creatives tab. No server imports.
 */
import type { FeedbackView } from '~/lib/ad-idea-types'
import type { GatesJson } from '~/lib/ad-render-rules'

export type ExportStateKind = 'none' | 'not-built' | 'building' | 'ready' | 'failed'

export interface ExportStateView {
  kind: ExportStateKind
  /** Stored PNG for the Download action when kind is ready. */
  downloadUrl?: string | null
  message?: string | null
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
