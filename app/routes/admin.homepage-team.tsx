/**
 * /admin/homepage-team — control + observability for ALL the store's
 * autonomous agent teams (homepage | social | ads | email | strategy).
 *
 * - Team tabs: per-team kill switch, daily $ budget, run cap; homepage keeps
 *   its extra image/build settings; social gets the autopost valve; strategy
 *   gets the suggestion-apply valve (agent-editor kill switch).
 * - Status: enabled, today's spend vs budget, runs today vs cap, gate state.
 * - Improvement bus: suggestions from every team with Approve / Dismiss —
 *   approved instruction-kind rows are picked up by agent-editor as PRs.
 * - Strategy: the active weekly brief + history.
 * - Ads: proposed campaigns with their policy check, Approve / Reject
 *   (approve ≠ launch — launching stays a human action in-platform).
 * - Run history: recent runs per team; click a run for its activity feed.
 *
 * Degrades gracefully when migrations 049/051 haven't been applied.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Form, Link, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { homepageTeamSuggestions, pipelineSettings, suggestionLinks } from '../../db/schema'
import { setPipelineSettingAudited } from '~/lib/settings.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import {
  gate, getTeamConfig, getValve, listRecentRuns, listRunEvents,
  listSuggestions, decideSuggestion, retireSuggestion, transitionSuggestion, listBriefs,
  listAdCampaigns, decideAdCampaign,
  type TeamConfig, type GateResult, type TicketStatus,
} from '~/lib/team.server'
import { TEAM_IDS, teamKeys, isTeamId, HOMEPAGE_EXTRA_KEYS, CONTENT_EXTRA_KEYS, VIDEO_EXTRA_KEYS, VALVE_KEYS, type TeamId } from '~/lib/team-keys'

/**
 * Release-engine controls. Deliberately NOT added to VALVE_KEYS: that constant
 * lives in team-keys.ts, which the release engine treats as a protected path,
 * and the digest enumerates it. Both keys are seeded in pipeline_settings by
 * migration 070, read here directly, and allowlisted explicitly in the action
 * (an unlisted key makes the toggle a silent no-op).
 */
const RELEASE_ENGINE_KEYS = {
  enabled:          'release_engine_enabled',
  maxMergesPerDay:  'release_engine_max_merges_per_day',
} as const

/**
 * Instagram publish cap. Same reasoning as the release-engine keys above: it
 * belongs beside the autopublish valve in the UI, but adding it to team-keys.ts
 * would make every future tweak an owner-merged protected-path PR. Read here
 * directly and allowlisted explicitly in the action.
 *
 * The valve itself IS in VALVE_KEYS (`instagram_autopublish_enabled`), so it
 * needs no entry here — only a control, which is what it has been missing.
 * Until this shipped the key existed in code and in the cron and nowhere the
 * owner could reach it, so the only way to turn Instagram autopublish on was a
 * hand-written row in pipeline_settings.
 */
const SOCIAL_EXTRA_KEYS = {
  instagramPublishMaxPerDay: 'instagram_publish_max_per_day',
} as const

/** Mirrors DEFAULT_MAX_PER_DAY in social-publish-job.server.ts (unset = 3/day). */
const INSTAGRAM_PUBLISH_MAX_PER_DAY_DEFAULT = 3

/**
 * Everything still in flight. The pre-070 board only knew proposed/approved/
 * pr_open; the ticket lifecycle added the middle of the road, and a ticket that
 * is not on this list is invisible to the owner.
 *
 * Spelled out here rather than derived from team.server's TICKET_STATUSES
 * because the component reads them too, and importing a value (not just a
 * type) from a .server module drags it into the client bundle. `satisfies`
 * keeps them tied to the canonical union: adding a status there without
 * classifying it here is a typecheck failure, not a silently missing filter.
 */
const OPEN_TICKET_STATUSES = [
  'proposed', 'approved', 'in_progress', 'pr_open', 'in_review', 'verified', 'blocked',
] as const satisfies readonly TicketStatus[]

const CLOSED_TICKET_STATUSES = ['applied', 'dismissed'] as const satisfies readonly TicketStatus[]

const ALL_TICKET_STATUSES = [...OPEN_TICKET_STATUSES, ...CLOSED_TICKET_STATUSES]

export const meta: MetaFunction = () => [{ title: 'Agent Teams — xdipx Admin' }]

type RunRow = Awaited<ReturnType<typeof listRecentRuns>>[number]
type EventRow = Awaited<ReturnType<typeof listRunEvents>>[number]
type SuggestionRow = Awaited<ReturnType<typeof listSuggestions>>[number]
type BriefRow = Awaited<ReturnType<typeof listBriefs>>[number]
type CampaignRow = Awaited<ReturnType<typeof listAdCampaigns>>[number]

const TEAM_LABELS: Record<TeamId, string> = {
  homepage: 'Homepage',
  social:   'Social',
  ads:      'Ads',
  email:    'Email',
  strategy: 'Strategy',
  content:  'Content',
  product:  'Product',
  video:    'Video',
  support:  'Support',
}

interface TicketLink {
  suggestionId: number
  kind: string | null
  ref: string
  state: string | null
}

interface TicketFilter {
  status: string   // '' = the whole open set
  kind: string
  assignee: string
}

interface LoaderData {
  team: TeamId
  config: TeamConfig
  migrated: boolean
  gateResult: GateResult | null
  runs: RunRow[]
  selectedRun: { run: RunRow; events: EventRow[] } | null
  suggestions: SuggestionRow[]
  ticketLinks: TicketLink[]
  filter: TicketFilter
  kindOptions: string[]
  assigneeOptions: string[]
  statusCounts: Array<{ status: string; n: number }>
  briefs: BriefRow[]
  campaigns: CampaignRow[]
  autopost: boolean
  socialTrendScout: boolean
  suggestionApply: boolean
  contentAutopublish: boolean
  seoCuration: boolean
  trendScout: boolean
  videoAutopublish: boolean
  videoFrameReview: boolean
  videoEndcard: boolean
  instagramAutopublish: boolean
  instagramPublishMaxPerDay: number
  releaseEngine: boolean
  releaseEngineMaxMerges: number
}

