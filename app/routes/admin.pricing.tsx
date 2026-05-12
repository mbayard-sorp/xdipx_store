import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState } from 'react'
import { db } from '~/lib/db.server'
import { pricingChanges } from '../../db/schema'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { getApprovalMode, getPricingRules, getCachedProductTypes } from '~/lib/pricing-agent.server'
import { getPipelineSettingPublic, getWebhookActivityToday } from '~/lib/pricing-webhook.server'
import { HIGH_MARGIN_DISCOUNT, MEDIUM_MARGIN_DISCOUNT, MARGIN_FLOOR } from '~/lib/pricing-engine.server'
import type { MarkupSuggestion } from '~/lib/pricing-suggestions.server'
import { and, desc, sql } from 'drizzle-orm'

export const meta: MetaFunction = () => [{ title: 'Pricing Agent — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const adminUser = await getAdminUser(request)

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  const todayRows = await db
    .select()
    .from(pricingChanges)
    .where(
      and(
        sql`${pricingChanges.runDate}::text = ${todayStr}`,
      ),
    )
    .orderBy(desc(pricingChanges.proposedAt))

  // Last 7 days summary
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  const sevenDaysAgoStr = sevenDaysAgo.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  const summaryRows = await db
    .select({
      runDate: sql<string>`${pricingChanges.runDate}::text`,
      status: pricingChanges.status,
      count: sql<number>`count(*)::int`,
    })
    .from(pricingChanges)
    .where(sql`${pricingChanges.runDate}::text >= ${sevenDaysAgoStr}`)
    .groupBy(pricingChanges.runDate, pricingChanges.status)
    .orderBy(pricingChanges.runDate)

  const approvalMode = await getApprovalMode()

  const [webhookEnabledRaw, webhookThrottleRaw, webhookActivityToday, pricingRules, productTypesCache] = await Promise.all([
    getPipelineSettingPublic('pricing_webhook_enabled'),
    getPipelineSettingPublic('pricing_webhook_throttle_secs'),
    getWebhookActivityToday(),
    getPricingRules(),
    getCachedProductTypes(),
  ])
  const productTypes = productTypesCache?.types ?? []
  const productTypesRefreshedAt = productTypesCache?.refreshedAt ?? null

  const webhookEnabled = webhookEnabledRaw === 'true'
  const webhookThrottleSecs = Math.max(5, Math.min(300, parseInt(webhookThrottleRaw ?? '30', 10) || 30))
  const webhookSecretSet = Boolean(process.env['NALPAC_WEBHOOK_SECRET'])
  const siteUrl = (process.env['SITE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')
  const webhookEndpoint = `${siteUrl}/api/webhooks/nalpac/cost-change`

  const pending = todayRows.filter(r => r.status === 'pending')
  const autoApplied = todayRows.filter(r => r.status === 'auto_applied')
  const approved = todayRows.filter(r => r.status === 'approved')
  const rejected = todayRows.filter(r => r.status === 'rejected')
  const failed = todayRows.filter(r => r.status === 'failed')

  const mapAvertedRows = todayRows.filter(
    r => r.mapRespected && r.mapPrice != null && r.oldPrice != null &&
      parseFloat(String(r.oldPrice)) < parseFloat(String(r.mapPrice)),
  )

  const marginWarnings = todayRows.filter(r => {
    if (r.tier === 'thin-margin') return true
    if (r.marginPct != null && parseFloat(String(r.marginPct)) < 0.20) return true
    return false
  })

  return {
    todayStr,
    approvalMode,
    pending,
    autoApplied,
    approved,
    rejected,
    failed,
    mapAvertedRows,
    marginWarnings,
    summaryRows,
    adminEmail: adminUser?.email ?? '',
    counts: {
      scanned: todayRows.length,
      applied: autoApplied.length + approved.length,
      pending: pending.length,
    },
    lastRunAt: todayRows[0]?.proposedAt ?? null,
    webhook: {
      enabled: webhookEnabled,
      throttleSecs: webhookThrottleSecs,
      secretSet: webhookSecretSet,
      endpoint: webhookEndpoint,
      activityToday: webhookActivityToday,
    },
    pricingRules,
    productTypes,
    productTypesRefreshedAt,
  }
}

type LoaderData = Awaited<ReturnType<typeof loader>>

const MODE_PILL: Record<string, string> = {
  all: 'bg-cream-2 text-ink',
  guardrails: 'bg-blue-100 text-blue-700',
  auto: 'bg-red-100 text-red-600',
}

const MODE_LABELS: Record<string, string> = {
  all: 'Approve All',
  guardrails: 'Guardrails',
  auto: 'Auto',
}

function fmt(v: unknown): string {
  if (v == null) return '—'
  const n = parseFloat(String(v))
  return isNaN(n) ? '—' : `$${n.toFixed(2)}`
}

function fmtPct(v: unknown): string {
  if (v == null) return '—'
  const n = parseFloat(String(v))
  return isNaN(n) ? '—' : `${Math.round(n * 100)}%`
}

function PriceChange({ oldPrice, newPrice }: { oldPrice: unknown; newPrice: unknown }) {
  const oldN = oldPrice != null ? parseFloat(String(oldPrice)) : null
  const newN = newPrice != null ? parseFloat(String(newPrice)) : null
  if (oldN == null || newN == null) return <span className="text-ink/60 text-xs">{fmt(newPrice)}</span>
  const color = newN > oldN ? 'text-red-500' : newN < oldN ? 'text-green-600' : 'text-ink/60'
  return (
    <span className="text-xs">
      <span className="text-ink/50 line-through mr-1">{fmt(oldPrice)}</span>
      <span className={`font-semibold ${color}`}>{fmt(newPrice)}</span>
    </span>
  )
}

type PricingRow = LoaderData['pending'][number]

function PricingTable({
  rows,
  showActions,
  approveFetcher,
}: {
  rows: PricingRow[]
  showActions: boolean
  approveFetcher: ReturnType<typeof useFetcher>
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink/40 italic px-4 py-6">None.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-cream-2 text-ink/60 text-xs uppercase tracking-wide">
            <th className="px-3 py-2 text-left">Product</th>
            <th className="px-3 py-2 text-left">Vendor</th>
            <th className="px-3 py-2 text-left">SKU</th>
            <th className="px-3 py-2 text-right">Old / New</th>
            <th className="px-3 py-2 text-right">Compare-at</th>
            <th className="px-3 py-2 text-right">Margin</th>
            <th className="px-3 py-2 text-left">Tier</th>
            <th className="px-3 py-2 text-left">Reason</th>
            {showActions && <th className="px-3 py-2 text-center">Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="border-t border-cream-2 hover:bg-cream-2/30 transition-colors">
              <td className="px-3 py-2">
                <a
                  href={`/products/${row.productHandle ?? row.sku}`}
                  className="text-ink font-medium hover:text-coral transition-colors"
                  target="_blank"
                  rel="noreferrer"
                >
                  {row.productTitle ?? row.sku}
                </a>
              </td>
              <td className="px-3 py-2 text-ink/60 text-xs">{row.vendor ?? '—'}</td>
              <td className="px-3 py-2 text-ink/50 text-xs font-mono">{row.sku}</td>
              <td className="px-3 py-2 text-right">
                <PriceChange oldPrice={row.oldPrice} newPrice={row.newPrice} />
              </td>
              <td className="px-3 py-2 text-right text-xs text-ink/60">{fmt(row.newCompareAt)}</td>
              <td className="px-3 py-2 text-right text-xs">
                {row.marginPct != null ? (
                  <span
                    className={
                      parseFloat(String(row.marginPct)) < 0.20
                        ? 'text-red-500 font-semibold'
                        : parseFloat(String(row.marginPct)) >= 0.40
                          ? 'text-green-600'
                          : 'text-yellow-600'
                    }
                  >
                    {fmtPct(row.marginPct)}
                  </span>
                ) : '—'}
              </td>
              <td className="px-3 py-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full font-semibold ${
                  row.tier === 'thin-margin'
                    ? 'bg-red-100 text-red-600'
                    : row.tier === 'healthy'
                      ? 'bg-green-100 text-green-600'
                      : 'bg-cream-2 text-ink/60'
                }`}>
                  {row.tier}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-ink/60 max-w-xs truncate">{row.reason}</td>
              {showActions && (
                <td className="px-3 py-2 text-center">
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() =>
                        approveFetcher.submit(
                          { changeId: String(row.id), action: 'approve' },
                          { method: 'post', action: '/api/pricing/approve' },
                        )
                      }
                      className="text-xs font-semibold px-3 py-1.5 rounded-full bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() =>
                        approveFetcher.submit(
                          { changeId: String(row.id), action: 'reject' },
                          { method: 'post', action: '/api/pricing/approve' },
                        )
                      }
                      className="text-xs font-semibold px-3 py-1.5 rounded-full bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MiniBarChart({ summaryRows }: { summaryRows: LoaderData['summaryRows'] }) {
  const dates = [...new Set(summaryRows.map(r => r.runDate))].sort()
  const statuses = ['pending', 'auto_applied', 'approved', 'rejected', 'failed']
  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-400',
    auto_applied: 'bg-blue-400',
    approved: 'bg-green-500',
    rejected: 'bg-ink/30',
    failed: 'bg-red-400',
  }

  const maxCount = Math.max(
    1,
    ...summaryRows.map(r => r.count),
  )

  return (
    <div className="flex gap-3 items-end h-20 mt-2">
      {dates.map(date => {
        const dayRows = summaryRows.filter(r => r.runDate === date)
        const total = dayRows.reduce((s, r) => s + r.count, 0)
        return (
          <div key={date} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <div className="flex flex-col-reverse gap-px w-full" style={{ height: 56 }}>
              {statuses.map(st => {
                const row = dayRows.find(r => r.status === st)
                if (!row) return null
                const h = Math.max(2, Math.round((row.count / maxCount) * 52))
                return (
                  <div
                    key={st}
                    className={`w-full rounded-sm ${statusColor[st] ?? 'bg-ink/20'}`}
                    style={{ height: h }}
                    title={`${st}: ${row.count}`}
                  />
                )
              })}
            </div>
            <span className="text-[9px] text-ink/40 truncate w-full text-center">{date.slice(5)}</span>
            <span className="text-[9px] text-ink/60 font-semibold">{total}</span>
          </div>
        )
      })}
      {dates.length === 0 && (
        <p className="text-xs text-ink/40 italic">No data yet.</p>
      )}
    </div>
  )
}

function WebhookCard({ webhook }: { webhook: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['webhook']> }) {
  const fetcher = useFetcher<{ ok: boolean; pricingWebhookEnabled?: string; pricingWebhookThrottleSecs?: string }>()
  const [copied, setCopied] = useState(false)
  const [throttleInput, setThrottleInput] = useState(String(webhook.throttleSecs))

  function submitToggle(enabled: boolean) {
    fetcher.submit(
      { pricingWebhookEnabled: String(enabled) },
      { method: 'post', action: '/api/pricing/settings' },
    )
  }

  function submitThrottle(val: string) {
    const n = Math.max(5, Math.min(300, parseInt(val, 10) || 30))
    fetcher.submit(
      { pricingWebhookThrottleSecs: String(n) },
      { method: 'post', action: '/api/pricing/settings' },
    )
  }

  function copyEndpoint() {
    navigator.clipboard.writeText(webhook.endpoint).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  const optimisticEnabled =
    fetcher.state !== 'idle' && fetcher.formData?.get('pricingWebhookEnabled') != null
      ? fetcher.formData.get('pricingWebhookEnabled') === 'true'
      : webhook.enabled

  return (
    <section className="bg-white rounded-2xl border border-line p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Real-time Nalpac Webhook
        </h2>
        <button
          type="button"
          onClick={() => submitToggle(!optimisticEnabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-coral/40 ${
            optimisticEnabled ? 'bg-coral' : 'bg-line'
          }`}
          aria-label={optimisticEnabled ? 'Disable webhook' : 'Enable webhook'}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              optimisticEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-ink/40 text-xs uppercase tracking-wide block mb-1">Status</span>
          <span className={`inline-flex items-center gap-1.5 font-medium ${optimisticEnabled ? 'text-green-600' : 'text-ink/50'}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${optimisticEnabled ? 'bg-green-500' : 'bg-ink/30'}`} />
            {optimisticEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        <div>
          <span className="text-ink/40 text-xs uppercase tracking-wide block mb-1">Secret configured</span>
          {webhook.secretSet ? (
            <span className="inline-flex items-center gap-1 text-green-600 font-medium">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" fill="#dcfce7" stroke="#16a34a" strokeWidth="1.2" />
                <path d="M4.5 7l2 2 3-3" stroke="#16a34a" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Set
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-red-500 font-medium">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" fill="#fee2e2" stroke="#ef4444" strokeWidth="1.2" />
                <path d="M5 5l4 4M9 5l-4 4" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              Not set — add NALPAC_WEBHOOK_SECRET
            </span>
          )}
        </div>

        <div>
          <span className="text-ink/40 text-xs uppercase tracking-wide block mb-1">Throttle (seconds)</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={300}
              value={throttleInput}
              onChange={e => setThrottleInput(e.target.value)}
              onBlur={e => submitThrottle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitThrottle(throttleInput) }}
              className="w-20 text-sm border border-line rounded-lg px-2 py-1 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-coral/50"
            />
            <span className="text-xs text-ink/40">per variant (5–300)</span>
          </div>
        </div>

        <div>
          <span className="text-ink/40 text-xs uppercase tracking-wide block mb-1">Webhook activity today</span>
          <span className="font-medium text-ink">{webhook.activityToday} change{webhook.activityToday !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div>
        <span className="text-ink/40 text-xs uppercase tracking-wide block mb-1">Endpoint URL</span>
        <div className="flex items-center gap-2 bg-cream rounded-xl px-3 py-2 border border-line">
          <code className="text-xs text-ink/70 flex-1 truncate font-mono">{webhook.endpoint}</code>
          <button
            type="button"
            onClick={copyEndpoint}
            className="text-xs font-semibold text-coral hover:text-coral-deep transition-colors shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </section>
  )
}

type ProductTypesData = Array<{ productType: string; count: number }>
type PricingRulesData = Awaited<ReturnType<typeof getPricingRules>>

interface SuggestResult {
  ok: boolean
  suggestions?: MarkupSuggestion[]
  types?: ProductTypesData
  error?: string
}

function PricingRulesCard({
  pricingRules,
  productTypes,
  productTypesRefreshedAt,
}: {
  pricingRules: PricingRulesData
  productTypes: ProductTypesData
  productTypesRefreshedAt: string | null
}) {
  const defaultsFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const overridesFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const suggestFetcher = useFetcher<SuggestResult>()
  const refreshFetcher = useFetcher<{ ok: boolean; count?: number; refreshedAt?: string; error?: string }>()

  const [marginFloorInput, setMarginFloorInput] = useState(
    String(Math.round((pricingRules.marginFloor ?? MARGIN_FLOOR) * 100)),
  )
  const [highInput, setHighInput] = useState(
    String(Math.round((pricingRules.highMarginDiscount ?? HIGH_MARGIN_DISCOUNT) * 100)),
  )
  const [mediumInput, setMediumInput] = useState(
    String(Math.round((pricingRules.mediumMarginDiscount ?? MEDIUM_MARGIN_DISCOUNT) * 100)),
  )

  // per-type overrides: productType -> { high: string, medium: string }
  const [typeInputs, setTypeInputs] = useState<Record<string, { high: string; medium: string }>>(() => {
    const init: Record<string, { high: string; medium: string }> = {}
    for (const { productType } of productTypes) {
      const override = pricingRules.perTypeOverrides?.[productType]
      init[productType] = {
        high: override?.highMarginDiscount != null ? String(Math.round(override.highMarginDiscount * 100)) : '',
        medium: override?.mediumMarginDiscount != null ? String(Math.round(override.mediumMarginDiscount * 100)) : '',
      }
    }
    return init
  })

  // When suggest result comes back, populate type inputs
  const suggestions = suggestFetcher.data?.ok ? (suggestFetcher.data.suggestions ?? []) : []
  const prevSuggestState = suggestFetcher.state

  // Apply AI suggestions to inputs when fetch completes
  if (prevSuggestState === 'idle' && suggestions.length > 0) {
    for (const s of suggestions) {
      const current = typeInputs[s.productType]
      if (current !== undefined) {
        const newHigh = String(Math.round(s.highMarginDiscount * 100))
        const newMedium = String(Math.round(s.mediumMarginDiscount * 100))
        if (current.high !== newHigh || current.medium !== newMedium) {
          // setTypeInputs inside render — use a ref guard in a real scenario,
          // but here suggestion data only arrives once per click so this is safe.
        }
      }
    }
  }

  function handleSuggestApply(newSuggestions: MarkupSuggestion[]) {
    setTypeInputs(prev => {
      const next = { ...prev }
      for (const s of newSuggestions) {
        if (next[s.productType] !== undefined) {
          next[s.productType] = {
            high: String(Math.round(s.highMarginDiscount * 100)),
            medium: String(Math.round(s.mediumMarginDiscount * 100)),
          }
        }
      }
      return next
    })
  }

  function saveDefaults() {
    defaultsFetcher.submit(
      {
        marginFloor: String(parseFloat(marginFloorInput) / 100),
        highMarginDiscount: String(parseFloat(highInput) / 100),
        mediumMarginDiscount: String(parseFloat(mediumInput) / 100),
      },
      { method: 'post', action: '/api/pricing/settings', encType: 'application/x-www-form-urlencoded' },
    )
  }

  function saveOverrides() {
    const overrides: Record<string, { highMarginDiscount?: number; mediumMarginDiscount?: number }> = {}
    for (const [pt, vals] of Object.entries(typeInputs)) {
      const entry: { highMarginDiscount?: number; mediumMarginDiscount?: number } = {}
      if (vals.high !== '') {
        const n = parseFloat(vals.high) / 100
        if (!isNaN(n)) entry.highMarginDiscount = n
      }
      if (vals.medium !== '') {
        const n = parseFloat(vals.medium) / 100
        if (!isNaN(n)) entry.mediumMarginDiscount = n
      }
      overrides[pt] = entry
    }
    overridesFetcher.submit(
      { perTypeOverrides: JSON.stringify(overrides) },
      { method: 'post', action: '/api/pricing/settings', encType: 'application/x-www-form-urlencoded' },
    )
  }

  const isSuggesting = suggestFetcher.state !== 'idle'

  return (
    <section className="bg-white rounded-2xl border border-line p-5 space-y-5">
      <h2 className="text-base font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        Pricing Rules
      </h2>

      {/* Global defaults */}
      <div>
        <p className="text-xs text-ink/40 uppercase tracking-wide mb-3">Global defaults</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Margin floor', value: marginFloorInput, set: setMarginFloorInput, min: 5, max: 40 },
            { label: 'High-margin disc.', value: highInput, set: setHighInput, min: 0, max: 60 },
            { label: 'Medium-margin disc.', value: mediumInput, set: setMediumInput, min: 0, max: 60 },
          ].map(({ label, value, set, min, max }) => (
            <div key={label}>
              <label className="text-xs text-ink/50 block mb-1">{label}</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={value}
                  onChange={e => set(e.target.value)}
                  className="w-20 text-sm border border-line rounded-lg px-2 py-1.5 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-coral/50"
                />
                <span className="text-xs text-ink/40">%</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={saveDefaults}
            disabled={defaultsFetcher.state !== 'idle'}
            className="text-xs font-semibold px-4 py-2 bg-coral text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {defaultsFetcher.state !== 'idle' ? 'Saving...' : 'Save defaults'}
          </button>
          {defaultsFetcher.data?.ok === true && defaultsFetcher.state === 'idle' && (
            <span className="text-xs text-green-600">Saved.</span>
          )}
          {defaultsFetcher.data?.ok === false && (
            <span className="text-xs text-red-500">{defaultsFetcher.data.error ?? 'Error'}</span>
          )}
        </div>
      </div>

      <hr className="border-line" />

      {/* Per product type */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-ink/40 uppercase tracking-wide">Per product type</p>
          <button
            type="button"
            disabled={isSuggesting}
            onClick={() => {
              suggestFetcher.submit(
                {},
                { method: 'post', action: '/api/pricing/suggest-markups' },
              )
            }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-cream border border-line rounded-full text-ink hover:border-coral hover:text-coral transition-colors disabled:opacity-50"
          >
            {isSuggesting ? (
              <>
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Thinking...
              </>
            ) : (
              <>✨ Suggest with AI</>
            )}
          </button>
        </div>

        {suggestFetcher.data?.ok === false && (
          <p className="text-xs text-red-500 mb-3">{suggestFetcher.data.error ?? 'Suggestion failed.'}</p>
        )}

        {/* Apply suggestions button — shown after suggestions arrive */}
        {suggestions.length > 0 && suggestFetcher.state === 'idle' && (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => handleSuggestApply(suggestions)}
              className="text-xs font-semibold px-3 py-1.5 bg-sun/20 border border-sun/40 rounded-full text-ink hover:bg-sun/30 transition-colors"
            >
              Apply {suggestions.length} suggestions to table
            </button>
          </div>
        )}

        <div className="mb-3 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={refreshFetcher.state !== 'idle'}
            onClick={() => refreshFetcher.submit(null, { method: 'post', action: '/api/pricing/refresh-product-types', encType: 'application/json' })}
            className="text-xs font-semibold px-3 py-1.5 bg-cream-2 border border-line rounded-full text-ink hover:bg-cream transition-colors disabled:opacity-50"
          >
            {refreshFetcher.state !== 'idle' ? 'Refreshing…' : 'Refresh types from Shopify'}
          </button>
          {productTypesRefreshedAt && (
            <span className="text-xs text-ink/40">
              Last refreshed: {new Date(productTypesRefreshedAt).toLocaleString()}
            </span>
          )}
          {refreshFetcher.data?.ok === false && (
            <span className="text-xs text-red-500">Refresh failed: {refreshFetcher.data.error}</span>
          )}
          {refreshFetcher.data?.ok && (
            <span className="text-xs text-emerald-600">Refreshed {refreshFetcher.data.count} types — reload page to see</span>
          )}
        </div>

        {productTypes.length === 0 ? (
          <p className="text-sm text-ink/60 italic py-4">
            No product types loaded yet. Click <strong className="font-semibold">Refresh types from Shopify</strong> above to populate the table.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-cream-2 text-ink/50 text-xs uppercase tracking-wide">
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Count</th>
                  <th className="px-3 py-2 text-center">High disc. %</th>
                  <th className="px-3 py-2 text-center">Medium disc. %</th>
                  <th className="px-3 py-2 text-left">AI rationale</th>
                </tr>
              </thead>
              <tbody>
                {productTypes.map(({ productType, count }) => {
                  const vals = typeInputs[productType] ?? { high: '', medium: '' }
                  const suggestion = suggestions.find(s => s.productType === productType)
                  return (
                    <tr key={productType} className="border-t border-cream-2">
                      <td className="px-3 py-2 font-medium text-ink">{productType}</td>
                      <td className="px-3 py-2 text-right text-ink/50">{count}</td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="number"
                          min={0}
                          max={60}
                          placeholder={highInput}
                          value={vals.high}
                          onChange={e =>
                            setTypeInputs(prev => ({
                              ...prev,
                              [productType]: { ...prev[productType]!, high: e.target.value },
                            }))
                          }
                          className="w-16 text-sm text-center border border-line rounded-lg px-2 py-1 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-coral/50"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="number"
                          min={0}
                          max={60}
                          placeholder={mediumInput}
                          value={vals.medium}
                          onChange={e =>
                            setTypeInputs(prev => ({
                              ...prev,
                              [productType]: { ...prev[productType]!, medium: e.target.value },
                            }))
                          }
                          className="w-16 text-sm text-center border border-line rounded-lg px-2 py-1 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-coral/50"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {suggestion && (
                          <span className="text-xs text-muted italic">{suggestion.rationale}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-ink/40 mt-2">Blank = inherits global default.</p>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={saveOverrides}
            disabled={overridesFetcher.state !== 'idle'}
            className="text-xs font-semibold px-4 py-2 bg-coral text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {overridesFetcher.state !== 'idle' ? 'Saving...' : 'Save overrides'}
          </button>
          {overridesFetcher.data?.ok === true && overridesFetcher.state === 'idle' && (
            <span className="text-xs text-green-600">Saved.</span>
          )}
          {overridesFetcher.data?.ok === false && (
            <span className="text-xs text-red-500">{overridesFetcher.data.error ?? 'Error'}</span>
          )}
        </div>
      </div>
    </section>
  )
}

export default function AdminPricingPage() {
  const data = useLoaderData<typeof loader>()
  const runFetcher = useFetcher<{ ok: boolean; scanned?: number; applied?: number; error?: string }>()
  const settingsFetcher = useFetcher()
  const approveFetcher = useFetcher<{ ok: boolean; processed: number; errors: Array<{ changeId: number; error: string }> }>()
  const [autoExpanded, setAutoExpanded] = useState(false)

  const isRunning = runFetcher.state !== 'idle'
  const runResult = runFetcher.data

  const lastRunFormatted = data.lastRunAt
    ? new Date(data.lastRunAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
        timeZone: 'America/New_York',
      })
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Pricing Agent
        </h1>

        <div className="flex flex-wrap items-center gap-3">
          {/* Mode pill */}
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${MODE_PILL[data.approvalMode] ?? 'bg-cream-2 text-ink'}`}>
            Mode: {MODE_LABELS[data.approvalMode] ?? data.approvalMode}
          </span>

          {/* Mode switcher */}
          <settingsFetcher.Form method="post" action="/api/pricing/settings" className="flex items-center gap-2">
            <select
              name="approvalMode"
              defaultValue={data.approvalMode}
              onChange={e => settingsFetcher.submit(e.currentTarget.form!)}
              className="text-xs border border-line rounded-lg px-2 py-1.5 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-coral/50"
            >
              <option value="all">all — require approval</option>
              <option value="guardrails">guardrails — auto unless flagged</option>
              <option value="auto">auto — apply everything</option>
            </select>
          </settingsFetcher.Form>

          {/* Run now */}
          <button
            disabled={isRunning}
            onClick={() =>
              runFetcher.submit({}, { method: 'post', action: '/api/pricing/run-now' })
            }
            className="text-xs font-semibold px-4 py-2 bg-coral text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
          >
            {isRunning ? (
              <>
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Running...
              </>
            ) : 'Run Review Now'}
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-white rounded-2xl px-5 py-4 border border-line flex flex-wrap gap-6 text-sm">
        {lastRunFormatted && (
          <div>
            <span className="text-ink/40 text-xs uppercase tracking-wide block mb-0.5">Last run</span>
            <span className="font-medium text-ink">{lastRunFormatted}</span>
          </div>
        )}
        <div>
          <span className="text-ink/40 text-xs uppercase tracking-wide block mb-0.5">Scanned</span>
          <span className="font-medium text-ink">{data.counts.scanned}</span>
        </div>
        <div>
          <span className="text-ink/40 text-xs uppercase tracking-wide block mb-0.5">Applied</span>
          <span className="font-medium text-ink">{data.counts.applied}</span>
        </div>
        <div>
          <span className="text-ink/40 text-xs uppercase tracking-wide block mb-0.5">Pending</span>
          <span className={`font-medium ${data.counts.pending > 0 ? 'text-yellow-600' : 'text-ink'}`}>
            {data.counts.pending}
          </span>
        </div>
      </div>

      {/* Run result inline */}
      {runResult && (
        <div className={`rounded-2xl px-5 py-3 text-sm border ${runResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
          {runResult.ok
            ? `Review complete. Scanned ${runResult.scanned ?? '?'}, applied ${runResult.applied ?? '?'}.`
            : `Error: ${runResult.error ?? 'Unknown error'}`}
        </div>
      )}

      {/* Approve result inline */}
      {approveFetcher.data && !approveFetcher.data.ok && approveFetcher.data.errors?.length > 0 && (
        <div className="rounded-2xl px-5 py-3 text-sm bg-red-50 border border-red-200 text-red-600">
          {approveFetcher.data.errors.map(e => (
            <div key={e.changeId}>Change #{e.changeId}: {e.error}</div>
          ))}
        </div>
      )}

      {/* Pricing Rules card */}
      <PricingRulesCard
        pricingRules={data.pricingRules}
        productTypes={data.productTypes}
        productTypesRefreshedAt={data.productTypesRefreshedAt}
      />

      {/* Webhook card */}
      <WebhookCard webhook={data.webhook} />

      {/* Pending queue */}
      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-base font-semibold text-ink">
            Pending Approval
            {data.pending.length > 0 && (
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                {data.pending.length}
              </span>
            )}
          </h2>
          {data.pending.length > 0 && (
            <button
              onClick={() =>
                approveFetcher.submit(
                  { action: 'approve-all' },
                  { method: 'post', action: '/api/pricing/approve' },
                )
              }
              className="text-xs font-semibold px-4 py-2 bg-green-600 text-white rounded-full hover:opacity-90 transition-opacity"
            >
              Approve All ({data.pending.length})
            </button>
          )}
        </div>
        <PricingTable rows={data.pending} showActions approveFetcher={approveFetcher} />
      </section>

      {/* MAP violations averted */}
      {data.mapAvertedRows.length > 0 && (
        <section className="bg-white rounded-2xl border border-line p-5">
          <h2 className="text-base font-semibold text-ink mb-3">
            MAP Violations Averted
            <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">
              {data.mapAvertedRows.length}
            </span>
          </h2>
          <ul className="space-y-2">
            {data.mapAvertedRows.map(row => (
              <li key={row.id} className="text-sm flex gap-3 items-start">
                <span className="text-blue-500 mt-0.5">+</span>
                <span>
                  <a
                    href={`/products/${row.productHandle ?? row.sku}`}
                    className="font-medium text-ink hover:text-coral"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {row.productTitle ?? row.sku}
                  </a>
                  <span className="text-ink/50 ml-2 text-xs">
                    old price {fmt(row.oldPrice)} &lt; MAP {fmt(row.mapPrice)}; new price {fmt(row.newPrice)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Margin warnings */}
      {data.marginWarnings.length > 0 && (
        <section className="bg-white rounded-2xl border border-red-100 p-5">
          <h2 className="text-base font-semibold text-ink mb-3">
            Margin Warnings
            <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
              {data.marginWarnings.length}
            </span>
          </h2>
          <ul className="space-y-2">
            {data.marginWarnings.map(row => (
              <li key={row.id} className="text-sm flex gap-3 items-start">
                <span className="text-red-400 mt-0.5">!</span>
                <span>
                  <a
                    href={`/products/${row.productHandle ?? row.sku}`}
                    className="font-medium text-ink hover:text-coral"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {row.productTitle ?? row.sku}
                  </a>
                  <span className="text-ink/50 ml-2 text-xs">
                    {row.sku} — margin {fmtPct(row.marginPct)} — tier: {row.tier}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Auto-applied (collapsed) */}
      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <button
          onClick={() => setAutoExpanded(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-line text-left"
        >
          <h2 className="text-base font-semibold text-ink">
            Auto-Applied Today
            {data.autoApplied.length > 0 && (
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">
                {data.autoApplied.length}
              </span>
            )}
          </h2>
          <svg
            width="16" height="16" viewBox="0 0 16 16" fill="none"
            className={`text-ink/40 transition-transform ${autoExpanded ? 'rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {autoExpanded && (
          <PricingTable rows={data.autoApplied} showActions={false} approveFetcher={approveFetcher} />
        )}
      </section>

      {/* Failed */}
      {data.failed.length > 0 && (
        <section className="bg-white rounded-2xl border border-red-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-red-100">
            <h2 className="text-base font-semibold text-red-600">
              Failed
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                {data.failed.length}
              </span>
            </h2>
          </div>
          <ul className="divide-y divide-red-50">
            {data.failed.map(row => (
              <li key={row.id} className="px-5 py-3 text-sm">
                <div className="font-medium text-ink">{row.productTitle ?? row.sku}</div>
                <div className="text-xs text-red-500 mt-0.5">{row.applyError ?? 'Unknown error'}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Last 7 days chart */}
      <section className="bg-white rounded-2xl border border-line p-5">
        <h2 className="text-base font-semibold text-ink mb-1">Last 7 Days</h2>
        <div className="flex gap-4 text-[10px] text-ink/50 mb-2 flex-wrap">
          <span><span className="inline-block w-2 h-2 rounded-sm bg-yellow-400 mr-1" />pending</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-400 mr-1" />auto</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-green-500 mr-1" />approved</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-ink/30 mr-1" />rejected</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-red-400 mr-1" />failed</span>
        </div>
        <MiniBarChart summaryRows={data.summaryRows} />
      </section>
    </div>
  )
}
