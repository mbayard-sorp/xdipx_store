/**
 * Owner escalation for a red main.
 *
 * `.github/workflows/ci.yml` runs the `check` job (typecheck, test, build) on
 * pushes to main as well as on pull requests, so main finally has a verdict of
 * its own. A verdict nobody reads is not an alarm, though: GitHub's built-in
 * default-branch failure email goes to whoever pushed, which for a squash merge
 * performed by automation is not reliably a human who will act. This module is
 * the escalation, on the same Zoho owner-alert channel the release engine and
 * the checkout probe already use.
 *
 * WHY THIS IS NOT PART OF THE RELEASE ENGINE, even though the engine already
 * has escalate(), dedupe, and an email shell:
 *
 *   1. The engine is behind the `release_engine_enabled` kill switch. An alarm
 *      must not share a kill switch with the thing it watches. The moment the
 *      owner pauses automation is exactly the moment a broken main most needs
 *      to be shouted about, and the engine, being paused, would say nothing.
 *   2. `app/lib/release-engine.server.ts` is a protected path because it is the
 *      most safety-critical file in the repo. A read-only watcher does not need
 *      to be inside it, so it is not.
 *
 * WHY IT POLLS GITHUB RATHER THAN BEING A FAILURE STEP IN THE WORKFLOW:
 * a `if: failure()` notify step only fires when the job runs and reaches that
 * step. It reports nothing when the run is cancelled by a superseded
 * concurrency group, when a hosted runner is never acquired, or when GitHub
 * declines to create the run at all (which this repo has seen: the release
 * engine carries MAX_CI_RETRIGGERS_PER_PR precisely because of it). Reading the
 * recorded conclusion after the fact catches all four states, including the
 * quietest and most dangerous one, "there is no verdict and nobody noticed".
 *
 * Everything here is read-only against GitHub. It sends email; it never merges,
 * reverts, re-runs, or writes to a branch.
 */

import { getRef, getChecksForRef, listWorkflowRunsForSha, getCommit } from '~/lib/github.server'
import { kvGet, kvSet, kvDel, kvSetNX } from '~/lib/kv.server'
import { sendOwnerEmail, escapeHtml } from '~/lib/owner-alerts.server'

const LOG = '[main-ci-watch]'

/** The required CI check, from .github/workflows/ci.yml (job id `check`). */
export const MAIN_CHECK = 'check'

/**
 * Conclusions that mean the job ran and did not pass. Mirrors the release
 * engine's list minus the two below, which are handled separately because they
 * mean something different.
 */
export const RED_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required', 'startup_failure'])

/**
 * Conclusions where no typecheck, test, or build step actually executed.
 *
 * GitHub reports both a superseded concurrency group and a hosted-runner
 * capacity failure as `cancelled`. Reading that as "main is red" is as wrong as
 * reading it as "main is green"; the honest state is that this commit has no
 * coverage. On main that is its own alert, because unlike a PR there is nothing
 * downstream that will notice and re-run it.
 *
 * ci.yml sets `cancel-in-progress` false for push events specifically so this
 * stays rare. If it starts firing, that setting has regressed.
 */
export const NO_VERDICT_CONCLUSIONS = new Set(['cancelled', 'stale'])

/**
 * Conclusions that are not a pass but are not a problem either. `check` should
 * never report these on main; they are listed so an unexpected one is treated
 * as benign rather than paging the owner at 3am over a semantic we did not
 * anticipate.
 */
const BENIGN_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])

/**
 * How long a main commit may sit with no `check` run before that silence is
 * itself the alert.
 *
 * Deliberately longer than one cron cycle plus a normal Actions queue wait, so
 * a merely slow run is never reported as a missing one. Matches the release
 * engine's CI_ABSENT_GRACE_MS for the same reason.
 */
export const MAIN_CI_ABSENT_GRACE_MS = 20 * 60_000

const KEY_ALERTED = 'main-ci-watch:alerted-sha'
const alertDedupeKey = (sha: string, code: string) => `main-ci-watch:alert:${sha}:${code}`

