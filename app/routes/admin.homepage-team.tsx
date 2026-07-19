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
import { pipelineSettings } from '../../db/schema'
import {
  gate, getTeamConfig, getValve, invalidateTeamSettingsCache, listRecentRuns, listRunEvents,
  listSuggestions, decideSuggestion, retireSuggestion, listBriefs, listAdCampaigns, decideAdCampaign,
  type TeamConfig, type GateResult,
} from '~/lib/team.server'
import { TEAM_IDS, teamKeys, isTeamId, HOMEPAGE_EXTRA_KEYS, CONTENT_EXTRA_KEYS, VALVE_KEYS, type TeamId } from '~/lib/team-keys'

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
}

interface LoaderData {
  team: TeamId
  config: TeamConfig
  migrated: boolean
  gateResult: GateResult | null
  runs: RunRow[]
  selectedRun: { run: RunRow; events: EventRow[] } | null
  suggestions: SuggestionRow[]
  briefs: BriefRow[]
  campaigns: CampaignRow[]
  autopost: boolean
  suggestionApply: boolean
  contentAutopublish: boolean
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
  const [autopost, suggestionApply, contentAutopublish] = await Promise.all([
    getValve(VALVE_KEYS.socialAutopost).catch(() => false),
    getValve(VALVE_KEYS.suggestionApply).catch(() => false),
    getValve(VALVE_KEYS.contentAutopublish).catch(() => false),
  ])

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
  if (migrated) {
    suggestions = await listSuggestions({ limit: 60 }).catch(() => [])
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

  return { team, config, migrated, gateResult, runs, selectedRun, suggestions, briefs, campaigns, autopost, suggestionApply, contentAutopublish }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  // Allowlisted pipeline_settings keys: every team's key set + homepage extras + valves.
  const allowed = new Set<string>([
    ...TEAM_IDS.flatMap(t => Object.values(teamKeys(t))),
    ...Object.values(HOMEPAGE_EXTRA_KEYS),
    ...Object.values(CONTENT_EXTRA_KEYS),
    ...Object.values(VALVE_KEYS),
  ])

  async function upsertSetting(key: string, value: string) {
    await db
      .insert(pipelineSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: pipelineSettings.key, set: { value, updatedAt: new Date() } })
    // Bust the 60s config/valve cache so kill-switch flips land immediately.
    await invalidateTeamSettingsCache()
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

export default function AgentTeamsPage() {
  const {
    team, config, migrated, gateResult, runs, selectedRun,
    suggestions, briefs, campaigns, autopost, suggestionApply, contentAutopublish,
  } = useLoaderData<typeof loader>()
  const keys = teamKeys(team)
  const activeBrief = briefs.find(b => b.status === 'active')
  const openSuggestions = suggestions.filter(s => s.status === 'proposed' || s.status === 'approved' || s.status === 'pr_open')
  const closedSuggestions = suggestions.filter(s => s.status === 'applied' || s.status === 'dismissed')

  return (
    <div className="max-w-4xl mx-auto space-y-8">
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
        </div>

        <ValveRow
          label={`Auto-approve suggestions is ${config.autoApproveSuggestions ? 'ON' : 'OFF'}`}
          detail={`When ON, suggestions ${TEAM_LABELS[team]} acts on skip your review and land as approved (decided_by 'auto'). Downstream gates still apply: instruction/config rows become agent-editor PRs you merge (needs Suggestion-apply on the Strategy tab); campaign/promo/code rows are still executed by hand.`}
          settingKey={keys.autoApproveSuggestions}
          on={config.autoApproveSuggestions}
        />

        {team === 'social' && (
          <ValveRow
            label={`Autopost is ${autopost ? 'ON' : 'OFF'}`}
            detail="Even when ON, live posting also requires X_AUTO_POST_ENABLED and only X has plumbing. Keep OFF while the team is draft-only."
            settingKey={VALVE_KEYS.socialAutopost}
            on={autopost}
          />
        )}
        {team === 'content' && (
          <ValveRow
            label={`Autopublish is ${contentAutopublish ? 'ON' : 'OFF'}`}
            detail="When ON, voice-gate-passed posts publish live on the Notebook with no human step. OFF degrades the daily routine to Sanity drafts you publish by hand."
            settingKey={VALVE_KEYS.contentAutopublish}
            on={contentAutopublish}
          />
        )}
        {team === 'strategy' && (
          <ValveRow
            label={`Suggestion apply is ${suggestionApply ? 'ON' : 'OFF'}`}
            detail="When ON, agent-editor turns approved instruction-suggestions into PRs (you still merge). OFF pauses the apply path entirely."
            settingKey={VALVE_KEYS.suggestionApply}
            on={suggestionApply}
          />
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

      {/* ── Improvement bus (suggestions) ────────────────────────────────── */}
      {migrated && (
        <section>
          <h2 className="kicker mb-3">Suggestions (all teams)</h2>
          {openSuggestions.length === 0 ? (
            <p className="text-sm text-ink-4">
              Nothing proposed right now. Team retros and process-optimizer write suggestions here for your approval.
            </p>
          ) : (
            <div className="bg-paper rounded-xl border border-line divide-y divide-line">
              {openSuggestions.map(s => (
                <div key={s.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 text-xs text-ink-4">
                    <span className="font-mono">#{s.id}</span>
                    <span className="text-plum">{s.team}</span>
                    {s.targetTeam && <span>→ {s.targetTeam}</span>}
                    <span className="rounded bg-paper-3 px-1.5 py-0.5 font-mono">{s.kind}</span>
                    <span>{s.category}</span>
                    <span className={s.cxRisk === 'high' ? 'text-coral' : s.cxRisk === 'med' ? 'text-plum' : ''}>
                      cx:{s.cxRisk}
                    </span>
                    {Number(s.estSavingsUsd) > 0 && <span>~${Number(s.estSavingsUsd).toFixed(2)} saved</span>}
                    <StatusBadge status={s.status} />
                    {s.decidedBy === 'auto' && (
                      <span className="rounded bg-plum-soft px-1.5 py-0.5 font-mono text-plum">auto</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink">{s.suggestion}</p>
                  {s.status === 'proposed' && (
                    <div className="mt-2 flex gap-2">
                      <Form method="post">
                        <input type="hidden" name="intent" value="suggestion-approve" />
                        <input type="hidden" name="id" value={s.id} />
                        <button className="rounded-lg bg-sage/20 px-3 py-1 text-xs font-semibold text-sage hover:bg-sage/30">
                          Approve
                        </button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="suggestion-dismiss" />
                        <input type="hidden" name="id" value={s.id} />
                        <button className="rounded-lg bg-paper-3 px-3 py-1 text-xs font-semibold text-ink-3 hover:bg-paper-2">
                          Dismiss
                        </button>
                      </Form>
                    </div>
                  )}
                  {s.status === 'approved' && (
                    <div className="mt-1 flex items-center gap-3">
                      <p className="text-xs text-ink-4">
                        {s.decidedBy === 'auto' ? 'Auto-approved. ' : ''}Queued for agent-editor{s.kind === 'code' ? ' (code kind — route to rr7-engineer manually)' : ''}.
                      </p>
                      <Form method="post">
                        <input type="hidden" name="intent" value="suggestion-retire" />
                        <input type="hidden" name="id" value={s.id} />
                        <button className="rounded-lg bg-paper-3 px-2.5 py-0.5 text-[11px] font-semibold text-ink-3 hover:bg-coral-soft hover:text-coral" title="Retire this stale/superseded approved suggestion (reversible)">
                          Retire
                        </button>
                      </Form>
                    </div>
                  )}
                  {s.status === 'pr_open' && s.applyRef && (
                    <a href={s.applyRef} target="_blank" rel="noreferrer" className="link-coral mt-1 inline-block text-xs">
                      review PR →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {closedSuggestions.length > 0 && (
            <p className="text-xs text-ink-4 mt-2">{closedSuggestions.length} applied/dismissed in recent history.</p>
          )}
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
    status === 'succeeded' || status === 'applied' || status === 'approved' ? 'bg-sage/20 text-sage'
    : status === 'failed' || status === 'rolled_back' || status === 'rejected' ? 'bg-coral-soft text-coral'
    : status === 'running' || status === 'pr_open' ? 'bg-plum-soft text-plum'
    : 'bg-paper-3 text-ink-4'
  return <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-mono font-semibold ${tone}`}>{status}</span>
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
