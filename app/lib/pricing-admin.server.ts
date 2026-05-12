// pricing-admin.server.ts
// Server-side helpers for the /admin/pricing UI.
// All exports are server-only; never import from client components.

import { db } from './db.server'
import {
  pricingGroups,
  pricingSubGroups,
  pricingProductTypeMap,
  pricingRules,
  pricingAuditLog,
  pipelineSettings,
} from '../../db/schema'
import { eq, desc, sql, and, gte } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroupRuleValues {
  targetMarginPct: number | null
  marginFloorPct: number | null
  mapBehavior: string | null
  compareAtStrategy: string | null
  velocityModifierEnabled: boolean | null
}

export interface ProductTypeRow {
  productType: string
  subGroupId: string
  rule: GroupRuleValues
}

export interface SubGroupRow {
  id: string
  name: string
  sortOrder: number
  rule: GroupRuleValues
  productTypes: ProductTypeRow[]
  hasOverrides: boolean
}

export interface GroupRow {
  id: string
  name: string
  sortOrder: number
  usesClearanceLadder: boolean
  rule: GroupRuleValues
  subGroups: SubGroupRow[]
  coverageCount: number
  lastRationale: string | null
  hasOverrides: boolean
}

export interface AuditPendingRow {
  id: number
  occurredAt: Date
  variantId: string
  sku: string | null
  productType: string | null
  groupId: string | null
  trigger: string
  oldSell: string | null
  newSell: string | null
  oldCompareAt: string | null
  newCompareAt: string | null
  marginBefore: string | null
  marginAfter: string | null
  rationale: string | null
  status: string
}

export interface DaySummary {
  date: string
  auto_applied: number
  pending: number
  applied: number
  rejected: number
  skipped_no_change: number
}

// ---------------------------------------------------------------------------
// Load full group tree with rules
// ---------------------------------------------------------------------------

function emptyRule(): GroupRuleValues {
  return {
    targetMarginPct: null,
    marginFloorPct: null,
    mapBehavior: null,
    compareAtStrategy: null,
    velocityModifierEnabled: null,
  }
}

function ruleFromRow(row: {
  targetMarginPct: string | null
  marginFloorPct: string | null
  mapBehavior: string | null
  compareAtStrategy: string | null
  velocityModifierEnabled: boolean | null
} | undefined): GroupRuleValues {
  if (!row) return emptyRule()
  return {
    targetMarginPct: row.targetMarginPct != null ? parseFloat(row.targetMarginPct) : null,
    marginFloorPct: row.marginFloorPct != null ? parseFloat(row.marginFloorPct) : null,
    mapBehavior: row.mapBehavior,
    compareAtStrategy: row.compareAtStrategy,
    velocityModifierEnabled: row.velocityModifierEnabled,
  }
}

function hasAnyOverride(rule: GroupRuleValues): boolean {
  return (
    rule.targetMarginPct != null ||
    rule.marginFloorPct != null ||
    rule.mapBehavior != null ||
    rule.compareAtStrategy != null ||
    rule.velocityModifierEnabled != null
  )
}

