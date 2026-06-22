/**
 * /admin/usage/:day/:feature — drill-down for one daily-rollup bucket.
 *
 * Answers "what did this spend actually do, and on what SKUs." Reads raw
 * api_token_log rows (grouped by caller/sku/product/batch) via
 * getTokenCallDetail. The `usage_` segment opts out of nesting under the leaf
 * admin.usage route so this renders as its own page under the admin layout.
 *
 * model + source narrow the bucket via search params (?model=&source=) so the
 * detail matches the exact daily-detail row the user clicked.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getTokenCallDetail } from '~/lib/token-log.server'

export const meta: MetaFunction = () => [{ title: 'Usage detail — xdipx Admin' }]

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

function fmtTime(iso: string): string {
  // Show HH:MM UTC — enough to see when the work happened within the day.
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 16)
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const day     = params.day ?? ''
  const feature = params.feature ?? ''
  const url     = new URL(request.url)
  const model   = url.searchParams.get('model')  || null
  const source  = url.searchParams.get('source') || null

  const rows = await getTokenCallDetail({ day, feature, model, source })

  const parsed = rows.map(r => ({
    caller:             r.caller,
    sku:                r.sku,
    productId:          r.product_id,
    batchId:            r.batch_id,
    jobType:            r.job_type,
    jobSkuList:         Array.isArray(r.job_sku_list) ? r.job_sku_list : null,
    rowCount:           Number(r.row_count),
    calls:              Number(r.calls),
    inputTokens:        Number(r.input_tokens),
    outputTokens:       Number(r.output_tokens),
    cacheCreationTokens: Number(r.cache_creation_tokens),
    cacheReadTokens:    Number(r.cache_read_tokens),
    estCostUsd:         Number(r.est_cost_usd),
    firstTs:            r.first_ts,
    lastTs:             r.last_ts,
  }))

  const totalCost  = parsed.reduce((s, r) => s + r.estCostUsd, 0)
  const totalCalls = parsed.reduce((s, r) => s + r.calls, 0)

  return { day, feature, model, source, rows: parsed, totalCost, totalCalls }
}

type LoaderData = Awaited<ReturnType<typeof loader>>

export default function UsageDetailPage() {
  const { day, feature, model, source, rows, totalCost, totalCalls } =
    useLoaderData<LoaderData>()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <Link to="/admin/usage" className="link-coral text-xs">← Back to usage</Link>
        <h1
          className="text-2xl font-bold text-ink mt-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {feature} <span className="text-ink-4 font-normal">on {day}</span>
        </h1>
        <p className="text-xs text-ink-4 mt-1">
          {model && <span className="font-mono">{model.replace('claude-', '')}</span>}
          {model && source && ' · '}
          {source && <span>{source}</span>}
          {' · '}{fmtUsd(totalCost)} across {fmtNum(totalCalls)} calls
        </p>
      </div>

      {rows.length === 0 && (
        <div className="text-center py-16 text-ink-4 text-sm">
          No detail rows for this bucket. The underlying calls may predate
          attribution logging, or the bucket has rolled off the log.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-xs text-left">
            <thead className="bg-paper-2 text-ink-4">
              <tr>
                {['Action (caller)', 'SKU / Product', 'Calls', 'Input', 'Output', 'Cache-R', 'Est. $', 'Window (UTC)'].map(h => (
                  <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-paper-2 transition-colors align-top">
                  <td className="px-3 py-2 text-ink whitespace-nowrap">
                    {r.caller ?? <span className="text-ink-4 italic">unattributed</span>}
                    {r.batchId && (
                      <span className="block text-[10px] text-ink-4 font-mono">
                        batch {r.batchId.slice(0, 12)}…
                        {r.jobType && ` · ${r.jobType}`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-3">
                    {r.sku
                      ? <span className="font-mono text-ink">{r.sku}</span>
                      : r.productId
                        ? <span className="font-mono text-[10px] text-ink-4">{r.productId.replace('gid://shopify/Product/', '#')}</span>
                        : r.jobSkuList && r.jobSkuList.length > 0
                          ? <span className="text-ink-4">{r.jobSkuList.length} SKU{r.jobSkuList.length === 1 ? '' : 's'}: <span className="font-mono text-[10px]">{r.jobSkuList.slice(0, 6).join(', ')}{r.jobSkuList.length > 6 ? ` +${r.jobSkuList.length - 6}` : ''}</span></span>
                          : <span className="text-ink-4">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtNum(r.calls)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtNum(r.inputTokens)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtNum(r.outputTokens)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-3">{fmtNum(r.cacheReadTokens)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-ink">{fmtUsd(r.estCostUsd)}</td>
                  <td className="px-3 py-2 font-mono text-ink-4 whitespace-nowrap">{fmtTime(r.firstTs)}–{fmtTime(r.lastTs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-4">
        Rows are grouped by action (caller) + SKU/product. Batch rows aggregate a
        whole batch turn, so per-SKU cost can't be split — the SKUs the batch job
        touched are shown from batch_jobs instead. Blank SKU means the call site
        didn't log one.
      </p>
    </div>
  )
}
