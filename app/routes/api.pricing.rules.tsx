import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import {
  pricingRules,
  pricingSubGroups,
  pricingProductTypeMap,
} from '../../db/schema'
import { invalidatePricingRuleCache } from '~/lib/pricing-rules.server'
import { and, eq } from 'drizzle-orm'

// Accept both snake_case (CSV import path) and camelCase (UI edit path).
interface RawPatch {
  scope_level: 'global' | 'group' | 'sub_group' | 'product_type'
  scope_id: string
  target_margin_pct?: number | null
  targetMarginPct?: number | null
  margin_floor_pct?: number | null
  marginFloorPct?: number | null
  map_behavior?: string | null
  mapBehavior?: string | null
  compare_at_strategy?: string | null
  compareAtStrategy?: string | null
  velocity_modifier_enabled?: boolean | null
  velocityModifierEnabled?: boolean | null
}

interface Patch {
  scope_level: RawPatch['scope_level']
  scope_id: string
  target_margin_pct: number | null
  margin_floor_pct: number | null
  map_behavior: string | null
  compare_at_strategy: string | null
  velocity_modifier_enabled: boolean | null
}

const VALID_LEVELS = new Set(['global', 'group', 'sub_group', 'product_type'])
const VALID_MAP = new Set(['at_map', 'above_map_only', 'ignore_map'])
const VALID_COMPARE = new Set(['msrp', 'none'])
const LEVEL_ORDER = ['global', 'group', 'sub_group', 'product_type'] as const

function pick<T>(snake: T | null | undefined, camel: T | null | undefined): T | null {
  if (snake !== undefined) return snake ?? null
  if (camel !== undefined) return camel ?? null
  return null
}

function normalizeIncoming(raw: RawPatch): Patch {
  return {
    scope_level: raw.scope_level,
    scope_id: raw.scope_id,
    target_margin_pct: pick(raw.target_margin_pct, raw.targetMarginPct),
    margin_floor_pct: pick(raw.margin_floor_pct, raw.marginFloorPct),
    map_behavior: pick(raw.map_behavior, raw.mapBehavior),
    compare_at_strategy: pick(raw.compare_at_strategy, raw.compareAtStrategy),
    velocity_modifier_enabled: pick(raw.velocity_modifier_enabled, raw.velocityModifierEnabled),
  }
}

interface RuleSnapshot {
  scopeLevel: string
  scopeId: string
  targetMarginPct: string | null
  marginFloorPct: string | null
  mapBehavior: string | null
  compareAtStrategy: string | null
  velocityModifierEnabled: boolean | null
}

const FIELDS = [
  'target_margin_pct',
  'margin_floor_pct',
  'map_behavior',
  'compare_at_strategy',
  'velocity_modifier_enabled',
] as const

const PATCH_TO_DB: Record<typeof FIELDS[number], keyof RuleSnapshot> = {
  target_margin_pct: 'targetMarginPct',
  margin_floor_pct: 'marginFloorPct',
  map_behavior: 'mapBehavior',
  compare_at_strategy: 'compareAtStrategy',
  velocity_modifier_enabled: 'velocityModifierEnabled',
}

function patchFieldValue(p: Patch, f: typeof FIELDS[number]): number | string | boolean | null {
  switch (f) {
    case 'target_margin_pct': return p.target_margin_pct
    case 'margin_floor_pct': return p.margin_floor_pct
    case 'map_behavior': return p.map_behavior
    case 'compare_at_strategy': return p.compare_at_strategy
    case 'velocity_modifier_enabled': return p.velocity_modifier_enabled
  }
}

function ruleFieldValue(r: RuleSnapshot, f: typeof FIELDS[number]): number | string | boolean | null {
  const v = r[PATCH_TO_DB[f]]
  if (v == null) return null
  // Numeric fields are stored as strings (NUMERIC). Coerce for comparison.
  if (f === 'target_margin_pct' || f === 'margin_floor_pct') {
    return parseFloat(String(v))
  }
  return v as number | string | boolean
}