export async function loadGroupTree(): Promise<GroupRow[]> {
  // Load all groups, sub-groups, product type map, and rules in parallel.
  const [groups, subGroups, typeMap, allRules] = await Promise.all([
    db.select().from(pricingGroups).orderBy(pricingGroups.sortOrder),
    db.select().from(pricingSubGroups).orderBy(pricingSubGroups.sortOrder),
    db.select().from(pricingProductTypeMap),
    db.select().from(pricingRules),
  ])

  // Index rules by "scopeLevel:scopeId"
  const ruleIndex = new Map<string, typeof allRules[number]>()
  for (const r of allRules) {
    ruleIndex.set(`${r.scopeLevel}:${r.scopeId}`, r)
  }

  // Index sub-groups by group
  const subGroupsByGroup = new Map<string, typeof subGroups>()
  for (const sg of subGroups) {
    const arr = subGroupsByGroup.get(sg.groupId) ?? []
    arr.push(sg)
    subGroupsByGroup.set(sg.groupId, arr)
  }

  // Index product types by sub-group
  const typesBySubGroup = new Map<string, typeof typeMap>()
  for (const t of typeMap) {
    const arr = typesBySubGroup.get(t.subGroupId) ?? []
    arr.push(t)
    typesBySubGroup.set(t.subGroupId, arr)
  }

  return groups.map(g => {
    const gRule = ruleFromRow(ruleIndex.get(`group:${g.id}`))
    const sgs = subGroupsByGroup.get(g.id) ?? []

    let groupHasOverrides = false

    const subGroupRows: SubGroupRow[] = sgs.map(sg => {
      const sgRule = ruleFromRow(ruleIndex.get(`sub_group:${sg.id}`))
      const types = typesBySubGroup.get(sg.id) ?? []

      const ptRows: ProductTypeRow[] = types.map(t => {
        const ptRule = ruleFromRow(ruleIndex.get(`product_type:${t.productType}`))
        return { productType: t.productType, subGroupId: sg.id, rule: ptRule }
      })

      const sgHasOverrides = hasAnyOverride(sgRule) || ptRows.some(pt => hasAnyOverride(pt.rule))
      if (sgHasOverrides) groupHasOverrides = true

      return {
        id: sg.id,
        name: sg.name,
        sortOrder: sg.sortOrder,
        rule: sgRule,
        productTypes: ptRows,
        hasOverrides: sgHasOverrides,
      }
    })

    return {
      id: g.id,
      name: g.name,
      sortOrder: g.sortOrder,
      usesClearanceLadder: g.usesClearanceLadder,
      rule: gRule,
      subGroups: subGroupRows,
      coverageCount: 0, // filled by countVariantsByGroup
      lastRationale: null, // filled by getLastRationaleByGroup
      hasOverrides: groupHasOverrides,
    }
  })
}

// ---------------------------------------------------------------------------
// Variant coverage counts (cached 5 min in pipeline_settings)
// ---------------------------------------------------------------------------

const COVERAGE_CACHE_KEY = 'pricing:variant_counts'
const COVERAGE_TTL_MS = 5 * 60 * 1000

export async function countVariantsByGroup(): Promise<Map<string, number>> {
  // Check pipeline_settings cache
  try {
    const cached = await db
      .select({ value: pipelineSettings.value, updatedAt: pipelineSettings.updatedAt })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, COVERAGE_CACHE_KEY))
      .limit(1)

    if (cached[0] && cached[0].updatedAt) {
      const age = Date.now() - new Date(cached[0].updatedAt).getTime()
      if (age < COVERAGE_TTL_MS && cached[0].value) {
        try {
          const parsed = JSON.parse(cached[0].value) as Record<string, number>
          return new Map(Object.entries(parsed))
        } catch { /* fall through */ }
      }
    }
  } catch { /* fall through */ }

  // Count via join: product_type_map -> sub_groups -> groups
  // We count distinct product types per group as a proxy for coverage.
  const rows = await db
    .select({
      groupId: pricingSubGroups.groupId,
      count: sql<number>`count(*)::int`,
    })
    .from(pricingProductTypeMap)
    .innerJoin(pricingSubGroups, eq(pricingProductTypeMap.subGroupId, pricingSubGroups.id))
    .groupBy(pricingSubGroups.groupId)

  const result = new Map<string, number>()
  for (const row of rows) {
    result.set(row.groupId, row.count)
  }

  // Cache it
  const cacheVal = JSON.stringify(Object.fromEntries(result))
  try {
    await db
      .insert(pipelineSettings)
      .values({ key: COVERAGE_CACHE_KEY, value: cacheVal })
      .onConflictDoUpdate({ target: pipelineSettings.key, set: { value: cacheVal } })
  } catch { /* non-critical */ }

  return result
}

// ---------------------------------------------------------------------------
// Last rationale per group from audit log
// ---------------------------------------------------------------------------