export async function loader({ request }: LoaderFunctionArgs): Promise<LoaderData> {
  await requireAdmin(request)
  const url = new URL(request.url)
  const teamParam = url.searchParams.get('team')
  const team: TeamId = isTeamId(teamParam) ? teamParam : 'homepage'

  // pipeline_settings is already migrated, so config always loads.
  const config = await getTeamConfig(team).catch(
    (): TeamConfig => ({ team, enabled: false, dailyCents: 500, maxRunsPerDay: 1, autoApproveSuggestions: false }),
  )
  const [autopost, socialTrendScout, suggestionApply, contentAutopublish, seoCuration, trendScout, videoAutopublish, videoFrameReview, videoEndcard, instagramAutopublish, instagramPublishRow, releaseEngineRow] = await Promise.all([
    getValve(VALVE_KEYS.socialAutopost).catch(() => false),
    getValve(VALVE_KEYS.socialTrendScout).catch(() => false),
    getValve(VALVE_KEYS.suggestionApply).catch(() => false),
    getValve(VALVE_KEYS.contentAutopublish).catch(() => false),
    getValve(VALVE_KEYS.seoCuration).catch(() => false),
    getValve(VALVE_KEYS.trendScout).catch(() => false),
    getValve(VALVE_KEYS.videoAutopublish).catch(() => false),
    // Frame review is not a VALVE_KEYS member (it defaults ON, unlike the
    // ship-OFF valves) — read it directly from pipeline_settings.
    db.select().from(pipelineSettings).where(eq(pipelineSettings.key, VIDEO_EXTRA_KEYS.frameReview)).limit(1)
      .then(rows => rows[0]?.value !== 'false')
      .catch(() => true),
    // End card defaults OFF; read directly for the same not-a-VALVE_KEYS reason.
    db.select().from(pipelineSettings).where(eq(pipelineSettings.key, VIDEO_EXTRA_KEYS.endcardEnabled)).limit(1)
      .then(rows => rows[0]?.value === 'true')
      .catch(() => false),
    // Instagram autopublish IS a VALVE_KEYS member and ships OFF, so the normal
    // valve read applies.
    getValve(VALVE_KEYS.instagramAutopublish).catch(() => false),
    // Its daily cap is not a valve; read directly, same reason as frame review.
    db.select().from(pipelineSettings).where(eq(pipelineSettings.key, SOCIAL_EXTRA_KEYS.instagramPublishMaxPerDay)).limit(1)
      .then(rows => rows[0]?.value)
      .catch(() => undefined),
    // Release-engine settings: read directly, same reason as frame review.
    db.select().from(pipelineSettings)
      .where(inArray(pipelineSettings.key, [RELEASE_ENGINE_KEYS.enabled, RELEASE_ENGINE_KEYS.maxMergesPerDay]))
      .catch(() => [] as Array<{ key: string; value: string }>),
  ])
  // Parsed exactly as the cron parses it, zero included: `|| DEFAULT` would turn
  // a deliberate 0 (pause publishing without touching the valve) back into 3.
  const instagramPublishParsed = instagramPublishRow == null ? NaN : parseInt(instagramPublishRow, 10)
  const instagramPublishMaxPerDay = Number.isFinite(instagramPublishParsed) && instagramPublishParsed >= 0
    ? instagramPublishParsed
    : INSTAGRAM_PUBLISH_MAX_PER_DAY_DEFAULT
  const releaseEngine = releaseEngineRow.find(r => r.key === RELEASE_ENGINE_KEYS.enabled)?.value === 'true'
  const releaseEngineMaxMerges =
    Number(releaseEngineRow.find(r => r.key === RELEASE_ENGINE_KEYS.maxMergesPerDay)?.value ?? 6) || 6

  // The team tables (049/051) may not be applied yet — degrade cleanly.
  let migrated = true
  let gateResult: GateResult | null = null
  let runs: RunRow[] = []
  let suggestions: SuggestionRow[] = []
  let briefs: BriefRow[] = []
  let campaigns: CampaignRow[] = []
  try {
    gateResult = await gate(team)
    runs = await listRecentRuns(team, 25)
  } catch {
    migrated = false
  }
  // Filters live in the query string so a filtered board is a shareable URL and
  // a browser refresh keeps the owner where they were.
  const filter: TicketFilter = {
    status:   url.searchParams.get('status') ?? '',
    kind:     url.searchParams.get('kind') ?? '',
    assignee: url.searchParams.get('assignee') ?? '',
  }
  let ticketLinks: TicketLink[] = []
  let kindOptions: string[] = []
  let assigneeOptions: string[] = []
  let statusCounts: LoaderData['statusCounts'] = []
  if (migrated) {
    suggestions = await listSuggestions({
      // An explicit status wins; otherwise the board is the whole open set.
      statuses: filter.status ? [filter.status] : OPEN_TICKET_STATUSES,
      ...(filter.kind ? { kinds: [filter.kind] } : {}),
      ...(filter.assignee ? { assignee: filter.assignee } : {}),
      orderBy: 'priority',
      limit: 120,
    }).catch(() => [])

    // Links for exactly the rows on screen: one query, not one per ticket.
    const ids = suggestions.map(s => s.id)
    if (ids.length > 0) {
      ticketLinks = await db
        .select({
          suggestionId: suggestionLinks.suggestionId,
          kind:         suggestionLinks.kind,
          ref:          suggestionLinks.ref,
          state:        suggestionLinks.state,
        })
        .from(suggestionLinks)
        .where(inArray(suggestionLinks.suggestionId, ids))
        .limit(400)
        .catch(() => [])
    }

    // Filter vocabularies and the status tally come from the table itself, so a
    // kind or an agent this UI has never heard of still shows up in the picker.
    const facets = await db
      .select({
        status: homepageTeamSuggestions.status,
        kind:   homepageTeamSuggestions.kind,
        assignee: homepageTeamSuggestions.assignee,
        n:      sql<number>`count(*)::int`,
      })
      .from(homepageTeamSuggestions)
      .groupBy(homepageTeamSuggestions.status, homepageTeamSuggestions.kind, homepageTeamSuggestions.assignee)
      .catch(() => [])
    const statusTally = new Map<string, number>()
    const kinds = new Set<string>()
    const assignees = new Set<string>()
    for (const f of facets) {
      statusTally.set(f.status, (statusTally.get(f.status) ?? 0) + f.n)
      if (f.kind) kinds.add(f.kind)
      if (f.assignee) assignees.add(f.assignee)
    }
    statusCounts = [...statusTally.entries()]
      .map(([status, n]) => ({ status, n }))
      .sort((a, b) => b.n - a.n)
    kindOptions = [...kinds].sort()
    assigneeOptions = [...assignees].sort()

    briefs = await listBriefs(8).catch(() => [])
    if (team === 'ads') campaigns = await listAdCampaigns(undefined, 30).catch(() => [])
  }

  let selectedRun: LoaderData['selectedRun'] = null
  const runId = Number(url.searchParams.get('run'))
  if (migrated && Number.isFinite(runId) && runId > 0) {
    const run = runs.find(r => r.id === runId)
    if (run) {
      const events = await listRunEvents(runId).catch(() => [])
      selectedRun = { run, events }
    }
  }

  return {
    team, config, migrated, gateResult, runs, selectedRun, suggestions, ticketLinks, filter,
    kindOptions, assigneeOptions, statusCounts, briefs, campaigns, autopost, socialTrendScout,
    suggestionApply, contentAutopublish, seoCuration, trendScout, videoAutopublish,
    videoFrameReview, videoEndcard, instagramAutopublish, instagramPublishMaxPerDay,
    releaseEngine, releaseEngineMaxMerges,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  // Allowlisted pipeline_settings keys: every team's key set + homepage extras
  // + valves + the release-engine controls. A key that is not here is rejected,
  // so a new toggle must be added in both places or it silently does nothing.
  const allowed = new Set<string>([
    ...TEAM_IDS.flatMap(t => Object.values(teamKeys(t))),
    ...Object.values(HOMEPAGE_EXTRA_KEYS),
    ...Object.values(CONTENT_EXTRA_KEYS),
    ...Object.values(VIDEO_EXTRA_KEYS),
    ...Object.values(VALVE_KEYS),
    ...Object.values(SOCIAL_EXTRA_KEYS),
    ...Object.values(RELEASE_ENGINE_KEYS),
  ])

  // Routed through the audited write path so a valve flip is attributable
  // afterward. Before migration 072 there was no actor column at all, and four
  // auto-approve valves changed within 31 seconds on 2026-07-18 with no way to
  // prove who did it. Also busts the 60s config cache so kill-switch flips land
  // immediately rather than up to a minute later.
  async function upsertSetting(key: string, value: string) {
    await setPipelineSettingAudited(key, value, 'owner', 'admin.homepage-team')
  }

  if (intent === 'save' || intent === 'toggle') {
    const key = String(form.get('key') ?? '')
    const value = intent === 'toggle' ? String(form.get('next') ?? 'false') : String(form.get('value') ?? '')
    if (!allowed.has(key)) return Response.json({ ok: false, error: 'bad key' }, { status: 400 })
    await upsertSetting(key, value)
    return Response.json({ ok: true })
  }

  if (intent === 'suggestion-approve' || intent === 'suggestion-dismiss') {
    const id = Number(form.get('id'))
    if (!Number.isFinite(id) || id <= 0) return Response.json({ ok: false }, { status: 400 })
    await decideSuggestion(id, intent === 'suggestion-approve' ? 'approved' : 'dismissed')
    return Response.json({ ok: true })
  }

  if (intent === 'suggestion-retire') {
    const id = Number(form.get('id'))
    if (!Number.isFinite(id) || id <= 0) return Response.json({ ok: false }, { status: 400 })
    await retireSuggestion(id)
    return Response.json({ ok: true })
  }

  // Unblock: blocked -> approved, back onto the unassigned queue. Routed
  // through transitionSuggestion so the transition map (not this route) stays
  // the single arbiter, and so the attempt/claim bookkeeping is the same one
  // the agents get.
  if (intent === 'suggestion-unblock') {
    const id = Number(form.get('id'))
    if (!Number.isFinite(id) || id <= 0) return Response.json({ ok: false }, { status: 400 })
    try {
      await transitionSuggestion(id, 'approved', 'owner', { note: 'unblocked by owner from /admin/homepage-team' })
    } catch (err) {
      if (err instanceof Response) return Response.json({ ok: false, error: await err.text() }, { status: err.status })
      throw err
    }
    return Response.json({ ok: true })
  }

  // Priority is a plain re-prioritisation, not a lifecycle move: it changes
  // where a ticket sits in the claim queue and nothing else. Terminal rows are
  // excluded so reordering can never disturb applied/dismissed history.
  if (intent === 'suggestion-priority') {
    const id = Number(form.get('id'))
    const priority = Number(form.get('priority'))
    if (!Number.isFinite(id) || id <= 0) return Response.json({ ok: false }, { status: 400 })
    if (!Number.isFinite(priority) || priority < 1 || priority > 5) {
      return Response.json({ ok: false, error: 'priority must be 1..5' }, { status: 400 })
    }
    await db
      .update(homepageTeamSuggestions)
      .set({ priority, updatedAt: new Date() })
      .where(and(
        eq(homepageTeamSuggestions.id, id),
        notInArray(homepageTeamSuggestions.status, [...CLOSED_TICKET_STATUSES]),
      ))
    return Response.json({ ok: true })
  }

  if (intent === 'ad-approve' || intent === 'ad-reject') {
    const id = Number(form.get('id'))
    if (!Number.isFinite(id) || id <= 0) return Response.json({ ok: false }, { status: 400 })
    await decideAdCampaign(id, intent === 'ad-approve' ? 'approved' : 'rejected')
    return Response.json({ ok: true })
  }

  return Response.json({ ok: false }, { status: 400 })
}

function fmtUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="bg-paper rounded-xl border border-line p-4">
      <p className="text-xs text-ink-4 kicker mb-1">{label}</p>
      <p
        className={`text-2xl font-bold ${tone === 'warn' ? 'text-coral' : tone === 'ok' ? 'text-sage' : 'text-ink'}`}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-ink-4 mt-0.5">{sub}</p>}
    </div>
  )
}

