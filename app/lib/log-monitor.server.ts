import Anthropic from '@anthropic-ai/sdk'
import { TEAM_IDS, type TeamId } from '~/lib/team-keys'

/**
 * Autonomous log-monitor: pulls recent Vercel runtime logs, classifies signal
 * vs noise via Claude haiku, ranks P0/P1/P2, and opens GitHub issues for P0s.
 *
 * Interactive sibling lives at .claude/agents/log-monitor.md. Keep the system
 * prompt below in sync with that file's <critical_knowledge> + <workflow>
 * sections. The .md file is not bundled into the Vercel deployment, so this
 * is the authoritative copy at runtime.
 */

const MODEL = 'claude-haiku-4-5-20251001'
const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })

const SYSTEM_PROMPT = `You read Vercel function logs and find issues worth fixing. You are a classifier — fast, ruthless about ignoring noise. You do not fix issues; you rank them.

Real signal (always investigate):
- FUNCTION_INVOCATION_FAILED — Vercel function crashed. Almost always env-var drift, missing build artifact, or uncaught exception at module load.
- 500 from any /api/* or webhook route.
- Unhandled promise rejection, TypeError, ReferenceError in server logs.
- Cannot find module — missing import or broken build.
- Repeated identical errors (3+ in a 5-minute window).
- ETIMEDOUT / ECONNRESET to Shopify, Klaviyo, Anthropic, or Twilio sustained over multiple requests.
- IVR 403 Forbidden on /twilio/* endpoints.
- Voice webhook returns 500 — voicemail fallback may be masking real failure.

Noise (suppress unless overwhelming):
- 404s to /wp-admin, /.env, /.git, /phpmyadmin (script kiddies).
- 404s to /favicon.ico from old user-agents.
- OPTIONS preflight 204s.
- Healthcheck pings (/api/health, Vercel internal).
- Expected validation rejects (4xx on /api/waitlist from missing fields).
- One-off 504s during a known cold-start window.

Past incidents to pattern-match:
- Missing build/server/index.js artifact after Vercel build.
- Production env missing vars that preview had.
- DATABASE_URL set to empty string on a preview branch overriding the correct value.
- Trust bar Sanity query returning null due to GROQ select() breaking dereferencing.

Ranking:
- P0 — site-wide outage, payment/checkout broken, IVR down, customer-facing 500s in critical paths.
- P1 — single feature broken, high-volume but non-critical errors, webhook failures.
- P2 — low-volume errors, edge cases, deprecation warnings.

Group identical stack traces into one entry with occurrence count. Do not over-report. If everything is quiet, return zero groups. Owners: rr7-engineer (RR7/Express/general), ivr-ops (Twilio/voice), shopify-ops (Shopify/webhooks), sanity-content-builder (Sanity/GROQ).`

const REPORT_TOOL = {
  name: 'report_groups',
  description: 'Return classified log groups ranked by impact.',
  input_schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            priority:    { type: 'string', enum: ['P0', 'P1', 'P2'] },
            title:       { type: 'string' },
            occurrences: { type: 'number' },
            firstSeen:   { type: 'string', description: 'ISO-8601 timestamp of first occurrence in window' },
            owner:       { type: 'string', description: 'Subagent owner: rr7-engineer | ivr-ops | shopify-ops | sanity-content-builder' },
            excerpt:     { type: 'string', description: 'One representative log line or stack trace, max 800 chars' },
            likelyCause: { type: 'string' },
          },
          required: ['priority', 'title', 'occurrences', 'firstSeen', 'owner', 'excerpt', 'likelyCause'],
        },
      },
      suppressedNoiseCount: { type: 'number' },
    },
    required: ['groups', 'suppressedNoiseCount'],
  },
} as const

export interface LogLine {
  timestamp:  string
  level:      string
  message:    string
  source:     string
  deployment: string
}

