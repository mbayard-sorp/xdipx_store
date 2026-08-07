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

import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'

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
  listWorkflowRunsForSha,
  markPullRequestReadyForReview,
  normalizeChangedPath,
  openPullRequest,
  recyclePullRequest,
  rerunFailedJobs,
  squashMergePullRequest,
  type ProtectedClassification,
  type PullRequestSummary,
} from '~/lib/github.server'
import { checkPageOnce, renderTruth } from '~/lib/homepage-healthcheck.server'
import { checkUrl, runCheckoutProbe } from '~/lib/checkout-probe.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { KV_KEYS, kvDel, kvGet, kvIncr, kvSet, kvSetNX } from '~/lib/kv.server'
import { escapeHtml, sendOwnerEmail } from '~/lib/owner-alerts.server'
import { getTicket, runWithOutOfBandReconcile, transitionSuggestion, type TicketStatus } from '~/lib/team.server'
// One-directional: the autofile module imports team.server and github.server,
// never this file, so there is no cycle. Keeping the tunable half of ADR-008
// step 2 out of this protected file is the point (see that module's header).
import { autoFileTicketForPr } from '~/lib/release-ticket-autofile.server'

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
 *
 * `fix/` and `pm/` were added by ADR-008 step 4 (2026-08-04). This widens what
 * the engine LOOKS AT, and nothing else: every gate downstream is unchanged, so
 * a PR on either prefix still needs green CI, a clean protected-path
 * classification, and a QA-verified ticket before it can merge.
 *
 * The reason to widen is not throughput, it is silence. `listOpenPullRequests`
 * filters on these prefixes before a `PullRequestFacts` object is built, so a PR
 * outside them is never evaluated, never labelled, never logged by number, and
 * never reaches the owner digest. A protected-path PR escalates loudly and a
 * ticket-less PR at least logs; an ineligible prefix is invisible to every
 * observability surface at once. `pm/tracker-<date>` proved the cost: the
 * program-manager's weekly PR was documented in two playbooks as "merged by the
 * release engine", and no tracker PR had ever merged.
 *
 * Note what is NOT here. Adding a prefix to this list does not add it to
 * `autoReadyOnDraft`, and must not: see that function for why an owner-attended
 * lane keeps its drafts.
 */
export const AGENT_BRANCH_PREFIXES: readonly string[] = [
  'agents/', 'ticket/', 'claude/', 'phase1/', 'tonight/', 'fix/', 'pm/',
]

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

/**
 * Failing conclusions that mean the job never actually executed.
 *
 * GitHub reports a hosted-runner capacity failure ("The job was not acquired by
 * Runner of type hosted even after multiple attempts") as `cancelled`, and a
 * superseded concurrency group the same way. In both cases no typecheck, test,
 * or build step ran, so reading it as "the build is red" is as wrong as reading
 * it as "the build is green". The honest state is "no verdict yet", and the way
 * to get one is to re-run.
 *
 * This is bounded by MAX_CI_RETRIGGERS_PER_PR and it never merges anything: a
 * re-run that comes back `failure` is red, permanently, exactly as before.
 */
const NO_VERDICT_CONCLUSIONS = new Set(['cancelled', 'stale'])

/**
 * How long a non-draft PR may sit with a required check that never reported
 * before the engine concludes GitHub dropped the trigger.
 *
 * Measured against `updated_at`, and deliberately longer than one cron cycle
 * (10 min) plus a normal queue wait, so a merely slow run is never recycled out
 * from under itself.
 */
export const CI_ABSENT_GRACE_MS = 20 * 60_000

/**
 * Times the engine will try to make GitHub produce a missing check for one PR
 * before it stops and asks the owner.
 *
 * Why a cap at all: if the trigger is being declined for a reason recycling
 * cannot fix, an uncapped retry is an infinite close/reopen loop that spams the
 * PR timeline and burns Actions minutes. Two attempts covers the observed
 * transient case; the third signal to the owner is worth more than a third try.
 */
export const MAX_CI_RETRIGGERS_PER_PR = 2

/** Attempts a ticket gets before it is blocked and escalated. */
export const MAX_TICKET_ATTEMPTS = 3

/** Rollbacks in one UTC day that flip the kill switch off. */
export const ROLLBACK_CIRCUIT_LIMIT = 2

export const DEFAULT_MAX_MERGES_PER_DAY = 6