/** Everything the decision needs, so the decision itself does no I/O. */
export interface MainCiFacts {
  sha: string
  /** Conclusion of the `check` check, or null when it has not reported. */
  conclusion: string | null
  /** queued | in_progress | completed, or null when the check is absent. */
  status: string | null
  /** Whether GitHub created ANY workflow run for this sha. */
  runExists: boolean
  /** Age of the head commit. Only consulted when nothing has reported yet. */
  ageMs: number
  /** The sha of the last commit we alerted about, from KV. */
  alertedSha: string | null
}

export type MainCiAction = 'quiet' | 'alert' | 'recover'
export type MainCiCode = 'green' | 'pending' | 'red' | 'no-verdict' | 'missing' | 'recovered'

export interface MainCiDecision {
  action: MainCiAction
  code: MainCiCode
  reason: string
}

/**
 * Pure decision. Ordered most-certain first: a reported conclusion always beats
 * an inference drawn from silence.
 */
export function decideMainCi(facts: MainCiFacts): MainCiDecision {
  const { conclusion, status, runExists, ageMs, alertedSha } = facts

  if (conclusion !== null && BENIGN_CONCLUSIONS.has(conclusion)) {
    // An outstanding alert clears on the first green, whether that green came
    // from a fix commit or from a re-run of the same one. An alarm that never
    // says "resolved" teaches you to ignore it.
    if (alertedSha) {
      return { action: 'recover', code: 'recovered', reason: `check ${conclusion}; clearing alert for ${alertedSha.slice(0, 8)}` }
    }
    return { action: 'quiet', code: 'green', reason: `check ${conclusion}` }
  }

  if (conclusion !== null && RED_CONCLUSIONS.has(conclusion)) {
    return { action: 'alert', code: 'red', reason: `check concluded ${conclusion}` }
  }

  if (conclusion !== null && NO_VERDICT_CONCLUSIONS.has(conclusion)) {
    return { action: 'alert', code: 'no-verdict', reason: `check concluded ${conclusion}, so no step actually ran` }
  }

  if (conclusion !== null) {
    // Unknown conclusion. Say so rather than guessing in either direction.
    return { action: 'alert', code: 'no-verdict', reason: `check reported an unrecognised conclusion: ${conclusion}` }
  }

  // Nothing has concluded. Distinguish "still running" from "never created".
  if (status === 'queued' || status === 'in_progress') {
    return { action: 'quiet', code: 'pending', reason: `check is ${status}` }
  }

  if (ageMs < MAIN_CI_ABSENT_GRACE_MS) {
    return { action: 'quiet', code: 'pending', reason: 'commit is younger than the grace window' }
  }

  if (!runExists) {
    return {
      action: 'alert',
      code: 'missing',
      reason: `no workflow run exists for this commit after ${Math.round(ageMs / 60_000)} minutes`,
    }
  }

  return {
    action: 'alert',
    code: 'missing',
    reason: `workflow runs exist but ${MAIN_CHECK} never reported after ${Math.round(ageMs / 60_000)} minutes`,
  }
}

export interface MainCiWatchResult {
  ok: boolean
  sha?: string
  action?: MainCiAction
  code?: MainCiCode
  reason?: string
  emailed?: boolean
  /** Set when the run could not reach a decision at all. */
  error?: string
}

const SUBJECTS: Record<string, (sha: string) => string> = {
  red: (sha) => `[xdipx] main is RED: ${MAIN_CHECK} failed on ${sha.slice(0, 8)}`,
  'no-verdict': (sha) => `[xdipx] main has NO CI VERDICT on ${sha.slice(0, 8)}`,
  missing: (sha) => `[xdipx] main has NO CI RUN on ${sha.slice(0, 8)}`,
  recovered: (sha) => `[xdipx] main is green again as of ${sha.slice(0, 8)}`,
}

/**
 * Banner prepended in probe mode. Everything BELOW it is byte-identical to a
 * real alert on purpose: the point of a probe is to see what production would
 * actually send, so the marker is additive and never rewrites the content
 * being verified.
 */
const PROBE_BANNER =
  '<div style="background:#FFE6DD;border:1px solid #FF5A36;border-radius:8px;padding:10px 12px;margin:0 0 16px;font-size:13px;">'
  + '<strong>PROBE, not a real alert.</strong> main is fine. This was triggered deliberately against a historical commit '
  + 'to verify that the alert email renders. Everything below is exactly what a genuine alert would say.'
  + '</div>'