export interface LogGroup {
  priority:    'P0' | 'P1' | 'P2'
  title:       string
  occurrences: number
  firstSeen:   string
  owner:       string
  excerpt:     string
  likelyCause: string
  /**
   * Overrides the default title-hash dedupe identity (ticket #6760). The
   * title embeds identifying detail (a run id, a timestamp) that legitimately
   * varies between recurrences of the SAME underlying issue, so hashing the
   * title alone gives every recurrence its own ticket. Set this to a stable
   * key when the group represents a recurring class of incident rather than a
   * one-off, so repeat occurrences collapse onto one row instead of adding a
   * new blocked ticket each time.
   */
  dedupeKey?: string
  /**
   * Team that owns the fix. `fileDetectionTicket` defaults to `homepage`, which
   * is right for a storefront runtime error and wrong for anything that already
   * knows whose lane it came from: six auto-expiry rows (#5475, #5954, #6262,
   * #6553, #6706, #6707) and two more since (#6936 social, #6950 video) were all
   * filed at homepage for runs belonging to video, strategy, content and social.
   */
  targetTeam?: TeamId
  /**
   * Ticket kind. Defaults to `code`. A liveness signal is not a code defect, and
   * `code` has no agent-reachable close edge, so filing one there guarantees an
   * owner-only row. `process` is both honest and closeable by the detector that
   * raised it (DETECTOR_SELF_CLOSE_KINDS).
   */
  kind?: string
}

export interface LogMonitorReport {
  groups:               LogGroup[]
  suppressedNoiseCount: number
}

export interface LogMonitorRunResult {
  windowMinutes: number
  logCount:      number
  p0:            number
  p1:            number
  p2:            number
  suppressed:    number
  issuesOpened:  string[]
  /** Improvement-bus ticket ids filed for P0/P1 groups (0 = deduped/failed). */
  ticketsFiled:  number[]
  /** #5431(b): auto-expired team runs folded into this window's groups. */
  expiredRuns:   number
}

/**
 * Fetch Vercel runtime logs for the latest production deployment.
 *
 * NOTE: Vercel does not currently publish a stable REST endpoint for streaming
 * historical runtime logs across an entire project. The most reliable approach
 * is: (1) look up the latest production deployment, (2) pull its `events`
 * stream filtered by since-timestamp. Endpoint paths can drift, so isolate the
 * URLs in this function and verify with `vercel logs --json` if classification
 * suddenly stops returning groups after a platform update.
 */
export async function fetchRecentLogs({ windowMinutes }: { windowMinutes: number }): Promise<LogLine[]> {
  const token     = process.env['VERCEL_TOKEN']
  const projectId = process.env['VERCEL_PROJECT_ID']
  const teamId    = process.env['VERCEL_TEAM_ID']
  if (!token || !projectId) {
    throw new Error('VERCEL_TOKEN and VERCEL_PROJECT_ID must be set')
  }

  const teamQs = teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''
  const since  = Date.now() - windowMinutes * 60_000

  const deploymentsUrl =
    `https://api.vercel.com/v6/deployments` +
    `?projectId=${encodeURIComponent(projectId)}` +
    `&target=production&limit=1${teamQs}`
  const depRes = await fetch(deploymentsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!depRes.ok) {
    throw new Error(`Vercel deployments fetch ${depRes.status}: ${await depRes.text()}`)
  }
  const depJson = await depRes.json() as { deployments?: Array<{ uid: string }> }
  const deployment = depJson.deployments?.[0]
  if (!deployment) return []

  const eventsUrl =
    `https://api.vercel.com/v3/deployments/${deployment.uid}/events` +
    `?since=${since}&limit=500&direction=backward${teamQs}`
  const evRes = await fetch(eventsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!evRes.ok) {
    throw new Error(`Vercel events fetch ${evRes.status}: ${await evRes.text()}`)
  }
  const events = await evRes.json() as Array<{
    created?:    number
    date?:       number
    type?:       string
    text?:       string
    payload?:    { text?: string; level?: string; source?: string }
    deploymentId?: string
  }>

  return events
    .filter((e) => typeof (e.text ?? e.payload?.text) === 'string')
    .map<LogLine>((e) => ({
      timestamp:  new Date(e.created ?? e.date ?? Date.now()).toISOString(),
      level:      e.payload?.level ?? e.type ?? 'info',
      message:    (e.text ?? e.payload?.text ?? '').slice(0, 2000),
      source:     e.payload?.source ?? 'function',
      deployment: e.deploymentId ?? deployment.uid,
    }))
}

