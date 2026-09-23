/**
 * POST /api/team/video-episode — the episode ledger for the serialized video
 * program (ticket #5712, all-hands 2026-08-26).
 *
 *   { op: 'episode-propose', seriesSlug, seriesTitle?, episodes: [
 *       { logline, formula, concept?, arcPosition?, opensLoopKey?,
 *         paysOffLoopKey?, callbackToEpisode?, part2Hook?, storyboardJson?,
 *         hookText?, hookPattern?, castSlugs?, productPlacements?,
 *         scriptJson?, siteCutJson?, modelTier?, plannedSlotAt?, isReserve?,
 *         gateVerdicts?, seasonNumber?,
 *         // the pitch (plan Phase 2b), all-or-nothing, stored on scriptJson.pitch:
 *         format, speaker, listener?, fact, factSource: spec|material|reviews,
 *         laugh, firstFrameConcept, estCostUsd, readAudioUrl?, productHandle,
 *         alternate? } ], createdBy? }
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
 *   { op: 'owner-edits', episodeId?, limit?, includeRoom? }
 *     -> { edits, lineNotes }
 *     Recent before/after diffs captured by editEpisodeScript (ticket
 *     #7567) when the owner saves a script edit in /admin/video-studio, plus
 *     the owner's per-line notes ({episodeId, field, lineIdx, note}) from the
 *     script reader. The room's own episode-revise rows are excluded unless
 *     includeRoom is true, so the signal stays the owner's. Read-only.
 *
 *   { op: 'episode-revise', episodeId, fields: { presenterLine?, voiceover?,
 *       shareLine?, cta?, captionIg?, captionX? }, editedBy: 'video-room',
 *       note, readAudioUrl? }
 *     -> { episodeId, changedFields, productionStatus, estCostUsd }
 *     The /video-room command's write-back: a new script version with one
 *     video_script_edits row per changed field. Only on pending_approval or
 *     needs_changes rows (409 otherwise); the row lands at pending_approval.
 *     A revision is not a decision and never approves anything.
 *
 *   { op: 'learn', limit?, batches? }
 *     -> { episodes, rollups: { speaker, format }, batches, flags }
 *     Posted clips keyed on reach (IG reach, else X impressions), plus
 *     per-batch owner edit ratio, needs_changes and approved rates, frame
 *     re-roll rate, hours to decision, and the threshold flags.
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
  listLineNotes,
  reviseEpisodeScript,
  EpisodeReviseError,
  type ProposeEpisodeInput,
} from '~/lib/video-episodes.server'
import { apiError } from '~/lib/api-error.server'
import { ROOM_EDITORS } from '~/lib/video-episodes'

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

    if (b['op'] === 'owner-edits') {
      const scope = {
        ...(typeof b['episodeId'] === 'number' ? { episodeId: b['episodeId'] } : {}),
        ...(typeof b['limit'] === 'number' ? { limit: b['limit'] } : {}),
      }
      const [result, lineNotes] = await Promise.all([
        listOwnerScriptEdits({
          ...scope,
          // The room's own revisions are not owner signal; the retro would be
          // grading itself. includeRoom:true returns the whole history.
          ...(b['includeRoom'] === true ? {} : { excludeEditedBy: [...ROOM_EDITORS] }),
        }),
        listLineNotes(scope),
      ])
      return Response.json({ ...result, lineNotes })
    }

    if (b['op'] === 'episode-revise') {
      const episodeId = typeof b['episodeId'] === 'number' ? b['episodeId'] : NaN
      if (!Number.isFinite(episodeId)) {
        return new Response('Bad Request: episodeId required', { status: 400 })
      }
      try {
        const result = await reviseEpisodeScript({
          episodeId,
          fields: (b['fields'] ?? {}) as Record<string, string>,
          editedBy: typeof b['editedBy'] === 'string' ? b['editedBy'] : 'video-room',
          note: typeof b['note'] === 'string' ? b['note'] : '',
          ...(typeof b['readAudioUrl'] === 'string' ? { readAudioUrl: b['readAudioUrl'] } : {}),
        })
        return Response.json(result)
      } catch (err) {
        if (err instanceof EpisodeReviseError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        throw err
      }
    }

    if (b['op'] === 'learn') {
      // The room's weekly reading (ticket #5718): measured episodes flattened
      // plus rollups, medians only, every group carrying its n and an
      // underpowered flag below the signal floor. The honest limits are in
      // video-learn.server.ts's module doc and bind the room too. Phase 2b:
      // keyed on reach (IG, else X impressions) by speaker and format, plus
      // per-batch owner-behaviour signals and their threshold flags.
      const { listEpisodePerformance, rollupByDimension, listBatchSignals, LEARN_DIMENSIONS } = await import('~/lib/video-learn.server')
      const [rows, process] = await Promise.all([
        listEpisodePerformance({ ...(typeof b['limit'] === 'number' ? { limit: b['limit'] } : {}) }),
        listBatchSignals({ ...(typeof b['batches'] === 'number' ? { batches: b['batches'] } : {}) }),
      ])
      return Response.json({
        episodes: rows,
        rollups: Object.fromEntries(LEARN_DIMENSIONS.map(d => [d, rollupByDimension(rows, d)])),
        batches: process.batches,
        flags: process.flags,
      })
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