/**
 * Drafts the engine will take out of draft in a single cycle.
 *
 * Not a safety gate — undrafting merges nothing and every downstream gate still
 * runs — just a bound on how much a pathological state can do to the GitHub API
 * in one invocation. The realistic backlog is a handful of PRs from one agent
 * pass; 18 was the worst case observed, and on a ten-minute cron that clears in
 * four cycles.
 */
export const MAX_UNDRAFTS_PER_CYCLE = 5

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
  /**
   * Times the engine has tried to make GitHub produce a check for one head.
   *
   * Keyed on the SHA, not the PR: a new commit is a new chance at a run, and
   * an author who pushes a fix should not inherit the previous head's exhausted
   * budget. It also self-expires, since a merged branch's SHA is never read
   * again.
   */
  ciRetrigger: (sha: string) => `release-engine:ci-retrigger:${sha}`,
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
  /** PR title, consulted ONLY for the WIP marker in the conditional undraft
   *  rule. It is untrusted text, and it can only ever KEEP a PR drafted. */
  title: string
  /**
   * Milliseconds since the PR's last recorded activity (`updated_at`), 0 when
   * unparseable. `PullRequestSummary` carries no created_at, and updated_at is
   * a strictly conservative stand-in: it is never earlier than creation, so
   * "no activity for 30 minutes" implies "older than 30 minutes" and also
   * refuses to undraft a PR someone is actively pushing to.
   */
  ageMs: number
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
  /**
   * Times the engine has already tried to make GitHub produce a missing check
   * for this PR. Read from KV by the caller so `evaluatePullRequest` stays a
   * pure function of its facts.
   */
  ciRetriggers: number
}

export type ReleaseAction =
  | 'merge' | 'wait' | 'skip' | 'bounce' | 'escalate-protected' | 'undraft'
  | 'retrigger-ci' | 'escalate-ci'

export type ReleaseReasonCode =
  | 'protected'
  | 'needs-owner-label'
  | 'draft'
  | 'draft-auto-ready'
  | 'conflict'
  | 'ci-red'
  | 'ci-pending'
  | 'ci-absent'
  | 'ci-no-verdict'
  | 'ci-stuck'
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

/**
 * Branch namespaces where a draft PR is always an accident, so the engine takes
 * it out of draft itself instead of skipping it forever.
 *
 * Why this exists: a PR opened from a Claude Code cloud session is created as a
 * draft by the harness, and `evaluatePullRequest` skips drafts before it reads
 * CI, the allowlist, or the ticket. On 2026-07-30 that stranded 15 green
 * suggestion PRs and 3 QA-verified ticket PRs for a day. The failure is silent
 * in a way the other gates are not: CI is fully green, so no check, dashboard,
 * or run summary reports anything wrong, and the only symptom is a queue that
 * grows. The playbooks now require `gh pr ready` (routine-agent-editor.md step
 * 5, routine-dev-daily.md step 5b); this is the backstop for when an agent does
 * not follow them, which is the normal case eventually.
 *
 * Deliberately narrower than `AGENT_BRANCH_PREFIXES`. `agents/*` and `ticket/*`
 * are machine lanes whose only terminal state is an open PR, so a draft there
 * carries no intent. `claude/*`, `phase1/*`, and `tonight/*` are owner-attended
 * sessions where a draft is plausibly deliberate work-in-progress, and
 * `revert/pr-*` is opened by this engine and never drafted. Undrafting someone
 * else's WIP is a small rudeness the backstop does not need to commit.
 */
export function autoReadyOnDraft(headRef: string): boolean {
  return headRef.startsWith('agents/') || headRef.startsWith('ticket/')
}

/**
 * The owner-attended lanes where a draft MIGHT be deliberate WIP, so the engine
 * undrafts only under the strict conditions in `conditionalUndraftEligible`.
 *
 * Why widen at all: 38 of the last 118 owner hand-merges (measured 2026-08-05)
 * were green `claude/` drafts the engine refused to look at. A cloud session
 * opens its PR as a draft by default, and a session that files its ticket and
 * walks away leaves work that is fully gated, fully green, and structurally
 * unmergeable. The conditions below separate that case from real WIP.
 */
export const CONDITIONAL_UNDRAFT_PREFIXES: readonly string[] = [
  'claude/', 'phase1/', 'tonight/', 'fix/', 'pm/',
]

/** How long a draft on an owner-attended lane must sit with no activity before
 *  the conditional undraft may touch it. */
export const CONDITIONAL_UNDRAFT_MIN_AGE_MS = 30 * 60_000

export function isConditionalUndraftLane(headRef: string): boolean {
  return CONDITIONAL_UNDRAFT_PREFIXES.some((p) => headRef.startsWith(p))
}

