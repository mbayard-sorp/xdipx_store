import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { sql } from 'drizzle-orm'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'

export const meta: MetaFunction = () => [{ title: 'Calls — xdipx Admin' }]

interface DayRow {
  day: string
  total: number
  answered: number
  afterHours: number
  rateLimited: number
  anonymous: number
  avgDurationSec: number
  tokensTotal: number
}

interface TopCallerRow {
  fromNumber: string
  calls: number
  lastAt: string
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const days = await db.execute<{
    day: string
    total: string
    answered: string
    after_hours: string
    rate_limited: string
    anonymous: string
    avg_duration_sec: string | null
    tokens_total: string | null
  }>(sql`
    SELECT
      to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
      count(*) AS total,
      count(*) FILTER (WHERE end_reason IN ('user_hangup','silent_caller','max_duration','max_prompts','error')) AS answered,
      count(*) FILTER (WHERE end_reason = 'after_hours') AS after_hours,
      count(*) FILTER (WHERE end_reason = 'rate_limited') AS rate_limited,
      count(*) FILTER (WHERE end_reason = 'anonymous') AS anonymous,
      avg(duration_sec) FILTER (WHERE duration_sec IS NOT NULL) AS avg_duration_sec,
      sum(tokens_total) AS tokens_total
    FROM call_log
    WHERE created_at > now() - interval '14 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `)

  const rows: DayRow[] = (days.rows ?? []).map((r) => ({
    day: r.day,
    total: Number(r.total),
    answered: Number(r.answered),
    afterHours: Number(r.after_hours),
    rateLimited: Number(r.rate_limited),
    anonymous: Number(r.anonymous),
    avgDurationSec: Math.round(Number(r.avg_duration_sec ?? 0)),
    tokensTotal: Number(r.tokens_total ?? 0),
  }))

  const topRes = await db.execute<{ from_number: string; calls: string; last_at: string }>(sql`
    SELECT from_number, count(*) AS calls, max(created_at)::text AS last_at
    FROM call_log
    WHERE created_at > now() - interval '7 days'
    GROUP BY from_number
    ORDER BY calls DESC
    LIMIT 10
  `)

  const topCallers: TopCallerRow[] = (topRes.rows ?? []).map((r) => ({
    fromNumber: r.from_number,
    calls: Number(r.calls),
    lastAt: r.last_at,
  }))

  const totals = rows.reduce(
    (a, r) => ({
      total: a.total + r.total,
      answered: a.answered + r.answered,
      afterHours: a.afterHours + r.afterHours,
      rateLimited: a.rateLimited + r.rateLimited,
      anonymous: a.anonymous + r.anonymous,
      tokensTotal: a.tokensTotal + r.tokensTotal,
    }),
    { total: 0, answered: 0, afterHours: 0, rateLimited: 0, anonymous: 0, tokensTotal: 0 },
  )

  return { rows, topCallers, totals }
}

function fmtPhone(raw: string): string {
  if (!raw || raw === 'anonymous') return raw || '—'
  const d = raw.replace(/\D+/g, '')
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return raw
}

export default function AdminCallsPage() {
  const { rows, topCallers, totals } = useLoaderData<typeof loader>()

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: 'var(--font-display)' }}>Calls</h1>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">
        <Stat label="Total (14d)" value={totals.total} />
        <Stat label="Answered" value={totals.answered} />
        <Stat label="After-hours" value={totals.afterHours} />
        <Stat label="Rate-limited" value={totals.rateLimited} />
        <Stat label="Anonymous" value={totals.anonymous} />
        <Stat label="Tokens" value={totals.tokensTotal.toLocaleString()} />
      </div>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">Daily breakdown</h2>
        <div className="overflow-x-auto bg-white rounded-xl border border-black/10">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-black/50 border-b border-black/10">
              <tr>
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Answered</th>
                <th className="px-3 py-2">After-hrs</th>
                <th className="px-3 py-2">Rate-lim</th>
                <th className="px-3 py-2">Anon</th>
                <th className="px-3 py-2">Avg sec</th>
                <th className="px-3 py-2">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day} className="border-b border-black/5 last:border-b-0">
                  <td className="px-3 py-2 font-mono">{r.day}</td>
                  <td className="px-3 py-2">{r.total}</td>
                  <td className="px-3 py-2">{r.answered}</td>
                  <td className="px-3 py-2">{r.afterHours}</td>
                  <td className="px-3 py-2">{r.rateLimited}</td>
                  <td className="px-3 py-2">{r.anonymous}</td>
                  <td className="px-3 py-2">{r.avgDurationSec || '—'}</td>
                  <td className="px-3 py-2">{r.tokensTotal.toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td className="px-3 py-6 text-black/50" colSpan={8}>No calls yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Top callers (7d)</h2>
        <div className="bg-white rounded-xl border border-black/10 divide-y divide-black/5">
          {topCallers.map((c) => (
            <div key={c.fromNumber} className="px-3 py-2 flex items-center justify-between text-sm">
              <span className="font-mono">{fmtPhone(c.fromNumber)}</span>
              <span className="text-black/60">{c.calls} calls · last {c.lastAt.slice(0, 16).replace('T', ' ')}</span>
            </div>
          ))}
          {topCallers.length === 0 && (
            <div className="px-3 py-6 text-black/50 text-sm">No callers yet.</div>
          )}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white rounded-xl border border-black/10 px-3 py-3">
      <div className="text-[11px] uppercase tracking-wide text-black/50">{label}</div>
      <div className="text-xl font-semibold mt-1" style={{ fontFamily: 'var(--font-display)' }}>{value}</div>
    </div>
  )
}
