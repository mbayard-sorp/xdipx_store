/**
 * Homepage-team control plane — compatibility shim.
 *
 * The real implementation moved to app/lib/team.server.ts when the control
 * plane was generalized to all store teams (051). This module keeps the
 * original homepage-bound API so the existing /api/homepage-team/* routes,
 * admin dashboard, and scheduled routines work unchanged: every function here
 * delegates to the team module with team='homepage'.
 *
 * New code should import from '~/lib/team.server' directly.
 *
 * Server-only.
 */

import { TEAM_KEYS } from '~/lib/homepage-team-keys'
import * as team from '~/lib/team.server'

export { TEAM_KEYS }
export {
  assertTeamAuth,
  expireStaleRuns,
  updateRun,
  recordEvent,
  listRunEvents,
  type RunUpdate,
  type TeamEvent,
} from '~/lib/team.server'

/** Original homepage-shaped config (all extras present and required). */
export interface TeamConfig {
  enabled: boolean
  dailyCents: number
  buildCents: number
  maxImagesPerDay: number
  maxRunsPerDay: number
}

export async function getTeamConfig(): Promise<TeamConfig> {
  const cfg = await team.getTeamConfig('homepage')
  return {
    enabled:         cfg.enabled,
    dailyCents:      cfg.dailyCents,
    buildCents:      cfg.buildCents ?? 10000,
    maxImagesPerDay: cfg.maxImagesPerDay ?? 12,
    maxRunsPerDay:   cfg.maxRunsPerDay,
  }
}

export async function getTodaySpendCents(): Promise<number> {
  return team.getTodaySpendCents('homepage')
}

export async function getTodayRunCount(excludeRunId?: number): Promise<number> {
  return team.getTodayRunCount('homepage', excludeRunId)
}

export async function getTodayImageCount(): Promise<number> {
  return team.getTodayImageCount('homepage')
}

export async function isRunInProgress(excludeRunId?: number): Promise<boolean> {
  return team.isRunInProgress('homepage', excludeRunId)
}

/**
 * The homepage GateResult keeps its original shape; the generalized gate adds
 * `team` and `activeBriefId` on top, which existing callers simply ignore.
 */
export type GateResult = team.GateResult

export async function gate(excludeRunId?: number): Promise<GateResult> {
  return team.gate('homepage', excludeRunId)
}

export async function startRun(runType: 'merchandise' | 'design' | 'manual'): Promise<number> {
  return team.startRun('homepage', runType)
}

export async function listRecentRuns(limit = 25) {
  return team.listRecentRuns('homepage', limit)
}
