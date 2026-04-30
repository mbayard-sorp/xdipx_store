/**
 * /admin/sms-metrics — Phase 0 SMS observability dashboard.
 *
 * Plain-text table showing the last 14 days of SMS turn data. No charts, no
 * caching. Scoped to sms_turns rows so it reflects the Phase 0 logging layer
 * independently of sms_messages.
 *
 * Metrics surfaced:
 *   - Conversations per day (distinct phones with any turn)
 *   - p50 / p95 latency_ms
 *   - Inbound vs outbound count
 *   - Pipeline version breakdown
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { sql } from 'drizzle-orm'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'

export const meta: MetaFunction = () => [{ title: 'SMS Metrics — xdipx Admin' }]

interface DayRow {
  day: string
  conversations: number
  inbound: number
  outbound: number
  p50ms: number | null
  p95ms: number | null
  pipelineVersions: string
}

interface TotalsRow {
  totalConversations: number
  totalInbound: number
  totalOutbound: number
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const dayRes = await db.execute<{
    day: string
    conversations: string
    inbound: string
    outbound: string
    p50_ms: string | null
    p95_ms: string | null
    pipeline_versions: string
  }>(sql`
    SELECT
      to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
      count(DISTINCT phone)                                  AS conversations,
      count(*) FILTER (WHERE direction = 'inbound')          AS inbound,
      count(*) FILTER (WHERE direction = 'outbound')         AS outbound,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE latency_ms IS NOT NULL)                AS p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE latency_ms IS NOT NULL)                AS p95_ms,
      string_agg(DISTINCT pipeline_version, ', ' ORDER BY pipeline_version)
                                                             AS pipeline_versions
    FROM sms_turns
    WHERE created_at > now() - interval '14 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `)

  const rows: DayRow[] = (dayRes.rows ?? []).map((r) => ({
    day: r.day,
    conversations: Number(r.conversations),
    inbound: Number(r.inbound),
    outbound: Number(r.outbound),
    p50ms: r.p50_ms != null ? Math.round(Number(r.p50_ms)) : null,
    p95ms: r.p95_ms != null ? Math.round(Number(r.p95_ms)) : null,
    pipelineVersions: r.pipeline_versions ?? '',
  }))

  const totRes = await db.execute<{
    total_conversations: string
    total_inbound: string
    total_outbound: string
  }>(sql`
    SELECT
      count(DISTINCT phone)                          AS total_conversations,
      count(*) FILTER (WHERE direction = 'inbound')  AS total_inbound,
      count(*) FILTER (WHERE direction = 'outbound') AS total_outbound
    FROM sms_turns
    WHERE created_at > now() - interval '14 days'
  `)

  const totRow = totRes.rows?.[0]
  const totals: TotalsRow = {
    totalConversations: Number(totRow?.total_conversations ?? 0),
    totalInbound: Number(totRow?.total_inbound ?? 0),
    totalOutbound: Number(totRow?.total_outbound ?? 0),
  }

  // Phase 7 — per-stage breakdown (last 14d, inbound only so we count one row per turn).
  const stageRes = await db.execute<{ stage_out: string; n: string }>(sql`
    SELECT COALESCE(stage_out, '(null)') AS stage_out, count(*) AS n
    FROM sms_turns
    WHERE created_at > now() - interval '14 days' AND direction = 'inbound'
    GROUP BY 1
    ORDER BY n DESC
  `)
  const stageBreakdown: Array<{ stage: string; count: number }> = (stageRes.rows ?? []).map((r) => ({
    stage: r.stage_out,
    count: Number(r.n),
  }))

  // Phase 7 — fabrication validator fire-rate (last 14d).
  const fabRes = await db.execute<{ fabrication_caught: string; n: string }>(sql`
    SELECT fabrication_caught, count(*) AS n
    FROM sms_turns
    WHERE created_at > now() - interval '14 days' AND fabrication_caught IS NOT NULL
    GROUP BY 1
    ORDER BY n DESC
  `)
  const fabBreakdown: Array<{ kind: string; count: number }> = (fabRes.rows ?? []).map((r) => ({
    kind: r.fabrication_caught,
    count: Number(r.n),
  }))

  // Phase 7 — cutover banner state.
  const envFlag = (process.env['SMS_PIPELINE_VERSION'] ?? '').trim()
  const flagState =
    envFlag === ''
      ? "Pipeline default: v2 (kill-switch unset; set SMS_PIPELINE_VERSION=v1 to roll back)"
      : `Pipeline default: explicit SMS_PIPELINE_VERSION='${envFlag}'`

  return { rows, totals, stageBreakdown, fabBreakdown, flagState }
}

export default function AdminSmsMetricsPage() {
  const { rows, totals, stageBreakdown, fabBreakdown, flagState } = useLoaderData<typeof loader>()

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        SMS Metrics
      </h1>
      <p className="text-sm text-muted mb-6">Last 14 days · Phase 0 observability · live query, no cache.</p>

      {/* Phase 7 cutover banner */}
      <div className="mb-6 px-4 py-3 rounded-xl bg-coral/10 border border-coral/30 text-sm font-mono">
        {flagState}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <Stat label="Conversations (14d)" value={totals.totalConversations} />
        <Stat label="Inbound turns" value={totals.totalInbound} />
        <Stat label="Outbound turns" value={totals.totalOutbound} />
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Daily breakdown</h2>
        <div className="overflow-x-auto bg-white rounded-xl border border-black/10">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-black/50 border-b border-black/10">
              <tr>
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2">Convos</th>
                <th className="px-3 py-2">Inbound</th>
                <th className="px-3 py-2">Outbound</th>
                <th className="px-3 py-2">p50 ms</th>
                <th className="px-3 py-2">p95 ms</th>
                <th className="px-3 py-2">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day} className="border-b border-black/5 last:border-b-0">
                  <td className="px-3 py-2 font-mono">{r.day}</td>
                  <td className="px-3 py-2">{r.conversations}</td>
                  <td className="px-3 py-2">{r.inbound}</td>
                  <td className="px-3 py-2">{r.outbound}</td>
                  <td className="px-3 py-2">{r.p50ms ?? '—'}</td>
                  <td className="px-3 py-2">{r.p95ms ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.pipelineVersions || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-black/50" colSpan={7}>
                    No SMS turns logged yet. Send a message through the{' '}
                    <a href="/admin/sms-tester" className="underline">SMS tester</a> to see data here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 text-xs text-muted">
        Duplicate-SID rejections are logged as warnings in server logs (search{' '}
        <code className="bg-cream-2 px-1 rounded">[turn-logger] duplicate SID</code>). They are not
        counted in this table because the rejected turn never writes a row.
      </p>

      {/* Phase 7 — per-stage breakdown */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3">Per-stage inbound (14d)</h2>
        <div className="overflow-x-auto bg-white rounded-xl border border-black/10">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-black/50 border-b border-black/10">
              <tr>
                <th className="px-3 py-2">Stage out</th>
                <th className="px-3 py-2">Inbound count</th>
              </tr>
            </thead>
            <tbody>
              {stageBreakdown.map((r) => (
                <tr key={r.stage} className="border-b border-black/5 last:border-b-0">
                  <td className="px-3 py-2 font-mono">{r.stage}</td>
                  <td className="px-3 py-2">{r.count}</td>
                </tr>
              ))}
              {stageBreakdown.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-black/50" colSpan={2}>No stage data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phase 7 — fabrication validator fire-rate */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3">Fabrication validator fire-rate (14d)</h2>
        <div className="overflow-x-auto bg-white rounded-xl border border-black/10">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-black/50 border-b border-black/10">
              <tr>
                <th className="px-3 py-2">Validator</th>
                <th className="px-3 py-2">Fired</th>
              </tr>
            </thead>
            <tbody>
              {fabBreakdown.map((r) => (
                <tr key={r.kind} className="border-b border-black/5 last:border-b-0">
                  <td className="px-3 py-2 font-mono">{r.kind}</td>
                  <td className="px-3 py-2">{r.count}</td>
                </tr>
              ))}
              {fabBreakdown.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-black/50" colSpan={2}>
                    No fabrication catches in last 14d. Either the structure is doing the work or there's not enough traffic — see{' '}
                    <code className="bg-cream-2 px-1 rounded">.claude/orchestrator/audits/2026-04-30-validator-fire-rate.md</code>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white rounded-xl border border-black/10 px-3 py-3">
      <div className="text-[11px] uppercase tracking-wide text-black/50">{label}</div>
      <div className="text-xl font-semibold mt-1" style={{ fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
    </div>
  )
}
