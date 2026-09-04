/**
 * POST /api/team/video-episode — the episode ledger for the serialized video
 * program (ticket #5712, all-hands 2026-08-26).
 *
 *   { op: 'episode-propose', seriesSlug, seriesTitle?, episodes: [
 *       { logline, formula, concept?, arcPosition?, opensLoopKey?,
 *         paysOffLoopKey?, callbackToEpisode?, part2Hook?, storyboardJson?,
 *         hookText?, hookPattern?, castSlugs?, productPlacements?,
 *         scriptJson?, siteCutJson?, modelTier?, plannedSlotAt?, isReserve?,
 *         gateVerdicts?, seasonNumber? } ], createdBy? }
 *     -> { batchId, seriesId, episodes: [{id, episodeUid, seasonNumber,
 *          episodeNumber, logline, estCostUsd}] }
 *     Rows land at production_status 'pending_approval', numbered max+1 in a
 *     transaction, fully validated (formula, hook pattern, placement
 *     vocabulary, and a dry-run of scriptJson on its tier) so nothing
 *     unrenderable ever reaches the owner's batch. Cap 10 per call. Zero
 *     spend: proposing is free, which is the whole point.
 *
 *   { op: 'episode-list', seriesSlug?, status?, limit? }
 *     -> { series, episodes, openLoops }
 *     The ledger plus the DERIVED open-loop list (opened by an aired episode,
 *     closed by none). This is the writers room's continuity read and the
 *     script-doctor's evidence source.
 *
 *   { op: 'episode-claim', runId? }
 *     -> { episode } | 404 { error: 'empty_episode_queue' }
 *     Render lane only: the oldest approved episode at/past its planned slot,
 *     else the approved evergreen reserve. Stamps production_status
 *     'rendering' so a duplicate claim cannot double-render. Gated by
 *     video_program_enabled (ships OFF; a missing row reads OFF).
 *
 *   { op: 'episode-release', episodeId, reason }
 *     -> { released, episodeId, reason }  (409 when the row is not a
 *        releasable claim)
 *     Render lane only, the other half of episode-claim: hands a claimed
 *     episode back to 'approved' when the run refuses to render it. Without
 *     it a refusal strands the row in 'rendering' permanently.
 *
 * There is DELIBERATELY no 'episode-decide' op here. Deciding an episode is
 * the owner's money gate, agents hold this token, and agents never approve
 * spend: the decide path lives in the /admin/video-studio action behind the
 * admin session (decideEpisode in video-episodes.server.ts).
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, getValve, VALVE_KEYS } from '~/lib/team.server'
import {
  proposeEpisodes,
  listEpisodes,
  claimNextEpisode,
  releaseEpisodeClaim,
  listOwnerScriptEdits,
  type ProposeEpisodeInput,
} from '~/lib/video-episodes.server'
import { apiError } from '~/lib/api-error.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    if (b['op'] === 'episode-propose') {
      if (typeof b['seriesSlug'] !== 'string' || !b['seriesSlug'].trim()) {
        return new Response('Bad Request: seriesSlug required', { status: 400 })
      }
      if (!Array.isArray(b['episodes'])) {
        return new Response('Bad Request: episodes array required', { status: 400 })
      }
      try {
        const result = await proposeEpisodes({
          seriesSlug: b['seriesSlug'],
          ...(typeof b['seriesTitle'] === 'string' ? { seriesTitle: b['seriesTitle'] } : {}),
          episodes: b['episodes'] as ProposeEpisodeInput[],
          ...(typeof b['createdBy'] === 'string' ? { createdBy: b['createdBy'] } : {}),
        })
        return Response.json(result)
      } catch (err) {
        // Validation defects are the caller's to fix; answer 400 with the
        // message rather than a 500 (the room reads it and repairs the batch).
        if (err instanceof Error) return new Response(`Bad Request: ${err.message}`, { status: 400 })
        throw err
      }
    }

    if (b['op'] === 'episode-list') {
      const result = await listEpisodes({
        ...(typeof b['seriesSlug'] === 'string' ? { seriesSlug: b['seriesSlug'] } : {}),
        ...(typeof b['status'] === 'string' ? { status: b['status'] } : {}),
        ...(typeof b['limit'] === 'number' ? { limit: b['limit'] } : {}),
      })
      return Response.json(result)
    }

    if (b['op'] === 'learn') {
      // The room's weekly reading (ticket #5718): measured episodes flattened
      // plus rollups, medians only, every group carrying its n and an
      // underpowered flag below the signal floor. The honest limits are in
      // video-learn.server.ts's module doc and bind the room too.
      const { listEpisodePerformance, rollupByDimension } = await import('~/lib/video-learn.server')
      const rows = await listEpisodePerformance({ ...(typeof b['limit'] === 'number' ? { limit: b['limit'] } : {}) })
      const dims = ['formula', 'hookPattern', 'castSlug', 'productHandle', 'placementRole', 'arcPosition'] as const
      return Response.json({
        episodes: rows,
        rollups: Object.fromEntries(dims.map(d => [d, rollupByDimension(rows, d)])),
      })
    }

    if (b['op'] === 'owner-edits') {
      // The writers room's learning read (ticket #7557): recent owner script
      // edits, newest first, each before -> after per changed field with its
      // episode label. series-showrunner and episode-writer read this at run
      // start to learn what the owner actually rewrites. Read-only.
      const edits = await listOwnerScriptEdits({
        ...(typeof b['limit'] === 'number' ? { limit: b['limit'] } : {}),
      })
      return Response.json({ edits })
    }

    if (b['op'] === 'episode-release') {
      // The other half of episode-claim (ticket #5726). A render run that
      // claims and then refuses — closed gate, per-video ceiling, spoken-text
      // mismatch — MUST call this, or the row stays 'rendering' forever:
      // unclaimable (only 'approved' is claimable) and undecidable
      // (decideEpisode refuses anything past pending/needs_changes/approved).
      //
      // This is not an agent approving spend, which is why it may live on the
      // team-token API while episode-decide deliberately may not: it restores
      // the approval the OWNER already gave, and refuses any row that reached
      // a provider (those are markEpisodeRenderFailed's, off the job).
      const episodeId = typeof b['episodeId'] === 'number' ? b['episodeId'] : NaN
      if (!Number.isFinite(episodeId)) {
        return new Response('Bad Request: episodeId required', { status: 400 })
      }
      const reason = typeof b['reason'] === 'string' && b['reason'].trim()
        ? b['reason'].trim()
        : 'no reason given'
      const released = await releaseEpisodeClaim(episodeId, reason)
      return Response.json({ released, episodeId, reason }, { status: released ? 200 : 409 })
    }

    if (b['op'] === 'episode-claim') {
      // The render lane's arm switch. Ships OFF (missing row reads OFF); the
      // owner flips it on the Video tab of /admin/homepage-team.
      const armed = await getValve(VALVE_KEYS.videoProgram)
      if (!armed) {
        return Response.json({ error: 'video_program_disabled' }, { status: 403 })
      }
      const episode = await claimNextEpisode()
      if (!episode) return Response.json({ error: 'empty_episode_queue' }, { status: 404 })
      return Response.json({ episode })
    }

    return new Response('Bad Request', { status: 400 })
  } catch (err) {
    return apiError('team-video-episode', err, 'video-episode op failed')
  }
}
