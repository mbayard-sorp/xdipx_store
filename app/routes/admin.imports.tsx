import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, Link } from 'react-router'
import { useState } from 'react'
import { requireAdmin } from '~/lib/session.server'
import {
  getImportCandidatesByStatus,
  getRecentImportRuns,
} from '~/lib/import-monitor.server'
import type { ImportCandidateRow, ImportMonitorRunRow } from '~/lib/import-monitor.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { setPipelineSetting } from '~/lib/pricing-webhook.server'

export const meta: MetaFunction = () => [{ title: 'Import Monitor — xdipx Admin' }]

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const [
    pending,
    watching,
    imported,
    recentRuns,
    runDaysRaw,
    enabledRaw,
    phaseRaw,
    lastRunAtRaw,
    minMarkupRaw,
    minQtyRaw,
    minGapRaw,
    requireCarriedRaw,
    maxPerDayRaw,
    enrichEnabledRaw,
    enrichBatchCapRaw,
    productManagerEnabledRaw,
    productManagerMaxActionsRaw,
  ] = await Promise.all([
    getImportCandidatesByStatus(['pending']),
    getImportCandidatesByStatus(['watching']),
    getImportCandidatesByStatus(['imported'], 100),
    getRecentImportRuns(7),
    getPipelineSetting('import_monitor_run_days'),
    getPipelineSetting('import_monitor_enabled'),
    getPipelineSetting('import_monitor_phase'),
    getPipelineSetting('import_monitor_last_run_at'),
    getPipelineSetting('monitor_p2_min_markup_pct'),
    getPipelineSetting('monitor_p2_min_qty'),
    getPipelineSetting('monitor_p2_min_gap_score'),
    getPipelineSetting('monitor_p2_require_carried_brand'),
    getPipelineSetting('monitor_p2_max_auto_imports_per_day'),
    getPipelineSetting('import_enrich_enabled'),
    getPipelineSetting('import_enrich_batch_cap'),
    getPipelineSetting('product_manager_enabled'),
    getPipelineSetting('product_manager_max_actions_per_run'),
  ])

  const runDays = (runDaysRaw ?? '0,1,2,3,4,5,6')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n >= 0 && n <= 6)

  const enabled = enabledRaw !== 'false'
  const phase = parseInt(phaseRaw ?? '1', 10) as 1 | 2 | 3

  const latest = recentRuns[0] ?? null

  const live = imported.filter(r => r.publishedAt != null).length
  const enrichedNotLive = imported.filter(r => r.enrichedAt != null && r.publishedAt == null).length
  const awaitingEnrich = imported.length - live - enrichedNotLive

  return {
    pending,
    watching,
    imported,
    recentRuns,
    settings: {
      runDays,
      enabled,
      phase,
      lastRunAt: lastRunAtRaw,
      minMarkupPct:    parseFloat(minMarkupRaw ?? '0.08'),
      minQty:          parseInt(minQtyRaw ?? '30', 10) || 30,
      minGapScore:     parseFloat(minGapRaw ?? '3.0'),
      requireCarried:  (requireCarriedRaw ?? 'true') !== 'false',
      maxPerDay:       Math.max(0, parseInt(maxPerDayRaw ?? '8', 10) || 0),
      enrichEnabled:   enrichEnabledRaw === 'true',
      enrichBatchCap:  parseInt(enrichBatchCapRaw ?? '10', 10) || 10,
      productManagerEnabled:      productManagerEnabledRaw === 'true',
      productManagerMaxActions:   parseInt(productManagerMaxActionsRaw ?? '20', 10) || 20,
    },
    counts: {
      pending: pending.length,
      watching: watching.length,
      imported: imported.length,
      awaitingEnrich,
      enrichedNotLive,
      live,
      lastRunFound: latest?.candidatesFound ?? 0,
      lastRunImported: latest?.autoImported ?? 0,
    },
  }
}

