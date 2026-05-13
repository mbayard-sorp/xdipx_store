import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState, useEffect, useRef } from 'react'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { getPipelineSettingPublic, getWebhookActivityToday } from '~/lib/pricing-webhook.server'
import type { MarkupSuggestion } from '~/lib/pricing-suggestions.server'
import {
  loadGroupTree,
  countVariantsByGroup,
  getLastRationaleByGroup,
  getPendingAuditRows,
  getAutoAppliedToday,
  getLast7DaysSummary,
  getApprovalModeV2,
} from '~/lib/pricing-admin.server'
import type {
  GroupRuleValues,
  AuditPendingRow,
  DaySummary,
  ApprovalModeV2,
} from '~/lib/pricing-admin.server'

export const meta: MetaFunction = () => [{ title: 'Pricing Agent — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const adminUser = await getAdminUser(request)

  const [
    groupTree,
    coverageMap,
    lastRationaleMap,
    pendingRows,
    autoAppliedRows,
    last7Days,
    approvalMode,
    webhookEnabledRaw,
    webhookThrottleRaw,
    webhookActivityToday,
  ] = await Promise.all([
    loadGroupTree(),
    countVariantsByGroup(),
    getLastRationaleByGroup(),
    getPendingAuditRows(),
    getAutoAppliedToday(),
    getLast7DaysSummary(),
    getApprovalModeV2(),
    getPipelineSettingPublic('pricing_webhook_enabled'),
    getPipelineSettingPublic('pricing_webhook_throttle_secs'),
    getWebhookActivityToday(),
  ])

  // Merge coverage counts and last rationale into the tree
  const groups = groupTree.map(g => ({
    ...g,
    coverageCount: coverageMap.get(g.id) ?? 0,
    lastRationale: lastRationaleMap.get(g.id) ?? null,
  }))

  const webhookEnabled = webhookEnabledRaw !== 'false' // default on
  const webhookThrottleSecs = Math.max(5, Math.min(300, parseInt(webhookThrottleRaw ?? '30', 10) || 30))
  const webhookSecretSet = Boolean(process.env['NALPAC_WEBHOOK_SECRET'])
  const siteUrl = (process.env['SITE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')
  const webhookEndpoint = `${siteUrl}/api/webhooks/nalpac/cost-change`

  return {
    groups,
    pendingRows,
    autoAppliedRows,
    last7Days,
    approvalMode,
    adminEmail: adminUser?.email ?? '',
    webhook: {
      enabled: webhookEnabled,
      throttleSecs: webhookThrottleSecs,
      secretSet: webhookSecretSet,
      endpoint: webhookEndpoint,
      activityToday: webhookActivityToday,
    },
    counts: {
      pending: pendingRows.length,
      autoApplied: autoAppliedRows.length,
    },
  }
}

type LoaderData = Awaited<ReturnType<typeof loader>>

// ---------------------------------------------------------------------------
// Utility formatters
// ---------------------------------------------------------------------------

function fmt(v: string | number | null | undefined): string {
  if (v == null) return '—'
  const n = parseFloat(String(v))
  return isNaN(n) ? '—' : `$${n.toFixed(2)}`
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

function truncate(s: string | null | undefined, len: number): string {
  if (!s) return '—'
  return s.length > len ? s.slice(0, len) + '…' : s
}

// ---------------------------------------------------------------------------
// Pending card component
// ---------------------------------------------------------------------------

interface PendingCardProps {
  row: AuditPendingRow
  auditFetcher: ReturnType<typeof useFetcher>
}

function PendingCard({ row, auditFetcher }: PendingCardProps) {
  const [editMode, setEditMode] = useState(false)
  const [customSell, setCustomSell] = useState(row.newSell ?? '')

  const isSubmitting = auditFetcher.state !== 'idle' &&
    String(auditFetcher.formData?.get('auditId')) === String(row.id)

  function submit(action: string, extra?: Record<string, string>) {
    auditFetcher.submit(
      { auditId: String(row.id), action, ...extra },
      { method: 'post', action: '/api/pricing/audit-action' },
    )
  }

  return (
    <div className="border border-line rounded-xl p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-xs text-muted font-mono">{row.sku ?? row.variantId.slice(-8)}</span>
          {row.productType && (
            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-cream-2 text-muted">{row.productType}</span>
          )}
        </div>
        <span className="text-xs text-muted">{new Date(row.occurredAt).toLocaleString()}</span>
      </div>

      {/* Price arrow */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted line-through">{fmt(row.oldSell)}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-muted shrink-0">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm font-semibold text-ink">{fmt(row.newSell)}</span>
        {row.marginAfter && (
          <span className="text-xs text-muted">({fmtPct(parseFloat(row.marginAfter))} margin)</span>
        )}
      </div>

      {/* Rationale */}
      {row.rationale && (
        <p className="text-xs text-muted italic" title={row.rationale}>{truncate(row.rationale, 120)}</p>
      )}

      {/* Edit inline */}
      {editMode && (
        <div className="flex items-center gap-2 pt-1">
          <label className="text-xs text-muted">Custom sell:</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={customSell}
            onChange={e => setCustomSell(e.target.value)}
            className="w-24 text-sm border border-line rounded-lg px-2 py-1 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-coral/50"
          />
          <button
            onClick={() => {
              submit('edit-approve', { customSell })
              setEditMode(false)
            }}
            disabled={isSubmitting}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-coral text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            onClick={() => setEditMode(false)}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-cream-2 text-ink hover:bg-line transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Actions */}
      {!editMode && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => submit('approve')}
            disabled={isSubmitting}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-green-100 text-green-700 hover:bg-green-200 transition-colors disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => submit('reject')}
            disabled={isSubmitting}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-red-100 text-red-600 hover:bg-red-200 transition-colors disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => setEditMode(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-cream-2 text-ink hover:bg-line transition-colors"
          >
            Edit &amp; approve
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mini bar chart for Last 7 Days
// ---------------------------------------------------------------------------

function MiniBarChart({ days }: { days: DaySummary[] }) {
  const maxVal = Math.max(
    1,
    ...days.map(d => d.auto_applied + d.pending + d.applied + d.rejected + d.skipped_no_change),
  )

  return (
    <div className="flex gap-3 items-end h-20 mt-2">
      {days.map(day => {
        const total = day.auto_applied + day.pending + day.applied + day.rejected + day.skipped_no_change
        const segments = [
          { key: 'auto_applied', val: day.auto_applied, color: 'bg-blue-400' },
          { key: 'pending', val: day.pending, color: 'bg-yellow-400' },
          { key: 'applied', val: day.applied, color: 'bg-green-500' },
          { key: 'rejected', val: day.rejected, color: 'bg-ink/30' },
        ]
        return (
          <div key={day.date} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <div className="flex flex-col-reverse gap-px w-full" style={{ height: 56 }}>
              {segments.map(s => {
                if (!s.val) return null
                const h = Math.max(2, Math.round((s.val / maxVal) * 52))
                return (
                  <div
                    key={s.key}
                    className={`w-full rounded-sm ${s.color}`}
                    style={{ height: h }}
                    title={`${s.key}: ${s.val}`}
                  />
                )
              })}
            </div>
            <span className="text-[9px] text-muted truncate w-full text-center">{day.date.slice(5)}</span>
            <span className="text-[9px] text-ink/60 font-semibold">{total}</span>
          </div>
        )
      })}
      {days.length === 0 && <p className="text-xs text-muted italic">No data yet.</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline rule field editor
// ---------------------------------------------------------------------------

interface RuleFieldsEditorProps {
  inherited: GroupRuleValues // effective value from parent (for display when null)
  values: GroupRuleValues
  onChange: (next: GroupRuleValues) => void
}

function RuleFieldsEditor({ inherited, values, onChange }: RuleFieldsEditorProps) {
  function toggleField<K extends keyof GroupRuleValues>(key: K, parentVal: GroupRuleValues[K]) {
    if (values[key] != null) {
      // Revert to inherited (set NULL)
      onChange({ ...values, [key]: null })
    } else {
      // Override with parent value as starting point
      onChange({ ...values, [key]: parentVal })
    }
  }

  const effectiveTarget = values.targetMarginPct ?? inherited.targetMarginPct
  const effectiveFloor = values.marginFloorPct ?? inherited.marginFloorPct
  const effectiveMap = values.mapBehavior ?? inherited.mapBehavior ?? 'at_map'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      {/* Target margin */}
      <div>
        <div className="flex items-center gap-1 mb-1">
          <span className={`font-medium ${values.targetMarginPct == null ? 'text-muted' : 'text-ink'}`}>Target %</span>
          <button
            onClick={() => toggleField('targetMarginPct', inherited.targetMarginPct)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              values.targetMarginPct != null
                ? 'bg-coral/10 text-coral hover:bg-coral/20'
                : 'bg-cream-2 text-muted hover:text-ink'
            }`}
          >
            {values.targetMarginPct != null ? 'revert' : 'override'}
          </button>
        </div>
        {values.targetMarginPct != null ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={5}
              max={80}
              value={Math.round(values.targetMarginPct * 100)}
              onChange={e => onChange({ ...values, targetMarginPct: parseFloat(e.target.value) / 100 })}
              className="w-16 border border-line rounded-lg px-2 py-1 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-coral/50"
            />
            <span className="text-muted">%</span>
          </div>
        ) : (
          <span className="text-muted italic">{effectiveTarget != null ? fmtPct(effectiveTarget) : '—'}</span>
        )}
      </div>

      {/* Floor */}
      <div>
        <div className="flex items-center gap-1 mb-1">
          <span className={`font-medium ${values.marginFloorPct == null ? 'text-muted' : 'text-ink'}`}>Floor %</span>
          <button
            onClick={() => toggleField('marginFloorPct', inherited.marginFloorPct)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              values.marginFloorPct != null
                ? 'bg-coral/10 text-coral hover:bg-coral/20'
                : 'bg-cream-2 text-muted hover:text-ink'
            }`}
          >
            {values.marginFloorPct != null ? 'revert' : 'override'}
          </button>
        </div>
        {values.marginFloorPct != null ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={5}
              max={50}
              value={Math.round(values.marginFloorPct * 100)}
              onChange={e => onChange({ ...values, marginFloorPct: parseFloat(e.target.value) / 100 })}
              className="w-16 border border-line rounded-lg px-2 py-1 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-coral/50"
            />
            <span className="text-muted">%</span>
          </div>
        ) : (
          <span className="text-muted italic">{effectiveFloor != null ? fmtPct(effectiveFloor) : '—'}</span>
        )}
      </div>

      {/* MAP behavior */}
      <div>
        <div className="flex items-center gap-1 mb-1">
          <span className={`font-medium ${values.mapBehavior == null ? 'text-muted' : 'text-ink'}`}>MAP</span>
          <button
            onClick={() => toggleField('mapBehavior', inherited.mapBehavior)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              values.mapBehavior != null
                ? 'bg-coral/10 text-coral hover:bg-coral/20'
                : 'bg-cream-2 text-muted hover:text-ink'
            }`}
          >
            {values.mapBehavior != null ? 'revert' : 'override'}
          </button>
        </div>
        {values.mapBehavior != null ? (
          <select
            value={values.mapBehavior}
            onChange={e => onChange({ ...values, mapBehavior: e.target.value })}
            className="w-full border border-line rounded-lg px-2 py-1 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-coral/50"
          >
            <option value="at_map">at_map</option>
            <option value="above_map_only">above_map_only</option>
            <option value="ignore_map">ignore_map</option>
          </select>
        ) : (
          <span className="text-muted italic">{effectiveMap}</span>
        )}
      </div>

      {/* Velocity */}
      <div>
        <div className="flex items-center gap-1 mb-1">
          <span className={`font-medium ${values.velocityModifierEnabled == null ? 'text-muted' : 'text-ink'}`}>Velocity</span>
          <button
            onClick={() => toggleField('velocityModifierEnabled', inherited.velocityModifierEnabled)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              values.velocityModifierEnabled != null
                ? 'bg-coral/10 text-coral hover:bg-coral/20'
                : 'bg-cream-2 text-muted hover:text-ink'
            }`}
          >
            {values.velocityModifierEnabled != null ? 'revert' : 'override'}
          </button>
        </div>
        {values.velocityModifierEnabled != null ? (
          <button
            onClick={() => onChange({ ...values, velocityModifierEnabled: !values.velocityModifierEnabled })}
            className={`px-2 py-0.5 rounded-full font-semibold ${
              values.velocityModifierEnabled ? 'bg-sage/20 text-sage' : 'bg-cream-2 text-muted'
            }`}
          >
            {values.velocityModifierEnabled ? 'on' : 'off'}
          </button>
        ) : (
          <span className="text-muted italic">{inherited.velocityModifierEnabled != null ? (inherited.velocityModifierEnabled ? 'on' : 'off') : '—'}</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Group tree state type for local editing
// ---------------------------------------------------------------------------

type EditValues = Record<string, GroupRuleValues>

// ---------------------------------------------------------------------------
// Dry-run confirm modal
// ---------------------------------------------------------------------------

interface DryRunData {
  ok: boolean
  totalAffected?: number
  withinThreshold?: number
  willQueue?: number
  breachMap?: number
  breachFloor?: number
  cappedAt?: number | null
  error?: string
}

interface ConfirmModalProps {
  dryRun: DryRunData
  onCancel: () => void
  onConfirm: () => void
  saving: boolean
}

function ConfirmModal({ dryRun, onCancel, onConfirm, saving }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl border border-line p-6 max-w-md w-full space-y-4 shadow-lg">
        <h3 className="text-base font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Confirm rule change
        </h3>

        {dryRun.ok && dryRun.totalAffected != null ? (
          <div className="space-y-1 text-sm text-ink">
            <p className="font-medium mb-2">This change will adjust {dryRun.totalAffected.toLocaleString()} variants:</p>
            <ul className="space-y-1 pl-2">
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                {(dryRun.withinThreshold ?? 0).toLocaleString()} within auto-approve threshold (will apply on next webhook/batch)
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
                {(dryRun.willQueue ?? 0).toLocaleString()} will queue for review
              </li>
              {(dryRun.breachMap ?? 0) > 0 && (
                <li className="flex items-center gap-2 text-red-600">
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  {dryRun.breachMap!.toLocaleString()} would breach MAP — blocked
                </li>
              )}
              {(dryRun.breachFloor ?? 0) > 0 && (
                <li className="flex items-center gap-2 text-red-600">
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  {dryRun.breachFloor!.toLocaleString()} would breach margin floor — blocked
                </li>
              )}
            </ul>
            {dryRun.cappedAt != null && (
              <p className="text-xs text-muted mt-2">Preview capped at {dryRun.cappedAt.toLocaleString()} variants for speed.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-red-500">{dryRun.error ?? 'Dry-run failed.'}</p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button
            onClick={onCancel}
            className="text-sm font-semibold px-4 py-2 rounded-full bg-cream-2 text-ink hover:bg-line transition-colors"
          >
            Cancel
          </button>
          {dryRun.ok && (
            <button
              onClick={onConfirm}
              disabled={saving}
              className="text-sm font-semibold px-4 py-2 rounded-full bg-coral text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save and apply'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pricing Rules tree
// ---------------------------------------------------------------------------

interface PricingRulesCardProps {
  groups: LoaderData['groups']
}

type SuggestResult = {
  ok: boolean
  suggestions?: MarkupSuggestion[]
  error?: string
  debug?: {
    rawLength: number
    parsedCount: number
    rejectedCount: number
    rejectedReasons: string[]
    rawPreview: string
    error?: string
  }
}

function PricingRulesCard({ groups }: PricingRulesCardProps) {
  // Local edits keyed by "scopeLevel:scopeId"
  const [edits, setEdits] = useState<EditValues>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedSub, setExpandedSub] = useState<Set<string>>(new Set())
  const [overridesPanelGroup, setOverridesPanelGroup] = useState<string | null>(null)

  const dryRunFetcher = useFetcher<DryRunData & { ok: boolean }>()
  const saveFetcher = useFetcher<{ ok: boolean; patched?: number; error?: string }>()
  const suggestFetcher = useFetcher<SuggestResult>()
  const importFetcher = useFetcher<{
    ok: boolean
    patches?: Array<Record<string, unknown>>
    errors?: Array<{ line: number; reason: string }>
    error?: string
  }>()

  const [showConfirm, setShowConfirm] = useState(false)
  const pendingPatchesRef = useRef<unknown[]>([])
  const importFileRef = useRef<HTMLInputElement | null>(null)

  function getEditKey(scopeLevel: string, scopeId: string) {
    return `${scopeLevel}:${scopeId}`
  }

  function getValues(scopeLevel: string, scopeId: string, base: GroupRuleValues): GroupRuleValues {
    return edits[getEditKey(scopeLevel, scopeId)] ?? base
  }

  function setValues(scopeLevel: string, scopeId: string, vals: GroupRuleValues) {
    setEdits(prev => ({ ...prev, [getEditKey(scopeLevel, scopeId)]: vals }))
  }

  function toggleGroup(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSubGroup(id: string) {
    setExpandedSub(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Build patches from edits
  function buildPatches() {
    const patches: unknown[] = []
    for (const [key, vals] of Object.entries(edits)) {
      const [level, ...rest] = key.split(':')
      const id = rest.join(':')
      patches.push({ scope_level: level, scope_id: id, ...vals })
    }
    return patches
  }

  async function handleSave() {
    const patches = buildPatches()
    if (patches.length === 0) return

    // Count affected: rough proxy = patches * 10 (unknown without dry-run)
    // Always dry-run first (spec says show modal for > 50)
    pendingPatchesRef.current = patches
    dryRunFetcher.submit(
      JSON.stringify({ overrides: patches }),
      { method: 'post', action: '/api/pricing/dry-run', encType: 'application/json' },
    )
    setShowConfirm(true)
  }

  function onImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    importFetcher.submit(fd, { method: 'post', action: '/api/pricing/import-rules', encType: 'multipart/form-data' })
    e.target.value = ''
  }

  // When import returns parsed patches, dry-run them and open the confirm modal.
  useEffect(() => {
    if (importFetcher.state !== 'idle') return
    const data = importFetcher.data
    if (!data?.ok || !data.patches || data.patches.length === 0) return
    pendingPatchesRef.current = data.patches
    dryRunFetcher.submit(
      JSON.stringify({ overrides: data.patches }),
      { method: 'post', action: '/api/pricing/dry-run', encType: 'application/json' },
    )
    setShowConfirm(true)
  }, [importFetcher.state, importFetcher.data, dryRunFetcher])

  function confirmSave() {
    saveFetcher.submit(
      JSON.stringify({ patches: pendingPatchesRef.current }),
      { method: 'post', action: '/api/pricing/rules', encType: 'application/json' },
    )
  }

  // Close confirm on save success
  useEffect(() => {
    if (saveFetcher.state === 'idle' && saveFetcher.data?.ok) {
      setShowConfirm(false)
      setEdits({})
    }
  }, [saveFetcher.state, saveFetcher.data])

  const hasEdits = Object.keys(edits).length > 0
  const isSuggesting = suggestFetcher.state !== 'idle'
  const suggestions = suggestFetcher.data?.ok ? (suggestFetcher.data.suggestions ?? []) : []

  // Auto-apply AI suggestions to group-level edits
  const lastAppliedRef = useRef<MarkupSuggestion[] | null>(null)
  useEffect(() => {
    if (suggestFetcher.state !== 'idle') return
    if (!suggestFetcher.data?.ok) return
    const fresh = suggestFetcher.data.suggestions ?? []
    if (fresh.length === 0) return
    if (lastAppliedRef.current === fresh) return
    lastAppliedRef.current = fresh
    // Map suggestions by productType; find which group it belongs to and apply
    setEdits(prev => {
      const next = { ...prev }
      for (const s of fresh) {
        // Find the group that owns this product type
        for (const g of groups) {
          for (const sg of g.subGroups) {
            const pt = sg.productTypes.find(p => p.productType === s.productType)
            if (pt) {
              const key = getEditKey('product_type', s.productType)
              const existing = next[key] ?? pt.rule
              next[key] = {
                ...existing,
                targetMarginPct: s.highMarginDiscount ?? existing.targetMarginPct,
                marginFloorPct: s.mediumMarginDiscount ?? existing.marginFloorPct,
              }
            }
          }
        }
      }
      return next
    })
  }, [suggestFetcher.state, suggestFetcher.data, groups])

  // Global defaults row (from first group's inherited values as starting point)
  const globalRule: GroupRuleValues = {
    targetMarginPct: 0.50,
    marginFloorPct: 0.25,
    mapBehavior: 'at_map',
    compareAtStrategy: 'msrp',
    velocityModifierEnabled: false,
  }

  return (
    <>
      {showConfirm && dryRunFetcher.data && (
        <ConfirmModal
          dryRun={dryRunFetcher.data}
          onCancel={() => setShowConfirm(false)}
          onConfirm={confirmSave}
          saving={saveFetcher.state !== 'idle'}
        />
      )}

      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-base font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            Pricing Rules
          </h2>
          <div className="flex items-center gap-3">
            <a
              href="/api/pricing/export-rules"
              className="text-xs font-semibold px-3 py-1.5 bg-cream border border-line rounded-full text-ink hover:border-coral hover:text-coral transition-colors"
            >
              Export CSV
            </a>
            <input
              ref={importFileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onImportFileChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={importFetcher.state !== 'idle'}
              onClick={() => importFileRef.current?.click()}
              className="text-xs font-semibold px-3 py-1.5 bg-cream border border-line rounded-full text-ink hover:border-coral hover:text-coral transition-colors disabled:opacity-50"
            >
              {importFetcher.state !== 'idle' ? 'Importing...' : 'Import CSV'}
            </button>
            <button
              type="button"
              disabled={isSuggesting}
              onClick={() => suggestFetcher.submit({}, { method: 'post', action: '/api/pricing/suggest-markups?fresh=1' })}
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
              ) : <>Suggest with AI</>}
            </button>
            {hasEdits && (
              <button
                type="button"
                onClick={handleSave}
                disabled={dryRunFetcher.state !== 'idle' || saveFetcher.state !== 'idle'}
                className="text-xs font-semibold px-4 py-2 bg-coral text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {dryRunFetcher.state !== 'idle' ? 'Checking...' : 'Save changes'}
              </button>
            )}
          </div>
        </div>

        {importFetcher.data?.ok === false && (
          <div className="px-5 py-3 text-xs space-y-1 border-b border-line">
            <p className="text-red-500">
              Import failed{importFetcher.data.error ? `: ${importFetcher.data.error}` : '.'}
            </p>
            {importFetcher.data.errors && importFetcher.data.errors.length > 0 && (
              <ul className="text-muted list-disc pl-5">
                {importFetcher.data.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>line {e.line}: {e.reason}</li>
                ))}
                {importFetcher.data.errors.length > 10 && (
                  <li>...and {importFetcher.data.errors.length - 10} more</li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* AI debug panel */}
        {suggestFetcher.data?.ok === false && (
          <div className="px-5 py-3 text-xs space-y-1 border-b border-line">
            <p className="text-red-500">{suggestFetcher.data.error ?? 'Suggestion failed.'}</p>
            {suggestFetcher.data.debug && (
              <details className="text-muted">
                <summary className="cursor-pointer hover:text-ink">Debug info</summary>
                <div className="mt-1 p-2 bg-cream-2 rounded-lg space-y-0.5 font-mono">
                  {suggestFetcher.data.debug.error && <div className="text-red-500">error: {suggestFetcher.data.debug.error}</div>}
                  <div>raw length: {suggestFetcher.data.debug.rawLength}, parsed: {suggestFetcher.data.debug.parsedCount}, rejected: {suggestFetcher.data.debug.rejectedCount}</div>
                  {suggestFetcher.data.debug.rejectedReasons.length > 0 && (
                    <div className="text-red-500">rejected: {suggestFetcher.data.debug.rejectedReasons.slice(0, 5).join('; ')}</div>
                  )}
                  {suggestFetcher.data.debug.rawPreview && (
                    <div className="whitespace-pre-wrap break-all">raw: {suggestFetcher.data.debug.rawPreview}</div>
                  )}
                </div>
              </details>
            )}
          </div>
        )}

        {suggestions.length > 0 && suggestFetcher.state === 'idle' && (
          <div className="px-5 py-2 text-xs text-green-600 border-b border-line">
            Applied {suggestions.length} AI suggestions. Edit any value to adjust before saving.
          </div>
        )}

        {saveFetcher.data?.ok === false && (
          <div className="px-5 py-2 text-xs text-red-500 border-b border-line">
            Save failed: {saveFetcher.data.error}
          </div>
        )}

        {/* Table header */}
        <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_2fr] gap-2 px-4 py-2 bg-cream-2 text-xs text-muted uppercase tracking-wide font-medium">
          <div>Group</div>
          <div>Target %</div>
          <div>Floor %</div>
          <div>MAP</div>
          <div>Coverage</div>
          <div>Last rationale</div>
        </div>

        <div className="divide-y divide-cream-2">
          {groups.map(group => {
            const gVals = getValues('group', group.id, group.rule)
            const isExpanded = expanded.has(group.id)
            const effectiveTarget = gVals.targetMarginPct ?? globalRule.targetMarginPct
            const effectiveFloor = gVals.marginFloorPct ?? globalRule.marginFloorPct
            const effectiveMap = gVals.mapBehavior ?? globalRule.mapBehavior ?? 'at_map'

            // Count descendant overrides
            let descendantOverrideCount = 0
            for (const sg of group.subGroups) {
              const sgV = edits[getEditKey('sub_group', sg.id)] ?? sg.rule
              if (Object.values(sgV).some(v => v != null)) descendantOverrideCount++
              for (const pt of sg.productTypes) {
                const ptV = edits[getEditKey('product_type', pt.productType)] ?? pt.rule
                if (Object.values(ptV).some(v => v != null)) descendantOverrideCount++
              }
            }

            return (
              <div key={group.id}>
                {/* Group row */}
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2 md:mb-0">
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="text-muted hover:text-ink transition-colors shrink-0"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      <svg
                        width="14" height="14" viewBox="0 0 14 14" fill="none"
                        className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      >
                        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>

                    <span className="font-semibold text-sm text-ink">{group.name}</span>

                    {group.usesClearanceLadder && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sun/20 text-sun font-semibold">clearance</span>
                    )}

                    {descendantOverrideCount > 0 && (
                      <button
                        onClick={() => setOverridesPanelGroup(overridesPanelGroup === group.id ? null : group.id)}
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-coral/10 text-coral font-semibold hover:bg-coral/20 transition-colors"
                      >
                        {descendantOverrideCount} override{descendantOverrideCount !== 1 ? 's' : ''}
                      </button>
                    )}
                  </div>

                  {/* Overrides panel */}
                  {overridesPanelGroup === group.id && (
                    <div className="ml-6 mb-2 p-3 bg-cream rounded-xl border border-line text-xs space-y-1">
                      <p className="font-semibold text-ink mb-2">Active overrides in {group.name}:</p>
                      {group.subGroups.map(sg => {
                        const sgV = edits[getEditKey('sub_group', sg.id)] ?? sg.rule
                        const sgHas = Object.values(sgV).some(v => v != null)
                        return (
                          <div key={sg.id}>
                            {sgHas && <div className="text-muted">Sub-group <span className="text-ink font-medium">{sg.name}</span>: {Object.entries(sgV).filter(([,v]) => v != null).map(([k,v]) => `${k}=${v}`).join(', ')}</div>}
                            {sg.productTypes.map(pt => {
                              const ptV = edits[getEditKey('product_type', pt.productType)] ?? pt.rule
                              const ptHas = Object.values(ptV).some(v => v != null)
                              if (!ptHas) return null
                              return (
                                <div key={pt.productType} className="ml-3 text-muted">Type <span className="text-ink font-medium">{pt.productType}</span>: {Object.entries(ptV).filter(([,v]) => v != null).map(([k,v]) => `${k}=${v}`).join(', ')}</div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Group rule summary row (desktop grid / mobile stacked) */}
                  <div className="ml-6">
                    <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_2fr] gap-2 items-center text-sm">
                      <div />
                      <div className={gVals.targetMarginPct != null ? 'text-ink font-medium' : 'text-muted'}>
                        {effectiveTarget != null ? fmtPct(effectiveTarget) : '—'}
                      </div>
                      <div className={gVals.marginFloorPct != null ? 'text-ink font-medium' : 'text-muted'}>
                        {effectiveFloor != null ? fmtPct(effectiveFloor) : '—'}
                      </div>
                      <div className={gVals.mapBehavior != null ? 'text-ink font-medium' : 'text-muted'}>
                        {effectiveMap}
                      </div>
                      <div className="text-muted">{group.coverageCount} types</div>
                      <div
                        className="text-muted text-xs truncate"
                        title={group.lastRationale ?? undefined}
                      >
                        {truncate(group.lastRationale, 60)}
                      </div>
                    </div>

                    {/* Expanded editor */}
                    {isExpanded && (
                      <div className="mt-3 p-3 bg-cream rounded-xl border border-line">
                        <p className="text-xs text-muted mb-2 uppercase tracking-wide">Group defaults</p>
                        <RuleFieldsEditor
                          inherited={globalRule}
                          values={gVals}
                          onChange={vals => setValues('group', group.id, vals)}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Sub-groups */}
                {isExpanded && group.subGroups.map(sg => {
                  const sgVals = getValues('sub_group', sg.id, sg.rule)
                  const sgExpanded = expandedSub.has(sg.id)
                  // Effective inherited = group's effective values
                  const sgInherited: GroupRuleValues = {
                    targetMarginPct: gVals.targetMarginPct ?? globalRule.targetMarginPct,
                    marginFloorPct: gVals.marginFloorPct ?? globalRule.marginFloorPct,
                    mapBehavior: gVals.mapBehavior ?? globalRule.mapBehavior,
                    compareAtStrategy: gVals.compareAtStrategy ?? globalRule.compareAtStrategy,
                    velocityModifierEnabled: gVals.velocityModifierEnabled ?? globalRule.velocityModifierEnabled,
                  }

                  return (
                    <div key={sg.id} className="border-t border-cream-2 bg-cream/40">
                      <div className="px-4 py-2 pl-10">
                        <div className="flex items-center gap-2 mb-1">
                          <button
                            onClick={() => toggleSubGroup(sg.id)}
                            className="text-muted hover:text-ink transition-colors"
                          >
                            <svg
                              width="12" height="12" viewBox="0 0 14 14" fill="none"
                              className={`transition-transform ${sgExpanded ? 'rotate-90' : ''}`}
                            >
                              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <span className="text-sm text-ink">{sg.name}</span>
                          {sg.hasOverrides && <span className="text-[10px] text-coral">overrides</span>}
                        </div>

                        {sgExpanded && (
                          <div className="mt-2 p-3 bg-white rounded-xl border border-line">
                            <p className="text-xs text-muted mb-2 uppercase tracking-wide">Sub-group overrides</p>
                            <RuleFieldsEditor
                              inherited={sgInherited}
                              values={sgVals}
                              onChange={vals => setValues('sub_group', sg.id, vals)}
                            />

                            {/* Product types */}
                            {sg.productTypes.length > 0 && (
                              <div className="mt-4 space-y-3">
                                <p className="text-xs text-muted uppercase tracking-wide">Product types</p>
                                {sg.productTypes.map(pt => {
                                  const ptVals = getValues('product_type', pt.productType, pt.rule)
                                  const ptInherited: GroupRuleValues = {
                                    targetMarginPct: sgVals.targetMarginPct ?? sgInherited.targetMarginPct,
                                    marginFloorPct: sgVals.marginFloorPct ?? sgInherited.marginFloorPct,
                                    mapBehavior: sgVals.mapBehavior ?? sgInherited.mapBehavior,
                                    compareAtStrategy: sgVals.compareAtStrategy ?? sgInherited.compareAtStrategy,
                                    velocityModifierEnabled: sgVals.velocityModifierEnabled ?? sgInherited.velocityModifierEnabled,
                                  }
                                  return (
                                    <div key={pt.productType} className="pl-3 border-l-2 border-cream-2">
                                      <p className="text-xs font-medium text-ink mb-1">{pt.productType}</p>
                                      <RuleFieldsEditor
                                        inherited={ptInherited}
                                        values={ptVals}
                                        onChange={vals => setValues('product_type', pt.productType, vals)}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {groups.length === 0 && (
          <p className="px-5 py-8 text-sm text-muted italic text-center">
            No pricing groups found. Run the seed script to populate the group hierarchy.
          </p>
        )}

        <div className="px-5 py-3 border-t border-line text-xs text-muted">
          Muted values inherit from parent. Click Override to set an explicit value. Click Revert to restore inheritance.
        </div>
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------
// Approval mode panel
// ---------------------------------------------------------------------------

const MODE_DESCRIPTIONS: Record<ApprovalModeV2, string> = {
  aggressive: 'Auto-approve price changes up to 10%',
  balanced: 'Auto-approve price changes up to 5% (default)',
  conservative: 'Auto-approve price changes up to 2%',
  review_all: 'Queue every change for manual review',
}

function ApprovalModePanel({ current }: { current: ApprovalModeV2 }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>()

  const optimisticMode =
    fetcher.state !== 'idle' && fetcher.formData?.get('approvalMode')
      ? (fetcher.formData.get('approvalMode') as ApprovalModeV2)
      : current

  function setMode(mode: ApprovalModeV2) {
    fetcher.submit(
      { approvalMode: mode },
      { method: 'post', action: '/api/pricing/settings' },
    )
  }

  const modes: ApprovalModeV2[] = ['aggressive', 'balanced', 'conservative', 'review_all']

  return (
    <section className="bg-white rounded-2xl border border-line p-5 space-y-4">
      <h2 className="text-base font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        Approval Mode
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {modes.map(mode => (
          <button
            key={mode}
            onClick={() => setMode(mode)}
            className={`text-left px-4 py-3 rounded-xl border transition-colors ${
              optimisticMode === mode
                ? 'border-coral bg-coral/5 text-ink'
                : 'border-line bg-cream text-ink hover:border-coral/50'
            }`}
          >
            <div className="text-sm font-semibold capitalize mb-0.5">
              {mode.replace('_', ' ')}
              {optimisticMode === mode && <span className="ml-2 text-xs text-coral">active</span>}
            </div>
            <div className="text-xs text-muted">{MODE_DESCRIPTIONS[mode]}</div>
          </button>
        ))}
      </div>
      {fetcher.data?.ok === false && (
        <p className="text-xs text-red-500">{fetcher.data.error}</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Webhook card (kept; default is now enabled)
// ---------------------------------------------------------------------------

function WebhookCard({ webhook }: { webhook: LoaderData['webhook'] }) {
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
          <span className="text-muted text-xs uppercase tracking-wide block mb-1">Status</span>
          <span className={`inline-flex items-center gap-1.5 font-medium ${optimisticEnabled ? 'text-green-600' : 'text-muted'}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${optimisticEnabled ? 'bg-green-500' : 'bg-line'}`} />
            {optimisticEnabled ? 'Enabled (default)' : 'Disabled'}
          </span>
        </div>

        <div>
          <span className="text-muted text-xs uppercase tracking-wide block mb-1">Secret configured</span>
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
          <span className="text-muted text-xs uppercase tracking-wide block mb-1">Throttle (seconds)</span>
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
            <span className="text-xs text-muted">per variant (5-300)</span>
          </div>
        </div>

        <div>
          <span className="text-muted text-xs uppercase tracking-wide block mb-1">Webhook activity today</span>
          <span className="font-medium text-ink">{webhook.activityToday} change{webhook.activityToday !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div>
        <span className="text-muted text-xs uppercase tracking-wide block mb-1">Endpoint URL</span>
        <div className="flex items-center gap-2 bg-cream rounded-xl px-3 py-2 border border-line">
          <code className="text-xs text-muted flex-1 truncate font-mono">{webhook.endpoint}</code>
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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminPricingPage() {
  const data = useLoaderData<typeof loader>()
  const auditFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const runFetcher = useFetcher<{ ok: boolean; scanned?: number; applied?: number; error?: string }>()
  const [autoExpanded, setAutoExpanded] = useState(false)

  const isRunning = runFetcher.state !== 'idle'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Pricing Agent
        </h1>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted px-3 py-1.5 rounded-full border border-line">
            Mode: {data.approvalMode.replace('_', ' ')}
          </span>
          <button
            disabled={isRunning}
            onClick={() => runFetcher.submit({}, { method: 'post', action: '/api/pricing/run-now' })}
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
        <div>
          <span className="text-muted text-xs uppercase tracking-wide block mb-0.5">Pending approval</span>
          <span className={`font-medium ${data.counts.pending > 0 ? 'text-yellow-600' : 'text-ink'}`}>
            {data.counts.pending}
          </span>
        </div>
        <div>
          <span className="text-muted text-xs uppercase tracking-wide block mb-0.5">Auto-applied today</span>
          <span className="font-medium text-ink">{data.counts.autoApplied}</span>
        </div>
      </div>

      {/* Run result */}
      {runFetcher.data && (
        <div className={`rounded-2xl px-5 py-3 text-sm border ${runFetcher.data.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
          {runFetcher.data.ok
            ? `Review complete. Scanned ${runFetcher.data.scanned ?? '?'}, applied ${runFetcher.data.applied ?? '?'}.`
            : `Error: ${runFetcher.data.error ?? 'Unknown error'}`}
        </div>
      )}

      {/* Pricing Rules tree */}
      <PricingRulesCard groups={data.groups} />

      {/* Approval Mode */}
      <ApprovalModePanel current={data.approvalMode} />

      {/* Webhook */}
      <WebhookCard webhook={data.webhook} />

      {/* Pending Approval */}
      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-base font-semibold text-ink">
            Pending Approval
            {data.pendingRows.length > 0 && (
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                {data.pendingRows.length}
              </span>
            )}
          </h2>
        </div>
        {data.pendingRows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted italic">No pending items.</p>
        ) : (
          <div className="p-4 space-y-3">
            {data.pendingRows.map(row => (
              <PendingCard key={row.id} row={row} auditFetcher={auditFetcher} />
            ))}
          </div>
        )}
      </section>

      {/* Auto-Applied Today */}
      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <button
          onClick={() => setAutoExpanded(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-line text-left"
        >
          <h2 className="text-base font-semibold text-ink">
            Auto-Applied Today
            {data.autoAppliedRows.length > 0 && (
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">
                {data.autoAppliedRows.length}
              </span>
            )}
          </h2>
          <svg
            width="16" height="16" viewBox="0 0 16 16" fill="none"
            className={`text-muted transition-transform ${autoExpanded ? 'rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {autoExpanded && (
          <div className="divide-y divide-cream-2">
            {data.autoAppliedRows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted italic">None today.</p>
            ) : (
              data.autoAppliedRows.map(row => (
                <div key={row.id} className="px-5 py-3 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-mono text-xs text-muted">{row.sku ?? row.variantId.slice(-8)}</span>
                  <span className="text-muted line-through text-xs">{fmt(row.oldSell)}</span>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-muted shrink-0">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="font-semibold text-ink">{fmt(row.newSell)}</span>
                  {row.rationale && (
                    <span className="text-xs text-muted italic truncate max-w-xs" title={row.rationale ?? undefined}>
                      {truncate(row.rationale, 80)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* Last 7 Days */}
      <section className="bg-white rounded-2xl border border-line p-5">
        <h2 className="text-base font-semibold text-ink mb-1">Last 7 Days</h2>
        <div className="flex gap-4 text-[10px] text-muted mb-2 flex-wrap">
          <span><span className="inline-block w-2 h-2 rounded-sm bg-yellow-400 mr-1" />pending</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-400 mr-1" />auto</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-green-500 mr-1" />approved</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-ink/30 mr-1" />rejected</span>
        </div>
        <MiniBarChart days={data.last7Days} />
        <p className="text-xs text-muted mt-2">Powered by audit log (v2). Legacy pricing_changes table is no longer read.</p>
      </section>
    </div>
  )
}
