/**
 * The manual (owner-click) publish guard for /admin/socials Post-now.
 *
 * History matters here, because this file has been both too loose and too
 * tight. It started with no guard at all: Post-now checked only status=draft +
 * review_status=approved and gated every surface on the VIDEO valve, which is
 * how post #49 — a hard-fence image the gate would have blocked — reached
 * Instagram (incident #3640, ticket #3674). The fix required a publish-gate
 * PASS stamp, so an owner click could not publish a row nothing adversarial
 * had read.
 *
 * That requirement is now lifted for the owner's click, by owner direction
 * (2026-08-23): "if I want to post it now, I want it to post now and not
 * wait". Requiring the stamp made Post-now unusable in practice, because the
 * stamp is written by the `social-publish-gate` agent on its own run and the
 * Social Studio has no way to summon one. The refusal pointed the owner at a
 * curl call that needs an agent verdict in its payload, so from the UI it was
 * a dead end: the button existed and could never fire.
 *
 * What replaces it is the distinction the old guard collapsed. The agent
 * verdict is a JUDGMENT — register, repetition, whether the imagery reads as
 * testimony — and the owner is entitled to substitute his own. The
 * deterministic checks are FACTS the caption does not show you: the product
 * went out of stock, the media is not a generated social asset, the caption is
 * over X's ceiling as X counts it, the Instagram caption carries removal-tier
 * vocabulary or a PDP link. Those still refuse. They cost one Shopify lookup
 * and no agent, so enforcing them is not waiting.
 *
 * Repetition is deliberately NOT enforced on this path: it needs
 * `recentCaptions`, the caller does not pass them, and "you said something
 * similar last week" is a judgment call, which is the half the owner is
 * overriding. The scheduled job is unchanged and still demands the stamp —
 * unattended publishing has no owner looking at it, which was always the
 * actual difference.
 *
 * No autopublish valve gates a still any more either (owner direction
 * 2026-08-23, "make Instagram match X"). `instagram_autopublish_enabled` reads
 * as what its name says: it governs UNATTENDED posting, which is the hourly
 * cron, and an owner clicking a button in the Studio is the opposite of
 * unattended. X had already codified exactly that distinction; Instagram was
 * inconsistent with it, so an owner click on a still refused with "the valve is
 * OFF, post it by hand" while the identical click on X published. The cron
 * still reads the valve on every tick, so the kill switch keeps doing the only
 * job a kill switch has.
 *
 * Video is the one exception, and it is not an oversight. `video_autopublish_
 * enabled` is not a posting-cadence valve like the other two: it is the release
 * of the owner's frame review, which CLAUDE.md keeps on his desk alongside the
 * money valves. An Instagram video therefore still reads it.
 *
 * Kept pure (both the valve reader and the check runner are injected) so the
 * refusals are unit-tested rather than proven only by reading the route.
 */
import { runDeterministicPublishChecks, type GateFinding } from '../social-publish-gate.server'
import { isGatePlatform } from '../social-publish-approve.server'
import { VALVE_KEYS } from '../team-keys'

export type ManualPublishDecision =
  | { ok: true; findings: GateFinding[] }
  | { ok: false; error: string; stub?: boolean; findings?: GateFinding[] }

/** The valve that governs unattended posting for a given media kind. */
export function manualPublishValveKey(isVideo: boolean): (typeof VALVE_KEYS)[keyof typeof VALVE_KEYS] {
  return isVideo ? VALVE_KEYS.videoAutopublish : VALVE_KEYS.instagramAutopublish
}

export interface ManualPublishInput {
  isVideo: boolean
  /**
   * The row's platform, verbatim. Defaults to 'instagram', which is what every
   * caller was before X grew a manual path (ticket #3739). On 'x' the valve
   * read is skipped: the owner's click is the human approval, and
   * `x_autopublish_enabled` governs only the scheduled tick. A platform the
   * gate does not cover (LinkedIn, Facebook, TikTok) skips the checks — see
   * below.
   */
  platform?: string
  caption: string
  mediaUrls: readonly string[] | null | undefined
  /**
   * The featured product, when the caller can determine one. Absent is not a
   * finding: education posts legitimately have none, and the route runs its own
   * durable stock guard off `shopify_product_id` besides.
   */
  productHandle?: string | null
}

export async function decideManualPublish(
  input: ManualPublishInput,
  getValve: (key: (typeof VALVE_KEYS)[keyof typeof VALVE_KEYS]) => Promise<boolean>,
  deps?: { runChecks?: typeof runDeterministicPublishChecks },
): Promise<ManualPublishDecision> {
  // 1. The deterministic checks, first and before any valve read, so no valve
  //    state can buy a publish past a hard fact. `held` findings pass: a hold
  //    means "the owner should look at this", and the owner is the one
  //    clicking.
  const runChecks = deps?.runChecks ?? runDeterministicPublishChecks
  const platform = input.platform ?? 'instagram'
  // The deterministic checks encode Instagram and X policy specifically —
  // Instagram's removal-tier lexicon, X's weighted length ceiling. Running them
  // against a LinkedIn row judged it as Instagram and produced a refusal that
  // named the wrong platform's rule. The other platforms have no publisher at
  // all, so the registry refuses them a step later with an honest message;
  // this mirrors the approve path, which 409s a non-gate platform outright.
  if (!isGatePlatform(platform)) return { ok: true, findings: [] }
  const checks = await runChecks({
    caption: input.caption,
    mediaUrls: input.mediaUrls,
    platform,
    productHandle: input.productHandle ?? null,
    // Deliberately no recentCaptions: see the repetition note above.
  })
  if (checks.blocked) {
    const blocking = checks.findings.filter(f => f.severity === 'block')
    return {
      ok: false,
      findings: checks.findings,
      error:
        (blocking.length === 1
          ? 'Publish refused on a check that does not depend on anyone\'s judgment: '
          : 'Publish refused on checks that do not depend on anyone\'s judgment: ') +
        blocking.map(f => f.detail).join(' '),
    }
  }

  // 2. X stops here, as it always has: the owner's click is the approval.
  if (platform === 'x') return { ok: true, findings: checks.findings }

  // 3. So does an Instagram still, now. See the valve note above.
  if (!input.isVideo) return { ok: true, findings: checks.findings }

  // 4. Video alone still reads its valve, because that valve is the owner's
  //    frame review rather than a posting-cadence switch. The pre-#3674 handler
  //    gated STILLS on this valve too, so the Instagram switch governed nothing
  //    on this path; that bug is not what is being restored here.
  const valveOn = await getValve(manualPublishValveKey(true))
  if (!valveOn) {
    return {
      ok: false,
      stub: true,
      error:
        'Video autopublish valve is OFF (Homepage Team > Video tab). That valve is your frame ' +
        'review, not a posting switch. Approve the frames or flip it, or download the video to post by hand.',
    }
  }

  return { ok: true, findings: checks.findings }
}