/** Exported so the body can be asserted in tests and previewed before a send. */
export function renderMainCiAlert(
  code: MainCiCode,
  sha: string,
  reason: string,
  commitMessage: string | null,
  runUrl: string | null,
  probe = false,
): string {
  const subjectLine = (commitMessage ?? '').split('\n')[0] ?? ''
  const rows: Array<[string, string]> = [
    ['commit', sha.slice(0, 8)],
    ['reason', reason],
  ]
  if (subjectLine) rows.push(['message', subjectLine])

  const guidance =
    code === 'recovered'
      ? 'No action needed. Recording it so the previous alert has a visible end.'
      : code === 'red'
        ? 'main does not build or test clean. Every deploy from main carries this. Revert the offending merge or push a fix.'
        : code === 'no-verdict'
          ? `The run was cancelled or went stale, so no typecheck, test, or build step actually executed. This commit has no coverage. Re-run the workflow. If it recurs, check that cancel-in-progress is still false for push events in ci.yml.`
          : 'GitHub never produced a check for this commit, so main is unverified. Re-run the workflow from the Actions tab.'

  const link = runUrl
    ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(runUrl)}">View the run</a></p>`
    : ''

  const table = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6B5F68;">${escapeHtml(k)}</td><td style="padding:4px 0;"><strong>${escapeHtml(v)}</strong></td></tr>`,
    )
    .join('')

  return `<div style="font-family:system-ui,sans-serif;color:#1A1418;max-width:640px;">
${probe ? PROBE_BANNER : ''}<h2 style="margin:0 0 12px;">${escapeHtml(SUBJECTS[code]?.(sha) ?? `main CI: ${code}`)}</h2>
<table style="border-collapse:collapse;font-size:14px;">${table}</table>
<div style="margin-top:16px;font-size:14px;line-height:1.5;">${escapeHtml(guidance)}</div>
${link}
</div>`
}

/**
 * One pass: read main's head, read its `check` verdict, decide, and escalate.
 *
 * Non-throwing by contract like the other owner-alert call sites, so a GitHub
 * hiccup degrades to a logged no-op rather than a 500 on a cron route.
 */
/**
 * `sha` evaluates an arbitrary commit instead of main's head.
 *
 * This exists so the alert path can be exercised without breaking main, which
 * is the only other way to see a real alert and is obviously unacceptable: a
 * red main deploys to production. Point it at a historically red commit and the
 * whole path runs on real data (real conclusion, real commit message, real
 * render, real send), with only "which commit are we looking at" substituted.
 *
 * A probe is deliberately state-free. It never reads or writes the alerted-sha
 * key, so it cannot emit a `recover`, and more importantly cannot leave a
 * dangling alert that makes the NEXT real green send a spurious "main is green
 * again" email. Per-sha dedupe still applies, so a stuck retry loop cannot mail
 * repeatedly.
 */
