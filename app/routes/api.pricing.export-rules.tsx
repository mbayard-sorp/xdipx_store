import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import {
  pricingGroups,
  pricingSubGroups,
  pricingProductTypeMap,
  pricingRules,
} from '../../db/schema'

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const [groups, subGroups, typeMap, rules] = await Promise.all([
    db.select().from(pricingGroups).orderBy(pricingGroups.sortOrder),
    db.select().from(pricingSubGroups).orderBy(pricingSubGroups.sortOrder),
    db.select().from(pricingProductTypeMap),
    db.select().from(pricingRules),
  ])

  const ruleIndex = new Map<string, typeof rules[number]>()
  for (const r of rules) ruleIndex.set(`${r.scopeLevel}:${r.scopeId}`, r)

  const subGroupsByGroup = new Map<string, typeof subGroups>()
  for (const sg of subGroups) {
    const arr = subGroupsByGroup.get(sg.groupId) ?? []
    arr.push(sg)
    subGroupsByGroup.set(sg.groupId, arr)
  }

  const typesBySubGroup = new Map<string, typeof typeMap>()
  for (const t of typeMap) {
    const arr = typesBySubGroup.get(t.subGroupId) ?? []
    arr.push(t)
    typesBySubGroup.set(t.subGroupId, arr)
  }

  const header = [
    'scope_level',
    'scope_id',
    'scope_name',
    'parent',
    'target_margin_pct',
    'margin_floor_pct',
    'map_behavior',
    'compare_at_strategy',
    'velocity_modifier_enabled',
  ].join(',')

  const lines: string[] = [header]

  function row(
    level: string,
    id: string,
    name: string,
    parent: string,
  ): string {
    const r = ruleIndex.get(`${level}:${id}`)
    return [
      level,
      id,
      name,
      parent,
      r?.targetMarginPct ?? '',
      r?.marginFloorPct ?? '',
      r?.mapBehavior ?? '',
      r?.compareAtStrategy ?? '',
      r?.velocityModifierEnabled === null || r?.velocityModifierEnabled === undefined
        ? ''
        : String(r.velocityModifierEnabled),
    ].map(csvCell).join(',')
  }

  lines.push(row('global', 'global', 'Global Defaults', ''))

  for (const g of groups) {
    lines.push(row('group', g.id, g.name, 'global'))
    const sgs = subGroupsByGroup.get(g.id) ?? []
    for (const sg of sgs) {
      lines.push(row('sub_group', sg.id, sg.name, g.id))
      const types = typesBySubGroup.get(sg.id) ?? []
      for (const t of types) {
        lines.push(row('product_type', t.productType, t.productType, sg.id))
      }
    }
  }

  const csv = lines.join('\n') + '\n'
  const today = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pricing-rules-${today}.csv"`,
    },
  })
}
