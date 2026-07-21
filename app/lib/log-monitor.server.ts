import Anthropic from '@anthropic-ai/sdk'

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
async function fetchRecentLogs({ windowMinutes }: { windowMinutes: number }): Promise<LogLine[]> {
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

async function classifyLogs(logs: LogLine[]): Promise<LogMonitorReport> {
  if (logs.length === 0) return { groups: [], suppressedNoiseCount: 0 }

  const userPayload =
    `Window: ${logs[0]?.timestamp} to ${logs[logs.length - 1]?.timestamp}\n` +
    `Total lines: ${logs.length}\n\n` +
    logs.map((l) => `[${l.timestamp}] ${l.level} ${l.source}: ${l.message}`).join('\n')

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
  return block.input as LogMonitorReport
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

export async function runLogMonitor(
  { windowMinutes = 15 }: { windowMinutes?: number } = {},
): Promise<LogMonitorRunResult> {
  const logs   = await fetchRecentLogs({ windowMinutes })
  const report = await classifyLogs(logs)
  const issues = await openIssuesForP0(report.groups, windowMinutes)
  const issuesOpened = issues.map((i) => i.url)

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
    p0:          report.groups.filter((g) => g.priority === 'P0').length,
    p1:          report.groups.filter((g) => g.priority === 'P1').length,
    p2:          report.groups.filter((g) => g.priority === 'P2').length,
    suppressed:  report.suppressedNoiseCount,
    issuesOpened,
  }
}