export async function runMainCiWatch(
  opts: { dryRun?: boolean | undefined; sha?: string | undefined } = {},
): Promise<MainCiWatchResult> {
  const dryRun = opts.dryRun ?? false
  const probeSha = opts.sha?.trim() || null

  let sha: string
  if (probeSha) {
    sha = probeSha
  } else {
    const ref = await getRef('heads/main', 'main-ci-watch')
    if (!ref.ok) {
      console.warn(`${LOG} could not read main: ${ref.error}`)
      return { ok: false, error: `could not read main: ${ref.error}` }
    }
    sha = ref.data.sha
  }

  const checks = await getChecksForRef(sha, 'main-ci-watch')
  if (!checks.ok) {
    console.warn(`${LOG} could not read checks for ${sha}: ${checks.error}`)
    return { ok: false, sha, error: `could not read checks: ${checks.error}` }
  }

  const check = checks.data.checks.find((c) => c.name === MAIN_CHECK) ?? null

  // Only consulted when nothing has reported, so it is not worth a request in
  // the common green case.
  let runExists = true
  let ageMs = 0
  if (check?.conclusion == null) {
    const commit = await getCommit(sha, 'main-ci-watch')
    // A commit read that fails leaves ageMs at 0, which keeps us inside the
    // grace window and stays quiet. Silence is the safe default for an
    // inference drawn from missing data.
    if (commit.ok) {
      const runs = await listWorkflowRunsForSha(sha, 'main-ci-watch')
      runExists = runs.ok ? runs.data.length > 0 : true
    }
    const pushedAt = await kvGet<number>(`main-ci-watch:first-seen:${sha}`)
    const now = Date.now()
    if (pushedAt == null) {
      // First sighting. Start the clock rather than guessing the push time from
      // the commit's author date, which a rebase or an old branch can make
      // arbitrarily stale and would fire `missing` instantly.
      await kvSet(`main-ci-watch:first-seen:${sha}`, now, 7 * 24 * 3600)
      ageMs = 0
    } else {
      ageMs = now - pushedAt
    }
  }

  // A probe passes null so it can never resolve to `recover`, and so it never
  // reads state it is not entitled to act on.
  const alertedSha = probeSha ? null : await kvGet<string>(KEY_ALERTED)

  const decision = decideMainCi({
    sha,
    conclusion: check?.conclusion ?? null,
    status: check?.status ?? null,
    runExists,
    ageMs,
    alertedSha: alertedSha ?? null,
  })

  const base: MainCiWatchResult = { ok: true, sha, action: decision.action, code: decision.code, reason: decision.reason }

  if (decision.action === 'quiet') {
    console.log(`${LOG} ${sha.slice(0, 8)} ${decision.code}: ${decision.reason}`)
    return { ...base, emailed: false }
  }

  if (dryRun) {
    console.log(`${LOG} [dry-run] would ${decision.action} (${decision.code}) for ${sha.slice(0, 8)}: ${decision.reason}`)
    return { ...base, emailed: false }
  }

  if (decision.action === 'recover') {
    const commit = await getCommit(sha, 'main-ci-watch')
    const res = await sendOwnerEmail(
      SUBJECTS['recovered']!(sha),
      renderMainCiAlert('recovered', sha, decision.reason, commit.ok ? commit.data.message : null, check?.url ?? null),
      { escalation: 'ci-red-main', fromName: 'xdipx main ci' },
    )
    // Clear regardless of whether the email left the building. A send failure
    // must not wedge the watcher into re-sending a recovery notice every cycle
    // forever; the red alert it refers to was already delivered.
    await kvDel(KEY_ALERTED)
    if (!res.sent) console.warn(`${LOG} recovery email not sent: ${res.error}`)
    return { ...base, emailed: res.sent }
  }

  // One email per commit per code, for a week. A main that stays red for days
  // is one email, not one every ten minutes; a second failing commit is new
  // information and does send again.
  const first = await kvSetNX(alertDedupeKey(sha, decision.code), String(Date.now()), 7 * 24 * 3600)
  if (!first) {
    console.log(`${LOG} alert (${decision.code}) already sent for ${sha.slice(0, 8)}, not re-sending`)
    return { ...base, emailed: false }
  }

  const commit = await getCommit(sha, 'main-ci-watch')
  const baseSubject = SUBJECTS[decision.code]?.(sha) ?? `[xdipx] main CI: ${decision.code} on ${sha.slice(0, 8)}`
  const res = await sendOwnerEmail(
    probeSha ? `[PROBE] ${baseSubject}` : baseSubject,
    renderMainCiAlert(
      decision.code,
      sha,
      decision.reason,
      commit.ok ? commit.data.message : null,
      check?.url ?? null,
      Boolean(probeSha),
    ),
    { escalation: 'ci-red-main', fromName: 'xdipx main ci' },
  )
  if (!res.sent) console.warn(`${LOG} alert email not sent: ${res.error}`)

  // Remember the alert so the next green can close the loop. Written even when
  // the send failed: the condition is real either way, and a later "green
  // again" is still the correct thing to report.
  //
  // Never written for a probe. Doing so would arm a "main is green again"
  // email against a commit that was never main, and the next real green cycle
  // would send it.
  if (!probeSha) await kvSet(KEY_ALERTED, sha, 30 * 24 * 3600)

  return { ...base, emailed: res.sent }
}
