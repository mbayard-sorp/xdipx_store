// pricing-rules-csv.ts
// Client-safe CSV formatting for pricing rules. No server imports.

export const PRICING_RULES_CSV_HEADERS = [
  'scope_level',
  'scope_id',
  'scope_name',
  'target_margin_pct',
  'margin_floor_pct',
  'map_behavior',
  'compare_at_strategy',
  'velocity_modifier_enabled',
  'min_unit_profit_usd',
] as const

/** Dollar floor on unit gross profit: a finite amount from $0 to $100. */
export function isValidMinUnitProfit(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= 100
}

export function escapeCell(value: string): string {
  if (value === '') return ''
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function row(cells: string[]): string {
  return cells.map(escapeCell).join(',')
}

export interface PricingRuleCSVRow {
  scopeLevel: string
  scopeId: string
  scopeName: string
  targetMarginPct: number | null
  marginFloorPct: number | null
  mapBehavior: string | null
  compareAtStrategy: string | null
  velocityModifierEnabled: boolean | null
  minUnitProfitUsd?: number | null
}

export function pricingRulesToCSV(rows: PricingRuleCSVRow[]): string {
  const lines: string[] = [PRICING_RULES_CSV_HEADERS.join(',')]
  for (const r of rows) {
    lines.push(row([
      r.scopeLevel,
      r.scopeId,
      r.scopeName ?? '',
      r.targetMarginPct != null ? String(r.targetMarginPct) : '',
      r.marginFloorPct  != null ? String(r.marginFloorPct)  : '',
      r.mapBehavior              ?? '',
      r.compareAtStrategy        ?? '',
      r.velocityModifierEnabled  != null ? String(r.velocityModifierEnabled) : '',
      r.minUnitProfitUsd         != null ? String(r.minUnitProfitUsd) : '',
    ]))
  }
  return lines.join('\n') + '\n'
}
