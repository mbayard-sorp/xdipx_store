/**
 * Server-side release engine (OS-3.2).
 *
 * WHAT IT IS. A Vercel cron that squash-merges agent PRs the owner would
 * otherwise merge by hand, waits for the production deploy, smoke-tests the
 * live site, and reverts itself when the smoke fails. It lives on Vercel rather
 * than in a cloud routine because cloud egress cannot reach api.github.com or
 * api.vercel.com, and the tokens for both live in Vercel's environment.
 *
 * THE SAFETY MODEL, in the order it actually executes:
 *
 *  1. Kill switch. `release_engine_enabled` is read before any API call. Off
 *     means the process returns having done literally nothing, which restores
 *     exactly the owner-merges-everything world with no other behaviour change.
 *  2. Protected paths. The classification input is the GitHub changed-file list
 *     and nothing else. Ticket bodies, PR titles, and PR descriptions are
 *     untrusted text: they can name a ticket id (which only ever ADDS a
 *     requirement) and are otherwise never consulted. A protected PR is
 *     labelled, emailed once, and skipped forever. See PROTECTED_GLOBS in
 *     github.server.ts, which protects this file and .github/** too, so no
 *     agent PR can widen the gate it is passing through.
 *  3. CI. `check` must not be failing, ever, for any PR, including reverts.
 *  4. Ticket. A code PR needs a QA-`verified` ticket. Docs-only agent-editor
 *     PRs need only the allowlist check, which is the carve-out the drift audit
 *     recommended. Revert PRs skip the ticket requirement and nothing else.
 *  5. Serialisation. One KV lock, at most one merge per cycle, and a merge in
 *     flight blocks the next one until its deploy and smoke resolve.
 *  6. Money valves are never written. The only pipeline_settings write in this
 *     file is the circuit breaker turning ITSELF off.
 *
 * WHY IT IS RESUMABLE. The Vercel function cap is 300s (vercel.json
 * maxDuration) but the deploy-and-smoke window is up to 15 minutes, so a single
 * invocation cannot see a merge through. The post-merge state lives in KV
 * (`release-engine:pending`) and each 10-minute cycle resumes it, polling
 * within a small in-invocation budget. A cycle with a pending merge never
 * starts a second one.
 *
 * The decision logic below is deliberately split into pure functions
 * (evaluatePullRequest, attempt accounting, the circuit breaker, cap parsing)
 * so release-engine.test.ts can hammer it without a network or a database.
 */

import { and, desc, eq, sql } from 'drizzle-orm'

import { db } from '~/lib/db.server'
import { homepageTeamSuggestions, suggestionLinks } from '../../db/schema'
import {
  addLabels,
  classifyChangedFiles,
  createRevertBranch,
  getChecksForRef,
  getPullRequest,
  githubRequest,
  isGithubConfigured,
  listOpenPullRequests,
  listPullRequestFiles,
  normalizeChangedPath,
  openPullRequest,
  squashMergePullRequest,
  type ProtectedClassification,
  type PullRequestSummary,
} from '~/lib/github.server'
import { checkPageOnce, renderTruth } from '~/lib/homepage-healthcheck.server'
import { checkUrl, runCheckoutProbe } from '~/lib/checkout-probe.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { KV_KEYS, kvDel, kvGet, kvIncr, kvSet, kvSetNX } from '~/lib/kv.server'
import { escapeHtml, sendOwnerEmail } from '~/lib/owner-alerts.server'
import { getTicket, transitionSuggestion, type TicketStatus } from '~/lib/team.server'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG = '[release-engine]'

/**
 * Head-branch prefixes the engine will even look at.
 *
 * `agents/` and `ticket/` are deliberately separate namespaces, because the
 * `agent-allowlist` workflow fires on `agents/**` and hard-fails anything
 * outside agent-editor's docs allowlist. Code fixes from R-DEV live on
 * `ticket/<id>` so they are gated by CI plus a QA-verified ticket instead of by
 * a docs allowlist that was never written for them. See `requiresAllowlistCheck`.
 */
export const AGENT_BRANCH_PREFIXES: readonly string[] = ['agents/', 'ticket/', 'claude/', 'phase1/', 'tonight/']

/** Revert branches the engine opens for itself. */
export const REVERT_BRANCH_PREFIX = 'revert/pr-'

/** The required CI check, from .github/workflows/ci.yml (job id `check`). */
export const REQUIRED_CHECK = 'check'

/**
 * The allowlist check, from .github/workflows/agent-allowlist.yml. GitHub names
 * a check run after the JOB, so the reported name is `allowlist`; the workflow
 * is named `agent-allowlist`. Both spellings are accepted so a future rename of
 * either does not silently turn the gate into "no check reported, proceed".
 */
export const ALLOWLIST_CHECK_NAMES: readonly string[] = ['allowlist', 'agent-allowlist']

/** Applied to a PR the owner must merge by hand. */
export const NEEDS_OWNER_LABEL = 'needs-owner'

/**
 * The agent-editor allowlist, verbatim from agent-allowlist.yml. `[^/]+` so a
 * single `*` never crosses a directory boundary, matching the workflow exactly.
 * If these two ever disagree the workflow wins, because the workflow is the
 * thing that can actually fail a PR.
 */
export const AGENT_EDITOR_ALLOWLIST_RE =
  /^(\.claude\/agents\/[^/]+\.md|docs\/store-team\/[^/]+\.md|docs\/homepage-team\/[^/]+\.md)$/

/** Conclusions that mean a check reported and did not pass. */
const FAILING_CONCLUSIONS = new Set([
  'failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale',
])

/** Attempts a ticket gets before it is blocked and escalated. */
export const MAX_TICKET_ATTEMPTS = 3

/** Rollbacks in one UTC day that flip the kill switch off. */
export const ROLLBACK_CIRCUIT_LIMIT = 2

export const DEFAULT_MAX_MERGES_PER_DAY = 6

/** How long a merged PR may take to deploy and pass smoke before it is a failure. */
export const DEPLOY_TIMEOUT_MS = 15 * 60_000

/** In-invocation polling budget. Well inside the 300s function cap, leaving
 *  room for the smoke run that follows a READY deployment. */
const POLL_BUDGET_MS = 60_000
const POLL_INTERVAL_MS = 6_000

/** Lock TTL. Matches the function cap so a hard-killed invocation self-heals
 *  within one cycle instead of wedging the engine. */
const LOCK_TTL_SEC = 300

const KEYS = {
  lock: 'release-engine:lock',
  pending: 'release-engine:pending',
  selfCheck: 'release-engine:self-check-ok',
  merges: (day: string) => `release-engine:merges:${day}`,
  rollbacks: (day: string) => `release-engine:rollbacks:${day}`,
  escalated: (pr: number) => `release-engine:escalated:pr-${pr}`,
  /** Consecutive failed merge attempts for one PR. Cleared on success. */
  mergeFail: (pr: number) => `release-engine:merge-fail:pr-${pr}`,
  /** Once-a-day dedupe for the config-error email. */
  selfCheckAlert: (day: string) => `release-engine:self-check-alert:${day}`,
  /** Marks the cycle that last ran the out-of-band reconciliation sweep. */
  sweepHour: 'release-engine:sweep-hour',
  /** Marks the cycle that last swept tickets that burned every fix attempt. */
  exhaustedHour: 'release-engine:exhausted-sweep-hour',
} as const

/**
 * A PR whose merge keeps failing is escalated rather than retried forever.
 * Without this the engine re-attempted the same merge every ten minutes
 * indefinitely, since a merge failure wrote no state at all.
 */
const MAX_MERGE_ATTEMPTS = 3

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Pure decision layer
// ---------------------------------------------------------------------------

export interface TicketFacts {
  id: number
  status: TicketStatus
  kind: string
  attemptCount: number
}

/**
 * Everything the decision needs, all of it sourced from the GitHub API or the
 * database. Nothing here is free text an agent authored, except `ticket`, which
 * was resolved through the guarded link table or a title reference and can only
 * ever impose a requirement.
 */