// #3982 — known-noise line patterns, copied straight from the agent def's
// <critical_knowledge> "Noise" bullets (.claude/agents/log-monitor.md). Lines
// that match are dropped in CODE before the prompt is built, so noise is
// never paid for as model input tokens. A line is NEVER classified as noise
// if it also matches SIGNAL_LINE_PATTERNS below — signal always wins.
const NOISE_LINE_PATTERNS: RegExp[] = [
  /(wp-admin|\.env\b|\.git\b|phpmyadmin|xmlrpc\.php).{0,40}\b40[14]\b/i, // bot/crawler scans
  /\b40[14]\b.{0,40}(wp-admin|\.env\b|\.git\b|phpmyadmin|xmlrpc\.php)/i,
  /favicon\.ico.{0,40}\b404\b/i,
  /\b404\b.{0,40}favicon\.ico/i,
  /\bOPTIONS\b.{0,40}\b204\b/i,
  /\b204\b.{0,40}\bOPTIONS\b/i,
  /\/api\/health\b/i,
  /vercel[- ]?internal.*(ping|health)/i,
  /healthcheck/i,
  /\/api\/waitlist\b.{0,40}\b(400|422)\b/i, // expected validation rejects only
  /\b(400|422)\b.{0,40}\/api\/waitlist\b/i,
]

// Lines matching any of these are ALWAYS kept, uncapped, regardless of the
// token budget in filterAndCapLogs. This is the correctness bar from #3982:
// a real incident must survive filtering even if it means exceeding budget.
// Note: 5xx is treated as signal even though the agent def calls "one-off
// 504s during a known cold-start window" noise — a code-side regex cannot
// safely tell a one-off cold-start 504 from a sustained outage, so we never
// silently drop a 5xx here; that judgment call stays with the model.
const SIGNAL_LINE_PATTERNS: RegExp[] = [
  /FUNCTION_INVOCATION_FAILED/,
  /\b5\d\d\b/, // any 5xx status code
  /Unhandled promise rejection/i,
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /Cannot find module/i,
  /ETIMEDOUT|ECONNRESET/,
  /403\s*Forbidden/i,
  /traceback/i,
  /\bat\s+\S+\s*\(.*:\d+:\d+\)/, // stack trace frame, e.g. "at foo (/var/task/x.js:12:34)"
]

export function isSignalLine(line: LogLine): boolean {
  if (/^error$/i.test(line.level)) return true
  const text = `${line.level} ${line.source} ${line.message}`
  return SIGNAL_LINE_PATTERNS.some((re) => re.test(text))
}

export function isNoiseLine(line: LogLine): boolean {
  if (isSignalLine(line)) return false
  const text = `${line.level} ${line.source} ${line.message}`
  return NOISE_LINE_PATTERNS.some((re) => re.test(text))
}

// #6769: on a real (non-empty, non-all-noise) window, filterAndCapLogs almost
// always padded the payload with routine, non-signal lines all the way up to
// this budget, even when nothing was worth flagging -- 18 consecutive real
// invocations (2026-08-29 to 2026-08-31) each spent ~34,235 input tokens for
// ~54 output tokens (report_groups came back near-empty). Padding never
// changes WHETHER the detector fires: signal lines are always kept uncapped
// regardless of this value (see filterAndCapLogs), so this only bounds how
// much low-value routine context rides along with them. Lowered from 18,000.
const DEFAULT_TOKEN_BUDGET = 4_000
const CHARS_PER_TOKEN = 4 // rough estimate for English/log text (no tokenizer dep)

export interface FilterAndCapResult {
  keptLogs:        LogLine[]
  noiseSuppressed: number
  capTruncated:    number
}

