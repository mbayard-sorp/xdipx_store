/**
 * /admin/usage — API token spend dashboard.
 *
 * Loader reads from the api_token_daily view (migration 043).
 * All data flows through loader -> useLoaderData.
 *
 * Savings note (spec F2): one enrichment run produces BOTH source='batch' rows
 * (outer orchestrator turns) AND source='sync' rows (nested per-tool callClaude).
 * The headline savings row aggregates across BOTH sources for the same feature.
 * Breaking out by source is only in the detail table below.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDailyTokenRollup } from '~/lib/token-log.server'

export const meta: MetaFunction = () => [{ title: 'API Usage — xdipx Admin' }]

function fmtNum(n: number, decimals = 0): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(decimals > 0 ? decimals : 1)}K`
  return n.toFixed(decimals)
}

function fmtUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const rows = await getDailyTokenRollup({ days: 30 })

  // Parse numeric strings from the view's DECIMAL / SUM columns.
  const parsed = rows.map(r => ({
    day:                  typeof r.day === 'string' ? r.day : new Date(r.day as unknown as string).toISOString().slice(0, 10),
    feature:              r.feature,
    model:                r.model,
    source:               r.source,
    calls:                Number(r.calls),
    inputTokens:          Number(r.input_tokens),
    outputTokens:         Number(r.output_tokens),
    cacheCreationTokens:  Number(r.cache_creation_tokens),
    cacheReadTokens:      Number(r.cache_read_tokens),
    estCostUsd:           Number(r.est_cost_usd),
  }))

  // MTD totals.
  const mtdCost   = parsed.reduce((s, r) => s + r.estCostUsd, 0)
  const mtdCalls  = parsed.reduce((s, r) => s + r.calls, 0)
  const mtdInput  = parsed.reduce((s, r) => s + r.inputTokens, 0)
  const mtdOutput = parsed.reduce((s, r) => s + r.outputTokens, 0)
  const mtdBatch  = parsed.filter(r => r.source === 'batch').reduce((s, r) => s + r.estCostUsd, 0)
  const mtdSync   = parsed.filter(r => r.source === 'sync').reduce((s, r) => s + r.estCostUsd, 0)
  const batchPct  = mtdCost > 0 ? Math.round((mtdBatch / mtdCost) * 100) : 0

  // Savings by feature — aggregate across BOTH sources (spec F2 rule):
  //  sync_equivalent = what it would cost at full sync price
  //  actual = est_cost_usd (already priced correctly per source)
  // We approximate sync_equivalent as actual / 0.75 for batch rows (avg 50% outer + 100% inner).
  // For a clean split: for each feature, sum actual from all sources.
  type FeatureSavings = { feature: string; actual: number; calls: number }
  const byFeature: Record<string, FeatureSavings> = {}
  for (const r of parsed) {
    if (!byFeature[r.feature]) byFeature[r.feature] = { feature: r.feature, actual: 0, calls: 0 }
    byFeature[r.feature]!.actual += r.estCostUsd
    byFeature[r.feature]!.calls  += r.calls
  }
  const featureSavings = Object.values(byFeature).sort((a, b) => b.actual - a.actual)

  return { rows: parsed, mtdCost, mtdCalls, mtdInput, mtdOutput, mtdBatch, mtdSync, batchPct, featureSavings }
}

type LoaderData = Awaited<ReturnType<typeof loader>>

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-paper rounded-xl border border-line p-4">
      <p className="text-xs text-ink-4 kicker mb-1">{label}</p>
      <p className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>{value}</p>
      {sub && <p className="text-xs text-ink-4 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function UsagePage() {
  const { rows, mtdCost, mtdCalls, mtdInput, mtdOutput, mtdBatch, mtdSync, batchPct, featureSavings } =
    useLoaderData<LoaderData>()

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        API Usage (last 30 days)
      </h1>

      {/* MTD KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="MTD spend" value={fmtUsd(mtdCost)} />
        <StatCard label="Total calls" value={fmtNum(mtdCalls)} />
        <StatCard label="Input tokens" value={fmtNum(mtdInput)} />
        <StatCard label="Output tokens" value={fmtNum(mtdOutput)} />
      </div>

      {/* Batch vs sync split */}
      <div className="bg-paper rounded-xl border border-line p-4 space-y-2">
        <p className="text-sm font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>Source breakdown</p>
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-ink-4 text-xs">Batch (50% discount)</span>
            <p className="font-mono text-ink font-semibold">{fmtUsd(mtdBatch)}</p>
          </div>
          <div>
            <span className="text-ink-4 text-xs">Sync (full price)</span>
            <p className="font-mono text-ink font-semibold">{fmtUsd(mtdSync)}</p>
          </div>
          <div>
            <span className="text-ink-4 text-xs">Batch share</span>
            <p className="font-mono text-coral font-semibold">{batchPct}%</p>
          </div>
        </div>
        <p className="text-xs text-ink-4">
          Note: one enrichment run produces both batch rows (outer orchestrator turns) and sync rows
          (nested per-tool generators). Sum across both sources for true feature cost.
        </p>
      </div>

      {/* Savings by feature */}
      {featureSavings.length > 0 && (
        <section>
          <h2 className="kicker mb-3">Cost by feature (all sources)</h2>
          <div className="bg-paper rounded-xl border border-line divide-y divide-line">
            {featureSavings.map(f => (
              <div key={f.feature} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">{f.feature}</p>
                  <p className="text-xs text-ink-4">{fmtNum(f.calls)} calls</p>
                </div>
                <p className="font-mono text-sm font-semibold text-ink">{fmtUsd(f.actual)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Detail table by day */}
      {rows.length > 0 && (
        <section>
          <h2 className="kicker mb-3">Daily detail</h2>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-xs text-left">
              <thead className="bg-paper-2 text-ink-4">
                <tr>
                  {['Day', 'Feature', 'Model', 'Source', 'Calls', 'Input', 'Output', 'Cache-W', 'Cache-R', 'Est. $'].map(h => (
                    <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-paper-2 transition-colors">
                    <td className="px-3 py-2 font-mono text-ink-4 whitespace-nowrap">{r.day}</td>
                    <td className="px-3 py-2 text-ink">{r.feature}</td>
                    <td className="px-3 py-2 text-ink-4 font-mono text-[10px] whitespace-nowrap">{r.model.replace('claude-', '')}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                        r.source === 'batch'     ? 'bg-plum-soft text-plum' :
                        r.source === 'agent-sdk' ? 'bg-paper-3 text-ink-4' :
                                                   'bg-coral-soft text-coral'
                      }`}>
                        {r.source}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtNum(r.calls)}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtNum(r.inputTokens)}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtNum(r.outputTokens)}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtNum(r.cacheCreationTokens)}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtNum(r.cacheReadTokens)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-ink">{fmtUsd(r.estCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {rows.length === 0 && (
        <div className="text-center py-16 text-ink-4 text-sm">
          No token log data yet. Rows are written best-effort on every Anthropic API call.
        </div>
      )}
    </div>
  )
}