export interface PullRequestFacts {
  number: number
  headRef: string
  draft: boolean
  mergeable: boolean | null
  mergeableState: string
  labels: readonly string[]
  /** Sole input to the protected decision. */
  classification: ProtectedClassification
  /** Normalized changed paths, for the docs-only test. */
  changedPaths: readonly string[]
  /** check name -> conclusion. `null` = reported but still running. A name that
   *  is absent from this map never reported at all. */
  checks: Readonly<Record<string, string | null>>
  ticket: TicketFacts | null
}

export type ReleaseAction = 'merge' | 'wait' | 'skip' | 'bounce' | 'escalate-protected'

export type ReleaseReasonCode =
  | 'protected'
  | 'needs-owner-label'
  | 'draft'
  | 'conflict'
  | 'ci-red'
  | 'ci-pending'
  | 'allowlist-red'
  | 'allowlist-pending'
  | 'no-ticket'
  | 'ticket-not-verified'
  | 'not-mergeable'
  | 'mergeability-unknown'
  | 'ready'

export interface ReleaseDecision {
  prNumber: number
  headRef: string
  action: ReleaseAction
  code: ReleaseReasonCode
  reason: string
  ticketId: number | null
  /** Present only when `code === 'protected'`. */
  protectedFiles?: string[]
  protectedGlobs?: string[]
  /** Present on bounce: what gets written to the ticket's last_error. */
  lastError?: string
  /** True for a revert PR the engine opened for itself. */
  isRevert: boolean
  /** True when every changed path is on the agent-editor docs allowlist. */
  docsOnly: boolean
}

export function isAgentBranch(headRef: string): boolean {
  return AGENT_BRANCH_PREFIXES.some((p) => headRef.startsWith(p))
}

export function isRevertBranch(headRef: string): boolean {
  return headRef.startsWith(REVERT_BRANCH_PREFIX)
}

/** Branches this engine is willing to consider at all. */
export function isEligibleBranch(headRef: string): boolean {
  return isAgentBranch(headRef) || isRevertBranch(headRef)
}

/**
 * Only `agents/*` runs the allowlist workflow, so only `agents/*` is gated on it.
 *
 * This must stay in lockstep with `on.pull_request` + the `startsWith(github.
 * head_ref, 'agents/')` job condition in agent-allowlist.yml. Widening it to a
 * namespace the workflow does not run on would park those PRs forever on
 * `allowlist-pending`; narrowing it below what the workflow covers would let a
 * red allowlist merge. `ticket/*` is outside both, by design.
 */
export function requiresAllowlistCheck(headRef: string): boolean {
  return headRef.startsWith('agents/')
}

/** Every changed path is on the agent-editor docs allowlist. Empty = false: an
 *  empty diff is not a docs change, and must not unlock the docs carve-out. */
export function isDocsOnly(paths: readonly string[]): boolean {
  if (paths.length === 0) return false
  return paths.every((p) => AGENT_EDITOR_ALLOWLIST_RE.test(normalizeChangedPath(p)))
}

type CheckState = 'success' | 'failing' | 'pending' | 'absent'

export function checkState(checks: Readonly<Record<string, string | null>>, names: readonly string[]): CheckState {
  let seen: CheckState = 'absent'
  for (const name of names) {
    if (!(name in checks)) continue
    const conclusion = checks[name]
    if (conclusion === null || conclusion === undefined) {
      // Pending beats absent but loses to a definite verdict from a sibling name.
      if (seen === 'absent') seen = 'pending'
      continue
    }
    if (FAILING_CONCLUSIONS.has(conclusion)) return 'failing'
    if (conclusion === 'success') seen = 'success'
    else if (seen === 'absent' || seen === 'pending') seen = 'pending'
  }
  return seen
}

/**
 * Extract a ticket id from a PR title (`agents: ticket #41: ...`).
 *
 * This is untrusted text. It is safe only because naming a ticket can never
 * REMOVE a gate: an unresolvable or absent reference leaves a non-docs PR with
 * no verified ticket, which is a skip. The caller additionally refuses a title
 * reference when the ticket already links a different PR, so a title cannot
 * borrow another ticket's verdict.
 */
