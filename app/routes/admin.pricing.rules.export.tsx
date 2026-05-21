// admin.pricing.rules.export — POST action returns a CSV download of all pricing rules.
// Auth-guarded via requireAdmin (matches other admin export routes).

import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { loadGroupTree } from '~/lib/pricing-admin.server'
import { pricingRulesToCSV } from '~/lib/pricing-rules-csv'
import type { PricingRuleCSVRow } from '~/lib/pricing-rules-csv'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const groupTree = await loadGroupTree()

  const csvRows: PricingRuleCSVRow[] = []

  // Global scope row (synthetic -- represents the fallback defaults row if it exists)
  // We emit one row per scope that has at least one non-null rule value,
  // plus the structural rows so the import round-trip works.

  for (const g of groupTree) {
    csvRows.push({
      scopeLevel:              'group',
      scopeId:                 g.id,
      scopeName:               g.name,
      targetMarginPct:         g.rule.targetMarginPct,
      marginFloorPct:          g.rule.marginFloorPct,
      mapBehavior:             g.rule.mapBehavior,
      compareAtStrategy:       g.rule.compareAtStrategy,
      velocityModifierEnabled: g.rule.velocityModifierEnabled,
    })

    for (const sg of g.subGroups) {
      csvRows.push({
        scopeLevel:              'sub_group',
        scopeId:                 sg.id,
        scopeName:               sg.name,
        targetMarginPct:         sg.rule.targetMarginPct,
        marginFloorPct:          sg.rule.marginFloorPct,
        mapBehavior:             sg.rule.mapBehavior,
        compareAtStrategy:       sg.rule.compareAtStrategy,
        velocityModifierEnabled: sg.rule.velocityModifierEnabled,
      })

      for (const pt of sg.productTypes) {
        csvRows.push({
          scopeLevel:              'product_type',
          scopeId:                 pt.productType,
          scopeName:               pt.productType,
          targetMarginPct:         pt.rule.targetMarginPct,
          marginFloorPct:          pt.rule.marginFloorPct,
          mapBehavior:             pt.rule.mapBehavior,
          compareAtStrategy:       pt.rule.compareAtStrategy,
          velocityModifierEnabled: pt.rule.velocityModifierEnabled,
        })
      }
    }
  }

  const csv = pricingRulesToCSV(csvRows)
  const date = new Date().toISOString().split('T')[0]

  return new Response(csv, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pricing-rules-export-${date}.csv"`,
    },
  })
}