/**
 * A WIP marker means the author asked for the draft to stay a draft. The title
 * match is on the word `wip` (case-insensitive, word-bounded so "swipe" does
 * not count), and the label match is an exact `wip` label. Either alone keeps
 * the PR drafted.
 */
export function hasWipMarker(title: string, labels: readonly string[]): boolean {
  return /\bwip\b/i.test(title) || labels.some((l) => l.toLowerCase() === 'wip')
}

/**
 * Whether a draft on an owner-attended lane may be taken out of draft. ALL of:
 *
 *   1. The required CI check has reported success. A red or pending build is
 *      plausibly mid-work; a green one is a finished change sitting idle.
 *   2. A pr-linked ticket exists for the PR, whatever its status. A session
 *      that filed its ticket followed ADR-008 step 3 and meant to ship.
 *   3. No activity for CONDITIONAL_UNDRAFT_MIN_AGE_MS. Someone still typing
 *      gets left alone.
 *   4. No WIP marker in the title or labels.
 *
 * Undrafting is still not an approval and merges nothing: the PR is re-read
 * and fully gated on the next cycle, exactly like the machine-lane undraft.
 */
export function conditionalUndraftEligible(
  facts: Pick<PullRequestFacts, 'headRef' | 'checks' | 'ticket' | 'ageMs' | 'title' | 'labels'>,
): boolean {
  return (
    isConditionalUndraftLane(facts.headRef)
    && checkState(facts.checks, [REQUIRED_CHECK]) === 'success'
    && facts.ticket !== null
    && facts.ageMs >= CONDITIONAL_UNDRAFT_MIN_AGE_MS
    && !hasWipMarker(facts.title, facts.labels)
  )
}

