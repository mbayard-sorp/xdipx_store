import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { setApprovalMode, getPricingRules, setPricingRules } from '~/lib/pricing-agent.server'
import { setPipelineSetting } from '~/lib/pricing-webhook.server'
import type { ApprovalMode } from '~/lib/pricing-agent.server'
import type { PricingRules } from '~/lib/pricing-engine.server'

const VALID_MODES: ApprovalMode[] = ['all', 'guardrails', 'auto']

function clampOpt(v: unknown, lo: number, hi: number): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (isNaN(n)) return null
  return Math.min(hi, Math.max(lo, n))
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let mode: string | undefined
  let webhookEnabled: string | undefined
  let webhookThrottleSecs: string | undefined
  let marginFloorRaw: unknown
  let highDiscountRaw: unknown
  let mediumDiscountRaw: unknown
  let perTypeOverridesRaw: unknown

  const ct = request.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    const body = await request.json() as Record<string, unknown>
    mode = typeof body['approvalMode'] === 'string' ? body['approvalMode'] : undefined
    webhookEnabled = body['pricingWebhookEnabled'] !== undefined
      ? String(body['pricingWebhookEnabled'])
      : undefined
    webhookThrottleSecs = body['pricingWebhookThrottleSecs'] !== undefined
      ? String(body['pricingWebhookThrottleSecs'])
      : undefined
    marginFloorRaw = body['marginFloor']
    highDiscountRaw = body['highMarginDiscount']
    mediumDiscountRaw = body['mediumMarginDiscount']
    perTypeOverridesRaw = body['perTypeOverrides']
  } else {
    const fd = await request.formData()
    mode = fd.get('approvalMode') as string | undefined
    const whe = fd.get('pricingWebhookEnabled')
    webhookEnabled = whe != null ? String(whe) : undefined
    const wht = fd.get('pricingWebhookThrottleSecs')
    webhookThrottleSecs = wht != null ? String(wht) : undefined
    marginFloorRaw = fd.get('marginFloor')
    highDiscountRaw = fd.get('highMarginDiscount')
    mediumDiscountRaw = fd.get('mediumMarginDiscount')
    const pot = fd.get('perTypeOverrides')
    perTypeOverridesRaw = pot != null ? pot : undefined
  }

  const updates: Record<string, unknown> = {}

  if (mode !== undefined) {
    if (!VALID_MODES.includes(mode as ApprovalMode)) {
      return Response.json({ ok: false, error: `Invalid mode: ${mode}` }, { status: 400 })
    }
    await setApprovalMode(mode as ApprovalMode)
    updates['approvalMode'] = mode
  }

  if (webhookEnabled !== undefined) {
    const enabled = webhookEnabled === 'true' || webhookEnabled === '1'
    await setPipelineSetting('pricing_webhook_enabled', enabled ? 'true' : 'false')
    updates['pricingWebhookEnabled'] = String(enabled)
  }

  if (webhookThrottleSecs !== undefined) {
    const secs = Math.max(5, Math.min(300, parseInt(webhookThrottleSecs as string, 10) || 30))
    await setPipelineSetting('pricing_webhook_throttle_secs', String(secs))
    updates['pricingWebhookThrottleSecs'] = String(secs)
  }

  const rulesPatch: Partial<PricingRules> = {}

  const marginFloor = clampOpt(marginFloorRaw, 0.05, 0.40)
  if (marginFloor !== null) { rulesPatch.marginFloor = marginFloor; updates['marginFloor'] = marginFloor }

  const highDiscount = clampOpt(highDiscountRaw, 0, 0.60)
  if (highDiscount !== null) { rulesPatch.highMarginDiscount = highDiscount; updates['highMarginDiscount'] = highDiscount }

  const mediumDiscount = clampOpt(mediumDiscountRaw, 0, 0.60)
  if (mediumDiscount !== null) { rulesPatch.mediumMarginDiscount = mediumDiscount; updates['mediumMarginDiscount'] = mediumDiscount }

  if (perTypeOverridesRaw !== undefined && perTypeOverridesRaw !== null) {
    let parsed: unknown
    if (typeof perTypeOverridesRaw === 'string') {
      try { parsed = JSON.parse(perTypeOverridesRaw) } catch { parsed = null }
    } else {
      parsed = perTypeOverridesRaw
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const validated: PricingRules['perTypeOverrides'] = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue
        const entry: { highMarginDiscount?: number; mediumMarginDiscount?: number } = {}
        const h = clampOpt((v as Record<string, unknown>)['highMarginDiscount'], 0, 0.60)
        const m = clampOpt((v as Record<string, unknown>)['mediumMarginDiscount'], 0, 0.60)
        if (h !== null) entry.highMarginDiscount = h
        if (m !== null) entry.mediumMarginDiscount = m
        validated![k] = entry
      }
      rulesPatch.perTypeOverrides = validated
      updates['perTypeOverrides'] = validated
    }
  }

  if (Object.keys(rulesPatch).length > 0) {
    const currentRules = await getPricingRules()
    await setPricingRules({ ...currentRules, ...rulesPatch })
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ ok: false, error: 'No recognized settings in request' }, { status: 400 })
  }

  return Response.json({ ok: true, ...updates })
}
