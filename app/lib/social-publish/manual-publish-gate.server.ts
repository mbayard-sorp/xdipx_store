/**
 * The manual (owner-click) publish guard for /admin/socials `post-media`.
 *
 * The scheduled publish path (social-publish-job.server.ts) refuses two things
 * before it posts, and routine-social-daily.md states categorically that an
 * approved row is not a licence to publish "including one the owner approved by
 * hand". The manual Post-now button in the Social Studio used to make that
 * statement false: it checked only status=draft + review_status=approved, never
 * looked for a publish-gate stamp, and gated every surface on the VIDEO valve.
 * That is how post #49 — a hard-fence image the gate would have blocked —
 * reached Instagram (incident #3640, ticket #3674).
 *
 * This function is the single decision both concerns collapse into, kept pure
 * (the valve reader is injected) so the two refusals are unit-tested rather than
 * proven only by reading the route. It mirrors the cron's `parseGateStamp`
 * refusal and routes the valve by surface: stills on the Instagram kill switch,
 * video on the video team's valve.
 */
import { parseGateStamp } from '../social-publish-approve.server'
import { VALVE_KEYS } from '../team-keys'

export type ManualPublishDecision =
  | { ok: true }
  | { ok: false; error: string; stub?: boolean }

/** The valve that governs unattended posting for a given media kind. */
export function manualPublishValveKey(isVideo: boolean): (typeof VALVE_KEYS)[keyof typeof VALVE_KEYS] {
  return isVideo ? VALVE_KEYS.videoAutopublish : VALVE_KEYS.instagramAutopublish
}

export async function decideManualPublish(
  input: {
    feedback: string | null | undefined
    isVideo: boolean
    /**
     * Defaults to 'instagram', which is what every caller was before X grew a
     * manual path (ticket #3739). On 'x' the stamp refusal below applies
     * unchanged, and the valve read is skipped: the owner's click is the human
     * approval, and `x_autopublish_enabled` governs only the scheduled tick.
     */
    platform?: 'instagram' | 'x'
  },
  getValve: (key: (typeof VALVE_KEYS)[keyof typeof VALVE_KEYS]) => Promise<boolean>,
): Promise<ManualPublishDecision> {
  // 1. Refuse anything the pre-publish gate never looked at. `review_status`
  //    can be set by the gate (which stamps its verdict into `feedback`) or by
  //    the owner's click (which does not). No PASS stamp means nothing
  //    adversarial has read the row, so it is not publishable regardless of who
  //    approved it. Checked BEFORE any valve read so approval can never buy a
  //    publish on its own.
  const stamp = parseGateStamp(input.feedback)
  if (!stamp || stamp.verdict !== 'PASS') {
    return {
      ok: false,
      error:
        'This draft has no publish-gate PASS, so nothing independent has reviewed it. ' +
        'Owner approval alone is not a licence to publish. Run the publish gate over it ' +
        '(POST /api/team/social-post {op:"gate"}); it re-verdicts and, on a PASS, re-approves.',
    }
  }

  // X stops here (ticket #3739). The stamp requirement is the point: the
  // owner's click stays the human approval, but the stamp proves something
  // adversarial read the post (MAP framing, false claims, repetition), which
  // one reviewer at 11pm does not. No valve is required for an owner click.
  if (input.platform === 'x') return { ok: true }

  // 2. The autopublish valve that governs the SURFACE must be on. Video keeps
  //    the video team's valve; a still on Instagram is governed by the Instagram
  //    kill switch, not the video valve. The old handler gated stills on the
  //    video valve, so the Instagram switch governed nothing on this path.
  const valveOn = await getValve(manualPublishValveKey(input.isVideo))
  if (!valveOn) {
    return {
      ok: false,
      stub: true,
      error: input.isVideo
        ? 'Video autopublish valve is OFF (Homepage Team > Video tab). Copy the caption and download the media to post manually.'
        : 'Instagram autopublish valve is OFF (Homepage Team > Social tab). Copy the caption and download the media to post manually.',
    }
  }

  return { ok: true }
}
