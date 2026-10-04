/**
 * The export registry. It replaces the three inert push stubs (ad-publish/meta,
 * tiktok, google) with one exporter per output kind, keyed by lane:
 *
 *   google, microsoft                       -> google-editor-csv
 *   meta                                    -> meta-paused-draft
 *   snap, adult, newsletter, owned          -> banner-zip
 *
 * An exporter BUILDS (a file or a payload) and a build never reaches a platform.
 * `push` exists only on the Meta exporter, is reachable only from the admin route
 * action (never the team token), and throws `spend_disabled` unless
 * ads_spend_enabled is true. TikTok has no entry: paid TikTok is prohibited for
 * this catalog (docs/ads-policy.md), and a stub that could one day be keyed on
 * was the failure mode this registry removes.
 */
import { EXPORTER_BY_LANE, exporterForLane, type ExporterId } from './types'
import { ExportRefusal, type ExportBuild, type ExportCreative, type ExportIdea } from './common'
import { assertCreativesExportable, assertSingleLane } from './policy'
import { buildSearchExport, type SearchVariant } from './google-editor-csv.server'
import { buildMetaDraft } from './meta-paused-draft.server'
import { pushMetaDraft, type MetaPushDeps, type MetaPushExisting, type MetaPushResult } from './meta-push.server'
import { buildBannerZip } from './banner-zip.server'

/** Everything a builder needs, already loaded. The service loads it from the database. */
export interface LoadedSubjects {
  lane: string
  ideas: ExportIdea[]
  creatives: ExportCreative[]
}

export interface ExportContext {
  dailyCapCents: number
  fetchBytes: (url: string) => Promise<Buffer>
  /** M5 subset membership once PR-D lands, else null (the build warns). */
  inSubset?: ((handle: string) => boolean) | null
  pageIdConfigured?: boolean
  now?: Date
}

export interface Exporter {
  id: ExporterId
  build(subjects: LoadedSubjects, ctx: ExportContext): Promise<ExportBuild>
  /** Meta only. Throws MetaPushError('spend_disabled') unless ads_spend_enabled is true. */
  push?(payload: unknown, creativeId: number, existing: MetaPushExisting, deps: MetaPushDeps): Promise<MetaPushResult>
}

const googleEditorCsv: Exporter = {
  id: 'google-editor-csv',
  async build(s, ctx) {
    if (s.lane !== 'google' && s.lane !== 'microsoft') throw new ExportRefusal('mixed_lanes', `Lane ${s.lane} is not a Search lane.`)
    if (s.creatives.length) assertCreativesExportable(s.creatives, { needAsset: false })
    const creativeIdByIdea: Record<number, number> = {}
    for (const c of s.creatives) creativeIdByIdea[c.ideaId] = c.id
    return buildSearchExport({
      lane: s.lane as SearchVariant,
      ideas: s.ideas,
      creativeIdByIdea,
      dailyCapCents: ctx.dailyCapCents,
      ...(ctx.now ? { now: ctx.now } : {}),
    })
  },
}

const metaPausedDraft: Exporter = {
  id: 'meta-paused-draft',
  async build(s, ctx) {
    if (s.ideas.length !== 1) throw new ExportRefusal('mixed_lanes', 'A Meta paused draft is built for one idea at a time (one campaign, one ad set).')
    assertCreativesExportable(s.creatives, { needAsset: true })
    return buildMetaDraft({
      idea: s.ideas[0]!,
      creatives: s.creatives,
      dailyCapCents: ctx.dailyCapCents,
      inSubset: ctx.inSubset ?? null,
      pageIdConfigured: ctx.pageIdConfigured ?? false,
      ...(ctx.now ? { now: ctx.now } : {}),
    })
  },
  push: pushMetaDraft,
}

const bannerZip: Exporter = {
  id: 'banner-zip',
  async build(s, ctx) {
    assertCreativesExportable(s.creatives, { needAsset: true })
    assertSingleLane(s.creatives)
    return buildBannerZip({
      ideas: Object.fromEntries(s.ideas.map(i => [i.id, i])),
      creatives: s.creatives,
      fetchBytes: ctx.fetchBytes,
      ...(ctx.now ? { now: ctx.now } : {}),
    })
  },
}

export const EXPORTERS: Readonly<Record<ExporterId, Exporter>> = {
  'google-editor-csv': googleEditorCsv,
  'meta-paused-draft': metaPausedDraft,
  'banner-zip': bannerZip,
}

export function getExporter(lane: string | null | undefined): Exporter | null {
  const id = exporterForLane(lane)
  return id ? EXPORTERS[id] : null
}

export { EXPORTER_BY_LANE, exporterForLane }