/** Age from a GitHub timestamp string; 0 (never eligible) when unparseable. */
export function ageMsFromTimestamp(ts: string, now = Date.now()): number {
  const t = Date.parse(ts)
  return Number.isFinite(t) ? Math.max(0, now - t) : 0
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
 * The raw conclusion string of the first of `names` that reported one.
 *
 * `checkState` deliberately collapses every failing conclusion to `'failing'`,
 * which is the right shape for the merge gate but loses the distinction between
 * a build that ran and failed and a job that was never scheduled. Only the
 * re-run path needs the raw value, so it reads it here rather than widening
 * `CheckState` for everyone.
 */
export function rawConclusion(
  checks: Readonly<Record<string, string | null>>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    if (!(name in checks)) continue
    const conclusion = checks[name]
    if (typeof conclusion === 'string' && conclusion) return conclusion
  }
  return null
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

  // A draft is invisible to every gate below, so it is resolved before them.
  // On a machine lane the engine takes it out of draft and re-evaluates it on
  // the next cycle; everywhere else a draft still means hands off. Undrafting
  // is not an approval and merges nothing: the PR still has to clear CI, the
  // allowlist, the ticket, and mergeability on that next pass.
  if (facts.draft) {
    if (autoReadyOnDraft(facts.headRef)) {
      return {
        ...base,
        action: 'undraft',
        code: 'draft-auto-ready',
        reason: `draft PR on the ${facts.headRef.split('/')[0]}/ lane, marking it ready for review`,
      }
    }
    // Owner-attended lanes undraft only under the full eligibility test: green
    // required check, a pr-linked ticket, half an hour of silence, and no WIP
    // marker. Anything short of all four still means hands off.
    if (conditionalUndraftEligible(facts)) {
      return {
        ...base,
        action: 'undraft',
        code: 'draft-auto-ready',
        reason:
          `idle green draft on the ${facts.headRef.split('/')[0]}/ lane with a linked ticket `
          + 'and no WIP marker, marking it ready for review',
      }
    }
    return { ...base, action: 'skip', code: 'draft', reason: 'draft PR' }
  }

  if (facts.mergeableState === 'dirty') {
    return { ...base, action: 'skip', code: 'conflict', reason: 'merge conflict with the base branch' }
  }

  // 3. CI. A red `check` blocks every PR without exception, revert PRs included.
  const ci = checkState(facts.checks, [REQUIRED_CHECK])

  // 3a. A check that reported a no-verdict conclusion (a hosted runner that was
  //     never acquired, or a concurrency-superseded run) never executed a single
  //     step. Re-run it rather than reading it as a red build. Bounded, and it
  //     merges nothing: the re-run's real conclusion is what the gate below sees
  //     on the next cycle.
  const rawCi = rawConclusion(facts.checks, [REQUIRED_CHECK])
  if (ci === 'failing' && rawCi !== null && NO_VERDICT_CONCLUSIONS.has(rawCi)) {
    if (facts.ciRetriggers < MAX_CI_RETRIGGERS_PER_PR) {
      return {
        ...base,
        action: 'retrigger-ci',
        code: 'ci-no-verdict',
        reason:
          `required check "${REQUIRED_CHECK}" concluded '${rawCi}' without running any step, `
          + `re-running it (attempt ${facts.ciRetriggers + 1} of ${MAX_CI_RETRIGGERS_PER_PR})`,
      }
    }
    return {
      ...base,
      action: 'escalate-ci',
      code: 'ci-stuck',
      reason:
        `required check "${REQUIRED_CHECK}" concluded '${rawCi}' without running, and `
        + `${MAX_CI_RETRIGGERS_PER_PR} re-runs did not produce a verdict`,
    }
  }

  // 3b. A required check that never reported at all. GitHub silently declines to
  //     create `pull_request` workflow runs often enough that this is the single
  //     largest cause of a PR sitting open: the context branch protection
  //     requires can never arrive, so the PR is unmergeable forever and nothing
  //     in the loop notices. Recycling the PR (close then reopen) fires the
  //     `reopened` activity type and makes GitHub build the run.
  //
  //     The grace window matters. Before it elapses this is an ordinary
  //     `ci-pending` wait, because a queued run and a dropped run look identical.
  if (ci === 'absent' && facts.ageMs >= CI_ABSENT_GRACE_MS) {
    if (facts.ciRetriggers < MAX_CI_RETRIGGERS_PER_PR) {
      return {
        ...base,
        action: 'retrigger-ci',
        code: 'ci-absent',
        reason:
          `no "${REQUIRED_CHECK}" run exists for this head after `
          + `${Math.round(facts.ageMs / 60_000)} min, recycling the PR to make GitHub create one `
          + `(attempt ${facts.ciRetriggers + 1} of ${MAX_CI_RETRIGGERS_PER_PR})`,
      }
    }
    return {
      ...base,
      action: 'escalate-ci',
      code: 'ci-stuck',
      reason:
        `GitHub never created a "${REQUIRED_CHECK}" run for this head and `
        + `${MAX_CI_RETRIGGERS_PER_PR} recycles did not change that`,
    }
  }

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
    // Same dropped-trigger class as the required check above. The allowlist runs
    // in the same workflow dispatch batch, so when GitHub declines one it has
    // usually declined both, and recycling the PR rebuilds them together.
    if (allowlist === 'absent' && facts.ageMs >= CI_ABSENT_GRACE_MS
      && facts.ciRetriggers < MAX_CI_RETRIGGERS_PER_PR) {
      return {
        ...base,
        action: 'retrigger-ci',
        code: 'ci-absent',
        reason:
          `no agent-allowlist run exists for this head after `
          + `${Math.round(facts.ageMs / 60_000)} min, recycling the PR to make GitHub create one `
          + `(attempt ${facts.ciRetriggers + 1} of ${MAX_CI_RETRIGGERS_PER_PR})`,
      }
    }
    return {
      ...base,
      action: 'wait',
      code: 'allowlist-pending',
      reason: `agent-allowlist has not reported success yet (${allowlist})`,
    }
  }

  // The docs carve-out: a docs-only agent PR merges on the allowlist alone, so
  // a slow `check` does not park a one-line playbook edit for a day. It still
  // cannot merge over a RED `check`; that was handled above.
  //
  // `absent` is excluded on purpose. Branch protection lists `check` as a
  // required context, so a merge attempted while no run exists is one GitHub
  // refuses; the carve-out used to spend all three MAX_MERGE_ATTEMPTS on
  // refusals and then escalate a PR whose only real problem was a missing
  // trigger. Case 3b recycles it instead, and the carve-out applies once a run
  // exists and is merely slow.
  const docsCarveOut = docsOnly && allowlistRequired && ci !== 'absent'
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
  const vercelProblem = await checkVercelCredentials()
  if (vercelProblem) problems.push(vercelProblem)

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