/**
 * Pre-filter the log window before it reaches the model (#3982).
 * 1. Drop lines matching a known-noise pattern (never drops a signal line).
 * 2. Cap what's left to a bounded token budget: ALL signal lines are kept
 *    uncapped, then the most recent routine lines fill the remaining budget,
 *    oldest routine lines are truncated first.
 */
export function filterAndCapLogs(
  logs: LogLine[],
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
): FilterAndCapResult {
  const charBudget = tokenBudget * CHARS_PER_TOKEN
  const lineLen = (l: LogLine) => `[${l.timestamp}] ${l.level} ${l.source}: ${l.message}`.length + 1

  let noiseSuppressed = 0
  const nonNoise: Array<{ line: LogLine; index: number }> = []
  logs.forEach((line, index) => {
    if (isNoiseLine(line)) {
      noiseSuppressed++
    } else {
      nonNoise.push({ line, index })
    }
  })

  const mustKeep = nonNoise.filter(({ line }) => isSignalLine(line))
  const rest     = nonNoise.filter(({ line }) => !isSignalLine(line))

  let usedChars = mustKeep.reduce((sum, { line }) => sum + lineLen(line), 0)

  // Fill remaining budget with the most recent routine lines first.
  const restByRecency = [...rest].sort((a, b) => {
    const ta = Date.parse(a.line.timestamp)
    const tb = Date.parse(b.line.timestamp)
    if (Number.isNaN(ta) || Number.isNaN(tb)) return b.index - a.index
    return tb - ta
  })

  const keptRest: typeof rest = []
  let capTruncated = 0
  for (const item of restByRecency) {
    const len = lineLen(item.line)
    if (usedChars + len <= charBudget) {
      keptRest.push(item)
      usedChars += len
    } else {
      capTruncated++
    }
  }

  const kept = [...mustKeep, ...keptRest].sort((a, b) => a.index - b.index)

  return {
    keptLogs: kept.map(({ line }) => line),
    noiseSuppressed,
    capTruncated,
  }
}

async function classifyLogs(logs: LogLine[]): Promise<LogMonitorReport> {
  if (logs.length === 0) return { groups: [], suppressedNoiseCount: 0 }

  const { keptLogs, noiseSuppressed, capTruncated } = filterAndCapLogs(logs)
  if (keptLogs.length === 0) {
    return { groups: [], suppressedNoiseCount: noiseSuppressed + capTruncated }
  }

  const userPayload =
    `Window: ${logs[0]?.timestamp} to ${logs[logs.length - 1]?.timestamp}\n` +
    `Total lines: ${logs.length} ` +
    `(${keptLogs.length} after pre-filter; ${noiseSuppressed} known-noise dropped, ` +
    `${capTruncated} routine lines truncated to fit budget)\n\n` +
    keptLogs.map((l) => `[${l.timestamp}] ${l.level} ${l.source}: ${l.message}`).join('\n')

  const msg = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 4096,
    system:     SYSTEM_PROMPT,
    tools:      [REPORT_TOOL],
    tool_choice: { type: 'tool', name: 'report_groups' },
    messages:   [{ role: 'user', content: userPayload }],
  })

  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') {
    throw new Error('log-monitor: Claude did not return tool_use block')
  }
  // B3.6 — best-effort token log
  const uMon = msg.usage as typeof msg.usage & {
    cache_creation_input_tokens?: number
    cache_read_input_tokens?:     number
  }
  void import('./token-log.server').then(({ logApiTokens }) =>
    logApiTokens({
      feature: 'log-monitor', model: MODEL, source: 'sync', caller: 'log-monitor/analyzeLogWindow',
      inputTokens: uMon.input_tokens, outputTokens: uMon.output_tokens,
      cacheCreationTokens: uMon.cache_creation_input_tokens ?? 0,
      cacheReadTokens:     uMon.cache_read_input_tokens     ?? 0,
    })
  ).catch((err) => console.error('[log-monitor] token-log failed (ignored):', err))
  const report = block.input as LogMonitorReport
  return {
    ...report,
    suppressedNoiseCount: (report.suppressedNoiseCount ?? 0) + noiseSuppressed + capTruncated,
  }
}

