import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { setApprovalMode } from '~/lib/pricing-agent.server'
import { setPipelineSetting } from '~/lib/pricing-webhook.server'
import type { ApprovalMode } from '~/lib/pricing-agent.server'

const VALID_MODES: ApprovalMode[] = ['all', 'guardrails', 'auto']

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let mode: string | undefined
  let webhookEnabled: string | undefined
  let webhookThrottleSecs: string | undefined

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
  } else {
    const fd = await request.formData()
    mode = fd.get('approvalMode') as string | undefined
    const whe = fd.get('pricingWebhookEnabled')
    webhookEnabled = whe != null ? String(whe) : undefined
    const wht = fd.get('pricingWebhookThrottleSecs')
    webhookThrottleSecs = wht != null ? String(wht) : undefined
  }

  const updates: Record<string, string> = {}

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
    const secs = Math.max(5, Math.min(300, parseInt(webhookThrottleSecs, 10) || 30))
    await setPipelineSetting('pricing_webhook_throttle_secs', String(secs))
    updates['pricingWebhookThrottleSecs'] = String(secs)
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ ok: false, error: 'No recognized settings in request' }, { status: 400 })
  }

  return Response.json({ ok: true, ...updates })
}