export function parseTicketRefFromTitle(title: string): number | null {
  const m = /#(\d{1,9})\b/.exec(title)
  if (!m || !m[1]) return null
  const id = Number(m[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Pull number out of a PR URL or a `#123` ref, for matching link rows. */
export function prNumberFromRef(ref: string): number | null {
  const m = /(?:\/pull\/|#)(\d{1,9})\b/.exec(ref)
  if (!m || !m[1]) return null
  const n = Number(m[1])
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * The gate. Pure: no network, no clock, no database, no environment.
 *
 * Order matters and is asserted in the tests. Protected is first so a protected
 * PR escalates even when it is a draft, has red CI, or is a revert. CI is
 * evaluated before the ticket so a red build is reported as a build failure
 * rather than as a missing verdict.
 */
export function evaluatePullRequest(facts: PullRequestFacts): ReleaseDecision {
  const revert = isRevertBranch(facts.headRef)
  const docsOnly = isDocsOnly(facts.changedPaths)
  const base = {
    prNumber: facts.number,
    headRef: facts.headRef,
    ticketId: facts.ticket?.id ?? null,
    isRevert: revert,
    docsOnly,
  }

  // 1. Protected paths. Nothing overrides this and nothing precedes it.
  if (facts.classification.protected) {
    return {
      ...base,
      action: 'escalate-protected',
      code: 'protected',
      reason:
        `touches ${facts.classification.files.length} protected path(s): `
        + facts.classification.files.slice(0, 6).join(', '),
      protectedFiles: facts.classification.files,
      protectedGlobs: facts.classification.globs,
    }
  }

  // 2. The owner has already claimed this one by hand.
  if (facts.labels.includes(NEEDS_OWNER_LABEL)) {
    return { ...base, action: 'skip', code: 'needs-owner-label', reason: `labelled ${NEEDS_OWNER_LABEL}` }
  }

  if (facts.draft) {
    return { ...base, action: 'skip', code: 'draft', reason: 'draft PR' }
  }

  if (facts.mergeableState === 'dirty') {
    return { ...base, action: 'skip', code: 'conflict', reason: 'merge conflict with the base branch' }
  }

  // 3. CI. A red `check` blocks every PR without exception, revert PRs included.
  const ci = checkState(facts.checks, [REQUIRED_CHECK])
  if (ci === 'failing') {
    const lastError = `CI check "${REQUIRED_CHECK}" failed on PR #${facts.number} (${facts.headRef})`
    // A bounce is only legal from `verified`; from anywhere else the red build
    // belongs to QA or to the author, and writing to the ticket would be a 409.
    if (facts.ticket?.status === 'verified') {
      return { ...base, action: 'bounce', code: 'ci-red', reason: lastError, lastError }
    }
    return { ...base, action: 'skip', code: 'ci-red', reason: lastError }
  }

  const allowlistRequired = requiresAllowlistCheck(facts.headRef)
  const allowlist = allowlistRequired ? checkState(facts.checks, ALLOWLIST_CHECK_NAMES) : 'success'
  if (allowlist === 'failing') {
    const lastError = `agent-allowlist failed on PR #${facts.number}: a changed file is outside the docs allowlist`
    if (facts.ticket?.status === 'verified') {
      return { ...base, action: 'bounce', code: 'allowlist-red', reason: lastError, lastError }
    }
    return { ...base, action: 'skip', code: 'allowlist-red', reason: lastError }
  }
  if (allowlist === 'pending' || allowlist === 'absent') {
    return {
      ...base,
      action: 'wait',
      code: 'allowlist-pending',
      reason: `agent-allowlist has not reported success yet (${allowlist})`,
    }
  }

  // The docs carve-out: a docs-only agent PR merges on the allowlist alone, so
  // a slow or absent `check` does not park a one-line playbook edit for a day.
  // It still cannot merge over a RED `check`; that was handled above.
  const docsCarveOut = docsOnly && allowlistRequired
  if (ci !== 'success' && !docsCarveOut) {
    return {
      ...base,
      action: 'wait',
      code: 'ci-pending',
      reason: `required check "${REQUIRED_CHECK}" has not reported success yet (${ci})`,
    }
  }

  // 4. Ticket linkage.
  if (!revert && !docsCarveOut) {
    if (!facts.ticket) {
      return { ...base, action: 'skip', code: 'no-ticket', reason: 'no linked ticket to authorise the merge' }
    }
    if (facts.ticket.status !== 'verified') {
      return {
        ...base,
        action: 'skip',
        code: 'ticket-not-verified',
        reason: `ticket #${facts.ticket.id} is '${facts.ticket.status}', not 'verified'`,
      }
    }
  }

  // 5. GitHub's own mergeability verdict, last so the reasons above are the
  //    ones a human reads first.
  if (facts.mergeable === false) {
    return {
      ...base,
      action: 'skip',
      code: 'not-mergeable',
      reason: `GitHub reports the PR is not mergeable (state '${facts.mergeableState}')`,
    }
  }
  if (facts.mergeable === null) {
    return {
      ...base,
      action: 'wait',
      code: 'mergeability-unknown',
      reason: 'GitHub is still computing mergeability',
    }
  }

  return {
    ...base,
    action: 'merge',
    code: 'ready',
    reason: revert
      ? 'revert PR with green CI'
      : docsCarveOut
        ? 'docs-only agent PR with a green allowlist check'
        : `ticket #${facts.ticket?.id} verified and CI green`,
  }
}

/** A ticket is blocked and escalated once it has burned this many attempts. */
export function shouldBlockForAttempts(attemptCountAfterBounce: number): boolean {
  return attemptCountAfterBounce >= MAX_TICKET_ATTEMPTS
}

/** Two rollbacks in one UTC day flips the kill switch off. */
export function shouldTripCircuit(rollbacksToday: number): boolean {
  return rollbacksToday >= ROLLBACK_CIRCUIT_LIMIT
}

/** Non-positive or unparseable settings collapse to the default rather than to
 *  "unlimited": a typo in the admin field must not remove the cap. */
export function parseDailyCap(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_MAX_MERGES_PER_DAY
  const trimmed = String(raw).trim()
  // Number('') is 0, and an unset admin field must not read as "merge nothing".
  if (trimmed === '') return DEFAULT_MAX_MERGES_PER_DAY
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return DEFAULT_MAX_MERGES_PER_DAY
  const floored = Math.floor(n)
  // 0 is a legitimate "merge nothing today" setting; negatives are not.
  if (floored < 0) return DEFAULT_MAX_MERGES_PER_DAY
  return Math.min(floored, 100)
}

export function dailyCapReached(mergesToday: number, cap: number): boolean {
  return mergesToday >= cap
}

// ---------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------

export interface SmokeCheck {
  name: string
  ok: boolean
  detail?: string
}

export interface SmokeResult {
  ok: boolean
  checks: SmokeCheck[]
  /** One-line summary written into the ticket's last_error on failure. */
  evidence: string
}

export function summarizeSmoke(checks: readonly SmokeCheck[]): SmokeResult {
  const failed = checks.filter((c) => !c.ok)
  return {
    ok: failed.length === 0,
    checks: [...checks],
    evidence:
      failed.length === 0
        ? `smoke passed: ${checks.map((c) => c.name).join(', ')}`
        : `smoke failed: ${failed.map((c) => `${c.name} (${c.detail ?? 'no detail'})`).join('; ')}`,
  }
}

/**
 * Post-deploy smoke against production. Every step is a hard gate: a failure
 * here is what triggers the re-promote and the revert PR, so a step that cannot
 * make a judgement (renderTruth on a non-b variant, no resolvable PDP handle)
 * reports ok with a detail rather than failing the release.
 */
export async function runReleaseSmoke(): Promise<SmokeResult> {
  const checks: SmokeCheck[] = []

  const home = await checkPageOnce('/', 1, { captureHtml: true })
  checks.push({
    name: 'home',
    ok: home.ok,
    ...(home.ok ? {} : { detail: `HTTP ${home.status}: ${home.problems.join(', ')}` }),
  })

  const discover = await checkPageOnce('/discover', 1)
  checks.push({
    name: 'discover',
    ok: discover.ok,
    ...(discover.ok ? {} : { detail: `HTTP ${discover.status}: ${discover.problems.join(', ')}` }),
  })

  // fileTickets:false — the engine reports into its own PR flow. Filing a
  // render ticket from here would double-report the same failure.
  const truth = await renderTruth({ html: home.html, fileTickets: false })
  checks.push({
    name: 'render-truth',
    ok: truth.ok,
    ...(truth.ok
      ? truth.skipped
        ? { detail: `skipped: ${truth.skipped}` }
        : {}
      : { detail: `missing: ${truth.missing.slice(0, 4).join(' | ')}${truth.fallbacks.length > 0 ? ` (fallbacks: ${truth.fallbacks.join(', ')})` : ''}` }),
  })

  const handle = await resolveSmokeHandle(truth.slate?.heroHandle ?? null)
  if (handle) {
    const pdp = await checkUrl(`${siteOrigin()}/products/${handle}`, { markers: ['name="variantId"'] })
    checks.push({
      name: `pdp:${handle}`,
      ok: pdp.ok,
      ...(pdp.ok ? {} : { detail: pdp.detail ?? `HTTP ${pdp.status}` }),
    })
  } else {
    checks.push({ name: 'pdp', ok: true, detail: 'no product handle resolvable, PDP step skipped' })
  }

  const probe = await runCheckoutProbe()
  checks.push({
    name: 'checkout-probe',
    ok: probe.ok,
    ...(probe.ok ? {} : { detail: `failed at step "${probe.failedStep}"` }),
  })

  return summarizeSmoke(checks)
}

function siteOrigin(): string {
  const base = process.env['BASE_URL'] || (process.env['VERCEL_URL'] ? `https://${process.env['VERCEL_URL']}` : '')
  return base.replace(/\/+$/, '') || 'https://xdipx.com'
}

async function resolveSmokeHandle(heroHandle: string | null): Promise<string | null> {
  const explicit = process.env['PROBE_PRODUCT_HANDLE']
  if (explicit) return explicit
  if (heroHandle) return heroHandle
  try {
    return await kvGet<string>(KV_KEYS.liveDealHandle)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Vercel deployment API
// ---------------------------------------------------------------------------

export interface VercelDeployment {
  uid: string
  readyState: string
  url: string
  sha: string | null
  createdAt: number
}

function vercelConfig(): { token: string; projectId: string; teamQs: string } | null {
  const token = process.env['VERCEL_TOKEN']
  const projectId = process.env['VERCEL_PROJECT_ID']
  if (!token || !projectId) return null
  const teamId = process.env['VERCEL_TEAM_ID']
  return { token, projectId, teamQs: teamId ? `&teamId=${encodeURIComponent(teamId)}` : '' }
}

async function vercelFetch<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const cfg = vercelConfig()
  if (!cfg) return { ok: false, status: 0, data: null, error: 'VERCEL_TOKEN/VERCEL_PROJECT_ID not set' }
  try {
    const res = await fetch(`https://api.vercel.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, status: res.status, data: null, error: `${res.status}: ${text.slice(0, 300)}` }
    return { ok: true, status: res.status, data: (text ? JSON.parse(text) : {}) as T }
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : String(err) }
  }
}

interface RawDeployment {
  uid?: string
  id?: string
  readyState?: string
  state?: string
  url?: string
  created?: number
  createdAt?: number
  meta?: { githubCommitSha?: string }
}

function toDeployment(d: RawDeployment): VercelDeployment {
  return {
    uid: d.uid ?? d.id ?? '',
    readyState: d.readyState ?? d.state ?? 'UNKNOWN',
    url: d.url ?? '',
    sha: d.meta?.githubCommitSha ?? null,
    createdAt: d.created ?? d.createdAt ?? 0,
  }
}

/** Recent production deployments, newest first. */
export async function listProductionDeployments(limit = 20): Promise<VercelDeployment[]> {
  const cfg = vercelConfig()
  if (!cfg) return []
  const res = await vercelFetch<{ deployments?: RawDeployment[] }>(
    `/v6/deployments?projectId=${encodeURIComponent(cfg.projectId)}&target=production&limit=${limit}${cfg.teamQs}`,
  )
  if (!res.ok || !res.data) {
    console.warn(`${LOG} vercel deployments fetch failed: ${res.error}`)
    return []
  }
  return (res.data.deployments ?? []).map(toDeployment)
}

export async function findDeploymentBySha(sha: string): Promise<VercelDeployment | null> {
  const list = await listProductionDeployments(20)
  return list.find((d) => d.sha && d.sha.toLowerCase() === sha.toLowerCase()) ?? null
}

/**
 * The last READY production deployment that is NOT the bad one. This is the
 * instant-mitigation target: re-promoting it puts the previous good build back
 * in front of shoppers within seconds, well before the revert PR merges.
 */
export async function findPreviousReadyDeployment(badSha: string): Promise<VercelDeployment | null> {
  const list = await listProductionDeployments(20)
  return (
    list.find(
      (d) => d.readyState === 'READY' && (!d.sha || d.sha.toLowerCase() !== badSha.toLowerCase()),
    ) ?? null
  )
}

/**
 * Promote a previous deployment back to production. Vercel has moved this
 * endpoint more than once, so the current promote path is tried first and the
 * older rollback path is the fallback; both are logged.
 */
export async function promoteDeployment(deploymentId: string): Promise<{ ok: boolean; via: string; error?: string }> {
  const cfg = vercelConfig()
  if (!cfg) return { ok: false, via: 'none', error: 'VERCEL_TOKEN/VERCEL_PROJECT_ID not set' }

  const promote = await vercelFetch(
    `/v10/projects/${encodeURIComponent(cfg.projectId)}/promote/${encodeURIComponent(deploymentId)}?${cfg.teamQs.replace(/^&/, '')}`,
    { method: 'POST' },
  )
  if (promote.ok) return { ok: true, via: 'v10-promote' }

  const rollback = await vercelFetch(
    `/v9/projects/${encodeURIComponent(cfg.projectId)}/rollback/${encodeURIComponent(deploymentId)}?${cfg.teamQs.replace(/^&/, '')}`,
    { method: 'POST' },
  )
  if (rollback.ok) return { ok: true, via: 'v9-rollback' }

  return { ok: false, via: 'none', error: `promote: ${promote.error}; rollback: ${rollback.error}` }
}

// ---------------------------------------------------------------------------
// Startup self-check
// ---------------------------------------------------------------------------

export interface SelfCheckResult {
  ok: boolean
  problems: string[]
}

/**
 * Confirm the engine can actually do its job before it half-does it: the
 * GitHub token reads checks, the repo allows squash merges, and the Vercel
 * credentials exist for the deploy poll. A failure logs one clear config error
 * and the cycle returns without touching a PR. A pass is cached for an hour so
 * this costs three API calls a day, not three every ten minutes.
 */
export async function runSelfCheck(opts: { force?: boolean } = {}): Promise<SelfCheckResult> {
  if (!opts.force) {
    const cached = await kvGet<{ ok: true; at: number }>(KEYS.selfCheck)
    if (cached?.ok) return { ok: true, problems: [] }
  }

  const problems: string[] = []

  if (!isGithubConfigured()) {
    problems.push('GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO are not all set')
    return { ok: false, problems }
  }
  if (!vercelConfig()) {
    problems.push('VERCEL_TOKEN / VERCEL_PROJECT_ID are not set, so the deploy poll cannot run')
  }

  const repo = await githubRequest<{ allow_squash_merge?: boolean; default_branch?: string; permissions?: { push?: boolean } }>(
    '/repos/{owner}/{repo}',
    { context: 'release-engine' },
  )
  if (!repo.ok) {
    problems.push(`cannot read the repository: ${repo.error}`)
  } else {
    if (repo.data.allow_squash_merge === false) {
      problems.push('squash merging is disabled on the repository, so the engine cannot merge at all')
    }
    if (repo.data.permissions && repo.data.permissions.push === false) {
      problems.push('the token has no push permission, so it cannot merge')
    }
  }

  const branch = repo.ok ? (repo.data.default_branch ?? 'main') : 'main'
  const ref = await githubRequest<{ object: { sha: string } }>(`/repos/{owner}/{repo}/git/ref/heads/${branch}`, {
    context: 'release-engine',
  })
  if (!ref.ok) {
    problems.push(`cannot read refs/heads/${branch}: ${ref.error}`)
  } else {
    const checks = await getChecksForRef(ref.data.object.sha, 'release-engine')
    if (!checks.ok) problems.push(`the token cannot read check runs: ${checks.error}`)
  }

  if (problems.length === 0) {
    await kvSet(KEYS.selfCheck, { ok: true, at: Date.now() }, 3600)
    return { ok: true, problems: [] }
  }
  console.error(`${LOG} CONFIG ERROR, refusing to run:\n  - ${problems.join('\n  - ')}`)
  return { ok: false, problems }
}

// ---------------------------------------------------------------------------
// Ticket resolution
// ---------------------------------------------------------------------------

/**
 * Find the ticket a PR implements.
 *
 * Preferred path: a `suggestion_links` row of kind `pr` whose ref names this PR.
 * That row was written through the guarded transition API by the agent that
 * opened the PR, so it is the authoritative link.
 *
 * Fallback: a `#<id>` in the PR title, for when that write failed. Because the
 * title is untrusted, the fallback is refused when the ticket already links a
 * DIFFERENT PR: a title must not be able to borrow another ticket's QA verdict.
 */
export async function resolveTicketForPr(pr: PullRequestSummary): Promise<TicketFacts | null> {
  // Match this PR's links directly. This used to pull the most recent 500 pr
  // links and scan them in memory, which quietly stops finding older tickets
  // once the table passes that mark.
  const direct = await db
    .select({ suggestionId: suggestionLinks.suggestionId, ref: suggestionLinks.ref })
    .from(suggestionLinks)
    .where(and(
      eq(suggestionLinks.kind, 'pr'),
      sql`${suggestionLinks.ref} LIKE ${'%/pull/' + pr.number} OR ${suggestionLinks.ref} = ${'#' + pr.number}`,
    ))
    .orderBy(desc(suggestionLinks.createdAt))
    .limit(20)

  const match = direct.find((l) => prNumberFromRef(l.ref) === pr.number)
  if (match) return loadTicketFacts(match.suggestionId)

  const titleId = parseTicketRefFromTitle(pr.title)
  if (titleId === null) return null

  // The title claims a ticket. Refuse it if that ticket already links a
  // different PR, so an untrusted title cannot borrow another ticket's verdict.
  const claimed = await db
    .select({ suggestionId: suggestionLinks.suggestionId, ref: suggestionLinks.ref })
    .from(suggestionLinks)
    .where(and(
      eq(suggestionLinks.kind, 'pr'),
      eq(suggestionLinks.suggestionId, titleId),
    ))
    .orderBy(desc(suggestionLinks.createdAt))
    .limit(20)

  const otherPr = claimed.find((l) => prNumberFromRef(l.ref) !== pr.number)
  if (otherPr) {
    console.warn(
      `${LOG} PR #${pr.number} title claims ticket #${titleId}, but that ticket links PR ${otherPr.ref}. Refusing the title reference.`,
    )
    return null
  }
  return loadTicketFacts(titleId)
}

async function loadTicketFacts(id: number): Promise<TicketFacts | null> {
  const [row] = await db
    .select({
      id: homepageTeamSuggestions.id,
      status: homepageTeamSuggestions.status,
      kind: homepageTeamSuggestions.kind,
      attemptCount: homepageTeamSuggestions.attemptCount,
    })
    .from(homepageTeamSuggestions)
    .where(eq(homepageTeamSuggestions.id, id))
    .limit(1)
  if (!row) return null
  return { id: row.id, status: row.status as TicketStatus, kind: row.kind, attemptCount: row.attemptCount }
}

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

type EscalationKind = 'protected' | 'attempts' | 'merge-attempts' | 'revert-ci' | 'circuit'

/**
 * One email per PR per escalation kind, deduped in KV for a week. Without this
 * a protected PR that sits open for a day emails the owner 144 times.
 */
async function escalate(
  kind: EscalationKind,
  dedupeKey: string,
  subject: string,
  html: string,
  dryRun: boolean,
): Promise<boolean> {
  if (dryRun) {
    console.log(`${LOG} [dry-run] would escalate (${kind}) ${dedupeKey}: ${subject}`)
    return false
  }
  const first = await kvSetNX(`${dedupeKey}:${kind}`, String(Date.now()), 7 * 24 * 3600)
  if (!first) {
    console.log(`${LOG} escalation (${kind}) already sent for ${dedupeKey}, not re-sending`)
    return false
  }
  const res = await sendOwnerEmail(subject, html, { fromName: 'xdipx release engine' })
  if (!res.sent) console.warn(`${LOG} escalation email not sent: ${res.error}`)
  return res.sent
}

function emailShell(title: string, rows: Array<[string, string]>, body: string): string {
  const table = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6B5F68;">${escapeHtml(k)}</td><td style="padding:4px 0;"><strong>${escapeHtml(v)}</strong></td></tr>`,
    )
    .join('')
  return `<div style="font-family:system-ui,sans-serif;color:#1A1418;max-width:640px;">
<h2 style="margin:0 0 12px;">${escapeHtml(title)}</h2>
<table style="border-collapse:collapse;font-size:14px;">${table}</table>
<div style="margin-top:16px;font-size:14px;line-height:1.5;">${body}</div>
</div>`
}

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

interface PendingMerge {
  prNumber: number
  prUrl: string
  headRef: string
  mergeSha: string
  mergedAt: number
  ticketId: number | null
}

export type CyclePhase =
  | 'idle'
  | 'disabled'
  | 'locked'
  | 'config-error'
  | 'daily-cap'
  | 'circuit-open'
  | 'awaiting-deploy'
  | 'merged'
  | 'applied'
  | 'rolled-back'

export interface ReleaseCycleResult {
  ok: boolean
  dryRun: boolean
  phase: CyclePhase
  message: string
  decisions: ReleaseDecision[]
  /** Set when this cycle merged something. */
  merged?: { prNumber: number; sha: string; ticketId: number | null }
  /** Set when this cycle resolved a pending merge. */
  resolved?: { prNumber: number; outcome: 'applied' | 'rolled-back' | 'waiting'; evidence?: string }
  errors: string[]
}

function baseResult(dryRun: boolean): ReleaseCycleResult {
  return { ok: true, dryRun, phase: 'idle', message: '', decisions: [], errors: [] }
}

/**
 * One release cycle. Safe to call from a cron on any cadence: the kill switch,
 * the KV lock, the pending-merge gate, and the daily cap all make a second
 * concurrent or over-eager invocation a no-op.
 */
export async function runReleaseEngineCycle(opts: { dryRun?: boolean } = {}): Promise<ReleaseCycleResult> {
  const dryRun = opts.dryRun ?? false
  const result = baseResult(dryRun)

  // 1. KILL SWITCH, before anything else touches the network.
  const enabled = await getPipelineSetting('release_engine_enabled')
  if (enabled !== 'true') {
    return { ...result, phase: 'disabled', message: 'release_engine_enabled is not true, doing nothing' }
  }

  // 2. Serialise. A cycle that cannot take the lock does not queue, it returns.
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const acquired = await kvSetNX(KEYS.lock, token, LOCK_TTL_SEC)
  if (!acquired) {
    return { ...result, phase: 'locked', message: 'another cycle holds release-engine:lock' }
  }

  try {
    return await cycleBody(dryRun)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} cycle threw`, err)
    return { ...result, ok: false, message: `cycle error: ${msg}`, errors: [msg] }
  } finally {
    // Release only our own lock, so a cycle that overran its TTL cannot delete
    // the lock a later cycle now legitimately holds.
    const held = await kvGet<string>(KEYS.lock)
    if (held === token) await kvDel(KEYS.lock)
  }
}

async function cycleBody(dryRun: boolean): Promise<ReleaseCycleResult> {
  const result = baseResult(dryRun)

  const self = await runSelfCheck()
  if (!self.ok) {
    // A silent config error stops every merge. The GitHub token expiring in
    // July took roughly two days to notice because nothing announced it, so
    // the engine now tells the owner once a day that it is not working.
    await alertSelfCheckFailure(self.problems, dryRun)
    return {
      ...result,
      ok: false,
      phase: 'config-error',
      message: `config error: ${self.problems.join('; ')}`,
      errors: self.problems,
    }
  }

  // Ahead of every early return below: a ticket that has burned all three
  // attempts should stop consuming dev-pass claim slots whether or not the
  // engine is mid-merge, circuit-broken, or capped out for the day.
  await maybeSweepExhaustedTickets(dryRun)

  // A merge in flight owns the engine until its deploy and smoke resolve.
  const pending = await kvGet<PendingMerge>(KEYS.pending)
  if (pending) return resolvePending(pending, dryRun)

  // Reconcile hand-merged tickets roughly hourly, not on all 144 daily cycles:
  // a verified ticket with an unmerged PR would otherwise be re-queried every
  // ten minutes forever against an API that has already failed silently once.
  if (!dryRun) await maybeSweepOutOfBand()

  const day = utcDay()
  const rollbacks = Number((await kvGet<number>(KEYS.rollbacks(day))) ?? 0)
  if (shouldTripCircuit(rollbacks)) {
    return {
      ...result,
      phase: 'circuit-open',
      message: `${rollbacks} rollback(s) today, circuit breaker is open`,
    }
  }

  const cap = parseDailyCap(await getPipelineSetting('release_engine_max_merges_per_day'))
  const mergesToday = Number((await kvGet<number>(KEYS.merges(day))) ?? 0)
  if (dailyCapReached(mergesToday, cap)) {
    return { ...result, phase: 'daily-cap', message: `daily cap reached (${mergesToday}/${cap})` }
  }

  const open = await listOpenPullRequests({
    headPrefixes: [...AGENT_BRANCH_PREFIXES, REVERT_BRANCH_PREFIX],
    context: 'release-engine',
  })
  if (!open.ok) {
    return { ...result, ok: false, message: `cannot list PRs: ${open.error}`, errors: [open.error] }
  }

  // Reverts first: mitigating a bad release outranks shipping the next one.
  const candidates = [...open.data].sort((a, b) => {
    const ra = isRevertBranch(a.headRef) ? 0 : 1
    const rb = isRevertBranch(b.headRef) ? 0 : 1
    return ra !== rb ? ra - rb : a.number - b.number
  })

  const decisions: ReleaseDecision[] = []
  for (const summary of candidates) {
    const facts = await gatherFacts(summary)
    if (!facts) continue
    const decision = evaluatePullRequest(facts)
    decisions.push(decision)
    console.log(
      `${LOG}${dryRun ? ' [dry-run]' : ''} PR #${decision.prNumber} (${decision.headRef}) -> ${decision.action} [${decision.code}]: ${decision.reason}`,
    )

    if (decision.action === 'escalate-protected') {
      await handleProtected(summary, decision, dryRun)
      continue
    }
    if (decision.code === 'ci-red' && decision.isRevert) {
      await escalateRevertCiFailure(summary, dryRun)
    }
    if (decision.action === 'bounce') {
      await bounceTicket(decision.ticketId, decision.lastError ?? decision.reason, summary, dryRun)
      continue
    }
    if (decision.action !== 'merge') continue

    // ONE merge per cycle, and in dry-run zero.
    if (dryRun) {
      return {
        ...result,
        phase: 'idle',
        decisions,
        message: `[dry-run] would squash-merge PR #${summary.number} (${summary.headRef})`,
      }
    }
    return mergeOne(summary, decision, decisions, day)
  }

  return { ...result, decisions, message: `${decisions.length} open PR(s) evaluated, nothing merged` }
}

/** Assemble the decision inputs for one PR. Returns null when GitHub will not
 *  tell us something the decision needs: fail closed, evaluate nothing. */
async function gatherFacts(summary: PullRequestSummary): Promise<PullRequestFacts | null> {
  // Re-read the PR: the list endpoint does not populate `mergeable`.
  const full = await getPullRequest(summary.number, 'release-engine')
  const pr = full.ok ? full.data : summary

  const files = await listPullRequestFiles(pr.number, 'release-engine')
  if (!files.ok) {
    console.warn(`${LOG} cannot read changed files for PR #${pr.number}, skipping: ${files.error}`)
    return null
  }
  const classification = classifyChangedFiles(files.data)
  const changedPaths = files.data.flatMap((f) =>
    f.previousFilename ? [f.filename, f.previousFilename] : [f.filename],
  )

  const checksRes = await getChecksForRef(pr.headSha, 'release-engine')
  if (!checksRes.ok) {
    console.warn(`${LOG} cannot read checks for PR #${pr.number}, skipping: ${checksRes.error}`)
    return null
  }
  const checks: Record<string, string | null> = {}
  for (const c of checksRes.data.checks) checks[c.name] = c.status === 'completed' ? c.conclusion : null

  let ticket: TicketFacts | null = null
  try {
    ticket = await resolveTicketForPr(pr)
  } catch (err) {
    console.warn(`${LOG} ticket resolution failed for PR #${pr.number}`, err)
  }

  return {
    number: pr.number,
    headRef: pr.headRef,
    draft: pr.draft,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeableState,
    labels: pr.labels,
    classification,
    changedPaths,
    checks,
    ticket,
  }
}

/**
 * Announce a config error to the owner, once per UTC day.
 *
 * Deliberately not deduped per problem text: the owner needs to know the engine
 * is down, not to receive a message for each distinct symptom.
 */
async function alertSelfCheckFailure(problems: readonly string[], dryRun: boolean): Promise<void> {
  if (dryRun) return
  const first = await kvSetNX(KEYS.selfCheckAlert(utcDay()), String(Date.now()), 26 * 3600)
  if (!first) return
  await sendOwnerEmail(
    '[xdipx] release engine is not running: config error',
    emailShell(
      'The release engine failed its self-check, so nothing is being merged',
      [['Problems', problems.join('; ') || 'unknown']],
      `<p>Every agent PR is waiting until this is fixed. The most common cause is an expired
      <code>GITHUB_TOKEN</code> in the Vercel project environment.</p>
      <p>This message is sent once a day while the condition lasts.</p>`,
    ),
  )
}

/**
 * Run the out-of-band merge sweep at most once an hour. The hour marker is
 * stored rather than a TTL lock so a missed cycle simply sweeps on the next
 * one instead of waiting out a lease.
 */
async function maybeSweepOutOfBand(): Promise<void> {
  const hour = new Date().toISOString().slice(0, 13)
  const last = await kvGet<string>(KEYS.sweepHour)
  if (last === hour) return
  await kvSet(KEYS.sweepHour, hour)

  try {
    const { sweepOutOfBandMerges } = await import('~/lib/ticket-out-of-band-sweep.server')
    const swept = await sweepOutOfBandMerges()
    if (swept.applied.length > 0) {
      console.log(`${LOG} out-of-band sweep applied tickets: ${swept.applied.join(', ')}`)
    }
    for (const err of swept.errors) console.warn(`${LOG} sweep: ${err}`)
  } catch (err) {
    // Reconciliation is a bookkeeping nicety; never let it stop a release.
    console.error(`${LOG} out-of-band sweep failed`, err)
  }
}

/**
 * Hourly backstop: block and escalate any ticket that has burned every fix
 * attempt, whichever agent spent them.
 *
 * Only `in_progress` is swept, because it is the only status with a `->
 * blocked` edge in the transition map, and (since the bounce lease renewal in
 * team.server.ts) it is where a bounced ticket actually sits. A row that has
 * already moved on to `pr_open` is someone's live work and is left alone; if it
 * bounces again it comes straight back here.
 */
async function maybeSweepExhaustedTickets(dryRun: boolean): Promise<void> {
  if (dryRun) return
  const hour = new Date().toISOString().slice(0, 13)
  if ((await kvGet<string>(KEYS.exhaustedHour)) === hour) return
  await kvSet(KEYS.exhaustedHour, hour)

  let rows: Array<Record<string, unknown>> = []
  try {
    const res = await db.execute(sql`
      SELECT id, attempt_count, last_error
        FROM homepage_team_suggestions
       WHERE status = 'in_progress'
         AND attempt_count >= ${MAX_TICKET_ATTEMPTS}
       ORDER BY priority ASC, updated_at ASC
       LIMIT 20`)
    rows = (res.rows ?? []) as Array<Record<string, unknown>>
  } catch (err) {
    // Housekeeping must never stop a release.
    console.error(`${LOG} exhausted-ticket sweep failed`, err)
    return
  }

  for (const row of rows) {
    const id = Number(row['id'] ?? 0)
    if (!Number.isInteger(id) || id <= 0) continue
    await blockExhaustedTicket(
      id,
      Number(row['attempt_count'] ?? MAX_TICKET_ATTEMPTS),
      typeof row['last_error'] === 'string' && row['last_error']
        ? row['last_error']
        : 'no error recorded on the ticket',
    )
  }
}

async function handleProtected(pr: PullRequestSummary, decision: ReleaseDecision, dryRun: boolean): Promise<void> {
  if (!dryRun && !pr.labels.includes(NEEDS_OWNER_LABEL)) {
    const labelled = await addLabels(pr.number, [NEEDS_OWNER_LABEL], 'release-engine')
    if (!labelled.ok) console.warn(`${LOG} could not label PR #${pr.number}: ${labelled.error}`)
  }
  // Record the stop on the ticket itself. The owner digest builds its
  // escalation list from pr links in state 'needs-owner'; nothing wrote that
  // state before, so that section could never show anything. Only possible for
  // PRs that resolve to a ticket — an ad-hoc protected PR still gets the label
  // and the email, but has no row to hang a link on.
  if (!dryRun && decision.ticketId !== null) {
    await addTicketLink(decision.ticketId, {
      kind: 'pr',
      ref: pr.htmlUrl,
      state: 'needs-owner',
    })
  }
  await escalate(
    'protected',
    KEYS.escalated(pr.number),
    `[xdipx] PR #${pr.number} needs you: protected path`,
    emailShell(
      'A PR touches a protected path, so the release engine stopped',
      [
        ['PR', `#${pr.number} ${pr.title}`],
        ['Branch', pr.headRef],
        ['Protected files', (decision.protectedFiles ?? []).join(', ') || 'unknown'],
        ['Matched rules', (decision.protectedGlobs ?? []).join(', ') || 'unknown'],
      ],
      `<p>The engine will never merge this one. Review and merge it yourself if it is right: <a href="${escapeHtml(pr.htmlUrl)}">${escapeHtml(pr.htmlUrl)}</a></p>
<p>The classification comes only from the GitHub changed-file list. Nothing in the PR title, body, or the linked ticket was consulted.</p>`,
    ),
    dryRun,
  )
}

async function escalateRevertCiFailure(pr: PullRequestSummary, dryRun: boolean): Promise<void> {
  await escalate(
    'revert-ci',
    KEYS.escalated(pr.number),
    `[xdipx] revert PR #${pr.number} is failing CI`,
    emailShell(
      'A revert PR opened by the release engine cannot pass CI',
      [
        ['PR', `#${pr.number} ${pr.title}`],
        ['Branch', pr.headRef],
      ],
      `<p>Production was already re-promoted to the previous READY deployment, so the site should be healthy. The durable revert is stuck: <a href="${escapeHtml(pr.htmlUrl)}">${escapeHtml(pr.htmlUrl)}</a></p>`,
    ),
    dryRun,
  )
}

async function mergeOne(
  pr: PullRequestSummary,
  decision: ReleaseDecision,
  decisions: ReleaseDecision[],
  day: string,
): Promise<ReleaseCycleResult> {
  const result = baseResult(false)

  // expectedHeadSha: GitHub refuses the merge if the branch moved between
  // classification and merge, which is exactly how an unclassified commit
  // would otherwise reach main.
  const merged = await squashMergePullRequest(pr.number, {
    title: `${pr.title} (#${pr.number})`,
    message: `Merged by the xdipx release engine.\n\nGate: ${decision.reason}`,
    expectedHeadSha: pr.headSha,
    context: 'release-engine',
  })
  if (!merged.ok) {
    console.error(`${LOG} merge of PR #${pr.number} failed: ${merged.error}`)
    // Count the failure. A merge that cannot succeed (a rule GitHub enforces
    // and the gate does not model, say) used to be retried every ten minutes
    // forever with no record and no escalation.
    const attempts = await kvIncr(KEYS.mergeFail(pr.number))
    if (attempts >= MAX_MERGE_ATTEMPTS) {
      if (!pr.labels.includes(NEEDS_OWNER_LABEL)) {
        const labelled = await addLabels(pr.number, [NEEDS_OWNER_LABEL], 'release-engine')
        if (!labelled.ok) console.warn(`${LOG} could not label PR #${pr.number}: ${labelled.error}`)
      }
      await escalate(
        'merge-attempts',
        KEYS.escalated(pr.number),
        `[xdipx] PR #${pr.number} cannot be merged after ${attempts} attempts`,
        emailShell(
          'The release engine gave up merging a PR',
          [
            ['PR', `#${pr.number} ${pr.title}`],
            ['Branch', pr.headRef],
            ['Attempts', String(attempts)],
            ['Last error', merged.error],
          ],
          `<p>The gate keeps saying this PR is mergeable and GitHub keeps refusing. It now carries the
          <code>${escapeHtml(NEEDS_OWNER_LABEL)}</code> label, so the engine will skip it from here on:
          <a href="${escapeHtml(pr.htmlUrl)}">${escapeHtml(pr.htmlUrl)}</a></p>`,
        ),
        false,
      )
    }
    return {
      ...result,
      ok: false,
      decisions,
      message: `merge failed for PR #${pr.number} (attempt ${attempts}): ${merged.error}`,
      errors: [merged.error],
    }
  }

  await kvDel(KEYS.mergeFail(pr.number))
  await kvIncr(KEYS.merges(day))
  const pending: PendingMerge = {
    prNumber: pr.number,
    prUrl: pr.htmlUrl,
    headRef: pr.headRef,
    mergeSha: merged.data.sha,
    mergedAt: Date.now(),
    ticketId: decision.ticketId,
  }
  await kvSet(KEYS.pending, pending)
  console.log(`${LOG} merged PR #${pr.number} as ${merged.data.sha}, awaiting production deploy`)

  if (decision.ticketId !== null) {
    await addTicketLink(decision.ticketId, { kind: 'commit', ref: merged.data.sha, state: 'merged' })
  }

  return {
    ...result,
    phase: 'merged',
    decisions,
    merged: { prNumber: pr.number, sha: merged.data.sha, ticketId: decision.ticketId },
    message: `merged PR #${pr.number} as ${merged.data.sha.slice(0, 7)}`,
  }
}

/**
 * Resume a merge that is waiting on its production deployment. Polls inside a
 * small budget, then either finishes (deploy READY, smoke run) or leaves the
 * pending row for the next cycle until the 15-minute deadline turns silence
 * into a failure.
 */
async function resolvePending(pending: PendingMerge, dryRun: boolean): Promise<ReleaseCycleResult> {
  const result = baseResult(dryRun)
  const deadline = Date.now() + POLL_BUDGET_MS

  let deployment = await findDeploymentBySha(pending.mergeSha)
  while (
    Date.now() < deadline
    && (!deployment || (deployment.readyState !== 'READY' && !isTerminalFailure(deployment.readyState)))
  ) {
    await sleep(POLL_INTERVAL_MS)
    deployment = await findDeploymentBySha(pending.mergeSha)
  }

  if (deployment?.readyState === 'READY') {
    if (pending.ticketId !== null && !dryRun) {
      await addTicketLink(pending.ticketId, {
        kind: 'deploy',
        ref: deployment.url ? `https://${deployment.url}` : deployment.uid,
        state: 'ready',
      })
    }
    const smoke = await runReleaseSmoke()
    console.log(`${LOG} smoke for PR #${pending.prNumber}: ${smoke.evidence}`)
    if (smoke.ok) return applySuccess(pending, smoke, dryRun)
    return failAndRollback(pending, smoke.evidence, dryRun)
  }

  if (deployment && isTerminalFailure(deployment.readyState)) {
    return failAndRollback(pending, `production deployment ${deployment.uid} is ${deployment.readyState}`, dryRun)
  }

  if (Date.now() - pending.mergedAt > DEPLOY_TIMEOUT_MS) {
    return failAndRollback(
      pending,
      `no READY production deployment for ${pending.mergeSha.slice(0, 7)} within ${Math.round(DEPLOY_TIMEOUT_MS / 60_000)} min`,
      dryRun,
    )
  }

  return {
    ...result,
    phase: 'awaiting-deploy',
    resolved: { prNumber: pending.prNumber, outcome: 'waiting' },
    message: `PR #${pending.prNumber} merged ${Math.round((Date.now() - pending.mergedAt) / 60_000)} min ago, deployment ${deployment?.readyState ?? 'not found yet'}`,
  }
}

function isTerminalFailure(state: string): boolean {
  return state === 'ERROR' || state === 'CANCELED' || state === 'DELETED'
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function applySuccess(pending: PendingMerge, smoke: SmokeResult, dryRun: boolean): Promise<ReleaseCycleResult> {
  const result = baseResult(dryRun)
  const errors: string[] = []

  if (!dryRun && pending.ticketId !== null) {
    try {
      await transitionSuggestion(pending.ticketId, 'applied', 'system', {
        note: smoke.evidence,
        links: [{ kind: 'pr', ref: pending.prUrl, state: 'merged' }],
      })
    } catch (err) {
      // A ticket that is not in `verified` (a docs PR, a revert, an owner move)
      // is a 409 here and is not a release failure: the code is live and smoke
      // passed. Record it and move on.
      const msg = err instanceof Response ? `${err.status} ${await err.text()}` : String(err)
      console.warn(`${LOG} could not apply ticket #${pending.ticketId}: ${msg}`)
      errors.push(msg)
    }
  }

  if (!dryRun) {
    await markPrLinksMerged(pending)
    await kvDel(KEYS.pending)
  }

  return {
    ...result,
    phase: 'applied',
    resolved: { prNumber: pending.prNumber, outcome: 'applied', evidence: smoke.evidence },
    message: `PR #${pending.prNumber} deployed and smoke-clean`,
    errors,
  }
}

/**
 * Mitigate, then make it durable.
 *
 * Order is deliberate: re-promoting the previous READY deployment puts a
 * healthy build in front of shoppers in seconds. The revert PR that follows is
 * the durable fix and goes through CI and the protected classifier like any
 * other change; it only skips the QA verdict, because there is no QA verdict
 * to have for a machine-generated tree restore.
 */
async function failAndRollback(pending: PendingMerge, evidence: string, dryRun: boolean): Promise<ReleaseCycleResult> {
  const result = baseResult(dryRun)
  const errors: string[] = []
  console.error(`${LOG} release of PR #${pending.prNumber} FAILED: ${evidence}`)

  if (dryRun) {
    return {
      ...result,
      phase: 'rolled-back',
      resolved: { prNumber: pending.prNumber, outcome: 'rolled-back', evidence },
      message: `[dry-run] would re-promote and open ${REVERT_BRANCH_PREFIX}${pending.prNumber}`,
    }
  }

  // 1. Instant mitigation.
  let promotedTo = 'none'
  const previous = await findPreviousReadyDeployment(pending.mergeSha)
  if (previous) {
    const promoted = await promoteDeployment(previous.uid)
    promotedTo = promoted.ok ? `${previous.uid} (${promoted.via})` : `failed: ${promoted.error}`
    if (!promoted.ok) errors.push(`re-promote failed: ${promoted.error}`)
  } else {
    errors.push('no previous READY production deployment to re-promote')
  }

  // 2. Circuit breaker counts every rollback, whether or not the promote worked.
  const day = utcDay()
  const rollbacks = await kvIncr(KEYS.rollbacks(day))

  // 3. Durable revert PR.
  const branch = `${REVERT_BRANCH_PREFIX}${pending.prNumber}`
  let revertUrl = ''
  const revert = await createRevertBranch({
    badSha: pending.mergeSha,
    branch,
    base: 'main',
    message: `revert: PR #${pending.prNumber} failed post-deploy smoke\n\n${evidence}`,
    context: 'release-engine',
  })
  if (revert.ok) {
    const opened = await openPullRequest({
      title: `revert: PR #${pending.prNumber} failed post-deploy smoke`,
      head: branch,
      base: 'main',
      body:
        `The release engine merged #${pending.prNumber}, the production deploy went out, and the post-deploy smoke failed.\n\n`
        + `Evidence:\n\n> ${evidence}\n\n`
        + `Production was already re-promoted to ${promotedTo}. This PR restores the tree from before the bad squash and will be merged by the engine once CI is green. It skips the QA verdict, never CI and never the protected-path classifier.`,
      context: 'release-engine',
    })
    if (opened.ok) revertUrl = opened.data.htmlUrl
    else errors.push(`could not open the revert PR: ${opened.error}`)
  } else {
    errors.push(`could not create the revert branch: ${revert.error}`)
  }

  // 4. Bounce the ticket and, at attempt 3, block and escalate.
  await bounceTicket(pending.ticketId, evidence, null, false)

  // 5. Circuit breaker.
  if (shouldTripCircuit(rollbacks)) {
    await setReleaseEngineEnabled(false)
    await escalate(
      'circuit',
      `release-engine:circuit:${day}`,
      '[xdipx] release engine circuit breaker tripped, auto-merge is OFF',
      emailShell(
        'Two rollbacks in one day, so the release engine turned itself off',
        [
          ['Rollbacks today', String(rollbacks)],
          ['Last PR', `#${pending.prNumber}`],
          ['Evidence', evidence.slice(0, 400)],
        ],
        `<p><code>release_engine_enabled</code> is now <strong>false</strong>. Agent PRs wait for you exactly as they did before the engine existed. Flip it back on in /admin once you know what broke.</p>`,
      ),
      false,
    )
  }

  await markPrLinksState(pending, 'reverted')
  await kvDel(KEYS.pending)

  return {
    ...result,
    ok: false,
    phase: 'rolled-back',
    resolved: { prNumber: pending.prNumber, outcome: 'rolled-back', evidence },
    message: `PR #${pending.prNumber} rolled back (promoted ${promotedTo}${revertUrl ? `, revert ${revertUrl}` : ''})`,
    errors,
  }
}

/**
 * Send a ticket back for another fix attempt, and block it once it has burned
 * MAX_TICKET_ATTEMPTS. The bounce edge (`verified -> in_progress`, actor
 * `system`) increments the attempt itself; the block is a second hop because
 * the transition map has no `verified -> blocked` edge, deliberately.
 */
async function bounceTicket(
  ticketId: number | null,
  lastError: string,
  pr: PullRequestSummary | null,
  dryRun: boolean,
): Promise<void> {
  if (ticketId === null) return
  if (dryRun) {
    console.log(`${LOG} [dry-run] would bounce ticket #${ticketId}: ${lastError}`)
    return
  }
  let attemptCount = 0
  try {
    const row = await transitionSuggestion(ticketId, 'in_progress', 'system', {
      lastError: lastError.slice(0, 2000),
      ...(pr ? { links: [{ kind: 'pr', ref: pr.htmlUrl, state: 'open' }] } : {}),
    })
    attemptCount = row.attemptCount
  } catch (err) {
    const msg = err instanceof Response ? `${err.status}` : String(err)
    console.warn(`${LOG} could not bounce ticket #${ticketId} (${msg})`)
    return
  }

  if (!shouldBlockForAttempts(attemptCount)) return
  await blockExhaustedTicket(ticketId, attemptCount, lastError)
}

/**
 * Block a ticket that has burned every fix attempt, and tell the owner once.
 *
 * Split out of bounceTicket because the engine's own `verified -> in_progress`
 * bounce is not the only one that spends an attempt: QA's `in_review ->
 * in_progress` FAIL bounce walks the same attempt-incrementing edge from inside
 * the R-QA routine, which has no path to `blocked` and no escalation channel.
 * Three docs promised this block happened for any third failure; only the
 * engine's path implemented it, so a ticket QA failed three times cycled dev ->
 * QA -> dev forever and took one of the dev pass's three claim slots with it
 * every time. maybeSweepExhaustedTickets is the backstop for every other
 * bouncer; this is the shared tail both call.
 */
async function blockExhaustedTicket(
  ticketId: number,
  attemptCount: number,
  lastError: string,
): Promise<void> {
  try {
    await transitionSuggestion(ticketId, 'blocked', 'system', {
      note: `blocked after ${attemptCount} fix attempts`,
      lastError: lastError.slice(0, 2000),
    })
  } catch (err) {
    console.warn(`${LOG} could not block ticket #${ticketId}`, err)
  }

  const ticket = await getTicket(ticketId).catch(() => null)
  const recentErrors = (ticket?.links ?? [])
    .filter((l) => l.kind === 'note')
    .slice(0, 3)
    .map((l) => l.ref)
  await escalate(
    'attempts',
    `release-engine:ticket:${ticketId}`,
    `[xdipx] ticket #${ticketId} is blocked after ${attemptCount} attempts`,
    emailShell(
      'A ticket burned every fix attempt and is now blocked',
      [
        ['Ticket', `#${ticketId}`],
        ['Attempts', String(attemptCount)],
        ['Summary', (ticket?.suggestion.suggestion ?? '').slice(0, 200)],
      ],
      `<p>Latest error:</p><pre style="white-space:pre-wrap;font-size:13px;">${escapeHtml(lastError.slice(0, 800))}</pre>
${recentErrors.length > 0 ? `<p>Recent notes:</p><ul>${recentErrors.map((e) => `<li>${escapeHtml(e.slice(0, 200))}</li>`).join('')}</ul>` : ''}
<p>Unblock it in /admin when you have decided what to do.</p>`,
    ),
    false,
  )
}

// ---------------------------------------------------------------------------
// Small DB helpers (reads and link writes only; the engine never writes a valve
// except its own kill switch in the circuit breaker)
// ---------------------------------------------------------------------------

async function addTicketLink(ticketId: number, link: { kind: string; ref: string; state?: string }): Promise<void> {
  try {
    await db.insert(suggestionLinks).values({
      suggestionId: ticketId,
      kind: link.kind.slice(0, 12),
      ref: link.ref,
      state: link.state ? link.state.slice(0, 16) : null,
    })
  } catch (err) {
    console.warn(`${LOG} could not add ${link.kind} link to ticket #${ticketId}`, err)
  }
}

async function markPrLinksMerged(pending: PendingMerge): Promise<void> {
  await markPrLinksState(pending, 'merged')
}

async function markPrLinksState(pending: PendingMerge, state: string): Promise<void> {
  if (pending.ticketId === null) return
  try {
    await db
      .update(suggestionLinks)
      .set({ state: state.slice(0, 16), updatedAt: new Date() })
      .where(
        and(
          eq(suggestionLinks.suggestionId, pending.ticketId),
          eq(suggestionLinks.kind, 'pr'),
          eq(suggestionLinks.ref, pending.prUrl),
        ),
      )
  } catch (err) {
    console.warn(`${LOG} could not update link state for ticket #${pending.ticketId}`, err)
  }
}

/**
 * The ONLY pipeline_settings write in this module, and it only ever turns the
 * engine off. There is no code path here that enables anything.
 */
async function setReleaseEngineEnabled(value: false): Promise<void> {
  try {
    const { setPipelineSettingAudited } = await import('~/lib/settings.server')
    await setPipelineSettingAudited(
      'release_engine_enabled',
      String(value),
      'system',
      'release-engine:circuit-breaker',
    )
    console.error(`${LOG} circuit breaker: release_engine_enabled set to false`)
  } catch (err) {
    console.error(`${LOG} could not flip release_engine_enabled off`, err)
  }
}