type LoaderData = Awaited<ReturnType<typeof loader>>

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'save-run-days') {
    const days = (form.get('days') as string | null) ?? ''
    await setPipelineSetting('import_monitor_run_days', days)
    return { ok: true, saved: 'run-days' }
  }

  if (intent === 'save-phase') {
    const phase = (form.get('phase') as string | null) ?? '1'
    await setPipelineSetting('import_monitor_phase', phase)
    return { ok: true, saved: 'phase' }
  }

  if (intent === 'toggle-enabled') {
    const current = form.get('current') as string
    const next = current === 'true' ? 'false' : 'true'
    await setPipelineSetting('import_monitor_enabled', next)
    return { ok: true, saved: 'enabled' }
  }

  if (intent === 'save-p2-setting') {
    const key = form.get('key') as string | null
    const value = form.get('value') as string | null
    const ALLOWED_KEYS = [
      'monitor_p2_min_markup_pct',
      'monitor_p2_min_qty',
      'monitor_p2_min_gap_score',
      'monitor_p2_max_auto_imports_per_day',
      'import_enrich_batch_cap',
      'product_manager_max_actions_per_run',
    ]
    if (!key || value == null || !ALLOWED_KEYS.includes(key)) {
      return { ok: false, error: `Invalid key: ${key}` }
    }
    await setPipelineSetting(key, value)
    return { ok: true, saved: key }
  }

  if (intent === 'toggle-p2-setting') {
    const key = form.get('key') as string | null
    const current = form.get('current') as string
    const ALLOWED_KEYS = ['monitor_p2_require_carried_brand', 'import_enrich_enabled', 'product_manager_enabled']
    if (!key || !ALLOWED_KEYS.includes(key)) {
      return { ok: false, error: `Invalid key: ${key}` }
    }
    const next = current === 'true' ? 'false' : 'true'
    await setPipelineSetting(key, next)
    return { ok: true, saved: key }
  }

  return { ok: false, error: `Unknown intent: ${intent}` }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(v: string | number | null | undefined): string {
  if (v == null) return '—'
  const n = parseFloat(String(v))
  return isNaN(n) ? '—' : `$${n.toFixed(2)}`
}

// margin_pct is stored already as a percent (e.g. "45.00"), not a fraction —
// see import-monitor.server.ts where priceResult.marginPct is *100 before write.
function fmtPct(v: string | number | null | undefined): string {
  if (v == null) return '—'
  const n = parseFloat(String(v))
  return isNaN(n) ? '—' : `${n.toFixed(1)}%`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'never'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/**
 * Post-import lifecycle stage for an imported candidate, derived from the
 * enrich/publish timestamps (migration 040). Mirrors the cron tick order:
 * imported -> enriching -> enriched -> live.
 */
function lifecycleStage(row: ImportCandidateRow): { label: string; cls: string } {
  if (row.publishedAt != null) return { label: 'Live', cls: 'bg-green-100 text-green-700' }
  if (row.enrichedAt != null) return { label: 'Enriched', cls: 'bg-blue-100 text-blue-700' }
  if (row.enrichBatchId != null) return { label: 'Enriching', cls: 'bg-plum-soft text-plum' }
  return { label: 'Queued', cls: 'bg-line text-muted' }
}

const TIER_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-yellow-100 text-yellow-700',
  D: 'bg-line text-muted',
}

