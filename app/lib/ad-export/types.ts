/**
 * Ad Studio export registry: shared shapes and the lane to exporter map.
 * Client-safe (no server imports) so ExportState can read it.
 *
 * Plan section 2: nothing uploads while ads_spend_enabled is false. An exporter
 * BUILDS a file or a payload and a build is always safe. Only `push` can touch
 * a platform, only the Meta exporter has one, and it refuses with `spend_disabled`
 * unless the valve is on.
 */

export type ExporterId = 'google-editor-csv' | 'meta-paused-draft' | 'banner-zip'

/** Lane to exporter (plan section 5). Snap has no bulk importer we use: zip plus copy. */
export const EXPORTER_BY_LANE: Readonly<Record<string, ExporterId>> = {
  google: 'google-editor-csv',
  microsoft: 'google-editor-csv',
  meta: 'meta-paused-draft',
  snap: 'banner-zip',
  adult: 'banner-zip',
  newsletter: 'banner-zip',
  owned: 'banner-zip',
}

export function exporterForLane(lane: string | null | undefined): ExporterId | null {
  return lane ? EXPORTER_BY_LANE[lane] ?? null : null
}

/** Lanes whose idea carries text only, so the Ideas tab can export straight from the idea. */
export const TEXT_EXPORT_LANES: readonly string[] = ['google', 'microsoft']

export interface ExportSummary {
  /** Human lines for the toast and the README: "1 campaign, 2 ad groups, 15 headlines". */
  lines: string[]
  counts: Record<string, number>
  /** Things that did not block the build but the owner should read. */
  warnings: string[]
}

/** What is written into ad_creatives.export_payload.export once a build is stored. */
export interface StoredExportFile {
  exporter: ExporterId
  filename: string
  contentType: string
  /** Blob URL for csv and zip exports; null for a payload-only Meta draft. */
  url: string | null
  bytes: number
  summary: ExportSummary
  builtAt: string
  builtBy: string
  variant?: string
}

export const EXPORT_PUSH_ERRORS = ['spend_disabled', 'not_configured', 'not_exportable', 'already_pushed', 'api_error'] as const
export type ExportPushErrorCode = typeof EXPORT_PUSH_ERRORS[number]
