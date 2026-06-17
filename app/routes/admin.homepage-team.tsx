/**
 * /admin/homepage-team — control + observability for the autonomous homepage
 * merchandising team.
 *
 * - Control: kill switch, daily $ budget, cascade caps (image/run per day).
 * - Status: enabled, today's spend vs budget, runs today vs cap, gate state.
 * - Run history: recent runs with status/phase/PR; click a run to see its
 *   step-by-step activity feed (the conversation viewer).
 *
 * Degrades gracefully when migration 049 hasn't been applied yet (the team
 * tables don't exist): shows a banner and still lets you set the toggles
 * (which live in pipeline_settings, already migrated).
 */

import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Form, Link, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../db/schema'
import {
  TEAM_KEYS, getTeamConfig, gate, listRecentRuns, listRunEvents,
  type TeamConfig, type GateResult,
} from '~/lib/homepage-team.server'

export const meta: MetaFunction = () => [{ title: 'Homepage Team — xdipx Admin' }]

type RunRow = Awaited<ReturnType<typeof listRecentRuns>>[number]
type EventRow = Awaited<ReturnType<typeof listRunEvents>>[number]

interface LoaderData {
  config: TeamConfig
  migrated: boolean
  gateResult: GateResult | null
  runs: RunRow[]
  selectedRun: { run: RunRow; events: EventRow[] } | null
}

export async function loader({ request }: LoaderFunctionArgs): Promise<LoaderData> {
  await requireAdmin(request)

  // pipeline_settings is already migrated, so config always loads.
  const config = await getTeamConfig().catch(() => ({
    enabled: false, dailyCents: 1500, buildCents: 10000, maxImagesPerDay: 12, maxRunsPerDay: 4,
  }))

  // The team tables (migration 049) may not be applied yet — degrade cleanly.
  let migrated = true
  let gateResult: GateResult | null = null
  let runs: RunRow[] = []
  try {
    gateResult = await gate()
    runs = await listRecentRuns(25)
  } catch {
    migrated = false
  }

  let selectedRun: LoaderData['selectedRun'] = null
  const runId = Number(new URL(request.url).searchParams.get('run'))
  if (migrated && Number.isFinite(runId) && runId > 0) {
    const run = runs.find(r => r.id === runId)
    if (run) {
      const events = await listRunEvents(runId).catch(() => [])
      selectedRun = { run, events }
    }
  }

  return { config, migrated, gateResult, runs, selectedRun }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  const allowed = new Set<string>(Object.values(TEAM_KEYS))
  if (intent === 'save') {
    const key = String(form.get('key') ?? '')
    const value = String(form.get('value') ?? '')
    if (!allowed.has(key)) return Response.json({ ok: false, error: 'bad key' }, { status: 400 })
    await db
      .insert(pipelineSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: pipelineSettings.key, set: { value, updatedAt: new Date() } })
    return Response.json({ ok: true })
  }
  if (intent === 'toggle') {
    const next = String(form.get('next') ?? 'false')
    await db
      .insert(pipelineSettings)
      .values({ key: TEAM_KEYS.enabled, value: next })
      .onConflictDoUpdate({ target: pipelineSettings.key, set: { value: next, updatedAt: new Date() } })
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

export default function HomepageTeamPage() {
  const { config, migrated, gateResult, runs, selectedRun } = useLoaderData<typeof loader>()

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        Homepage Team
      </h1>

      {!migrated && (
        <div className="rounded-xl border border-coral bg-coral-soft/50 px-4 py-3 text-sm text-ink">
          Migration <code>049_homepage_team</code> isn't applied yet, so run history and the budget
          gate are inactive. Apply it with{' '}
          <code className="font-mono">npx tsx scripts/apply-migrations.ts --from 049</code>. You can
          still configure the controls below.
        </div>
      )}

      {/* ── Control ──────────────────────────────────────────────────────── */}
      <section className="bg-paper rounded-xl border border-line p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              {config.enabled ? 'Team is ON' : 'Team is OFF'}
            </p>
            <p className="text-xs text-ink-4">Kill switch. When off, the daily routine no-ops.</p>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="toggle" />
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
          <SettingField label="Daily budget (cents)" settingKey={TEAM_KEYS.dailyCents} value={config.dailyCents} asDollars />
          <SettingField label="Initial-build budget (cents)" settingKey={TEAM_KEYS.buildCents} value={config.buildCents} asDollars />
          <SettingField label="Max images / day" settingKey={TEAM_KEYS.maxImagesPerDay} value={config.maxImagesPerDay} />
          <SettingField label="Max runs / day" settingKey={TEAM_KEYS.maxRunsPerDay} value={config.maxRunsPerDay} />
        </div>
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

      {/* ── Run history ──────────────────────────────────────────────────── */}
      {migrated && (
        <section>
          <h2 className="kicker mb-3">Recent runs</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-ink-4">No runs yet. The daily routine will appear here once it fires.</p>
          ) : (
            <div className="bg-paper rounded-xl border border-line divide-y divide-line">
              {runs.map(r => (
                <Link
                  key={r.id}
                  to={`/admin/homepage-team?run=${r.id}`}
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
    status === 'succeeded' ? 'bg-sage/20 text-sage'
    : status === 'failed' || status === 'rolled_back' ? 'bg-coral-soft text-coral'
    : status === 'running' ? 'bg-plum-soft text-plum'
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
