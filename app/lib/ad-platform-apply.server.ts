/**
 * The seam between the rules engine and the ad platforms (Ad Studio v2).
 *
 * PR-H records every pause, resume, scale and brake in ad_rule_events and in
 * ad_creatives. PR-E (the export registry and the Meta connector) fills this
 * seam so the same verbs also reach the platform, only ever behind the
 * ads_spend_enabled valve. Until then the default applier is a no-op that logs,
 * so nothing here can move money.
 *
 * Callers pass `spendEnabled`. With the valve off, platformApply returns
 * without calling anything, simulation or not, so a registered applier cannot
 * be reached by accident.
 */

export type PlatformAction = 'pause' | 'resume' | 'scale' | 'brake' | 'refresh'

export interface PlatformApplyRequest {
  creativeId: number
  externalAdId: string | null
  lane: string | null
  action: PlatformAction
  /** The creative's budget multiplier after this action (scale and brake). */
  budgetMultiplier: number
  reason: string
}

export interface PlatformApplyResult {
  /** True only when a platform call really changed something. */
  applied: boolean
  note: string
  error?: boolean
}

export type PlatformApplier = (req: PlatformApplyRequest) => Promise<PlatformApplyResult>

const stub: PlatformApplier = async req => {
  console.log('[ad-platform-apply] no platform applier registered (PR-E fills this)', {
    creativeId: req.creativeId, action: req.action, lane: req.lane,
  })
  return { applied: false, note: 'Platform call not wired yet.' }
}

let applier: PlatformApplier = stub

/** PR-E registers the real applier here. Tests register fakes. */
export function setPlatformApplier(fn: PlatformApplier | null): void {
  applier = fn ?? stub
}

export async function platformApply(
  req: PlatformApplyRequest,
  opts: { spendEnabled: boolean },
): Promise<PlatformApplyResult> {
  if (!opts.spendEnabled) return { applied: false, note: 'Simulation: no platform call.' }
  try {
    return await applier(req)
  } catch (err) {
    console.error('[ad-platform-apply] applier threw', req.creativeId, req.action, err)
    return { applied: false, error: true, note: err instanceof Error ? err.message : 'Platform call failed.' }
  }
}