function eqValue(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9
  return String(a) === String(b)
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const adminUser = await getAdminUser(request)
  const updatedBy = adminUser?.email ?? 'admin'

  let rawPatches: RawPatch[] = []
  try {
    const body = await request.json() as { patches?: RawPatch[] }
    rawPatches = body.patches ?? []
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (rawPatches.length === 0) {
    return Response.json({ ok: false, error: 'No patches provided' }, { status: 400 })
  }

  const patches: Patch[] = rawPatches.map(normalizeIncoming)

  for (const p of patches) {
    if (!VALID_LEVELS.has(p.scope_level)) {
      return Response.json({ ok: false, error: `Invalid scope_level: ${p.scope_level}` }, { status: 400 })
    }
    if (p.map_behavior != null && !VALID_MAP.has(p.map_behavior)) {
      return Response.json({ ok: false, error: `Invalid map_behavior: ${p.map_behavior}` }, { status: 400 })
    }
    if (p.compare_at_strategy != null && !VALID_COMPARE.has(p.compare_at_strategy)) {
      return Response.json({ ok: false, error: `Invalid compare_at_strategy: ${p.compare_at_strategy}` }, { status: 400 })
    }
  }

  // Load the hierarchy + current rules so we can walk parents and normalize.
  const [allRules, subGroups, productTypeMap] = await Promise.all([
    db.select().from(pricingRules),
    db.select().from(pricingSubGroups),
    db.select().from(pricingProductTypeMap),
  ])

  const subToGroup = new Map<string, string>(subGroups.map(sg => [sg.id, sg.groupId]))
  const ptToSub = new Map<string, string>(productTypeMap.map(pt => [pt.productType, pt.subGroupId]))

  // Live, mutable index of post-patch state. Lets us walk parents AFTER the parent's patch applied.
  const ruleMap = new Map<string, RuleSnapshot>()
  for (const r of allRules) {
    ruleMap.set(`${r.scopeLevel}:${r.scopeId}`, r)
  }

  function parentOf(level: string, id: string): { level: string; id: string } | null {
    if (level === 'global') return null
    if (level === 'group') return { level: 'global', id: 'global' }
    if (level === 'sub_group') {
      const g = subToGroup.get(id); if (!g) return null
      return { level: 'group', id: g }
    }
    if (level === 'product_type') {
      const sg = ptToSub.get(id); if (!sg) return null
      return { level: 'sub_group', id: sg }
    }
    return null
  }

  function inherited(level: string, id: string, f: typeof FIELDS[number]): number | string | boolean | null {
    let cur = parentOf(level, id)
    while (cur) {
      const r = ruleMap.get(`${cur.level}:${cur.id}`)
      if (r) {
        const v = ruleFieldValue(r, f)
        if (v != null) return v
      }
      cur = parentOf(cur.level, cur.id)
    }
    return null
  }

  // Sort patches parent-first so children see normalized parent state.
  const sorted = [...patches].sort((a, b) =>
    LEVEL_ORDER.indexOf(a.scope_level) - LEVEL_ORDER.indexOf(b.scope_level),
  )

  let upserts = 0
  let deletes = 0

  for (const p of sorted) {
    // For each field, if the incoming value matches the inherited value, store NULL.
    // Global has no parent so its values are intrinsic and never normalized to NULL.
    const normalized: Record<typeof FIELDS[number], number | string | boolean | null> = {
      target_margin_pct: null,
      margin_floor_pct: null,
      map_behavior: null,
      compare_at_strategy: null,
      velocity_modifier_enabled: null,
    }

    for (const f of FIELDS) {
      const v = patchFieldValue(p, f)
      if (v == null) { normalized[f] = null; continue }
      if (p.scope_level === 'global') { normalized[f] = v; continue }
      const inh = inherited(p.scope_level, p.scope_id, f)
      normalized[f] = eqValue(v, inh) ? null : v
    }

    const allNull = FIELDS.every(f => normalized[f] == null)

    if (allNull && p.scope_level !== 'global') {
      // Fully redundant — remove the row entirely.
      await db.delete(pricingRules).where(
        and(
          eq(pricingRules.scopeLevel, p.scope_level),
          eq(pricingRules.scopeId, p.scope_id),
        ),
      )
      ruleMap.delete(`${p.scope_level}:${p.scope_id}`)
      deletes++
      continue
    }

    const dbVals = {
      targetMarginPct: normalized.target_margin_pct != null ? String(normalized.target_margin_pct) : null,
      marginFloorPct: normalized.margin_floor_pct != null ? String(normalized.margin_floor_pct) : null,
      mapBehavior: (normalized.map_behavior as string | null) ?? null,
      compareAtStrategy: (normalized.compare_at_strategy as string | null) ?? null,
      velocityModifierEnabled: (normalized.velocity_modifier_enabled as boolean | null) ?? null,
      updatedBy,
      updatedAt: new Date(),
    }

    const existing = ruleMap.get(`${p.scope_level}:${p.scope_id}`)
    if (existing) {
      await db.update(pricingRules).set(dbVals).where(
        and(
          eq(pricingRules.scopeLevel, p.scope_level),
          eq(pricingRules.scopeId, p.scope_id),
        ),
      )
    } else {
      await db.insert(pricingRules).values({
        scopeLevel: p.scope_level,
        scopeId: p.scope_id,
        ...dbVals,
      })
    }
    ruleMap.set(`${p.scope_level}:${p.scope_id}`, {
      scopeLevel: p.scope_level,
      scopeId: p.scope_id,
      ...dbVals,
    })
    upserts++
  }

  invalidatePricingRuleCache()

  return Response.json({ ok: true, patched: patches.length, upserts, deletes })
}