/**
 * Prove the Vercel credentials WORK, not merely that they are set.
 *
 * An invalid VERCEL_TOKEN used to pass the self-check (which only tested
 * presence) and then made listProductionDeployments return [] on every poll, so
 * every merge "timed out waiting for a deploy", failed, and rolled back a
 * perfectly good release. Two of those in a day trip the circuit breaker, which
 * turns a stale token into a self-inflicted engine shutdown plus a rollback of
 * healthy code. A definitive 401/403 from the API is therefore a config error
 * that stops the cycle up front, on the same once-daily owner email path as a
 * dead GitHub token.
 *
 * Any other failure (network blip, 429, 5xx) is transient and reports nothing:
 * failing the self-check on a hiccup would stop releases for an hour at a time.
 *
 * Returns the problem string, or null when the credentials are usable.
 */
export async function checkVercelCredentials(): Promise<string | null> {
  const cfg = vercelConfig()
  if (!cfg) {
    return 'VERCEL_TOKEN / VERCEL_PROJECT_ID are not set, so the deploy poll cannot run'
  }
  const probe = await vercelFetch<unknown>(
    `/v6/deployments?projectId=${encodeURIComponent(cfg.projectId)}&target=production&limit=1${cfg.teamQs}`,
  )
  if (!probe.ok && (probe.status === 401 || probe.status === 403)) {
    return (
      `VERCEL_TOKEN is set but the Vercel API rejects it (HTTP ${probe.status}), `
      + 'so the deploy poll would see no deployments and every merge would falsely roll back'
    )
  }
  return null
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

type EscalationKind = 'protected' | 'attempts' | 'merge-attempts' | 'revert-ci' | 'circuit' | 'ci-stuck'

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
  // The cap bounds MERGES, not vision. This used to return here, which meant a
  // capped engine also stopped classifying, labelling, escalating, autofiling,
  // and undrafting: on 2026-08-04 the cap was hit at 05:30 and a protected-path
  // PR opened later that day got no needs-owner label and no owner email until
  // the next UTC day. Now a capped cycle still lists and evaluates every PR and
  // executes every side action; only the merge itself is withheld.
  const capped = dailyCapReached(mergesToday, cap)

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
  const undraftErrors: string[] = []
  let undrafted = 0
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
    // Undrafting is not a merge and does not consume the one-merge-per-cycle
    // budget: it costs one cheap mutation and only restores the PR to the state
    // its author meant to leave it in. `continue` so the PR is re-read and fully
    // gated on the next cycle rather than merged on stale facts from this one.
    if (decision.action === 'undraft') {
      if (undrafted >= MAX_UNDRAFTS_PER_CYCLE) {
        console.warn(
          `${LOG} undraft cap reached (${MAX_UNDRAFTS_PER_CYCLE}/cycle), PR #${summary.number} waits for the next cycle`,
        )
        continue
      }
      undrafted += 1
      const problem = await undraftOne(summary, dryRun)
      if (problem) undraftErrors.push(problem)
      continue
    }
    // GitHub declined to build a required check, or built one that never ran a
    // step. Neither is a verdict, and until this existed neither had an exit:
    // the PR sat on `wait` every ten minutes until the owner merged it by hand.
    // Recycling costs one cheap mutation, merges nothing, and every gate is
    // re-evaluated from scratch on the next cycle against the real result.
    if (decision.action === 'retrigger-ci') {
      await retriggerChecks(summary, decision, dryRun)
      continue
    }
    if (decision.action === 'escalate-ci') {
      await escalateStuckCi(summary, decision, dryRun)
      continue
    }
    if (decision.code === 'ci-red' && decision.isRevert) {
      await escalateRevertCiFailure(summary, dryRun)
    }
    if (decision.action === 'bounce') {
      await bounceTicket(decision.ticketId, decision.lastError ?? decision.reason, summary, dryRun)
      continue
    }
    // ADR-008 step 2. The single enforcement point for autofile: by the time a
    // decision reads `no-ticket`, every condition the ADR listed as a skip has
    // already been checked by `evaluatePullRequest` above (protected path,
    // draft, needs-owner, the docs carve-out, an existing ticket, red CI). See
    // the table in release-ticket-autofile.server.ts. Filing here does not merge
    // anything now: the ticket lands at `pr_open`, QA reviews it, and the engine
    // reconsiders the PR on a later cycle once it is `verified`.
    if (decision.code === 'no-ticket') {
      await autoFileTicketForPr(summary, dryRun)
      continue
    }
    if (decision.action !== 'merge') continue

    // The daily cap withholds exactly this one action. Every side action above
    // (label, escalate, bounce, autofile, undraft) already ran for this cycle.
    if (capped) {
      console.log(
        `${LOG} daily cap reached (${mergesToday}/${cap}), PR #${summary.number} is merge-ready but waits for the next UTC day`,
      )
      continue
    }

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

  const undraftNote = undrafted > 0 ? `, ${undrafted} taken out of draft` : ''
  const evaluatedNote = `${decisions.length} open PR(s) evaluated, nothing merged${undraftNote}`
  return {
    ...result,
    // A failed undraft is reported rather than swallowed. Silence is what made
    // the original stall invisible, and a backstop that fails quietly is just a
    // slower version of the same bug.
    ...(undraftErrors.length > 0 ? { ok: false, errors: undraftErrors } : {}),
    ...(capped ? { phase: 'daily-cap' as const } : {}),
    decisions,
    message: capped
      ? `daily cap reached (${mergesToday}/${cap}); ${evaluatedNote}`
      : evaluatedNote,
  }
}