/**
 * #5431(b): an auto-expired team run (team.server.ts `expireStaleRuns`) is a
 * DB row -- `homepage_team_runs.status='failed', error='auto-expired: ...'`
 * -- not a console line, so no amount of tuning `SIGNAL_LINE_PATTERNS` could
 * ever make it visible to `fetchRecentLogs`/`classifyLogs`. It was a silent
 * error row by construction. This reads the table directly instead, so an
 * expired run rides the same classify -> issue -> ticket pipeline as a real
 * log-derived signal.
 *
 * Evidence (2026-08): runs 423 (8,110s), 338 (18,864s), 251 (20,500s), 200
 * (21,975s), 140 (20,963s) each auto-expired with BOTH current_phase and
 * current_agent NULL -- ~25h of wall clock with no trace of what died where.
 * The companion fix (api.team.run.tsx `op:'start'`) stamps a phase marker
 * immediately at run creation, so this function's `phase` field should never
 * again read NULL for a run started after that fix ships; it is read from the
 * row as-is (not defaulted here) so a NULL phase on an OLD run, or a genuine
 * gap, still surfaces rather than being silently papered over.
 *
 * Window is deliberately wider than `windowMinutes`: the expiry sweep runs
 * opportunistically (throttled to once/5min inside `gate()`), not on a fixed
 * clock tied to this cron's own 15-min cadence, so a strict window can miss a
 * row that expired between two log-monitor runs. Safe to widen because
 * `fileTicketsForGroups` dedupes by (hashed) title, and the title embeds the
 * run id, so re-seeing the same expired run in an overlapping window is a
 * no-op, not a duplicate ticket.
 *
 * #5632: an auto-expired run is not necessarily dead. A long, quiet-but-alive
 * run -- a content `podcast-reviewer` doing one long WebFetch + Sanity write
 * with no interim `op:'update'` heartbeat -- can go silent past the 240-min
 * idle reaper, get marked `failed`, and then complete successfully minutes
 * later. Run #517 did exactly this: auto-expired ~14:14, then succeeded 14:51
 * with a full podcast brief written, yet log-monitor had already paged a false
 * P1 at 14:15. So hold off until a run has stayed auto-expired for
 * `RECOVERY_GRACE_MIN`: a run that recovers within the grace flips to
 * `status != 'failed'` (dropping out of this failed-only query on its own),
 * while a genuinely dead run still surfaces one grace window later -- these are
 * post-hoc diagnostic tickets, not real-time pages, so the delay is cheap. The
 * SQL lower bound widens by the same grace so a row that ages past the cutoff
 * is still inside the window; at the 15-min cron cadence consecutive
 * `[since, graceCutoff]` bands overlap, and title dedupe keeps that a no-op.
 * `nowMs` is injectable for deterministic tests (repo convention, e.g.
 * `attribution.server.ts` `buildFbc`).
 */
/** Narrow a free-text `homepage_team_runs.team` to a real team id. */
function isTeamId(value: string): value is TeamId {
  return (TEAM_IDS as readonly string[]).includes(value)
}

