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

  return { rows, totals }
}

export default function AdminSmsMetricsPage() {
  const { rows, totals } = useLoaderData<typeof loader>()

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        SMS Metrics
      </h1>
      <p className="text-sm text-muted mb-6">Last 14 days · Phase 0 observability · live query, no cache.</p>

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