/**
 * Take one PR out of draft. Returns null on success, or the problem string when
 * GitHub refused, for the caller to surface on the run result.
 *
 * Failure is never fatal to the cycle: the PR stays a draft and is retried on
 * the next one, exactly as if the backstop did not exist. The realistic failure
 * is a token without `pull_requests: write`, which is worth seeing in the run
 * output rather than discovering a day later through another stalled queue.
 */
async function undraftOne(pr: PullRequestSummary, dryRun: boolean): Promise<string | null> {
  if (dryRun) {
    console.log(`${LOG} [dry-run] would mark PR #${pr.number} (${pr.headRef}) ready for review`)
    return null
  }
  const ready = await markPullRequestReadyForReview(pr.nodeId, 'release-engine')
  if (!ready.ok) {
    const problem = `could not mark PR #${pr.number} ready for review: ${ready.error}`
    console.warn(`${LOG} ${problem}`)
    return problem
  }
  console.log(`${LOG} marked PR #${pr.number} (${pr.headRef}) ready for review, it is gated on the next cycle`)
  return null
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
    title: pr.title,
    ageMs: ageMsFromTimestamp(pr.updatedAt),
    draft: pr.draft,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeableState,
    labels: pr.labels,
    classification,
    changedPaths,
    checks,
    ticket,
    ciRetriggers: Number((await kvGet<number>(KEYS.ciRetrigger(pr.headSha))) ?? 0),
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
    // The wrapper is the sweep's key to the `outOfBandReconcileOnly` edges
    // (pr_open/in_review -> applied; verified -> applied is unfenced). Its
    // transition calls live in ticket-out-of-band-sweep.server.ts, outside
    // this file, so the engine hands it the reconcile declaration ambiently
    // here at the one place the sweep is invoked. Without the wrapper the map
    // itself would 409 those transitions.
    const swept = await runWithOutOfBandReconcile(() => sweepOutOfBandMerges())
    if (swept.applied.length > 0) {
      console.log(`${LOG} out-of-band sweep applied tickets: ${swept.applied.join(', ')}`)
    }
    for (const err of swept.errors) console.warn(`${LOG} sweep: ${err}`)
  } catch (err) {
    // Reconciliation is a bookkeeping nicety; never let it stop a release.
    console.error(`${LOG} out-of-band sweep failed`, err)
  }

  // ADR-008 step 2's companion. `sweepOutOfBandMerges` above recognises work
  // that shipped; this recognises work that was abandoned. Same hourly cadence,
  // same isolation: an auto-filed ticket left parked at `pr_open` is untidy, not
  // urgent, and must never cost a merge.
  try {
    const { dismissTicketsForClosedUnmergedPrs } = await import('~/lib/release-ticket-autofile.server')
    const closed = await dismissTicketsForClosedUnmergedPrs()
    if (closed.dismissed > 0) {
      console.log(`${LOG} abandoned-PR sweep dismissed ${closed.dismissed} auto-filed ticket(s)`)
    }
    for (const err of closed.errors) console.warn(`${LOG} abandoned-PR sweep: ${err}`)
  } catch (err) {
    console.error(`${LOG} abandoned-PR sweep failed`, err)
  }

  // Third pass, same cadence and same isolation: tickets stranded in `approved`
  // or `blocked` whose linked PR already merged. See sweepOrphanedMergedPrTickets.
  try {
    const orphans = await sweepOrphanedMergedPrTickets()
    if (orphans.applied.length > 0) {
      console.log(`${LOG} orphan sweep applied tickets: ${orphans.applied.join(', ')}`)
    }
    for (const err of orphans.errors) console.warn(`${LOG} orphan sweep: ${err}`)
  } catch (err) {
    console.error(`${LOG} orphan sweep failed`, err)
  }
}

