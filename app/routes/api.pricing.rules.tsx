import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { pricingRules } from '../../db/schema'
import { invalidatePricingRuleCache } from '~/lib/pricing-rules.server'
import { pricingRulesFromCSV } from '~/lib/pricing-rules-csv.server'
import { and, eq } from 'drizzle-orm'

interface RulePatch {
  scope_level: 'global' | 'group' | 'sub_group' | 'product_type'
  scope_id: string
  target_margin_pct?: number | null
  margin_floor_pct?: number | null
  map_behavior?: string | null
  compare_at_strategy?: string | null
  velocity_modifier_enabled?: boolean | null
}

// ---------------------------------------------------------------------------
// Shared upsert helper -- used by both JSON manual-save and CSV import paths.
// ---------------------------------------------------------------------------

async function applyPatches(patches: RulePatch[], updatedBy: string): Promise<Response> {
  for (const p of patches) {
    const existing = await db
      .select({ scopeLevel: pricingRules.scopeLevel })
      .from(pricingRules)
      .where(
        and(
          eq(pricingRules.scopeLevel, p.scope_level),
          eq(pricingRules.scopeId, p.scope_id),
        ),
      )
      .limit(1)

    const vals = {
      targetMarginPct: p.target_margin_pct != null ? String(p.target_margin_pct) : null,
      marginFloorPct: p.margin_floor_pct != null ? String(p.margin_floor_pct) : null,
      mapBehavior: p.map_behavior ?? null,
      compareAtStrategy: p.compare_at_strategy ?? null,
      velocityModifierEnabled: p.velocity_modifier_enabled ?? null,
      updatedBy,
      updatedAt: new Date(),
    }

    if (existing.length > 0) {
      await db
        .update(pricingRules)
        .set(vals)
        .where(
          and(
            eq(pricingRules.scopeLevel, p.scope_level),
            eq(pricingRules.scopeId, p.scope_id),
          ),
        )
    } else {
      await db
        .insert(pricingRules)
        .values({
          scopeLevel: p.scope_level,
          scopeId: p.scope_id,
          ...vals,
        })
    }
  }

  invalidatePricingRuleCache()
  return Response.json({ ok: true, patched: patches.length })
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const adminUser = await getAdminUser(request)
  const updatedBy = adminUser?.email ?? 'admin'

  // ---- CSV import branch (FormData with intent=import-rules-csv) ----
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData()
    const intent = form.get('intent') as string | null
    if (intent === 'import-rules-csv') {
      const csv = form.get('csv') as string | null
      if (!csv) return Response.json({ ok: false, errors: ['Missing csv field'] }, { status: 400 })
      const { patches: csvPatches, errors } = await pricingRulesFromCSV(csv)
      if (errors.length > 0) return Response.json({ ok: false, errors })
      if (csvPatches.length === 0) return Response.json({ ok: false, errors: ['No valid rows in CSV'] })
      return applyPatches(csvPatches, updatedBy)
    }
  }

  // ---- JSON manual-save branch ----
  let patches: RulePatch[] = []
  try {
    const body = await request.json() as { patches?: RulePatch[] }
    patches = body.patches ?? []
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (patches.length === 0) {
    return Response.json({ ok: false, error: 'No patches provided' }, { status: 400 })
  }

  const VALID_LEVELS = new Set(['global', 'group', 'sub_group', 'product_type'])
  const VALID_MAP = new Set(['at_map', 'above_map_only', 'ignore_map'])
  const VALID_COMPARE = new Set(['msrp', 'none'])

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

  return applyPatches(patches, updatedBy)
}
