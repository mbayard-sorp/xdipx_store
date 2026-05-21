// pricing-rules-csv.server.ts
// Server-only CSV parser for pricing rules. Uses csv-parse/sync.

import { parse } from 'csv-parse/sync'
import { loadGroupTree } from './pricing-admin.server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RulePatch {
  scope_level: 'global' | 'group' | 'sub_group' | 'product_type'
  scope_id: string
  target_margin_pct?: number | null
  margin_floor_pct?: number | null
  map_behavior?: string | null
  compare_at_strategy?: string | null
  velocity_modifier_enabled?: boolean | null
}

// ---------------------------------------------------------------------------
// Valid enum values (sourced from api.pricing.rules.tsx and pricing-engine-v2)
// ---------------------------------------------------------------------------

const VALID_SCOPE_LEVELS = new Set(['global', 'group', 'sub_group', 'product_type'])
const VALID_MAP_BEHAVIORS = new Set(['at_map', 'above_map_only', 'ignore_map'])
const VALID_COMPARE_AT_STRATEGIES = new Set(['msrp', 'none'])

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface CsvRow {
  scope_level?: string
  scope_id?: string
  scope_name?: string
  target_margin_pct?: string
  margin_floor_pct?: string
  map_behavior?: string
  compare_at_strategy?: string
  velocity_modifier_enabled?: string
}

export async function pricingRulesFromCSV(
  csv: string,
): Promise<{ patches: RulePatch[]; errors: string[] }> {
  const errors: string[] = []
  let rows: CsvRow[]

  try {
    rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[]
  } catch (err) {
    return { patches: [], errors: [`CSV parse error: ${(err as Error).message}`] }
  }

  if (rows.length === 0) {
    return { patches: [], errors: ['CSV is empty'] }
  }

  const first = rows[0]!
  const requiredCols = ['scope_level', 'scope_id']
  const missing = requiredCols.filter(c => !(c in first))
  if (missing.length > 0) {
    return {
      patches: [],
      errors: [`CSV must have header columns: ${missing.join(', ')}`],
    }
  }

  // Build scope-id lookup from group tree for existence validation.
  const groupTree = await loadGroupTree()
  const validScopeIds = new Set<string>(['global'])
  for (const g of groupTree) {
    validScopeIds.add(g.id)
    for (const sg of g.subGroups) {
      validScopeIds.add(sg.id)
      for (const pt of sg.productTypes) {
        validScopeIds.add(pt.productType)
      }
    }
  }

  const patches: RulePatch[] = []

  rows.forEach((r, i) => {
    const lineNo = i + 2
    const scopeLevel = (r.scope_level ?? '').trim()
    const scopeId    = (r.scope_id    ?? '').trim()

    if (!scopeLevel) {
      errors.push(`Row ${lineNo}: scope_level is required`)
      return
    }
    if (!VALID_SCOPE_LEVELS.has(scopeLevel)) {
      errors.push(`Row ${lineNo}: invalid scope_level "${scopeLevel}" (must be one of: ${[...VALID_SCOPE_LEVELS].join(', ')})`)
      return
    }

    if (!scopeId) {
      errors.push(`Row ${lineNo}: scope_id is required`)
      return
    }
    if (!validScopeIds.has(scopeId)) {
      errors.push(`Row ${lineNo}: scope_id "${scopeId}" not found in group tree`)
      return
    }

    const patch: RulePatch = {
      scope_level: scopeLevel as RulePatch['scope_level'],
      scope_id:    scopeId,
    }

    // target_margin_pct
    const targetRaw = (r.target_margin_pct ?? '').trim()
    if (targetRaw !== '') {
      const val = Number(targetRaw)
      if (isNaN(val) || val < 0 || val > 100) {
        errors.push(`Row ${lineNo}: target_margin_pct must be a number 0-100 (got "${targetRaw}")`)
        return
      }
      patch.target_margin_pct = val
    } else {
      patch.target_margin_pct = null
    }

    // margin_floor_pct
    const floorRaw = (r.margin_floor_pct ?? '').trim()
    if (floorRaw !== '') {
      const val = Number(floorRaw)
      if (isNaN(val) || val < 0 || val > 100) {
        errors.push(`Row ${lineNo}: margin_floor_pct must be a number 0-100 (got "${floorRaw}")`)
        return
      }
      patch.margin_floor_pct = val
    } else {
      patch.margin_floor_pct = null
    }

    // map_behavior
    const mapRaw = (r.map_behavior ?? '').trim()
    if (mapRaw !== '') {
      if (!VALID_MAP_BEHAVIORS.has(mapRaw)) {
        errors.push(`Row ${lineNo}: invalid map_behavior "${mapRaw}" (must be one of: ${[...VALID_MAP_BEHAVIORS].join(', ')})`)
        return
      }
      patch.map_behavior = mapRaw
    } else {
      patch.map_behavior = null
    }

    // compare_at_strategy
    const compareRaw = (r.compare_at_strategy ?? '').trim()
    if (compareRaw !== '') {
      if (!VALID_COMPARE_AT_STRATEGIES.has(compareRaw)) {
        errors.push(`Row ${lineNo}: invalid compare_at_strategy "${compareRaw}" (must be one of: ${[...VALID_COMPARE_AT_STRATEGIES].join(', ')})`)
        return
      }
      patch.compare_at_strategy = compareRaw
    } else {
      patch.compare_at_strategy = null
    }

    // velocity_modifier_enabled
    const velRaw = (r.velocity_modifier_enabled ?? '').trim().toLowerCase()
    if (velRaw !== '') {
      if (velRaw === 'true' || velRaw === '1') {
        patch.velocity_modifier_enabled = true
      } else if (velRaw === 'false' || velRaw === '0') {
        patch.velocity_modifier_enabled = false
      } else {
        errors.push(`Row ${lineNo}: velocity_modifier_enabled must be true/false/1/0 (got "${r.velocity_modifier_enabled}")`)
        return
      }
    } else {
      patch.velocity_modifier_enabled = null
    }

    patches.push(patch)
  })

  return { patches, errors }
}