/** Whole-day age, computed on the server so SSR and hydration agree. */
function fmtAge(from: Date | string | null): string {
  if (!from) return '—'
  const ms = Date.now() - new Date(from).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return '<1h'
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export default function AgentTeamsPage() {
  const {
    team, config, migrated, gateResult, runs, selectedRun,
    suggestions, ticketLinks, filter, kindOptions, assigneeOptions, statusCounts,
    briefs, campaigns, autopost, socialTrendScout, suggestionApply, contentAutopublish,
    seoCuration, trendScout, videoAutopublish, videoFrameReview, videoEndcard,
    instagramAutopublish, instagramPublishMaxPerDay,
    releaseEngine, releaseEngineMaxMerges,
  } = useLoaderData<typeof loader>()
  const keys = teamKeys(team)
  const activeBrief = briefs.find(b => b.status === 'active')
  const countOf = (status: string) => statusCounts.find(s => s.status === status)?.n ?? 0
  const openTotal = statusCounts
    .filter(s => (OPEN_TICKET_STATUSES as readonly string[]).includes(s.status))
    .reduce((a, s) => a + s.n, 0)
  const closedTotal = countOf('applied') + countOf('dismissed')
  const linksById = new Map<number, TicketLink[]>()
  for (const l of ticketLinks) {
    // `note` rows are free-text transition reasons, not destinations.
    if (l.kind === 'note') continue
    const arr = linksById.get(l.suggestionId)
    if (arr) arr.push(l)
    else linksById.set(l.suggestionId, [l])
  }
  const filtered = filter.status !== '' || filter.kind !== '' || filter.assignee !== ''

  return (
    // max-w-5xl (not 4xl) so the ticket table's nine columns fit on a laptop
    // without horizontal scrolling; phones still scroll inside ResponsiveTable.
    <div className="max-w-5xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        Agent Teams
      </h1>

      {/* ── Team tabs ─────────────────────────────────────────────────────── */}
      <nav className="flex gap-2 flex-wrap">
        {TEAM_IDS.map(t => (
          <Link
            key={t}
            to={`/admin/homepage-team?team=${t}`}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              t === team ? 'bg-ink text-white' : 'bg-paper border border-line text-ink hover:bg-paper-2'
            }`}
          >
            {TEAM_LABELS[t]}
          </Link>
        ))}
      </nav>

      {!migrated && (
        <div className="rounded-xl border border-coral bg-coral-soft/50 px-4 py-3 text-sm text-ink">
          Migrations <code>049</code>/<code>051</code> aren't applied yet, so run history, the budget
          gate, suggestions, and briefs are inactive. Apply with{' '}
          <code className="font-mono">npx tsx scripts/apply-migrations.ts --from 049</code>. You can
          still configure the controls below.
        </div>
      )}

      {/* ── Control ──────────────────────────────────────────────────────── */}
      <section className="bg-paper rounded-xl border border-line p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              {TEAM_LABELS[team]} team is {config.enabled ? 'ON' : 'OFF'}
            </p>
            <p className="text-xs text-ink-4">Kill switch. When off, this team's routines no-op at the gate.</p>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="toggle" />
            <input type="hidden" name="key" value={keys.enabled} />
            <input type="hidden" name="next" value={config.enabled ? 'false' : 'true'} />
            <button
              className={`rounded-full px-5 py-2 text-sm font-semibold text-white transition-colors ${
                config.enabled ? 'bg-ink hover:bg-ink-2' : 'bg-coral hover:bg-coral-2'
              }`}
            >
              {config.enabled ? 'Disable' : 'Enable'}
            </button>
          </Form>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <SettingField label="Daily budget (cents)" settingKey={keys.dailyCents} value={config.dailyCents} asDollars />
          <SettingField label="Max runs / day" settingKey={keys.maxRunsPerDay} value={config.maxRunsPerDay} />
          {team === 'homepage' && (
            <>
              <SettingField label="Initial-build budget (cents)" settingKey={HOMEPAGE_EXTRA_KEYS.buildCents} value={config.buildCents ?? 10000} asDollars />
              <SettingField label="Max images / day" settingKey={HOMEPAGE_EXTRA_KEYS.maxImagesPerDay} value={config.maxImagesPerDay ?? 12} />
            </>
          )}
          {team === 'content' && (
            <SettingField label="Max images / day" settingKey={CONTENT_EXTRA_KEYS.maxImagesPerDay} value={config.maxImagesPerDay ?? 0} />
          )}
          {team === 'video' && (
            <>
              <SettingField label="Max cost / video (cents)" settingKey={VIDEO_EXTRA_KEYS.maxCostCents} value={config.maxCostCents ?? 600} asDollars />
              <SettingField label="Max variants / set" settingKey={VIDEO_EXTRA_KEYS.maxVariantsPerSet} value={config.maxVariantsPerSet ?? 4} />
            </>
          )}
        </div>

        <ValveRow
          label={`Auto-approve suggestions is ${config.autoApproveSuggestions ? 'ON' : 'OFF'}`}
          detail={`When ON, suggestions ${TEAM_LABELS[team]} acts on skip your review and land as approved (decided_by 'auto'). Downstream gates still apply: instruction/config rows become agent-editor PRs you merge (needs Suggestion-apply on the Strategy tab); campaign/promo/code rows are still executed by hand.`}
          settingKey={keys.autoApproveSuggestions}
          on={config.autoApproveSuggestions}
        />

        {team === 'social' && (
          <>
            <ValveRow
              label={`Autopost is ${autopost ? 'ON' : 'OFF'}`}
              detail="Even when ON, live posting also requires X_AUTO_POST_ENABLED and only X has plumbing. Keep OFF while the team is draft-only."
              settingKey={VALVE_KEYS.socialAutopost}
              on={autopost}
            />
            <ValveRow
              label={`Instagram autopublish is ${instagramAutopublish ? 'ON' : 'OFF'}`}
              detail="When ON, the hourly /cron/social-publish job posts approved, due Instagram drafts to @hello_xdipx with no click from you. Only the social-publish-gate agent can mark a draft approved, and every post is re-checked at publish time for stock, imagery provenance, sale language, and repetition. OFF means drafts wait in the Social Studio exactly as before. Turning it off takes effect on the next tick, not the next deploy."
              settingKey={VALVE_KEYS.instagramAutopublish}
              on={instagramAutopublish}
            />
            <ValveRow
              label={`Social trend scout is ${socialTrendScout ? 'ON' : 'OFF'}`}
              detail="Weekly social-trend-scout research run (propose-only)."
              settingKey={VALVE_KEYS.socialTrendScout}
              on={socialTrendScout}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <SettingField
                label="Instagram posts / day (publish cap)"
                settingKey={SOCIAL_EXTRA_KEYS.instagramPublishMaxPerDay}
                value={instagramPublishMaxPerDay}
              />
            </div>
            <p className="text-[11px] text-ink-4">
              The publish cap is independent of the drafting quota above: drafting can run ahead
              without the queue draining onto the account all at once. A tick posts at most 2, so a
              backlog trickles out rather than flooding. Set it to 0 to pause publishing while
              leaving the valve on.
            </p>
          </>
        )}
        {team === 'content' && (
          <>
            <ValveRow
              label={`Autopublish is ${contentAutopublish ? 'ON' : 'OFF'}`}
              detail="When ON, gate-passed posts publish live on the Notebook with no human step (every draft passes both the voice gate and the accuracy gate first). OFF degrades the daily routine to Sanity drafts you publish by hand."
              settingKey={VALVE_KEYS.contentAutopublish}
              on={contentAutopublish}
            />
            <ValveRow
              label={`SEO curation is ${seoCuration ? 'ON' : 'OFF'}`}
              detail="Kill switch for the weekly Sunday seo-curator routine: gray-zone keyword triage, cluster merge proposals, and the coming week's seoContentBrief queue. OFF exits before a run starts; the daily writer falls back to the static content plan."
              settingKey={VALVE_KEYS.seoCuration}
              on={seoCuration}
            />
            <ValveRow
              label={`Trend scout is ${trendScout ? 'ON' : 'OFF'}`}
              detail="Kill switch for the weekly Saturday trend-scout routine: community-discourse research that proposes 3-5 trendTopicBrief docs (in Sanity Studio) for the Sunday SEO curation to adopt or skip. Research-only, never writes posts or briefs into the queue itself."
              settingKey={VALVE_KEYS.trendScout}
              on={trendScout}
            />
          </>
        )}
        {team === 'video' && (
          <>
            <ValveRow
              label={`Frame review is ${videoFrameReview ? 'ON' : 'OFF'}`}
              detail="When ON, every video job parks after scene-frame composition so you pick the frame in /admin/video-studio before the expensive clip generation. OFF lets auto-QC choose the frame. Keep ON until frame quality has earned trust."
              settingKey={VIDEO_EXTRA_KEYS.frameReview}
              on={videoFrameReview}
            />
            <ValveRow
              label={`Autopublish is ${videoAutopublish ? 'ON' : 'OFF'}`}
              detail="Even when ON, platform posting also requires per-platform publisher keys (all unset today; publishers are stubs). Keep OFF while videos are review-first."
              settingKey={VALVE_KEYS.videoAutopublish}
              on={videoAutopublish}
            />
            <ValveRow
              label={`End card is ${videoEndcard ? 'ON' : 'OFF'}`}
              detail="When ON, assembly appends a 1.5s closing card (logo + whitelist CTA) to every finished video. Ships OFF until you approve the card design on a test render."
              settingKey={VIDEO_EXTRA_KEYS.endcardEnabled}
              on={videoEndcard}
            />
          </>
        )}
        {team === 'strategy' && (
          <>
            <ValveRow
              label={`Suggestion apply is ${suggestionApply ? 'ON' : 'OFF'}`}
              detail="When ON, agent-editor turns approved instruction-suggestions into PRs (you still merge). OFF pauses the apply path entirely."
              settingKey={VALVE_KEYS.suggestionApply}
              on={suggestionApply}
            />
            <ValveRow
              label={`Release engine (auto-merge) is ${releaseEngine ? 'ON' : 'OFF'}`}
              detail="Master kill switch for the whole auto-merge system. ON means agent PRs that pass CI and the QA gate are merged, deployed, and smoke-tested with no click from you. OFF means nothing auto-merges, ever: you merge every PR by hand, exactly like before this shipped. Everything else keeps running, so turning it off is safe and reversible. PRs touching checkout, payments, auth, migrations, or team valves always wait for you either way."
              settingKey={RELEASE_ENGINE_KEYS.enabled}
              on={releaseEngine}
            />
            {releaseEngine && (
              <div className="grid gap-4 sm:grid-cols-3">
                <SettingField
                  label="Max auto-merges / day"
                  settingKey={RELEASE_ENGINE_KEYS.maxMergesPerDay}
                  value={releaseEngineMaxMerges}
                />
              </div>
            )}
          </>
        )}
        {team === 'strategy' && (
          <p className="text-xs text-ink-4">
            Import-automation valves (Phase 2 auto-import, product-manager, enrich→publish) are managed on{' '}
            <Link to="/admin/imports" className="underline text-ink-3 hover:text-ink">/admin/imports</Link>, not here.
          </p>
        )}
      </section>

      {/* ── Status ───────────────────────────────────────────────────────── */}
      {gateResult && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Spent today" value={fmtUsdCents(gateResult.spentCents)} />
          <StatCard
            label="Remaining"
            value={fmtUsdCents(gateResult.remainingCents)}
            tone={gateResult.remainingCents <= 0 ? 'warn' : 'ok'}
          />
          <StatCard label="Runs today" value={`${gateResult.runsToday} / ${gateResult.maxRunsPerDay}`} />
          <StatCard
            label="Gate"
            value={gateResult.ok ? 'OPEN' : 'CLOSED'}
            {...(!gateResult.ok && gateResult.reason ? { sub: gateResult.reason } : {})}
            tone={gateResult.ok ? 'ok' : 'warn'}
          />
        </div>
      )}

      {/* ── Strategy brief ───────────────────────────────────────────────── */}
      {migrated && (
        <section>
          <h2 className="kicker mb-3">Weekly strategy brief</h2>
          {activeBrief ? (
            <div className="bg-paper rounded-xl border border-line p-5">
              <p className="text-xs text-ink-4 mb-2">
                Week of <span className="font-mono">{activeBrief.weekStart}</span> · by {activeBrief.createdBy}
              </p>
              <pre className="whitespace-pre-wrap text-sm text-ink font-body">{activeBrief.brief}</pre>
            </div>
          ) : (
            <p className="text-sm text-ink-4">
              No active brief yet. The store-strategist's weekly routine publishes one; every team reads it at run start.
            </p>
          )}
          {briefs.filter(b => b.status !== 'active').length > 0 && (
            <p className="text-xs text-ink-4 mt-2">
              {briefs.filter(b => b.status !== 'active').length} superseded brief(s) on record.
            </p>
          )}
        </section>
      )}

      {/* ── Ticket queue (improvement bus) ───────────────────────────────── */}
      {migrated && (
        <section>
          <h2 className="kicker mb-3">Ticket queue (all teams)</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard label="Open" value={String(openTotal)} />
            <StatCard
              label="Awaiting your triage"
              value={String(countOf('proposed'))}
              tone={countOf('proposed') > 0 ? 'warn' : 'ok'}
            />
            <StatCard
              label="Blocked"
              value={String(countOf('blocked'))}
              tone={countOf('blocked') > 0 ? 'warn' : 'ok'}
            />
            <StatCard label="Closed" value={String(closedTotal)} sub="applied or dismissed" />
          </div>

          {/* Filters. GET so a filtered board is a shareable, refreshable URL. */}
          <Form method="get" className="flex flex-col gap-3 md:flex-row md:items-end mb-3">
            <input type="hidden" name="team" value={team} />
            <FilterSelect label="Status" name="status" value={filter.status} options={ALL_TICKET_STATUSES} allLabel="Open (all in flight)" />
            <FilterSelect label="Kind" name="kind" value={filter.kind} options={kindOptions} allLabel="Any kind" />
            <FilterSelect label="Assignee" name="assignee" value={filter.assignee} options={assigneeOptions} allLabel="Anyone" />
            <div className="flex gap-2">
              <button className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper-2">
                Filter
              </button>
              {filtered && (
                <Link
                  to={`/admin/homepage-team?team=${team}`}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-paper-2"
                >
                  Clear
                </Link>
              )}
            </div>
          </Form>

          {suggestions.length === 0 ? (
            <p className="text-sm text-ink-4">
              {filtered
                ? 'No tickets match this filter.'
                : 'Nothing in flight right now. Detectors, team retros, and process-optimizer file tickets here for your approval.'}
            </p>
          ) : (
            <ResponsiveTable>
              {/* Floor, not a width: 860px keeps the columns legible while
                  still fitting inside the max-w-4xl shell on a laptop, so only
                  phones do the horizontal scroll. */}
              <table className="min-w-[860px] w-full bg-paper rounded-xl border border-line text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-ink-4 kicker border-b border-line">
                    <th className="px-3 py-2 font-normal">Ticket</th>
                    <th className="px-3 py-2 font-normal">Status</th>
                    <th className="px-3 py-2 font-normal">Pri</th>
                    <th className="px-3 py-2 font-normal">Assignee</th>
                    <th className="px-3 py-2 font-normal">Age</th>
                    <th className="px-3 py-2 font-normal">Att</th>
                    <th className="px-3 py-2 font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line align-top">
                  {suggestions.map(s => {
                    const links = linksById.get(s.id) ?? []
                    return (
                      <tr key={s.id}>
                        <td className="px-3 py-3 max-w-[380px]">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-4">
                            <span className="font-mono">#{s.id}</span>
                            <span className="text-plum">{s.team}</span>
                            {s.targetTeam && <span>→ {s.targetTeam}</span>}
                            <span className="rounded bg-paper-3 px-1.5 py-0.5 font-mono">{s.kind}</span>
                            <span>{s.category}</span>
                            <span className={s.cxRisk === 'high' ? 'text-coral' : s.cxRisk === 'med' ? 'text-plum' : ''}>
                              cx:{s.cxRisk}
                            </span>
                            {Number(s.estSavingsUsd) > 0 && <span>~${Number(s.estSavingsUsd).toFixed(2)} saved</span>}
                            {s.decidedBy === 'auto' && (
                              <span className="rounded bg-plum-soft px-1.5 py-0.5 font-mono text-plum">auto</span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-ink">{s.suggestion}</p>
                          {s.lastError && (
                            <p
                              className="mt-1 text-[11px] text-coral truncate"
                              title={s.lastError}
                            >
                              last error: {s.lastError}
                            </p>
                          )}
                          {(links.length > 0 || s.applyRef) && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                              {links.map((l, i) => (
                                <TicketRef key={`${l.ref}-${i}`} kind={l.kind} ref_={l.ref} state={l.state} />
                              ))}
                              {links.length === 0 && s.applyRef && (
                                <TicketRef kind="pr" ref_={s.applyRef} state={null} />
                              )}
                            </div>
                          )}
                          {s.status === 'approved' && (
                            <p className="mt-1 text-[11px] text-ink-4">
                              {s.decidedBy === 'auto' ? 'Auto-approved. ' : ''}
                              {s.kind === 'code'
                                ? 'Claimable by the dev routine.'
                                : 'Queued for agent-editor.'}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3"><StatusBadge status={s.status} /></td>
                        <td className="px-3 py-3">
                          <PriorityForm id={s.id} priority={s.priority} />
                        </td>
                        <td className="px-3 py-3 text-xs text-ink-3 font-mono whitespace-nowrap">
                          {s.assignee ?? <span className="text-ink-4">unassigned</span>}
                        </td>
                        <td className="px-3 py-3 text-xs text-ink-3 whitespace-nowrap">{fmtAge(s.createdAt)}</td>
                        <td className={`px-3 py-3 text-xs whitespace-nowrap ${s.attemptCount >= 3 ? 'text-coral font-semibold' : 'text-ink-3'}`}>
                          {s.attemptCount}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1.5">
                            {s.status === 'proposed' && (
                              <>
                                <IntentButton
                                  intent="suggestion-approve"
                                  id={s.id}
                                  label="Approve"
                                  className="bg-sage/20 text-sage hover:bg-sage/30"
                                />
                                <IntentButton
                                  intent="suggestion-dismiss"
                                  id={s.id}
                                  label="Dismiss"
                                  className="bg-paper-3 text-ink-3 hover:bg-paper-2"
                                />
                              </>
                            )}
                            {s.status === 'approved' && (
                              <IntentButton
                                intent="suggestion-retire"
                                id={s.id}
                                label="Retire"
                                className="bg-paper-3 text-ink-3 hover:bg-coral-soft hover:text-coral"
                                title="Retire this stale or superseded approved ticket (reversible)"
                              />
                            )}
                            {s.status === 'blocked' && (
                              <IntentButton
                                intent="suggestion-unblock"
                                id={s.id}
                                label="Unblock"
                                className="bg-plum-soft text-plum hover:bg-plum-soft/70"
                                title="Send this ticket back to approved so an agent can claim it again"
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ResponsiveTable>
          )}
          <p className="text-xs text-ink-4 mt-2">
            Showing {suggestions.length} ticket{suggestions.length === 1 ? '' : 's'}
            {filtered ? ' (filtered)' : ' in flight'} · {closedTotal} applied/dismissed on record.
          </p>
        </section>
      )}

      {/* ── Ad campaign proposals ────────────────────────────────────────── */}
      {migrated && team === 'ads' && (
        <section>
          <h2 className="kicker mb-3">Ad campaign proposals</h2>
          {campaigns.length === 0 ? (
            <p className="text-sm text-ink-4">
              No proposals yet. The ads-manager routine writes propose-only campaigns here; launching stays manual.
            </p>
          ) : (
            <div className="bg-paper rounded-xl border border-line divide-y divide-line">
              {campaigns.map(c => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 text-xs text-ink-4">
                    <span className="font-mono">#{c.id}</span>
                    <span className="text-plum">{c.platform}</span>
                    <span>{c.objective}</span>
                    <span>{fmtUsdCents(c.plannedDailyCents)}/day planned</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-1 text-sm font-medium text-ink">{c.name}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    <span className="font-semibold">Policy check:</span> {c.policyCheck}
                  </p>
                  {c.status === 'proposed' && (
                    <div className="mt-2 flex gap-2">
                      <Form method="post">
                        <input type="hidden" name="intent" value="ad-approve" />
                        <input type="hidden" name="id" value={c.id} />
                        <button className="rounded-lg bg-sage/20 px-3 py-1 text-xs font-semibold text-sage hover:bg-sage/30">
                          Approve (launch stays manual)
                        </button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="ad-reject" />
                        <input type="hidden" name="id" value={c.id} />
                        <button className="rounded-lg bg-paper-3 px-3 py-1 text-xs font-semibold text-ink-3 hover:bg-paper-2">
                          Reject
                        </button>
                      </Form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Run history ──────────────────────────────────────────────────── */}
      {migrated && (
        <section>
          <h2 className="kicker mb-3">Recent {TEAM_LABELS[team].toLowerCase()} runs</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-ink-4">No runs yet. This team's routine will appear here once it fires.</p>
          ) : (
            <div className="bg-paper rounded-xl border border-line divide-y divide-line">
              {runs.map(r => (
                <Link
                  key={r.id}
                  to={`/admin/homepage-team?team=${team}&run=${r.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-paper-2 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      <span className="font-mono text-ink-4">#{r.id}</span> {r.runType}
                      {r.currentPhase ? <span className="text-ink-4"> · {r.currentPhase}</span> : null}
                    </p>
                    <p className="text-xs text-ink-4 truncate">{r.summary ?? r.error ?? '—'}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Run detail (conversation viewer) ─────────────────────────────── */}
      {selectedRun && (
        <section>
          <h2 className="kicker mb-3">
            Run #{selectedRun.run.id} activity{' '}
            {selectedRun.run.prUrl && (
              <a href={selectedRun.run.prUrl} className="link-coral ml-2 text-xs" target="_blank" rel="noreferrer">
                open PR →
              </a>
            )}
          </h2>
          {selectedRun.events.length === 0 ? (
            <p className="text-sm text-ink-4">No events recorded for this run.</p>
          ) : (
            <ol className="bg-paper rounded-xl border border-line divide-y divide-line">
              {selectedRun.events.map(e => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 text-xs text-ink-4">
                    <span className="font-mono">{e.eventType}</span>
                    {e.agentRole && <span className="text-plum">{e.agentRole}</span>}
                    {e.phase && <span>· {e.phase}</span>}
                  </div>
                  <p className="mt-1 text-sm text-ink">{e.summary}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'succeeded' || status === 'applied' || status === 'approved' || status === 'verified' ? 'bg-sage/20 text-sage'
    : status === 'failed' || status === 'rolled_back' || status === 'rejected' || status === 'blocked' ? 'bg-coral-soft text-coral'
    : status === 'running' || status === 'pr_open' || status === 'in_progress' || status === 'in_review' ? 'bg-plum-soft text-plum'
    : 'bg-paper-3 text-ink-4'
  return <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-mono font-semibold ${tone}`}>{status}</span>
}

function FilterSelect({
  label, name, value, options, allLabel,
}: { label: string; name: string; value: string; options: string[]; allLabel: string }) {
  return (
    <label className="flex flex-col gap-1 md:w-44">
      <span className="text-xs text-ink-4">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="rounded-lg border border-line bg-paper-2 px-3 py-1.5 text-sm text-ink"
      >
        <option value="">{allLabel}</option>
        {options.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}

/** One outbound ref on a ticket: the PR, the run, the deploy, the issue. */
function TicketRef({ kind, ref_, state }: { kind: string | null; ref_: string; state: string | null }) {
  const label = `${kind ?? 'ref'}${state ? ` (${state})` : ''}`
  const isUrl = /^https?:\/\//.test(ref_)
  const short = ref_.replace(/^https?:\/\/(www\.)?github\.com\//, '').slice(0, 48)
  return isUrl ? (
    <a href={ref_} target="_blank" rel="noreferrer" className="link-coral" title={ref_}>
      {label} → {short}
    </a>
  ) : (
    <span className="text-ink-4" title={ref_}>{label}: {short}</span>
  )
}

function PriorityForm({ id, priority }: { id: number; priority: number }) {
  return (
    <Form method="post" className="flex items-center gap-1">
      <input type="hidden" name="intent" value="suggestion-priority" />
      <input type="hidden" name="id" value={id} />
      <select
        name="priority"
        defaultValue={String(priority)}
        aria-label={`Priority for ticket ${id}`}
        className="rounded border border-line bg-paper-2 px-1.5 py-0.5 text-xs text-ink"
      >
        {[1, 2, 3, 4, 5].map(p => (
          <option key={p} value={p}>P{p}</option>
        ))}
      </select>
      <button className="rounded border border-line px-1.5 py-0.5 text-[11px] font-semibold text-ink-3 hover:bg-paper-2" title="1 is highest priority; the claim queue reads this first">
        Set
      </button>
    </Form>
  )
}

function IntentButton({
  intent, id, label, className, title,
}: { intent: string; id: number; label: string; className: string; title?: string }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={id} />
      <button
        className={`w-full rounded-lg px-3 py-1 text-xs font-semibold whitespace-nowrap ${className}`}
        {...(title ? { title } : {})}
      >
        {label}
      </button>
    </Form>
  )
}

function SettingField({
  label, settingKey, value, asDollars,
}: { label: string; settingKey: string; value: number; asDollars?: boolean }) {
  const display = asDollars ? (value / 100).toFixed(2) : String(value)
  return (
    <Form method="post" className="flex flex-col gap-1">
      <label className="text-xs text-ink-4">{label}</label>
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="key" value={settingKey} />
      <div className="flex gap-2">
        <input
          name="value"
          defaultValue={asDollars ? String(value) : display}
          inputMode="numeric"
          className="w-full rounded-lg border border-line bg-paper-2 px-3 py-1.5 text-sm text-ink"
          aria-label={label}
        />
        <button className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper-2">
          Save
        </button>
      </div>
      {asDollars && <p className="text-[11px] text-ink-4">Stored as cents ({display} = {value}¢).</p>}
    </Form>
  )
}

function ValveRow({
  label, detail, settingKey, on,
}: { label: string; detail: string; settingKey: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-line bg-paper-2 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-xs text-ink-4">{detail}</p>
      </div>
      <Form method="post">
        <input type="hidden" name="intent" value="toggle" />
        <input type="hidden" name="key" value={settingKey} />
        <input type="hidden" name="next" value={on ? 'false' : 'true'} />
        <button
          className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white transition-colors ${
            on ? 'bg-ink hover:bg-ink-2' : 'bg-coral hover:bg-coral-2'
          }`}
        >
          {on ? 'Turn off' : 'Turn on'}
        </button>
      </Form>
    </div>
  )
}