export async function fetchExpiredRunGroups(
  windowMinutes: number,
  nowMs: number = Date.now(),
): Promise<LogGroup[]> {
  const { db } = await import('~/lib/db.server')
  const { homepageTeamRuns } = await import('../../db/schema')
  const { and, eq, gte, like, count: sqlCount } = await import('drizzle-orm')
  const { makeDedupeKey } = await import('~/lib/detection-tickets.server')

  const RECOVERY_GRACE_MIN = 60
  /** How far back a recurring auto-expiry class is counted. */
  const EXPIRY_CLASS_WINDOW_DAYS = 14
  /** Occurrences of one (team, runType) class before it is worth a ticket. */
  const EXPIRY_CLASS_MIN_OCCURRENCES = 3
  const graceCutoffMs = nowMs - RECOVERY_GRACE_MIN * 60_000
  const since = new Date(nowMs - (windowMinutes + 15 + RECOVERY_GRACE_MIN) * 60_000)
  const rows = await db
    .select({
      id:           homepageTeamRuns.id,
      team:         homepageTeamRuns.team,
      runType:      homepageTeamRuns.runType,
      currentPhase: homepageTeamRuns.currentPhase,
      currentAgent: homepageTeamRuns.currentAgent,
      startedAt:    homepageTeamRuns.startedAt,
      finishedAt:   homepageTeamRuns.finishedAt,
      error:        homepageTeamRuns.error,
    })
    .from(homepageTeamRuns)
    .where(and(
      eq(homepageTeamRuns.status, 'failed'),
      like(homepageTeamRuns.error, 'auto-expired:%'),
      gte(homepageTeamRuns.finishedAt, since),
    ))

  const settled = rows
    // Skip runs auto-expired within the grace window: they may still be a slow
    // but alive run that will recover before it is genuinely dead (#5632).
    .filter((r) => r.finishedAt != null && r.finishedAt.getTime() <= graceCutoffMs)

  // One auto-expiry is an event, not a defect. Runs go quiet for reasons that
  // resolve themselves, and filing on the first occurrence produced eight
  // P1 tickets in nine days, every one of which ended up `blocked` or sitting
  // `approved` at the wrong team. A class only becomes actionable once it
  // repeats, so count how often this (team, runType) pair has expired over a
  // fortnight and stay silent below the threshold. The liveness fact is still
  // recorded either way: the run row itself carries status and error.
  const classCounts = await db
    .select({
      team:    homepageTeamRuns.team,
      runType: homepageTeamRuns.runType,
      n:       sqlCount(),
    })
    .from(homepageTeamRuns)
    .where(and(
      eq(homepageTeamRuns.status, 'failed'),
      like(homepageTeamRuns.error, 'auto-expired:%'),
      gte(homepageTeamRuns.finishedAt, new Date(nowMs - EXPIRY_CLASS_WINDOW_DAYS * 86_400_000)),
    ))
    .groupBy(homepageTeamRuns.team, homepageTeamRuns.runType)

  const countFor = (team: string, runType: string | null): number =>
    Number(classCounts.find(c => c.team === team && c.runType === runType)?.n ?? 0)

  return settled
    .filter(r => countFor(r.team, r.runType) >= EXPIRY_CLASS_MIN_OCCURRENCES)
    .map((r): LogGroup => ({
    priority:    'P1',
    // The lane that owns the run owns the fix. `team` is a free varchar on the
    // runs table, so an unrecognised value falls back to the default rather
    // than routing a ticket at a team that does not exist.
    ...(isTeamId(r.team) ? { targetTeam: r.team } : {}),
    // Liveness, not a code defect - and `process` is closeable by the detector.
    kind:        'process',
    title:       `Team run auto-expired: ${r.team} run #${r.id} (phase: ${r.currentPhase ?? 'unknown'})`,
    occurrences: 1,
    firstSeen:   r.startedAt.toISOString(),
    owner:       'rr7-engineer',
    excerpt:
      `team=${r.team} runType=${r.runType ?? 'unknown'} phase=${r.currentPhase ?? 'NULL'} ` +
      `agent=${r.currentAgent ?? 'NULL'} error=${r.error ?? ''}`,
    likelyCause: r.currentPhase
      ? `Run died during phase "${r.currentPhase}" without a further update and was auto-expired after the idle timeout.`
      : `Run auto-expired with no phase ever recorded -- died before any step reported progress (pre-#5431 run, or the phase-stamp fix did not reach this run's start call).`,
    // Ticket #6760: stable per (team, runType), NOT per run id. The title
    // above embeds the run id on purpose (so a human reading the ticket knows
    // which row triggered it), but that means every NEW recurrence of the
    // same recurring class of expiry -- the same routine going quiet the same
    // way each week -- hashed to a different key and filed a brand new ticket
    // (#5475, #5954, #6262, #6553, #6706 all trace to the same weekly
    // strategy retro). This key collapses those onto one row.
    dedupeKey: makeDedupeKey('logmon', 'run-auto-expired', r.team, r.runType ?? 'unknown'),
  }))
}

