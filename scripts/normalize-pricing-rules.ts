// One-time cleanup: walk pricing_rules and null-out / delete rows whose
// field values are redundant with their inherited parent. Mirrors the
// normalization logic in app/routes/api.pricing.rules.tsx so the DB and
// the live save path stay consistent.

import { db } from '../app/lib/db.server'
import {
  pricingRules,
  pricingSubGroups,
  pricingProductTypeMap,
} from '../db/schema'
import { and, eq } from 'drizzle-orm'

interface Row {
  scopeLevel: string
  scopeId: string
  targetMarginPct: string | null
  marginFloorPct: string | null
  mapBehavior: string | null
  compareAtStrategy: string | null
  velocityModifierEnabled: boolean | null
}

const FIELDS = ['targetMarginPct','marginFloorPct','mapBehavior','compareAtStrategy','velocityModifierEnabled'] as const
type Field = typeof FIELDS[number]

function fv(r: Row | undefined, f: Field): number | string | boolean | null {
  if (!r) return null
  const v = r[f]
  if (v == null) return null
  if (f === 'targetMarginPct' || f === 'marginFloorPct') return parseFloat(String(v))
  return v as string | boolean
}

function eqV(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9
  return String(a) === String(b)
}

async function main() {
  const [rules, subGroups, ptMap] = await Promise.all([
    db.select().from(pricingRules),
    db.select().from(pricingSubGroups),
    db.select().from(pricingProductTypeMap),
  ])

  const subToGroup = new Map(subGroups.map(sg => [sg.id, sg.groupId]))
  const ptToSub = new Map(ptMap.map(pt => [pt.productType, pt.subGroupId]))
  const ruleMap = new Map<string, Row>(rules.map(r => [`${r.scopeLevel}:${r.scopeId}`, r]))

  function parentOf(level: string, id: string): { level: string; id: string } | null {
    if (level === 'global') return null
    if (level === 'group') return { level: 'global', id: 'global' }
    if (level === 'sub_group') { const g = subToGroup.get(id); if (!g) return null; return { level: 'group', id: g } }
    if (level === 'product_type') { const sg = ptToSub.get(id); if (!sg) return null; return { level: 'sub_group', id: sg } }
    return null
  }

  function inherited(level: string, id: string, f: Field): unknown {
    let cur = parentOf(level, id)
    while (cur) {
      const r = ruleMap.get(`${cur.level}:${cur.id}`)
      const v = fv(r, f)
      if (v != null) return v
      cur = parentOf(cur.level, cur.id)
    }
    return null
  }

  // Process parent-first so children see normalized parents.
  const ORDER = ['global','group','sub_group','product_type']
  const sorted = [...rules].sort((a, b) => ORDER.indexOf(a.scopeLevel) - ORDER.indexOf(b.scopeLevel))

  let updates = 0
  let deletes = 0

  for (const r of sorted) {
    if (r.scopeLevel === 'global') continue  // never normalize global

    const out: Record<Field, number | string | boolean | null> = {
      targetMarginPct: null, marginFloorPct: null, mapBehavior: null,
      compareAtStrategy: null, velocityModifierEnabled: null,
    }
    let changed = false
    for (const f of FIELDS) {
      const own = fv(r, f)
      if (own == null) { out[f] = null; continue }
      const inh = inherited(r.scopeLevel, r.scopeId, f)
      if (eqV(own, inh)) { out[f] = null; changed = true }
      else out[f] = own
    }
    const allNull = FIELDS.every(f => out[f] == null)

    if (allNull) {
      await db.delete(pricingRules).where(
        and(eq(pricingRules.scopeLevel, r.scopeLevel), eq(pricingRules.scopeId, r.scopeId)),
      )
      ruleMap.delete(`${r.scopeLevel}:${r.scopeId}`)
      console.log(`DELETE ${r.scopeLevel}:${r.scopeId} (all fields matched inherited)`)
      deletes++
    } else if (changed) {
      const dbVals = {
        targetMarginPct: out.targetMarginPct != null ? String(out.targetMarginPct) : null,
        marginFloorPct: out.marginFloorPct != null ? String(out.marginFloorPct) : null,
        mapBehavior: (out.mapBehavior as string | null) ?? null,
        compareAtStrategy: (out.compareAtStrategy as string | null) ?? null,
        velocityModifierEnabled: (out.velocityModifierEnabled as boolean | null) ?? null,
        updatedAt: new Date(),
      }
      await db.update(pricingRules).set(dbVals).where(
        and(eq(pricingRules.scopeLevel, r.scopeLevel), eq(pricingRules.scopeId, r.scopeId)),
      )
      ruleMap.set(`${r.scopeLevel}:${r.scopeId}`, { ...r, ...dbVals })
      console.log(`UPDATE ${r.scopeLevel}:${r.scopeId} -> cleared redundant fields`)
      updates++
    }
  }

  console.log(`\nDone. ${updates} updates, ${deletes} deletes.`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
