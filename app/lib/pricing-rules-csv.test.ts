/**
 * Unit tests for pricing-rules-csv pure formatting functions.
 *
 * No DB, no network. The server parser (pricingRulesFromCSV) is tested
 * via a local mock of loadGroupTree so this file stays in the vitest
 * unit tier.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pricingRulesToCSV, PRICING_RULES_CSV_HEADERS, escapeCell } from './pricing-rules-csv'
import type { PricingRuleCSVRow } from './pricing-rules-csv'

// ---------------------------------------------------------------------------
// Mock pricing-admin.server so the .server.ts parser can be tested without DB
// ---------------------------------------------------------------------------

vi.mock('./pricing-admin.server', () => ({
  loadGroupTree: vi.fn(),
}))

import { loadGroupTree } from './pricing-admin.server'
import { pricingRulesFromCSV } from './pricing-rules-csv.server'

const mockGroupTree = [
  {
    id: 'vibrators',
    name: 'Vibrators',
    sortOrder: 1,
    usesClearanceLadder: false,
    rule: { targetMarginPct: null, marginFloorPct: null, mapBehavior: null, compareAtStrategy: null, velocityModifierEnabled: null },
    subGroups: [
      {
        id: 'vibes-luxury',
        name: 'Luxury Vibes',
        sortOrder: 1,
        rule: { targetMarginPct: null, marginFloorPct: null, mapBehavior: null, compareAtStrategy: null, velocityModifierEnabled: null },
        productTypes: [
          { productType: 'Wand Vibrator', subGroupId: 'vibes-luxury', rule: { targetMarginPct: null, marginFloorPct: null, mapBehavior: null, compareAtStrategy: null, velocityModifierEnabled: null } },
        ],
        hasOverrides: false,
      },
    ],
    coverageCount: 0,
    lastRationale: null,
    hasOverrides: false,
  },
]

beforeEach(() => {
  vi.mocked(loadGroupTree).mockResolvedValue(mockGroupTree as never)
})

// ---------------------------------------------------------------------------
// escapeCell
// ---------------------------------------------------------------------------

describe('escapeCell', () => {
  it('passes plain values through unchanged', () => {
    expect(escapeCell('at_map')).toBe('at_map')
    expect(escapeCell('')).toBe('')
    expect(escapeCell('0.45')).toBe('0.45')
  })

  it('wraps values containing commas in quotes', () => {
    expect(escapeCell('hello, world')).toBe('"hello, world"')
  })

  it('escapes internal double-quotes', () => {
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""')
  })
})

// ---------------------------------------------------------------------------
// pricingRulesToCSV
// ---------------------------------------------------------------------------

describe('pricingRulesToCSV', () => {
  const sampleRows: PricingRuleCSVRow[] = [
    {
      scopeLevel: 'global',
      scopeId: 'global',
      scopeName: 'Global',
      targetMarginPct: 0.5,
      marginFloorPct: 0.25,
      mapBehavior: 'at_map',
      compareAtStrategy: 'msrp',
      velocityModifierEnabled: false,
    },
    {
      scopeLevel: 'group',
      scopeId: 'vibrators',
      scopeName: 'Vibrators',
      targetMarginPct: null,
      marginFloorPct: null,
      mapBehavior: null,
      compareAtStrategy: null,
      velocityModifierEnabled: null,
    },
  ]

  it('produces a header row as the first line', () => {
    const csv = pricingRulesToCSV(sampleRows)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe(PRICING_RULES_CSV_HEADERS.join(','))
  })

  it('produces one data row per input row', () => {
    const csv = pricingRulesToCSV(sampleRows)
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 rows
  })

  it('emits empty string for null fields', () => {
    const csv = pricingRulesToCSV(sampleRows)
    const lines = csv.trim().split('\n')
    const groupLine = lines[2]!
    // group row has all-null rule fields -- last 5 cols should be empty
    expect(groupLine).toMatch(/vibrators,Vibrators,,,,,$/)
  })
})

// ---------------------------------------------------------------------------
// Round-trip: toCSV -> fromCSV
// ---------------------------------------------------------------------------

describe('round-trip toCSV -> fromCSV', () => {
  it('recovers all non-null field values', async () => {
    const rows: PricingRuleCSVRow[] = [
      {
        scopeLevel: 'group',
        scopeId: 'vibrators',
        scopeName: 'Vibrators',
        targetMarginPct: 0.55,
        marginFloorPct: 0.3,
        mapBehavior: 'above_map_only',
        compareAtStrategy: 'msrp',
        velocityModifierEnabled: true,
      },
    ]

    const csv = pricingRulesToCSV(rows)
    const { patches, errors } = await pricingRulesFromCSV(csv)

    expect(errors).toHaveLength(0)
    expect(patches).toHaveLength(1)

    const p = patches[0]!
    expect(p.scope_level).toBe('group')
    expect(p.scope_id).toBe('vibrators')
    expect(p.target_margin_pct).toBe(0.55)
    expect(p.margin_floor_pct).toBe(0.3)
    expect(p.map_behavior).toBe('above_map_only')
    expect(p.compare_at_strategy).toBe('msrp')
    expect(p.velocity_modifier_enabled).toBe(true)
  })

  it('emits null for empty optional fields', async () => {
    const rows: PricingRuleCSVRow[] = [
      {
        scopeLevel: 'group',
        scopeId: 'vibrators',
        scopeName: 'Vibrators',
        targetMarginPct: null,
        marginFloorPct: null,
        mapBehavior: null,
        compareAtStrategy: null,
        velocityModifierEnabled: null,
      },
    ]

    const csv = pricingRulesToCSV(rows)
    const { patches, errors } = await pricingRulesFromCSV(csv)

    expect(errors).toHaveLength(0)
    expect(patches).toHaveLength(1)

    const p = patches[0]!
    expect(p.target_margin_pct).toBeNull()
    expect(p.map_behavior).toBeNull()
    expect(p.velocity_modifier_enabled).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Malformed row produces a line-numbered error
// ---------------------------------------------------------------------------

describe('pricingRulesFromCSV error handling', () => {
  it('reports a line-numbered error for a bad margin value', async () => {
    const csv = [
      'scope_level,scope_id,scope_name,target_margin_pct,margin_floor_pct,map_behavior,compare_at_strategy,velocity_modifier_enabled',
      'group,vibrators,Vibrators,not-a-number,,,,' ,
    ].join('\n') + '\n'

    const { patches, errors } = await pricingRulesFromCSV(csv)
    expect(patches).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/Row 2/)
    expect(errors[0]).toMatch(/target_margin_pct/)
  })

  it('reports a line-numbered error for an unknown scope_id', async () => {
    const csv = [
      'scope_level,scope_id,scope_name,target_margin_pct,margin_floor_pct,map_behavior,compare_at_strategy,velocity_modifier_enabled',
      'group,nonexistent-group,Unknown,,,,,' ,
    ].join('\n') + '\n'

    const { patches, errors } = await pricingRulesFromCSV(csv)
    expect(patches).toHaveLength(0)
    expect(errors[0]).toMatch(/Row 2/)
    expect(errors[0]).toMatch(/scope_id "nonexistent-group" not found/)
  })
})

// ---------------------------------------------------------------------------
// Enum validation
// ---------------------------------------------------------------------------

describe('enum validation', () => {
  it('rejects an invalid map_behavior', async () => {
    const csv = [
      'scope_level,scope_id,scope_name,target_margin_pct,margin_floor_pct,map_behavior,compare_at_strategy,velocity_modifier_enabled',
      'group,vibrators,Vibrators,,,bad_value,,',
    ].join('\n') + '\n'

    const { errors } = await pricingRulesFromCSV(csv)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/map_behavior/)
    expect(errors[0]).toMatch(/bad_value/)
  })

  it('rejects an invalid compare_at_strategy', async () => {
    const csv = [
      'scope_level,scope_id,scope_name,target_margin_pct,margin_floor_pct,map_behavior,compare_at_strategy,velocity_modifier_enabled',
      'group,vibrators,Vibrators,,,,not_a_strategy,',
    ].join('\n') + '\n'

    const { errors } = await pricingRulesFromCSV(csv)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/compare_at_strategy/)
    expect(errors[0]).toMatch(/not_a_strategy/)
  })

  it('rejects an invalid scope_level', async () => {
    const csv = [
      'scope_level,scope_id,scope_name,target_margin_pct,margin_floor_pct,map_behavior,compare_at_strategy,velocity_modifier_enabled',
      'universe,vibrators,Vibrators,,,,,',
    ].join('\n') + '\n'

    const { errors } = await pricingRulesFromCSV(csv)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/scope_level/)
    expect(errors[0]).toMatch(/universe/)
  })

  it('accepts all valid map_behavior values', async () => {
    for (const val of ['at_map', 'above_map_only', 'ignore_map']) {
      const csv = [
        'scope_level,scope_id,scope_name,target_margin_pct,margin_floor_pct,map_behavior,compare_at_strategy,velocity_modifier_enabled',
        `group,vibrators,Vibrators,,,${val},,`,
      ].join('\n') + '\n'

      const { errors, patches } = await pricingRulesFromCSV(csv)
      expect(errors, `expected no errors for map_behavior=${val}`).toHaveLength(0)
      expect(patches[0]!.map_behavior).toBe(val)
    }
  })

  it('accepts both valid compare_at_strategy values', async () => {
    for (const val of ['msrp', 'none']) {
      const csv = [
        'scope_level,scope_id,scope_name,target_margin_pct,margin_floor_pct,map_behavior,compare_at_strategy,velocity_modifier_enabled',
        `group,vibrators,Vibrators,,,,${val},`,
      ].join('\n') + '\n'

      const { errors, patches } = await pricingRulesFromCSV(csv)
      expect(errors, `expected no errors for compare_at_strategy=${val}`).toHaveLength(0)
      expect(patches[0]!.compare_at_strategy).toBe(val)
    }
  })
})