/**
 * Statuses the orphan sweep reconciles, complementing the out-of-band sweep's
 * `verified`/`in_review`/`pr_open` (ticket-out-of-band-sweep.server.ts, which
 * this file cannot widen without an owner merge; the two lists must stay
 * disjoint so a ticket is never swept twice in one hour).
 *
 * How a ticket strands here with a merged PR:
 *   - `approved`: a bounce plus a lease expiry returns the row to the
 *     unassigned queue with its PR link intact, then the owner merges the PR
 *     by hand. Tickets #120 and #423 (PRs #436/#429 merged) sat this way.
 *   - `blocked`: the engine blocks a ticket after three attempts, then the
 *     owner fixes and merges the PR himself but never revisits the ticket.
 *     Ticket #455 (PR #508 merged) sat this way.
 *
 * `in_progress` stays excluded for the same reason it is excluded over there:
 * an active lease means an agent is mid-edit and a link may be a superseded
 * attempt.
 */
export const ORPHAN_SWEEP_STATUSES: readonly TicketStatus[] = ['approved', 'blocked']

/** Tickets checked per sweep. Bounds the GitHub calls one cycle can make. */
export const ORPHAN_SWEEP_MAX_TICKETS = 5

/** Grace period so the sweep never races a transition that is mid-flight. */
const ORPHAN_SWEEP_MIN_AGE_MS = 60 * 60_000

/**
 * Reconcile `approved`/`blocked` tickets whose most recent PR link points at a
 * PR GitHub reports as merged, using the two out-of-band `-> applied` system
 * edges added for exactly this. Identical safety shape to the main sweep: only
 * `merged: true` from GitHub itself moves a ticket, a 409 means the row moved
 * first and is ignored, and nothing here can mark unmerged work as shipped.
 *
 * Both edges are `outOfBandReconcileOnly` in the transition map, so they open
 * only to a call that passes `viaOutOfBandReconcile` (this sweep, after the
 * merged check) or runs inside `runWithOutOfBandReconcile`. A plain
 * `transitionSuggestion(id, 'applied', 'system')` from anywhere else, present
 * or future, is a 409 at the map.
 */