function TierBadge({ tier }: { tier: string | null }) {
  const t = tier ?? '?'
  const cls = TIER_COLORS[t] ?? 'bg-line text-muted'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {t}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Run-status header card
// ---------------------------------------------------------------------------

function RunStatusCard({
  recentRuns,
  counts,
  settings,
}: {
  recentRuns: ImportMonitorRunRow[]
  counts: LoaderData['counts']
  settings: LoaderData['settings']
}) {
  const runFetcher = useFetcher<{ ok: boolean; candidatesFound?: number; autoImported?: number; error?: string }>()
  const isRunning = runFetcher.state !== 'idle'
  const latest = recentRuns[0] ?? null

  return (
    <section className="bg-white rounded-2xl border border-line p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div>
          <h2
            className="text-base font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Monitor Status
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Last run: {fmtDate(settings.lastRunAt ?? latest?.startedAt?.toString())}
          </p>
        </div>
        <button
          disabled={isRunning}
          onClick={() =>
            runFetcher.submit({}, { method: 'post', action: '/api/import-monitor/run' })
          }
          className="text-xs font-semibold px-4 py-2 bg-coral text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5 self-start sm:self-auto"
        >
          {isRunning ? (
            <>
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Running...
            </>
          ) : (
            'Trigger now'
          )}
        </button>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-5 text-sm">
        <div>
          <span className="text-muted text-xs uppercase tracking-wide block mb-0.5">Pending</span>
          <span className={`font-semibold ${counts.pending > 0 ? 'text-yellow-600' : 'text-ink'}`}>
            {counts.pending}
          </span>
        </div>
        <div>
          <span className="text-muted text-xs uppercase tracking-wide block mb-0.5">Watching</span>
          <span className="font-semibold text-ink">{counts.watching}</span>
        </div>
        {latest && (
          <>
            <div>
              <span className="text-muted text-xs uppercase tracking-wide block mb-0.5">Last found</span>
              <span className="font-semibold text-ink">{latest.candidatesFound ?? 0}</span>
            </div>
            <div>
              <span className="text-muted text-xs uppercase tracking-wide block mb-0.5">Auto-imported</span>
              <span className="font-semibold text-ink">{latest.autoImported ?? 0}</span>
            </div>
            <div>
              <span className="text-muted text-xs uppercase tracking-wide block mb-0.5">Feeds ok</span>
              <span className={`font-semibold ${latest.feedsOk ? 'text-green-600' : 'text-red-500'}`}>
                {latest.feedsOk ? 'Yes' : 'No'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Run result banner */}
      {runFetcher.data && (
        <div
          className={`rounded-xl px-4 py-3 text-sm border ${
            runFetcher.data.ok
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-600'
          }`}
        >
          {runFetcher.data.ok
            ? `Run complete. Found ${runFetcher.data.candidatesFound ?? '?'} candidates, auto-imported ${runFetcher.data.autoImported ?? 0}.`
            : `Error: ${runFetcher.data.error ?? 'Unknown error'}`}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function SettingsPanel({ settings }: { settings: LoaderData['settings'] }) {
  const daysFetcher = useFetcher<{ ok: boolean }>()
  const phaseFetcher = useFetcher<{ ok: boolean }>()
  const toggleFetcher = useFetcher<{ ok: boolean }>()

  // Optimistic state for run days checkboxes
  const optimisticDays: number[] =
    daysFetcher.state !== 'idle' && daysFetcher.formData?.get('days') != null
      ? (daysFetcher.formData.get('days') as string)
          .split(',')
          .map(s => parseInt(s, 10))
          .filter(n => !isNaN(n))
      : settings.runDays

  // Optimistic phase
  const optimisticPhase: 1 | 2 | 3 =
    phaseFetcher.state !== 'idle' && phaseFetcher.formData?.get('phase') != null
      ? (parseInt(phaseFetcher.formData.get('phase') as string, 10) as 1 | 2 | 3)
      : settings.phase

  // Optimistic enabled
  const optimisticEnabled: boolean =
    toggleFetcher.state !== 'idle' && toggleFetcher.formData?.get('current') != null
      ? toggleFetcher.formData.get('current') !== 'true'
      : settings.enabled

  function toggleDay(day: number) {
    const next = optimisticDays.includes(day)
      ? optimisticDays.filter(d => d !== day)
      : [...optimisticDays, day].sort((a, b) => a - b)
    daysFetcher.submit(
      { intent: 'save-run-days', days: next.join(',') },
      { method: 'post' },
    )
  }

  function setPhase(p: 1 | 2 | 3) {
    phaseFetcher.submit(
      { intent: 'save-phase', phase: String(p) },
      { method: 'post' },
    )
  }

  function toggleEnabled() {
    toggleFetcher.submit(
      { intent: 'toggle-enabled', current: String(optimisticEnabled) },
      { method: 'post' },
    )
  }

  const phases: { val: 1 | 2 | 3; label: string; desc: string }[] = [
    { val: 1, label: 'Phase 1', desc: 'All candidates stay pending — manual review only' },
    { val: 2, label: 'Phase 2', desc: 'Auto-import tier A/B candidates above thresholds (see below)' },
    { val: 3, label: 'Phase 3', desc: 'Relaxed thresholds, up to 5/day' },
  ]

  return (
    <section className="bg-white rounded-2xl border border-line p-5 space-y-5">
      <h2
        className="text-base font-semibold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Settings
      </h2>

      {/* Enabled toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ink">Monitor enabled</p>
          <p className="text-xs text-muted">Cron will run on scheduled days when on</p>
        </div>
        <button
          type="button"
          onClick={toggleEnabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-coral/40 ${
            optimisticEnabled ? 'bg-coral' : 'bg-line'
          }`}
          aria-label={optimisticEnabled ? 'Disable monitor' : 'Enable monitor'}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              optimisticEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Run days */}
      <div>
        <p className="text-sm font-medium text-ink mb-2">Run days (UTC)</p>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, idx) => {
            const active = optimisticDays.includes(idx)
            return (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  active
                    ? 'bg-coral text-white border-coral'
                    : 'bg-cream text-ink border-line hover:border-coral/50'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Phase segmented control */}
      <div>
        <p className="text-sm font-medium text-ink mb-2">Automation phase</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {phases.map(({ val, label, desc }) => (
            <button
              key={val}
              type="button"
              onClick={() => setPhase(val)}
              className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                optimisticPhase === val
                  ? 'border-coral bg-coral/5 text-ink'
                  : 'border-line bg-cream text-ink hover:border-coral/50'
              }`}
            >
              <div className="text-sm font-semibold mb-0.5">
                {label}
                {optimisticPhase === val && (
                  <span className="ml-2 text-xs text-coral">active</span>
                )}
              </div>
              <div className="text-xs text-muted">{desc}</div>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Phase 2 gate thresholds + enrichment kill switch
// ---------------------------------------------------------------------------

function Phase2SettingsPanel({ settings }: { settings: LoaderData['settings'] }) {
  const numberFetcher = useFetcher<{ ok: boolean; saved?: string }>()
  const carriedFetcher = useFetcher<{ ok: boolean }>()
  const enrichFetcher = useFetcher<{ ok: boolean }>()
  const productManagerFetcher = useFetcher<{ ok: boolean }>()

  const [markupPct, setMarkupPct] = useState(String(settings.minMarkupPct))
  const [minQty, setMinQty] = useState(String(settings.minQty))
  const [minGapScore, setMinGapScore] = useState(String(settings.minGapScore))
  const [maxPerDay, setMaxPerDay] = useState(String(settings.maxPerDay))
  const [enrichBatchCap, setEnrichBatchCap] = useState(String(settings.enrichBatchCap))
  const [productManagerMaxActions, setProductManagerMaxActions] = useState(String(settings.productManagerMaxActions))

  const optimisticCarried: boolean =
    carriedFetcher.state !== 'idle' && carriedFetcher.formData?.get('current') != null
      ? carriedFetcher.formData.get('current') !== 'true'
      : settings.requireCarried

  const optimisticEnrichEnabled: boolean =
    enrichFetcher.state !== 'idle' && enrichFetcher.formData?.get('current') != null
      ? enrichFetcher.formData.get('current') !== 'true'
      : settings.enrichEnabled

  const optimisticProductManagerEnabled: boolean =
    productManagerFetcher.state !== 'idle' && productManagerFetcher.formData?.get('current') != null
      ? productManagerFetcher.formData.get('current') !== 'true'
      : settings.productManagerEnabled

  function saveNumber(key: string, value: string) {
    numberFetcher.submit({ intent: 'save-p2-setting', key, value }, { method: 'post' })
  }

  function toggleCarried() {
    carriedFetcher.submit(
      { intent: 'toggle-p2-setting', key: 'monitor_p2_require_carried_brand', current: String(optimisticCarried) },
      { method: 'post' },
    )
  }

  function toggleEnrich() {
    enrichFetcher.submit(
      { intent: 'toggle-p2-setting', key: 'import_enrich_enabled', current: String(optimisticEnrichEnabled) },
      { method: 'post' },
    )
  }

  function toggleProductManager() {
    productManagerFetcher.submit(
      { intent: 'toggle-p2-setting', key: 'product_manager_enabled', current: String(optimisticProductManagerEnabled) },
      { method: 'post' },
    )
  }

  return (
    <section className="bg-white rounded-2xl border border-line p-5 space-y-5">
      <h2
        className="text-base font-semibold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Phase 2 auto-import gates
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-ink">Min markup over wholesale</span>
          <p className="text-xs text-muted mb-1">Fraction, e.g. 0.08 = 8% above wholesale cost (covers processor fees)</p>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={markupPct}
              onChange={e => setMarkupPct(e.target.value)}
              className="text-sm border border-line rounded-lg px-3 py-1.5 w-28"
            />
            <button
              type="button"
              onClick={() => saveNumber('monitor_p2_min_markup_pct', markupPct)}
              className="text-xs font-semibold px-3 py-1.5 bg-cream border border-line rounded-lg hover:border-coral/50"
            >
              Save
            </button>
          </div>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Min qty available</span>
          <p className="text-xs text-muted mb-1">Total qty across variants required to auto-import</p>
          <div className="flex gap-2">
            <input
              type="number"
              step="1"
              min="0"
              value={minQty}
              onChange={e => setMinQty(e.target.value)}
              className="text-sm border border-line rounded-lg px-3 py-1.5 w-28"
            />
            <button
              type="button"
              onClick={() => saveNumber('monitor_p2_min_qty', minQty)}
              className="text-xs font-semibold px-3 py-1.5 bg-cream border border-line rounded-lg hover:border-coral/50"
            >
              Save
            </button>
          </div>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Min gap score</span>
          <p className="text-xs text-muted mb-1">Gap score floor (~1-6 scale)</p>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.1"
              min="0"
              value={minGapScore}
              onChange={e => setMinGapScore(e.target.value)}
              className="text-sm border border-line rounded-lg px-3 py-1.5 w-28"
            />
            <button
              type="button"
              onClick={() => saveNumber('monitor_p2_min_gap_score', minGapScore)}
              className="text-xs font-semibold px-3 py-1.5 bg-cream border border-line rounded-lg hover:border-coral/50"
            >
              Save
            </button>
          </div>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Max auto-imports / day</span>
          <p className="text-xs text-muted mb-1">Daily cap on Phase 2 auto-imports</p>
          <div className="flex gap-2">
            <input
              type="number"
              step="1"
              min="0"
              value={maxPerDay}
              onChange={e => setMaxPerDay(e.target.value)}
              className="text-sm border border-line rounded-lg px-3 py-1.5 w-28"
            />
            <button
              type="button"
              onClick={() => saveNumber('monitor_p2_max_auto_imports_per_day', maxPerDay)}
              className="text-xs font-semibold px-3 py-1.5 bg-cream border border-line rounded-lg hover:border-coral/50"
            >
              Save
            </button>
          </div>
        </label>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ink">Require carried brand</p>
          <p className="text-xs text-muted">Tier B masters must belong to a brand already in the catalog</p>
        </div>
        <button
          type="button"
          onClick={toggleCarried}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-coral/40 ${
            optimisticCarried ? 'bg-coral' : 'bg-line'
          }`}
          aria-label={optimisticCarried ? 'Disable carried-brand requirement' : 'Enable carried-brand requirement'}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              optimisticCarried ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-line pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">Enrichment + publish (kill switch)</p>
            <p className="text-xs text-muted">
              Starts Anthropic Batch API spend and eventually publishes imported products live. Leave off unless intentionally starting enrichment.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleEnrich}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-coral/40 shrink-0 ${
              optimisticEnrichEnabled ? 'bg-coral' : 'bg-line'
            }`}
            aria-label={optimisticEnrichEnabled ? 'Disable enrichment' : 'Enable enrichment'}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                optimisticEnrichEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink">Enrichment batch cap</span>
          <p className="text-xs text-muted mb-1">Max candidates per enrichment batch run</p>
          <div className="flex gap-2">
            <input
              type="number"
              step="1"
              min="1"
              value={enrichBatchCap}
              onChange={e => setEnrichBatchCap(e.target.value)}
              className="text-sm border border-line rounded-lg px-3 py-1.5 w-28"
            />
            <button
              type="button"
              onClick={() => saveNumber('import_enrich_batch_cap', enrichBatchCap)}
              className="text-xs font-semibold px-3 py-1.5 bg-cream border border-line rounded-lg hover:border-coral/50"
            >
              Save
            </button>
          </div>
        </label>
      </div>

      <div className="border-t border-line pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">Autonomous import queue management (product-manager agent)</p>
            <p className="text-xs text-muted">
              Lets the product-manager agent approve/reject/watch import candidates on its own judgment without human review. Combined with the enrichment kill switch above, this starts fully unattended enrichment/publish. Leave off unless intentionally going hands-off.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleProductManager}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-coral/40 shrink-0 ${
              optimisticProductManagerEnabled ? 'bg-coral' : 'bg-line'
            }`}
            aria-label={optimisticProductManagerEnabled ? 'Disable autonomous import queue management' : 'Enable autonomous import queue management'}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                optimisticProductManagerEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink">Max autonomous actions / run</span>
          <p className="text-xs text-muted mb-1">Per-run cap on candidates the product-manager agent can approve/reject/watch</p>
          <div className="flex gap-2">
            <input
              type="number"
              step="1"
              min="0"
              value={productManagerMaxActions}
              onChange={e => setProductManagerMaxActions(e.target.value)}
              className="text-sm border border-line rounded-lg px-3 py-1.5 w-28"
            />
            <button
              type="button"
              onClick={() => saveNumber('product_manager_max_actions_per_run', productManagerMaxActions)}
              className="text-xs font-semibold px-3 py-1.5 bg-cream border border-line rounded-lg hover:border-coral/50"
            >
              Save
            </button>
          </div>
        </label>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Row action buttons (per-row fetcher)
// ---------------------------------------------------------------------------

function CandidateRowActions({ row }: { row: ImportCandidateRow }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>()
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const isSubmitting = fetcher.state !== 'idle'

  function submit(intent: 'approve' | 'reject' | 'watch') {
    fetcher.submit(
      {
        intent,
        id: String(row.id),
        ...(intent === 'reject' ? { reason: rejectReason } : {}),
      },
      { method: 'post', action: '/api/import-monitor/candidate-action' },
    )
  }

  if (fetcher.data?.ok) {
    return <span className="text-xs text-muted italic">Done</span>
  }

  return (
    <div className="flex flex-col gap-1 min-w-[140px]">
      {showRejectInput ? (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            placeholder="Reason (optional)"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            className="text-xs border border-line rounded px-2 py-1 w-full"
          />
          <div className="flex gap-1">
            <button
              onClick={() => submit('reject')}
              disabled={isSubmitting}
              className="flex-1 text-xs px-2 py-1 bg-line text-muted rounded hover:bg-red-100 hover:text-red-600 transition-colors disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              onClick={() => setShowRejectInput(false)}
              className="text-xs px-2 py-1 border border-line rounded hover:bg-cream"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => submit('approve')}
            disabled={isSubmitting}
            className="text-xs px-3 py-1 bg-coral text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 font-semibold"
          >
            Approve
          </button>
          <button
            onClick={() => setShowRejectInput(true)}
            disabled={isSubmitting}
            className="text-xs px-3 py-1 bg-cream text-muted rounded-full border border-line hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => submit('watch')}
            disabled={isSubmitting}
            className="text-xs px-3 py-1 bg-cream rounded-full border border-line hover:border-sage transition-colors disabled:opacity-50"
            style={{ color: 'var(--color-sage)' }}
          >
            Watch
          </button>
        </div>
      )}
      {fetcher.data?.ok === false && (
        <p className="text-xs text-red-500">{fetcher.data.error}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Candidates table
// ---------------------------------------------------------------------------

/** Format the variant count + axis names for the Variants column. */
function fmtVariants(row: ImportCandidateRow): string {
  const count = row.variantCount ?? 1
  if (count <= 1) return '—'
  const axes = (row.axes ?? []) as { name: string; values: string[] }[]
  const axisLabel = axes.map(a => a.name).join('×')
  return axisLabel ? `${count} · ${axisLabel}` : String(count)
}

function CandidatesTable({
  rows,
  showActions,
}: {
  rows: ImportCandidateRow[]
  showActions: boolean
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted px-5 py-8 text-center">No candidates.</p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">
              Title
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden sm:table-cell">
              Brand
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">
              Tier
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">
              Score
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden sm:table-cell">
              Variants
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden md:table-cell">
              Margin
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden md:table-cell">
              Price
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden md:table-cell">
              Qty
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden lg:table-cell">
              Gap reason
            </th>
            {showActions && (
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(row => (
            <tr key={row.id} className="hover:bg-cream/50 transition-colors">
              <td className="px-4 py-3 max-w-[180px]">
                <div className="flex items-start gap-1.5 flex-wrap">
                  <span className="block truncate font-medium text-ink text-xs" title={row.productTitle ?? ''}>
                    {row.productTitle ?? '—'}
                  </span>
                  {row.needsReview && (
                    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                      review
                    </span>
                  )}
                </div>
                <span className="block text-[10px] text-muted font-mono">{row.sku}</span>
              </td>
              <td className="px-4 py-3 text-xs text-muted hidden sm:table-cell">
                {row.brand ?? '—'}
              </td>
              <td className="px-4 py-3">
                <TierBadge tier={row.tier} />
              </td>
              <td className="px-4 py-3 text-xs font-semibold text-ink">
                {row.dealScore != null ? parseFloat(String(row.dealScore)).toFixed(2) : '—'}
              </td>
              <td className="px-4 py-3 text-xs text-muted hidden sm:table-cell">
                {fmtVariants(row)}
              </td>
              <td className="px-4 py-3 text-xs text-ink hidden md:table-cell">
                {fmtPct(row.marginPct)}
              </td>
              <td className="px-4 py-3 text-xs text-ink hidden md:table-cell">
                {fmt(row.proposedPrice)}
              </td>
              <td className="px-4 py-3 text-xs text-ink hidden md:table-cell">
                {row.qtyAvailable ?? '—'}
              </td>
              <td className="px-4 py-3 text-xs text-muted max-w-[160px] hidden lg:table-cell">
                <span className="block truncate" title={row.gapReason ?? ''}>
                  {row.gapReason ?? '—'}
                </span>
              </td>
              {showActions && (
                <td className="px-4 py-3">
                  <CandidateRowActions row={row} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Watching table (collapsible)
// ---------------------------------------------------------------------------

function WatchingSection({ rows }: { rows: ImportCandidateRow[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <section className="bg-white rounded-2xl border border-line overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 border-b border-line hover:bg-cream/40 transition-colors"
      >
        <h2
          className="text-base font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Watching ({rows.length})
        </h2>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && <CandidatesTable rows={rows} showActions={false} />}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Recent runs table
// ---------------------------------------------------------------------------

function RecentRunsSection({ runs }: { runs: ImportMonitorRunRow[] }) {
  if (runs.length === 0) return null

  return (
    <section className="bg-white rounded-2xl border border-line overflow-hidden">
      <div className="px-5 py-4 border-b border-line">
        <h2
          className="text-base font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Recent Runs
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Source</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Feeds ok</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Found</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden sm:table-cell">New</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden sm:table-cell">Imported</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {runs.map(run => (
              <tr key={run.id} className="hover:bg-cream/50">
                <td className="px-4 py-3 text-xs text-ink">{fmtDate(run.startedAt?.toString())}</td>
                <td className="px-4 py-3 text-xs text-muted capitalize">{run.source ?? 'cron'}</td>
                <td className="px-4 py-3 text-xs">
                  <span className={run.feedsOk ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                    {run.feedsOk ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-ink">{run.candidatesFound ?? 0}</td>
                <td className="px-4 py-3 text-xs text-ink hidden sm:table-cell">{run.candidatesNew ?? 0}</td>
                <td className="px-4 py-3 text-xs text-ink hidden sm:table-cell">{run.autoImported ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Imported lifecycle table (read-only — tracks enrich -> publish stages)
// ---------------------------------------------------------------------------

function LifecycleSection({
  rows,
  counts,
}: {
  rows: ImportCandidateRow[]
  counts: LoaderData['counts']
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <section className="bg-white rounded-2xl border border-line overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 border-b border-line hover:bg-cream/40 transition-colors"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <h2
            className="text-base font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Imported ({counts.imported})
          </h2>
          <span className="text-xs text-muted">
            {counts.awaitingEnrich} queued · {counts.enrichedNotLive} enriched · {counts.live} live
          </span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-muted transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded &&
        (rows.length === 0 ? (
          <p className="text-sm text-muted px-5 py-8 text-center">No imported products yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Title</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Tier</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Stage</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden sm:table-cell">Enriched</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden sm:table-cell">Published</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(row => {
                  const stage = lifecycleStage(row)
                  return (
                    <tr key={row.id} className="hover:bg-cream/50 transition-colors">
                      <td className="px-4 py-3 max-w-[220px]">
                        <span className="block truncate font-medium text-ink text-xs" title={row.productTitle ?? ''}>
                          {row.productTitle ?? '—'}
                        </span>
                        <span className="block text-[10px] text-muted font-mono">{row.sku}</span>
                      </td>
                      <td className="px-4 py-3">
                        <TierBadge tier={row.tier} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${stage.cls}`}>
                          {stage.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted hidden sm:table-cell">
                        {row.enrichedAt ? fmtDate(row.enrichedAt.toString()) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted hidden sm:table-cell">
                        {row.publishedAt ? fmtDate(row.publishedAt.toString()) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminImportsPage() {
  const data = useLoaderData<typeof loader>()
  const [brandFilter, setBrandFilter] = useState('')

  const pendingBrands = Array.from(
    new Set(data.pending.map(r => r.brand).filter((b): b is string => !!b)),
  ).sort((a, b) => a.localeCompare(b))

  const visiblePending =
    brandFilter === '' ? data.pending : data.pending.filter(r => r.brand === brandFilter)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Import Monitor
        </h1>
        <div className="flex gap-3">
          <Link
            to="/admin/imports"
            className="text-xs font-semibold px-4 py-2 bg-coral text-white rounded-full"
          >
            Candidates
          </Link>
          <Link
            to="/admin/imports/opportunities"
            className="text-xs font-semibold px-4 py-2 bg-cream border border-line text-ink rounded-full hover:border-coral/50 transition-colors"
          >
            Opportunities
          </Link>
        </div>
      </div>

      {/* Run status card */}
      <RunStatusCard
        recentRuns={data.recentRuns}
        counts={data.counts}
        settings={data.settings}
      />

      {/* Settings */}
      <SettingsPanel settings={data.settings} />
      <Phase2SettingsPanel settings={data.settings} />

      {/* Pending candidates */}
      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <h2
            className="text-base font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Pending Review ({brandFilter === '' ? data.counts.pending : visiblePending.length}
            {brandFilter === '' ? '' : ` of ${data.counts.pending}`})
          </h2>
          {pendingBrands.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Brand
              <select
                value={brandFilter}
                onChange={e => setBrandFilter(e.target.value)}
                className="text-xs text-ink border border-line rounded-lg px-2 py-1.5 bg-cream focus:outline-none focus:ring-2 focus:ring-coral/40"
              >
                <option value="">All brands ({data.counts.pending})</option>
                {pendingBrands.map(b => (
                  <option key={b} value={b}>
                    {b} ({data.pending.filter(r => r.brand === b).length})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <CandidatesTable rows={visiblePending} showActions={true} />
      </section>

      {/* Watching */}
      <WatchingSection rows={data.watching} />

      {/* Imported lifecycle */}
      <LifecycleSection rows={data.imported} counts={data.counts} />

      {/* Recent runs */}
      <RecentRunsSection runs={data.recentRuns} />
    </div>
  )
}
