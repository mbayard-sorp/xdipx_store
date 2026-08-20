/**
 * Shared GitHub REST client for server-side callers (Vercel functions and crons).
 *
 * Why this exists: cloud agent routines can only reach xdipx.com, so every
 * GitHub call has to happen server-side and be exposed through the team API.
 * Three modules already hand-rolled the same raw-REST block (log-monitor,
 * homepage-healthcheck, notebook-healthcheck), each with its own copy of the
 * headers, the JSON handling, and the warn-and-skip-when-env-missing contract.
 * This module is the single implementation of that contract plus the focused
 * helpers the release engine needs (PR read, changed files, checks, preview
 * URL, squash merge, label, Git Data revert branch).
 *
 * The three existing callers are deliberately NOT refactored here. That is a
 * riskier change with its own blast radius and belongs in a separate PR.
 *
 * Contract, matching what the existing callers do today:
 *   - Missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO is not an exception.
 *     Every helper returns `{ ok: false, skipped: true }` and logs one warning,
 *     so a cron in a half-configured environment degrades instead of paging.
 *   - Non-2xx is returned as `{ ok: false, skipped: false, status, error }`.
 *     Callers decide what is fatal; nothing here throws on an HTTP error.
 */

const API_BASE = 'https://api.github.com'
const TIMEOUT_MS = 20_000
/** GitHub caps `pulls/{n}/files` at 3000 entries; 100 per page, 30 pages max. */
const MAX_FILE_PAGES = 30

export interface GithubConfig {
  token: string
  owner: string
  repo: string
}

export type GithubResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: null; error: string; skipped: boolean }

function err(status: number, error: string, skipped = false): GithubResult<never> {
  return { ok: false, status, data: null, error, skipped }
}

/**
 * Resolve credentials, warning once per call site when they are absent.
 * `context` is the log prefix so a skip is attributable (e.g. 'release-engine').
 */
export function getGithubConfig(context = 'github'): GithubConfig | null {
  const token = process.env['GITHUB_TOKEN']
  const owner = process.env['GITHUB_OWNER']
  const repo = process.env['GITHUB_REPO']
  if (!token || !owner || !repo) {
    console.warn(`[${context}] GITHUB_TOKEN/OWNER/REPO not set, skipping GitHub call`)
    return null
  }
  return { token, owner, repo }
}

export function isGithubConfigured(): boolean {
  return Boolean(process.env['GITHUB_TOKEN'] && process.env['GITHUB_OWNER'] && process.env['GITHUB_REPO'])
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'xdipx-release-engine',
  }
}

export interface GithubRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Log prefix used for the missing-env warning. */
  context?: string
}

/**
 * Low-level request. `path` is either an absolute URL or a path relative to the
 * API root; `{owner}` / `{repo}` placeholders are filled from env so callers do
 * not each re-interpolate the slug.
 */