export async function sweepOrphanedMergedPrTickets(
  limit = ORPHAN_SWEEP_MAX_TICKETS,
): Promise<{ checked: number; applied: number[]; errors: string[] }> {
  const out = { checked: 0, applied: [] as number[], errors: [] as string[] }
  const cutoff = new Date(Date.now() - ORPHAN_SWEEP_MIN_AGE_MS)

  let rows: Array<{ ticketId: number; status: string; ref: string }> = []
  try {
    rows = await db
      .select({
        ticketId: homepageTeamSuggestions.id,
        status: homepageTeamSuggestions.status,
        ref: suggestionLinks.ref,
      })
      .from(homepageTeamSuggestions)
      .innerJoin(suggestionLinks, eq(suggestionLinks.suggestionId, homepageTeamSuggestions.id))
      .where(and(
        inArray(homepageTeamSuggestions.status, [...ORPHAN_SWEEP_STATUSES]),
        eq(suggestionLinks.kind, 'pr'),
        lt(homepageTeamSuggestions.updatedAt, cutoff),
      ))
      // Oldest ticket first; within a ticket the newest link is the live claim.
      .orderBy(homepageTeamSuggestions.updatedAt, desc(suggestionLinks.createdAt))
  } catch (err) {
    out.errors.push(`orphan candidate query failed: ${String(err)}`)
    return out
  }

  const seen = new Set<number>()
  for (const row of rows) {
    if (out.checked >= limit) break
    if (seen.has(row.ticketId)) continue
    seen.add(row.ticketId)
    const prNumber = prNumberFromRef(row.ref)
    if (prNumber === null) continue
    out.checked += 1

    try {
      const pr = await getPullRequest(prNumber, 'release-engine')
      if (!pr.ok || !pr.data) {
        out.errors.push(`ticket #${row.ticketId}: PR #${prNumber}: ${pr.ok ? 'no data' : pr.error}`)
        continue
      }
      if (pr.data.merged !== true) continue

      // `viaOutOfBandReconcile` is what unlocks the fenced approved/blocked
      // `-> applied` edges, and this call has earned it: the `merged: true`
      // check above is the precondition the flag declares.
      await transitionSuggestion(row.ticketId, 'applied', 'system', {
        note: `merged out-of-band while '${row.status}' (PR #${prNumber} was already merged when the engine reconciled it)`,
        links: [{ kind: 'pr', ref: pr.data.htmlUrl, state: 'merged' }],
        viaOutOfBandReconcile: true,
      })
      out.applied.push(row.ticketId)
      console.log(`${LOG} orphan ticket #${row.ticketId} (${row.status}) applied: PR #${prNumber} merged out of band`)
    } catch (err) {
      // A 409 is normal: the row moved between the query and the transition.
      const msg = err instanceof Response ? `${err.status}` : String(err)
      if (msg.includes('409')) continue
      out.errors.push(`ticket #${row.ticketId}: ${msg}`)
    }
  }
  return out
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

/**
 * Make GitHub produce a check it did not produce.
 *
 * Two mechanisms, chosen by what is actually wrong:
 *   - a run exists but concluded without executing (`ci-no-verdict`): re-run its
 *     failed jobs, which keeps the same run and the same head;
 *   - no run exists at all (`ci-absent`): close and reopen the PR, which is the
 *     only thing that reliably makes GitHub dispatch `pull_request` workflows it
 *     skipped the first time.
 *
 * The counter is incremented before the mutation, not after. If the mutation
 * throws or the function is killed mid-flight, the attempt is still spent, so a
 * pathological PR converges on the escalation instead of recycling forever.
 */
async function retriggerChecks(
  pr: PullRequestSummary,
  decision: ReleaseDecision,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    console.log(`${LOG} [dry-run] would re-trigger checks on PR #${pr.number}: ${decision.reason}`)
    return
  }
  const attempts = await kvIncr(KEYS.ciRetrigger(pr.headSha))
  console.log(`${LOG} re-triggering checks on PR #${pr.number} (attempt ${attempts}): ${decision.reason}`)

  if (decision.code === 'ci-no-verdict') {
    const runs = await listWorkflowRunsForSha(pr.headSha, 'release-engine')
    if (!runs.ok) {
      console.warn(`${LOG} cannot list workflow runs for PR #${pr.number}: ${runs.error}`)
      return
    }
    const stalled = runs.data.filter((r) =>
      r.status === 'completed' && r.conclusion !== null && NO_VERDICT_CONCLUSIONS.has(r.conclusion),
    )
    if (stalled.length === 0) {
      console.warn(`${LOG} PR #${pr.number} reported a no-verdict check but no matching run was found`)
      return
    }
    for (const run of stalled) {
      const res = await rerunFailedJobs(run.id, 'release-engine')
      if (!res.ok) console.warn(`${LOG} rerun of run ${run.id} failed: ${res.error}`)
    }
    return
  }

  const recycled = await recyclePullRequest(pr.number, 'release-engine')
  if (!recycled.ok) {
    console.warn(`${LOG} recycle of PR #${pr.number} failed: ${recycled.error}`)
  }
}

/**
 * The re-trigger budget is spent and GitHub still will not produce a verdict.
 *
 * This is the one case the engine genuinely cannot resolve, so it does what it
 * does for a protected path: labels the PR and tells the owner once. The point
 * is that a PR is never again stuck silently. Before this, `wait / ci-pending`
 * was written only to a Vercel function log that nothing reads.
 */
async function escalateStuckCi(
  pr: PullRequestSummary,
  decision: ReleaseDecision,
  dryRun: boolean,
): Promise<void> {
  if (!dryRun && !pr.labels.includes(NEEDS_OWNER_LABEL)) {
    const labelled = await addLabels(pr.number, [NEEDS_OWNER_LABEL], 'release-engine')
    if (!labelled.ok) console.warn(`${LOG} could not label PR #${pr.number}: ${labelled.error}`)
  }
  if (!dryRun && decision.ticketId !== null) {
    await addTicketLink(decision.ticketId, { kind: 'pr', ref: pr.htmlUrl, state: 'needs-owner' })
  }
  await escalate(
    'ci-stuck',
    KEYS.escalated(pr.number),
    `[xdipx] PR #${pr.number} needs you: CI will not report`,
    emailShell(
      'GitHub will not produce a required check, so the release engine stopped',
      [
        ['PR', `#${pr.number} ${pr.title}`],
        ['Branch', pr.headRef],
        ['Head', pr.headSha.slice(0, 8)],
        ['Detail', decision.reason],
      ],
      `<p>The engine re-triggered the checks ${MAX_CI_RETRIGGERS_PER_PR} times and GitHub still reported no verdict. This is a GitHub Actions problem, not a problem with the diff.</p>
<p>Re-run the checks from the PR page, or merge it yourself if you are satisfied it is right: <a href="${escapeHtml(pr.htmlUrl)}">${escapeHtml(pr.htmlUrl)}</a></p>`,
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
