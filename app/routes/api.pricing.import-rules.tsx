import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import {
  pricingGroups,
  pricingSubGroups,
  pricingProductTypeMap,
} from '../../db/schema'

interface RulePatch {
  scope_level: 'global' | 'group' | 'sub_group' | 'product_type'
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

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      cell += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(cell); cell = ''; i++; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []; i++; continue
    }
    cell += c; i++
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

function parseNumber(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

function parseBool(s: string): boolean | null {
  const t = s.trim().toLowerCase()
  if (t === '') return null
  if (t === 'true' || t === '1' || t === 'yes') return true
  if (t === 'false' || t === '0' || t === 'no') return false
  return null
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let csvText = ''
  const ct = request.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    const body = await request.json() as { csv?: string }
    csvText = body.csv ?? ''
  } else if (ct.includes('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('file')
    if (file instanceof File) csvText = await file.text()
  } else {
    csvText = await request.text()
  }

  if (!csvText.trim()) {
    return Response.json({ ok: false, error: 'Empty CSV body' }, { status: 400 })
  }

  const rows = parseCSV(csvText)
  if (rows.length < 2) {
    return Response.json({ ok: false, error: 'CSV has no data rows' }, { status: 400 })
  }

  const header = (rows[0] ?? []).map(h => h.trim().toLowerCase())
  const idx = (name: string) => header.indexOf(name)
  const need = ['scope_level', 'scope_id']
  for (const col of need) {
    if (idx(col) < 0) {
      return Response.json({ ok: false, error: `Missing required column: ${col}` }, { status: 400 })
    }
  }

  const cTarget = idx('target_margin_pct')
  const cFloor = idx('margin_floor_pct')
  const cMap = idx('map_behavior')
  const cCmp = idx('compare_at_strategy')
  const cVel = idx('velocity_modifier_enabled')

  // Validate referenced scopes exist in DB
  const [groupIds, subGroupIds, productTypes] = await Promise.all([
    db.select({ id: pricingGroups.id }).from(pricingGroups).then(r => new Set(r.map(x => x.id))),
    db.select({ id: pricingSubGroups.id }).from(pricingSubGroups).then(r => new Set(r.map(x => x.id))),
    db.select({ pt: pricingProductTypeMap.productType }).from(pricingProductTypeMap).then(r => new Set(r.map(x => x.pt))),
  ])

  const patches: RulePatch[] = []
  const errors: Array<{ line: number; reason: string }> = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const lineNo = r + 1
    const level = (row[idx('scope_level')] ?? '').trim()
    const id = (row[idx('scope_id')] ?? '').trim()
    if (!level && !id) continue

    if (!VALID_LEVELS.has(level)) {
      errors.push({ line: lineNo, reason: `Invalid scope_level: ${level}` })
      continue
    }

    if (level === 'global' && id !== 'global') {
      errors.push({ line: lineNo, reason: `global scope_id must be "global"` })
      continue
    }
    if (level === 'group' && !groupIds.has(id)) {
      errors.push({ line: lineNo, reason: `Unknown group: ${id}` })
      continue
    }
    if (level === 'sub_group' && !subGroupIds.has(id)) {
      errors.push({ line: lineNo, reason: `Unknown sub_group: ${id}` })
      continue
    }
    if (level === 'product_type' && !productTypes.has(id)) {
      errors.push({ line: lineNo, reason: `Unknown product_type: ${id}` })
      continue
    }

    const mapVal = cMap >= 0 ? (row[cMap] ?? '').trim() : ''
    if (mapVal !== '' && !VALID_MAP.has(mapVal)) {
      errors.push({ line: lineNo, reason: `Invalid map_behavior: ${mapVal}` })
      continue
    }
    const cmpVal = cCmp >= 0 ? (row[cCmp] ?? '').trim() : ''
    if (cmpVal !== '' && !VALID_COMPARE.has(cmpVal)) {
      errors.push({ line: lineNo, reason: `Invalid compare_at_strategy: ${cmpVal}` })
      continue
    }

    const target = cTarget >= 0 ? parseNumber(row[cTarget] ?? '') : null
    const floor = cFloor >= 0 ? parseNumber(row[cFloor] ?? '') : null
    const vel = cVel >= 0 ? parseBool(row[cVel] ?? '') : null

    if (target != null && (target < 0 || target >= 1)) {
      errors.push({ line: lineNo, reason: `target_margin_pct out of range (0..1): ${target}` })
      continue
    }
    if (floor != null && (floor < 0 || floor >= 1)) {
      errors.push({ line: lineNo, reason: `margin_floor_pct out of range (0..1): ${floor}` })
      continue
    }

    patches.push({
      scope_level: level as RulePatch['scope_level'],
      scope_id: id,
      target_margin_pct: target,
      margin_floor_pct: floor,
      map_behavior: mapVal || null,
      compare_at_strategy: cmpVal || null,
      velocity_modifier_enabled: vel,
    })
  }

  if (errors.length > 0) {
    return Response.json({ ok: false, errors, parsed: patches.length }, { status: 400 })
  }

  return Response.json({ ok: true, patches })
}