export async function getLastRationaleByGroup(): Promise<Map<string, string>> {
  // Fetch the most recent audit log row per group_id
  const rows = await db
    .select({
      groupId: pricingAuditLog.groupId,
      rationale: pricingAuditLog.rationale,
      occurredAt: pricingAuditLog.occurredAt,
    })
    .from(pricingAuditLog)
    .where(sql`${pricingAuditLog.groupId} is not null`)
    .orderBy(desc(pricingAuditLog.occurredAt))
    .limit(500)

  // Deduplicate: first occurrence per groupId = most recent
  const result = new Map<string, string>()
  for (const row of rows) {
    if (row.groupId && !result.has(row.groupId) && row.rationale) {
      result.set(row.groupId, row.rationale)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Pending audit rows (for actionable cards)
// ---------------------------------------------------------------------------

export async function getPendingAuditRows(): Promise<AuditPendingRow[]> {
  const rows = await db
    .select()
    .from(pricingAuditLog)
    .where(eq(pricingAuditLog.status, 'pending'))
    .orderBy(desc(pricingAuditLog.occurredAt))
    .limit(200)

  return rows.map(r => ({
    id: r.id,
    occurredAt: r.occurredAt,
    variantId: r.variantId,
    sku: r.sku,
    productType: r.productType,
    groupId: r.groupId,
    trigger: r.trigger,
    oldSell: r.oldSell,
    newSell: r.newSell,
    oldCompareAt: r.oldCompareAt,
    newCompareAt: r.newCompareAt,
    marginBefore: r.marginBefore,
    marginAfter: r.marginAfter,
    rationale: r.rationale,
    status: r.status,
  }))
}

// ---------------------------------------------------------------------------
// Auto-applied today
// ---------------------------------------------------------------------------

export async function getAutoAppliedToday(): Promise<AuditPendingRow[]> {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const rows = await db
    .select()
    .from(pricingAuditLog)
    .where(
      and(
        eq(pricingAuditLog.status, 'auto_applied'),
        sql`${pricingAuditLog.occurredAt}::date = ${todayStr}::date`,
      ),
    )
    .orderBy(desc(pricingAuditLog.occurredAt))
    .limit(200)

  return rows.map(r => ({
    id: r.id,
    occurredAt: r.occurredAt,
    variantId: r.variantId,
    sku: r.sku,
    productType: r.productType,
    groupId: r.groupId,
    trigger: r.trigger,
    oldSell: r.oldSell,
    newSell: r.newSell,
    oldCompareAt: r.oldCompareAt,
    newCompareAt: r.newCompareAt,
    marginBefore: r.marginBefore,
    marginAfter: r.marginAfter,
    rationale: r.rationale,
    status: r.status,
  }))
}

// ---------------------------------------------------------------------------
// Last 7 days summary from audit log
// ---------------------------------------------------------------------------

export async function getLast7DaysSummary(): Promise<DaySummary[]> {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  const sevenDaysAgoStr = sevenDaysAgo.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  const rows = await db
    .select({
      date: sql<string>`${pricingAuditLog.occurredAt}::date::text`,
      status: pricingAuditLog.status,
      count: sql<number>`count(*)::int`,
    })
    .from(pricingAuditLog)
    .where(gte(pricingAuditLog.occurredAt, new Date(sevenDaysAgoStr)))
    .groupBy(
      sql`${pricingAuditLog.occurredAt}::date`,
      pricingAuditLog.status,
    )
    .orderBy(sql`${pricingAuditLog.occurredAt}::date`)

  // Pivot by date
  const byDate = new Map<string, DaySummary>()
  for (const row of rows) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, {
        date: row.date,
        auto_applied: 0,
        pending: 0,
        applied: 0,
        rejected: 0,
        skipped_no_change: 0,
      })
    }
    const day = byDate.get(row.date)!
    const key = row.status as keyof DaySummary
    if (key in day && key !== 'date') {
      (day[key] as number) += row.count
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// Global rule values (for loader)
// ---------------------------------------------------------------------------

export async function getGlobalRule(): Promise<GroupRuleValues> {
  const rows = await db
    .select()
    .from(pricingRules)
    .where(and(eq(pricingRules.scopeLevel, 'global'), eq(pricingRules.scopeId, 'global')))
    .limit(1)
  return ruleFromRow(rows[0])
}

// ---------------------------------------------------------------------------
// V2 approval mode (4-mode enum)
// ---------------------------------------------------------------------------

export type ApprovalModeV2 = 'aggressive' | 'balanced' | 'conservative' | 'review_all'

export async function getApprovalModeV2(): Promise<ApprovalModeV2> {
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, 'pricing_approval_mode'))
      .limit(1)
    const val = rows[0]?.value
    if (val === 'aggressive' || val === 'conservative' || val === 'review_all' || val === 'balanced') return val
  } catch { /* fall through */ }
  return 'balanced'
}