export async function githubRequest<T>(path: string, opts: GithubRequestOptions = {}): Promise<GithubResult<T>> {
  const cfg = getGithubConfig(opts.context ?? 'github')
  if (!cfg) return err(0, 'GITHUB_TOKEN/OWNER/REPO not set', true)

  const resolved = path
    .replace('{owner}', cfg.owner)
    .replace('{repo}', cfg.repo)
  const url = resolved.startsWith('http') ? resolved : `${API_BASE}${resolved.startsWith('/') ? '' : '/'}${resolved}`

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: githubHeaders(cfg.token),
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) {
      return err(res.status, `GitHub ${opts.method ?? 'GET'} ${resolved} -> ${res.status}: ${text.slice(0, 400)}`)
    }
    const data = text.length === 0 ? ({} as T) : (JSON.parse(text) as T)
    return { ok: true, status: res.status, data }
  } catch (e) {
    return err(0, `GitHub ${resolved} failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

export interface PullRequestSummary {
  number: number
  title: string
  state: string
  /** GraphQL global node id. Empty string when the REST payload omitted it.
   *  Required by `markPullRequestReadyForReview`, which has no REST equivalent. */
  nodeId: string
  draft: boolean
  merged: boolean
  /** null while GitHub is still computing the merge commit. */
  mergeable: boolean | null
  /** 'clean' | 'blocked' | 'dirty' | 'behind' | 'unstable' | 'unknown' | ... */
  mergeableState: string
  headSha: string
  headRef: string
  baseRef: string
  htmlUrl: string
  labels: string[]
  body: string
  user: string
  updatedAt: string
}

interface RawPull {
  number: number
  title: string
  state: string
  node_id?: string
  draft?: boolean
  merged?: boolean
  mergeable?: boolean | null
  mergeable_state?: string
  head: { sha: string; ref: string }
  base: { ref: string }
  html_url: string
  labels?: Array<{ name: string }>
  body?: string | null
  user?: { login?: string } | null
  updated_at?: string
}

function toSummary(p: RawPull): PullRequestSummary {
  return {
    number: p.number,
    title: p.title,
    state: p.state,
    nodeId: p.node_id ?? '',
    draft: p.draft ?? false,
    merged: p.merged ?? false,
    mergeable: p.mergeable ?? null,
    mergeableState: p.mergeable_state ?? 'unknown',
    headSha: p.head.sha,
    headRef: p.head.ref,
    baseRef: p.base.ref,
    htmlUrl: p.html_url,
    labels: (p.labels ?? []).map((l) => l.name),
    body: p.body ?? '',
    user: p.user?.login ?? '',
    updatedAt: p.updated_at ?? '',
  }
}

export async function getPullRequest(number: number, context = 'github'): Promise<GithubResult<PullRequestSummary>> {
  const res = await githubRequest<RawPull>(`/repos/{owner}/{repo}/pulls/${number}`, { context })
  if (!res.ok) return res
  return { ok: true, status: res.status, data: toSummary(res.data) }
}

/** Open PRs, newest first, optionally filtered to head refs with a given prefix. */
export async function listOpenPullRequests(
  opts: { headPrefixes?: string[]; context?: string } = {},
): Promise<GithubResult<PullRequestSummary[]>> {
  const res = await githubRequest<RawPull[]>(
    '/repos/{owner}/{repo}/pulls?state=open&per_page=100&sort=created&direction=asc',
    { context: opts.context ?? 'github' },
  )
  if (!res.ok) return res
  const all = res.data.map(toSummary)
  const prefixes = opts.headPrefixes
  const data = prefixes && prefixes.length > 0 ? all.filter((p) => prefixes.some((pre) => p.headRef.startsWith(pre))) : all
  return { ok: true, status: res.status, data }
}

// A type alias rather than an interface so it satisfies the index signature on
// ChangedFileInput (interfaces have no implicit index signature).
export type ChangedFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  previousFilename?: string
}

/** Statuses GitHub is known to return transiently on `pulls/{n}/files` while it
 *  is still computing the diff for that PR, distinct from a real 404 (PR does
 *  not exist / no access) or a real client error. Retrying these is safe.
 *  Retrying 401/403/422 is not: it would just spin on a real permission or
 *  request problem and delay surfacing it. */
const RETRYABLE_FILES_STATUSES = new Set([404, 502, 503, 504])
const FILES_RETRY_ATTEMPTS = 3
const FILES_RETRY_DELAY_MS = [500, 1500]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Every changed file on a PR, paginated. This list is the ONLY input the
 *  protected-path classifier is allowed to see.
 *
 * `pulls/{n}/files` computes the diff lazily and can 404 (occasionally 502)
 * for a PR that unambiguously exists and that `getPullRequest` on the very
 * same number just answered 200 for, because GitHub has not finished the
 * diff yet. That is a different failure than a real 404 (deleted/renamed/no access),
 * which every other endpoint on this PR would also be 404ing for. So each
 * page retries a bounded, short number of times on the known-transient
 * statuses before giving up and returning the upstream error as-is. */
export async function listPullRequestFiles(number: number, context = 'github'): Promise<GithubResult<ChangedFile[]>> {
  const out: ChangedFile[] = []
  let status = 200
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    let res: GithubResult<Array<{
      filename: string
      status: string
      additions?: number
      deletions?: number
      previous_filename?: string
    }>> | null = null
    for (let attempt = 0; attempt < FILES_RETRY_ATTEMPTS; attempt++) {
      res = await githubRequest<Array<{
        filename: string
        status: string
        additions?: number
        deletions?: number
        previous_filename?: string
      }>>(`/repos/{owner}/{repo}/pulls/${number}/files?per_page=100&page=${page}`, { context })
      if (res.ok || !RETRYABLE_FILES_STATUSES.has(res.status)) break
      const delay = FILES_RETRY_DELAY_MS[attempt]
      if (delay === undefined) break
      console.warn(
        `[${context}] pulls/${number}/files page ${page} -> ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${FILES_RETRY_ATTEMPTS})`,
      )
      await sleep(delay)
    }
    if (!res || !res.ok) return res ?? err(0, `pulls/${number}/files: no response`)
    status = res.status
    for (const f of res.data) {
      out.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        ...(f.previous_filename ? { previousFilename: f.previous_filename } : {}),
      })
    }
    if (res.data.length < 100) break
  }
  return { ok: true, status, data: out }
}

// ---------------------------------------------------------------------------
// Checks (check-runs + legacy commit statuses, which is where Vercel reports)
// ---------------------------------------------------------------------------

export interface CheckSummary {
  name: string
  source: 'check_run' | 'status'
  /** check-runs: queued | in_progress | completed. statuses: mapped the same way. */
  status: string
  /** success | failure | neutral | cancelled | timed_out | action_required | skipped | null while pending */
  conclusion: string | null
  url: string | null
}

export interface ChecksReport {
  ref: string
  checks: CheckSummary[]
  pending: string[]
  failing: string[]
  succeeded: string[]
  /** At least one check, none pending, none failing. Never true on an empty set:
   *  "no checks reported" must not read as "all checks passed". */
  allGreen: boolean
}

const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'])

/** Check-runs and commit statuses for a ref, merged and deduped by name.
 *  Re-runs report the same name repeatedly; the most recent entry wins. */
export async function getChecksForRef(sha: string, context = 'github'): Promise<GithubResult<ChecksReport>> {
  const runs = await githubRequest<{
    check_runs?: Array<{
      name: string
      status: string
      conclusion: string | null
      html_url?: string | null
      started_at?: string
      completed_at?: string | null
    }>
  }>(`/repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`, { context })
  if (!runs.ok) return runs

  const statuses = await githubRequest<{
    statuses?: Array<{ context: string; state: string; target_url?: string | null; updated_at?: string }>
  }>(`/repos/{owner}/{repo}/commits/${sha}/status?per_page=100`, { context })
  if (!statuses.ok) return statuses

  const byName = new Map<string, { at: string; check: CheckSummary }>()
  const put = (at: string, check: CheckSummary) => {
    const prev = byName.get(check.name)
    if (!prev || prev.at <= at) byName.set(check.name, { at, check })
  }

  for (const r of runs.data.check_runs ?? []) {
    put(r.completed_at ?? r.started_at ?? '', {
      name: r.name,
      source: 'check_run',
      status: r.status,
      conclusion: r.conclusion,
      url: r.html_url ?? null,
    })
  }
  for (const s of statuses.data.statuses ?? []) {
    // pending -> in_progress with a null conclusion, so both sources read alike.
    const pending = s.state === 'pending'
    put(s.updated_at ?? '', {
      name: s.context,
      source: 'status',
      status: pending ? 'in_progress' : 'completed',
      conclusion: pending ? null : s.state === 'success' ? 'success' : 'failure',
      url: s.target_url ?? null,
    })
  }

  const checks = [...byName.values()].map((v) => v.check).sort((a, b) => a.name.localeCompare(b.name))
  const pending = checks.filter((c) => c.status !== 'completed' || c.conclusion === null).map((c) => c.name)
  const failing = checks.filter((c) => c.conclusion !== null && FAILING_CONCLUSIONS.has(c.conclusion)).map((c) => c.name)
  const succeeded = checks.filter((c) => c.conclusion === 'success').map((c) => c.name)

  return {
    ok: true,
    status: 200,
    data: {
      ref: sha,
      checks,
      pending,
      failing,
      succeeded,
      allGreen: checks.length > 0 && pending.length === 0 && failing.length === 0,
    },
  }
}

/** Conclusion of one named check, or null when it has not reported at all. */
export function checkConclusion(report: ChecksReport, name: string): string | null {
  return report.checks.find((c) => c.name === name)?.conclusion ?? null
}

// ---------------------------------------------------------------------------
// Vercel preview URL discovery (via GitHub, since that is what we can read)
// ---------------------------------------------------------------------------

function isPreviewHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.vercel.app')
  } catch {
    return false
  }
}

/**
 * The preview deployment URL for a commit. Prefers GitHub Deployments
 * (`environment_url` is the real preview origin) and falls back to any commit
 * status whose target points at a *.vercel.app host. Vercel's status target_url
 * is often the vercel.com inspector, which is useless to fetch, hence the host
 * filter rather than "first status wins".
 */
export async function findPreviewUrl(sha: string, context = 'github'): Promise<GithubResult<string | null>> {
  const deployments = await githubRequest<Array<{ id: number; environment?: string }>>(
    `/repos/{owner}/{repo}/deployments?sha=${encodeURIComponent(sha)}&per_page=20`,
    { context },
  )
  if (deployments.ok) {
    for (const d of deployments.data) {
      const st = await githubRequest<Array<{ state: string; environment_url?: string | null; target_url?: string | null }>>(
        `/repos/{owner}/{repo}/deployments/${d.id}/statuses?per_page=20`,
        { context },
      )
      if (!st.ok) continue
      const ready = st.data.find((s) => s.state === 'success' && s.environment_url && isPreviewHost(s.environment_url))
      if (ready?.environment_url) return { ok: true, status: 200, data: ready.environment_url.replace(/\/+$/, '') }
      const any = st.data.find((s) => s.environment_url && isPreviewHost(s.environment_url))
      if (any?.environment_url) return { ok: true, status: 200, data: any.environment_url.replace(/\/+$/, '') }
    }
  }

  const statuses = await githubRequest<{ statuses?: Array<{ target_url?: string | null }> }>(
    `/repos/{owner}/{repo}/commits/${sha}/status?per_page=100`,
    { context },
  )
  if (!statuses.ok) return statuses
  const hit = (statuses.data.statuses ?? []).find((s) => s.target_url && isPreviewHost(s.target_url))
  return { ok: true, status: 200, data: hit?.target_url ? hit.target_url.replace(/\/+$/, '') : null }
}

/**
 * Sanitize the caller-supplied part of a preview fetch.
 *
 * The origin of a preview fetch always comes from the GitHub deployment record;
 * the caller only chooses a path. Absolute URLs, schemes, and protocol-relative
 * paths are rejected rather than rewritten, so `/api/team/pr` can never be
 * turned into a fetch of a host the caller picked. Returns null on rejection.
 */
export function sanitizePreviewPath(raw: unknown): string | null {
  if (raw === undefined || raw === null) return '/'
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const p = trimmed === '' ? '/' : trimmed
  if (!p.startsWith('/') || p.startsWith('//')) return null
  // A colon before the query string means a scheme snuck in (`/x:y` is legal in
  // a path, `javascript:` is not, and neither is worth allowing here).
  if (/[a-z][a-z0-9+.-]*:/i.test(p.split('?')[0] ?? '')) return null
  return p
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

/**
 * Minimal GraphQL client. Exists for exactly one reason: taking a pull request
 * out of draft has no REST equivalent. `draft` is read-only on
 * `PATCH /pulls/{n}`, and `markPullRequestReadyForReview` is GraphQL-only.
 *
 * GraphQL answers 200 with an `errors` array rather than a non-2xx status, so a
 * failed mutation would otherwise read as success. That is collapsed here: any
 * `errors` entry becomes `ok: false` with the messages joined, matching the REST
 * helpers' contract so callers need no special case.
 */
export async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
  context = 'github',
): Promise<GithubResult<T>> {
  const res = await githubRequest<{ data?: T; errors?: Array<{ message?: string }> }>(
    'https://api.github.com/graphql',
    { method: 'POST', body: { query, variables }, context },
  )
  if (!res.ok) return res
  const { data, errors } = res.data
  if (errors && errors.length > 0) {
    const msg = errors.map((e) => e.message ?? 'unknown').join('; ')
    return err(res.status, `GitHub GraphQL: ${msg}`)
  }
  if (data === undefined || data === null) {
    return err(res.status, 'GitHub GraphQL returned no data')
  }
  return { ok: true, status: res.status, data }
}

const MARK_READY_MUTATION = `
mutation MarkReady($id: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $id }) {
    pullRequest { number isDraft }
  }
}`

/**
 * Take a PR out of draft.
 *
 * `nodeId` is the GraphQL global id from the REST payload's `node_id`, carried
 * on `PullRequestSummary.nodeId`. An empty id is a caller bug rather than an
 * API failure, so it is rejected here instead of being sent to GitHub as
 * `null`, which the mutation would reject with a less obvious message.
 *
 * Idempotent from the caller's side: re-running it on an already-open PR is a
 * no-op that still answers `ok`, so a retry after a partial cycle is safe.
 */
export async function markPullRequestReadyForReview(
  nodeId: string,
  context = 'github',
): Promise<GithubResult<{ number: number; isDraft: boolean }>> {
  if (!nodeId) return err(0, 'markPullRequestReadyForReview called without a node id')
  const res = await githubGraphQL<{
    markPullRequestReadyForReview: { pullRequest: { number: number; isDraft: boolean } | null } | null
  }>(MARK_READY_MUTATION, { id: nodeId }, context)
  if (!res.ok) return res
  const pr = res.data.markPullRequestReadyForReview?.pullRequest
  if (!pr) return err(res.status, 'GitHub GraphQL: mutation returned no pull request')
  return { ok: true, status: res.status, data: pr }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Squash-merge. `expectedHeadSha` is passed through as `sha`, so GitHub refuses
 * the merge if the PR moved between classification and merge. That race is
 * exactly how an unclassified commit would otherwise reach main.
 */
export async function squashMergePullRequest(
  number: number,
  opts: { title?: string; message?: string; expectedHeadSha?: string; context?: string } = {},
): Promise<GithubResult<{ sha: string; merged: boolean; message: string }>> {
  return githubRequest<{ sha: string; merged: boolean; message: string }>(
    `/repos/{owner}/{repo}/pulls/${number}/merge`,
    {
      method: 'PUT',
      context: opts.context ?? 'github',
      body: {
        merge_method: 'squash',
        ...(opts.title ? { commit_title: opts.title } : {}),
        ...(opts.message ? { commit_message: opts.message } : {}),
        ...(opts.expectedHeadSha ? { sha: opts.expectedHeadSha } : {}),
      },
    },
  )
}

export async function addLabels(number: number, labels: string[], context = 'github'): Promise<GithubResult<string[]>> {
  const res = await githubRequest<Array<{ name: string }>>(`/repos/{owner}/{repo}/issues/${number}/labels`, {
    method: 'POST',
    body: { labels },
    context,
  })
  if (!res.ok) return res
  return { ok: true, status: res.status, data: res.data.map((l) => l.name) }
}

export async function createIssueComment(number: number, body: string, context = 'github'): Promise<GithubResult<{ html_url: string }>> {
  return githubRequest<{ html_url: string }>(`/repos/{owner}/{repo}/issues/${number}/comments`, {
    method: 'POST',
    body: { body },
    context,
  })
}

/**
 * Workflow runs GitHub created for one head SHA.
 *
 * The release engine needs this to tell two states apart that look identical
 * from the checks API: a run that has not reported yet, and a run GitHub never
 * created at all. `getChecksForRef` reports check RUNS, so a workflow that was
 * never dispatched contributes nothing to it and is indistinguishable from one
 * still queued.
 */
export async function listWorkflowRunsForSha(
  sha: string,
  context = 'github',
): Promise<GithubResult<Array<{ id: number; name: string; status: string; conclusion: string | null }>>> {
  if (!sha) return err(0, 'listWorkflowRunsForSha called without a sha')
  const res = await githubRequest<{
    workflow_runs: Array<{ id: number; name: string; status: string; conclusion: string | null }>
  }>(`/repos/{owner}/{repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=50`, { context })
  if (!res.ok) return res
  return {
    ok: true,
    status: res.status,
    data: (res.data.workflow_runs ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
    })),
  }
}

/**
 * Re-run only the failed jobs of a workflow run.
 *
 * Used for the runner-capacity class of failure. GitHub reports "The job was
 * not acquired by Runner of type hosted even after multiple attempts" as a
 * `cancelled` conclusion, which is indistinguishable from a real failure in the
 * checks API even though no test, typecheck, or build step ever executed. A
 * re-run is how you get an actual verdict; it is not a way around one.
 */
export async function rerunFailedJobs(runId: number, context = 'github'): Promise<GithubResult<unknown>> {
  if (!Number.isInteger(runId) || runId <= 0) return err(0, 'rerunFailedJobs called without a run id')
  return githubRequest<unknown>(`/repos/{owner}/{repo}/actions/runs/${runId}/rerun-failed-jobs`, {
    method: 'POST',
    context,
  })
}

/**
 * Close a pull request and immediately reopen it.
 *
 * This is the only reliable way to make GitHub create `pull_request` workflow
 * runs it declined to create the first time. `reopened` is one of the default
 * `on: pull_request` activity types, so every workflow in the repo re-evaluates
 * the PR from scratch.
 *
 * Why this rather than an empty commit: a commit moves the head SHA, which
 * invalidates every check already reported, resets QA's review target, and
 * writes to the branch. Close/reopen changes no code and no SHA.
 *
 * The reopen is attempted even when the close reports a failure, because
 * leaving a PR closed is far worse than a redundant reopen. A caller that gets
 * `ok: false` should assume the PR may be in either state and re-read it.
 */
export async function recyclePullRequest(number: number, context = 'github'): Promise<GithubResult<PullRequestSummary>> {
  const closed = await githubRequest<RawPull>(`/repos/{owner}/{repo}/pulls/${number}`, {
    method: 'PATCH',
    body: { state: 'closed' },
    context,
  })
  const reopened = await githubRequest<RawPull>(`/repos/{owner}/{repo}/pulls/${number}`, {
    method: 'PATCH',
    body: { state: 'open' },
    context,
  })
  if (!reopened.ok) return reopened
  if (!closed.ok) return err(closed.status, `close failed (${closed.error}) but reopen succeeded`)
  return { ok: true, status: reopened.status, data: toSummary(reopened.data) }
}

export async function openPullRequest(
  input: { title: string; head: string; base: string; body?: string; context?: string },
): Promise<GithubResult<PullRequestSummary>> {
  const res = await githubRequest<RawPull>('/repos/{owner}/{repo}/pulls', {
    method: 'POST',
    context: input.context ?? 'github',
    body: { title: input.title, head: input.head, base: input.base, body: input.body ?? '' },
  })
  if (!res.ok) return res
  return { ok: true, status: res.status, data: toSummary(res.data) }
}

// ---------------------------------------------------------------------------
// Git Data API (revert path)
// ---------------------------------------------------------------------------

export async function getRef(ref: string, context = 'github'): Promise<GithubResult<{ sha: string; ref: string }>> {
  const res = await githubRequest<{ ref: string; object: { sha: string } }>(
    `/repos/{owner}/{repo}/git/ref/${ref.replace(/^refs\//, '')}`,
    { context },
  )
  if (!res.ok) return res
  return { ok: true, status: res.status, data: { sha: res.data.object.sha, ref: res.data.ref } }
}

export async function getCommit(
  sha: string,
  context = 'github',
): Promise<GithubResult<{ sha: string; treeSha: string; parents: string[]; message: string }>> {
  const res = await githubRequest<{
    sha: string
    message: string
    tree: { sha: string }
    parents?: Array<{ sha: string }>
  }>(`/repos/{owner}/{repo}/git/commits/${sha}`, { context })
  if (!res.ok) return res
  return {
    ok: true,
    status: res.status,
    data: {
      sha: res.data.sha,
      treeSha: res.data.tree.sha,
      parents: (res.data.parents ?? []).map((p) => p.sha),
      message: res.data.message,
    },
  }
}

export async function createCommit(
  input: { message: string; tree: string; parents: string[]; context?: string },
): Promise<GithubResult<{ sha: string }>> {
  return githubRequest<{ sha: string }>('/repos/{owner}/{repo}/git/commits', {
    method: 'POST',
    context: input.context ?? 'github',
    body: { message: input.message, tree: input.tree, parents: input.parents },
  })
}

export async function createRef(
  input: { ref: string; sha: string; context?: string },
): Promise<GithubResult<{ ref: string; object: { sha: string } }>> {
  const ref = input.ref.startsWith('refs/') ? input.ref : `refs/heads/${input.ref}`
  return githubRequest<{ ref: string; object: { sha: string } }>('/repos/{owner}/{repo}/git/refs', {
    method: 'POST',
    context: input.context ?? 'github',
    body: { ref, sha: input.sha },
  })
}

/**
 * Build a revert branch for a squash commit without a working copy.
 *
 * Because the release engine merges serially, the bad squash is the tip of the
 * base branch, so "revert" is exactly "commit the parent's tree onto the tip".
 * That is one tree read and two writes, no checkout, no merge conflict surface.
 * Returns the new branch name and commit sha; opening the PR is the caller's
 * call so the revert can be reviewed like any other change.
 */
export async function createRevertBranch(
  input: { badSha: string; branch: string; base?: string; message?: string; context?: string },
): Promise<GithubResult<{ branch: string; sha: string; restoredTree: string }>> {
  const context = input.context ?? 'github'
  const base = input.base ?? 'main'

  const bad = await getCommit(input.badSha, context)
  if (!bad.ok) return bad
  const parent = bad.data.parents[0]
  if (!parent) return err(0, `commit ${input.badSha} has no parent, cannot revert`)

  const parentCommit = await getCommit(parent, context)
  if (!parentCommit.ok) return parentCommit

  const tip = await getRef(`heads/${base}`, context)
  if (!tip.ok) return tip

  const commit = await createCommit({
    message: input.message ?? `revert: restore tree of ${parent.slice(0, 7)} (bad commit ${input.badSha.slice(0, 7)})`,
    tree: parentCommit.data.treeSha,
    parents: [tip.data.sha],
    context,
  })
  if (!commit.ok) return commit

  const ref = await createRef({ ref: `refs/heads/${input.branch}`, sha: commit.data.sha, context })
  if (!ref.ok) return ref

  return {
    ok: true,
    status: 201,
    data: { branch: input.branch, sha: commit.data.sha, restoredTree: parentCommit.data.treeSha },
  }
}

// ---------------------------------------------------------------------------
// Protected-path classifier
// ---------------------------------------------------------------------------

/**
 * Paths an autonomous merge must never touch. A PR matching any of these stops
 * and emails the owner; only the owner merges it.
 *
 * Two properties this list depends on:
 *  1. It is applied ONLY to the changed-file list returned by the GitHub API.
 *     Ticket text, PR title, and PR body are untrusted input and are never
 *     consulted, so prompt injection cannot reclassify a PR.
 *  2. It protects the machinery that enforces it: this file, the release
 *     engine, and .github/** are themselves protected, so no agent PR can
 *     widen the gate it is passing through.
 *
 * The first group is the policy list from the design doc, verbatim. The second
 * group closes holes that list has against this repo's actual filenames (for
 * example `app/lib/cart.server.ts` is the cart cookie helper and is not matched
 * by `app/lib/emma-cart.server.ts`). Widenings only ever add owner emails, they
 * never allow more automation.
 */
export const PROTECTED_GLOBS: readonly string[] = [
  // --- policy list ---
  '**/checkout*',
  'app/lib/emma-cart.server.ts',
  'app/components/store/CartDrawer.tsx',
  'app/lib/checkout-probe*',
  'db/migrations/**',
  'db/schema.ts',
  'app/lib/*auth*',
  'app/lib/*session*',
  'app/lib/team.server.ts',
  'app/lib/team-keys.ts',
  '.github/**',
  'vercel.json',
  '.env*',
  'package.json',
  'app/lib/release-engine.server.ts',
  'app/lib/github.server.ts',

  // --- widenings (same intent, this repo's real filenames) ---
  // Any file whose name mentions checkout or cart, at any depth: catches
  // app/routes/admin.checkout-upsells.tsx, app/routes/api.cart.tsx,
  // app/lib/cart.server.ts, and future money-path files nobody remembers to add.
  // (This comment used to cite app/routes/_layout.checkout-extras.tsx, which
  // does not exist in the repo. The glob was always fine; the example was not.)
  '**/*checkout*',
  '**/*cart*',
  // Valve and spend definitions beyond the two named files.
  'app/lib/homepage-team.server.ts',
  'app/lib/homepage-team-keys.ts',
  // The audited write path for every pipeline_settings key, including the
  // release engine's own enable flag. A change here can weaken or bypass the
  // attribution trail on the store's entire safety boundary, so it needs the
  // owner's eyes even though the file itself is small.
  'app/lib/settings.server.ts',
  // The cron auth block lives here; a change to it is a change to who can
  // trigger every scheduled job.
  //
  // The glob covers the siblings too, because the entry was previously an exact
  // filename while the handlers it authorises live in server/cron.<job>.ts. That
  // meant server/cron.pricing-batch-recompute.ts and every other scheduled
  // handler was unprotected, which contradicts the reason this line exists: the
  // auth block only decides who may *call* a job, and the job itself is where
  // the money and the writes are. A single `*` never crosses a directory
  // boundary, so this stays scoped to server/.
  'server/cron*.ts',
  // Lockfile is the other half of package.json for supply chain.
  'package-lock.json',
  '**/package.json',
  '**/package-lock.json',
  // Nested env files, not just repo root.
  '**/.env*',
  // Deploy-critical build steps. apply-additive-migrations.ts runs against
  // the production database on every prod build (see the --build gate in the
  // file itself); build-vercel.mjs decides what code that build ships. Either
  // one is a way to change what happens during a deploy without going through
  // the paths already protected above.
  'scripts/apply-additive-migrations.ts',
  'scripts/build-vercel.mjs',
]

const RE_SPECIALS = /[.+?^${}()|[\]\\]/g

function escapeRe(s: string): string {
  return s.replace(RE_SPECIALS, '\\$&')
}

/**
 * Compile one glob. Supported syntax is deliberately small:
 *   `**` as a whole segment  -> zero or more path segments
 *   `*`                      -> any run of characters inside one segment
 * Matching is case-insensitive: a case-variant path is never the same file on
 * GitHub, but matching loosely can only over-protect, and under-protecting is
 * the failure mode that costs money.
 */
function globToRegExp(glob: string): RegExp {
  const parts = glob.split('/')
  let source = '^'
  parts.forEach((part, i) => {
    const last = i === parts.length - 1
    if (part === '**') {
      source += last ? '.*' : '(?:[^/]*/)*'
      return
    }
    source += part.split('*').map(escapeRe).join('[^/]*')
    if (!last) source += '/'
  })
  return new RegExp(`${source}$`, 'i')
}

const COMPILED: Array<{ glob: string; re: RegExp }> = PROTECTED_GLOBS.map((glob) => ({ glob, re: globToRegExp(glob) }))

/**
 * Normalize a path from the API before matching: backslashes to slashes,
 * `.`/`..`/empty segments collapsed, leading `./` and `/` stripped. GitHub does
 * not emit those forms, which is the point: anything that arrives looking
 * unusual is normalized into the form the globs are written against rather than
 * being allowed to slip past them.
 */
export function normalizeChangedPath(raw: string): string {
  const out: string[] = []
  for (const seg of raw.trim().replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

/** Globs a single path matches (empty when the path is unprotected). */
export function matchProtectedGlobs(path: string): string[] {
  const normalized = normalizeChangedPath(path)
  if (normalized === '') return []
  return COMPILED.filter((c) => c.re.test(normalized)).map((c) => c.glob)
}

export interface ProtectedClassification {
  /** True when at least one changed file touches a protected path. */
  protected: boolean
  /** Number of paths considered (includes previous names of renamed files). */
  fileCount: number
  /** Unique protected paths, sorted. */
  files: string[]
  /** Unique globs that matched, sorted. */
  globs: string[]
  /** Per-file detail for the escalation email. */
  matches: Array<{ file: string; globs: string[] }>
}

/** Marker glob used when an entry cannot be resolved to a path string. */
export const UNRESOLVED_PATH_GLOB = '<unresolved-path>'

export type ChangedFileInput =
  | string
  // Index signature so a raw GitHub file object (patch, sha, blob_url, and the
  // rest) is accepted as-is. Those extra fields are carried, never consulted.
  | { filename?: unknown; previous_filename?: unknown; previousFilename?: unknown; [key: string]: unknown }

/**
 * Classify a PR's changed files against PROTECTED_GLOBS.
 *
 * Accepts raw filenames or GitHub file objects. Renames contribute BOTH names:
 * moving a protected file somewhere harmless is still a protected change.
 * An entry that cannot be resolved to a string path classifies the whole PR as
 * protected rather than being skipped, so a malformed or unexpected API shape
 * fails closed.
 */
export function classifyChangedFiles(files: readonly ChangedFileInput[] | null | undefined): ProtectedClassification {
  const matches: Array<{ file: string; globs: string[] }> = []
  const seen = new Set<string>()
  let fileCount = 0

  const consider = (path: string) => {
    fileCount += 1
    const globs = matchProtectedGlobs(path)
    if (globs.length === 0) return
    const key = normalizeChangedPath(path)
    if (seen.has(key)) return
    seen.add(key)
    matches.push({ file: key, globs })
  }

  for (const entry of files ?? []) {
    if (typeof entry === 'string') {
      consider(entry)
      continue
    }
    const name = entry && typeof entry === 'object' ? (entry as { filename?: unknown }).filename : undefined
    if (typeof name === 'string' && name.trim() !== '') {
      consider(name)
      const prevRaw =
        (entry as { previous_filename?: unknown }).previous_filename ??
        (entry as { previousFilename?: unknown }).previousFilename
      if (typeof prevRaw === 'string' && prevRaw.trim() !== '') consider(prevRaw)
      continue
    }
    // Fail closed: an entry we cannot read is treated as protected.
    fileCount += 1
    if (!seen.has(UNRESOLVED_PATH_GLOB)) {
      seen.add(UNRESOLVED_PATH_GLOB)
      matches.push({ file: UNRESOLVED_PATH_GLOB, globs: [UNRESOLVED_PATH_GLOB] })
    }
  }

  matches.sort((a, b) => a.file.localeCompare(b.file))
  const globs = [...new Set(matches.flatMap((m) => m.globs))].sort()

  return {
    protected: matches.length > 0,
    fileCount,
    files: matches.map((m) => m.file),
    globs,
    matches,
  }
}