/**
 * Open a GitHub issue for each P0 group, deduping against open issues that
 * already share the title. Uses the GitHub REST API directly (no Octokit dep)
 * since we only need two endpoints: search + create.
 */
async function openIssuesForP0(
  groups: LogGroup[],
  windowMinutes: number,
): Promise<Array<{ url: string; title: string; created: boolean }>> {
  const p0 = groups.filter((g) => g.priority === 'P0')
  if (p0.length === 0) return []

  const token = process.env['GITHUB_TOKEN']
  const owner = process.env['GITHUB_OWNER']
  const repo  = process.env['GITHUB_REPO']
  if (!token || !owner || !repo) {
    console.warn('[log-monitor] GITHUB_TOKEN/OWNER/REPO not set, skipping issue creation')
    return []
  }

  const headers = {
    'Authorization':        `Bearer ${token}`,
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':         'application/json',
  }
  const opened: Array<{ url: string; title: string; created: boolean }> = []

  for (const group of p0) {
    const title = `[P0] ${group.title}`
    const searchQs = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open in:title "${title}"`)
    const search = await fetch(`https://api.github.com/search/issues?q=${searchQs}`, { headers })
    if (!search.ok) {
      console.error(`[log-monitor] GitHub search ${search.status}: ${await search.text()}`)
      continue
    }
    const searchJson = await search.json() as { items?: Array<{ number: number; html_url: string }> }
    const existing = searchJson.items?.[0]

    const body =
      `**Occurrences:** ${group.occurrences} in the last ${windowMinutes} min\n` +
      `**First seen:** ${group.firstSeen}\n` +
      `**Likely cause:** ${group.likelyCause}\n` +
      `**Owner:** \`${group.owner}\`\n\n` +
      '```\n' + group.excerpt + '\n```\n\n' +
      '_Opened by `/cron/log-monitor` autonomous sweep._'

    if (existing) {
      const comment = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${existing.number}/comments`,
        { method: 'POST', headers, body: JSON.stringify({ body: `Recurrence:\n\n${body}` }) },
      )
      if (comment.ok) opened.push({ url: existing.html_url, title, created: false })
      else console.error(`[log-monitor] GitHub comment ${comment.status}: ${await comment.text()}`)
      continue
    }

    const create = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers,
      body:   JSON.stringify({ title, body, labels: ['log-monitor', 'P0'] }),
    })
    if (create.ok) {
      const json = await create.json() as { html_url: string }
      opened.push({ url: json.html_url, title, created: true })
    } else {
      console.error(`[log-monitor] GitHub create ${create.status}: ${await create.text()}`)
    }
  }
  return opened
}

/**
 * File one improvement-bus ticket per actionable group, so a detection becomes
 * claimable work instead of another email the owner has to route by hand.
 *
 * Identity is the group TITLE, hashed: that is the same thing the GitHub issue
 * dedupes on, so an error recurring every 15 minutes comments on one issue and
 * lives on one ticket. Recurrence therefore never floods the queue.
 *
 * Additive only. The GitHub issue and the owner SMS/email above are untouched;
 * this cannot throw, so a Neon hiccup can never suppress them.
 */
async function fileTicketsForGroups(
  groups: LogGroup[],
  issues: Array<{ url: string; title: string; created: boolean }>,
  windowMinutes: number,
): Promise<number[]> {
  const { fileDetectionTicket, makeDedupeKey, priorityFromSeverity, hashToken } =
    await import('~/lib/detection-tickets.server')

  const ids: number[] = []
  // P2 is the "low volume, edge case" bucket by the classifier's own
  // definition; ticketing it would bury the queue in things nobody will fix.
  for (const group of groups.filter((g) => g.priority === 'P0' || g.priority === 'P1')) {
    const issue = issues.find((i) => i.title === `[P0] ${group.title}`)
    ids.push(
      await fileDetectionTicket({
        detector: 'log-monitor',
        dedupeKey: group.dedupeKey ?? makeDedupeKey('logmon', hashToken(group.title)),
        priority: priorityFromSeverity(group.priority),
        category: 'other',
        // A group that knows its own lane routes there; the rest keep the
        // storefront default, which is right for a runtime error.
        ...(group.targetTeam ? { targetTeam: group.targetTeam } : {}),
        kind: group.kind ?? 'code',
        suggestion:
          `${group.priority} runtime error: ${group.title}\n\n`
          + `Occurrences: ${group.occurrences} in the last ${windowMinutes} min\n`
          + `First seen: ${group.firstSeen}\n`
          + `Suggested owner: ${group.owner}\n`
          + `Likely cause: ${group.likelyCause}\n\n`
          + '```\n' + group.excerpt + '\n```\n\n'
          + 'Detected by /cron/log-monitor. Reproduce from the excerpt, fix, and confirm the '
          + 'signal stops appearing in the next log window.',
        ...(issue ? { links: [{ kind: 'issue', ref: issue.url, state: 'open' }] } : {}),
      }),
    )
  }
  return ids
}

export async function runLogMonitor(
  { windowMinutes = 15 }: { windowMinutes?: number } = {},
): Promise<LogMonitorRunResult> {
  const logs   = await fetchRecentLogs({ windowMinutes })
  const report = await classifyLogs(logs)

  // #5431(b): fold auto-expired team runs into this window's groups so they
  // ride the same classify -> issue -> ticket pipeline as a log-derived
  // signal, instead of sitting as a silent `failed` row nothing ever surfaces.
  // Never allowed to break the detector: a Neon hiccup here still lets the
  // log-derived groups through.
  let expiredRunGroups: LogGroup[] = []
  try {
    expiredRunGroups = await fetchExpiredRunGroups(windowMinutes)
  } catch (err) {
    console.error('[log-monitor] expired-run query failed (ignored):', err)
  }
  const groups = [...report.groups, ...expiredRunGroups]

  const issues = await openIssuesForP0(groups, windowMinutes)
  const issuesOpened = issues.map((i) => i.url)

  // Ticket filing must never be able to break the detector, so it is wrapped
  // here as well as inside fileDetectionTicket (the dynamic import itself could
  // fail on a cold bundle).
  let ticketsFiled: number[] = []
  try {
    ticketsFiled = await fileTicketsForGroups(groups, issues, windowMinutes)
  } catch (err) {
    console.error('[log-monitor] ticket filing failed (ignored):', err)
  }

  // Owner alert only for newly created issues (first detection). Recurrence
  // comments on an existing open issue run every 15 min and must not re-page.
  const created = issues.filter((i) => i.created)
  if (created.length > 0) {
    const { sendOwnerSms, sendOwnerEmail, escapeHtml } = await import('~/lib/owner-alerts.server')
    await sendOwnerSms(
      `xdipx P0 logs: ${created.length} new issue${created.length === 1 ? '' : 's'}. ${created[0]!.title}`,
    )
    await sendOwnerEmail(
      `[P0] xdipx log-monitor: ${created.length} new issue${created.length === 1 ? '' : 's'}`,
      created
        .map((i) => `<p><a href="${i.url}">${escapeHtml(i.title)}</a></p>`)
        .join(''),
    )
  }

  return {
    windowMinutes,
    logCount:    logs.length,
    p0:          groups.filter((g) => g.priority === 'P0').length,
    p1:          groups.filter((g) => g.priority === 'P1').length,
    p2:          groups.filter((g) => g.priority === 'P2').length,
    suppressed:  report.suppressedNoiseCount,
    issuesOpened,
    ticketsFiled,
    expiredRuns: expiredRunGroups.length,
  }
}
