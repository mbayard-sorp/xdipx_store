/**
 * Ticket #16413: /admin/ads/settings is the old Ad Studio Spend tab, moved.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 *
 * The spend lib (caps, margin, rules, automation) keeps its own tests in
 * ad-spend.server.test.ts and the lead SMS valve in api-lead-sms-optin.test.ts.
 * This file covers the route wiring that moved: the owner gate on every save,
 * each intent reaching the same lib call it did on the Spend tab, and the
 * audit source staying 'admin.ad-studio.spend' so valve history reads as one
 * series across the move.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

const session = vi.hoisted(() => ({ role: 'owner' as string | null }))
vi.mock('~/lib/session.server', () => ({
  requireAdmin: vi.fn(async () => {}),
  getAdminUser: vi.fn(async () => (session.role ? { email: 'mike@xdipx.com', role: session.role } : null)),
}))

const spend = vi.hoisted(() => {
  class SpendInputError extends Error {}
  return {
    SpendInputError,
    getSpendOverview: vi.fn(async () => ({ overview: true })),
    saveMediaCaps: vi.fn(async () => ({ message: 'Caps saved.' })),
    saveGrossMargin: vi.fn(async () => ({ message: 'Margin saved.' })),
    saveRuleValues: vi.fn(async () => ({})),
    saveAutoApply: vi.fn(async () => ({ message: 'Auto-apply on.' })),
    saveAutomationLimits: vi.fn(async () => ({ message: 'Limits saved.' })),
  }
})
vi.mock('~/lib/ad-spend.server', () => spend)

const metrics = vi.hoisted(() => {
  class AdMetricsError extends Error {}
  return {
    AdMetricsError,
    importGoogleAdsCsv: vi.fn(async () => ({ fileRows: 3 })),
    importShopCampaignsCsv: vi.fn(async () => ({ fileRows: 5 })),
  }
})
vi.mock('~/lib/ad-metrics.server', () => metrics)

vi.mock('~/lib/lead-funnel-report.server', () => ({ buildLeadFunnelReport: vi.fn(async () => ({ report: true })) }))

const sms = vi.hoisted(() => ({ envOverride: null as boolean | null }))
vi.mock('~/lib/lead-sms-optin.server', () => ({
  isLeadSmsOptinEnabled: vi.fn(async () => false),
  leadSmsOptinEnvOverride: () => sms.envOverride,
}))

const setPipelineSettingAudited = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('~/lib/settings.server', () => ({ setPipelineSettingAudited }))

import { action, loader } from '~/routes/admin.ads.settings'

type ActionArgs = Parameters<typeof action>[0]
type LoaderArgs = Parameters<typeof loader>[0]

async function post(fields: Record<string, string | Blob>) {
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.append(k, v)
  const request = new Request('https://xdipx.com/admin/ads/settings', { method: 'POST', body })
  return action({ request, params: {}, context: {} } as unknown as ActionArgs)
}

async function load() {
  const request = new Request('https://xdipx.com/admin/ads/settings')
  return loader({ request, params: {}, context: {} } as unknown as LoaderArgs)
}

beforeEach(() => {
  session.role = 'owner'
  sms.envOverride = null
  vi.clearAllMocks()
})

describe('admin.ads.settings loader', () => {
  it('returns the spend overview, the owner flag and the lead SMS state', async () => {
    const data = await load()
    expect(data.isOwner).toBe(true)
    expect(data.overview).toEqual({ overview: true })
    expect(data.leadSmsOptin).toEqual({ enabled: false, envForced: false })
  })

  it('marks a non-owner admin read-only', async () => {
    session.role = 'admin'
    expect((await load()).isOwner).toBe(false)
  })
})

describe('admin.ads.settings action', () => {
  it.each([
    ['save-caps', { monthly: '600', daily: '20' }],
    ['save-margin', { margin: '45' }],
    ['save-rules', { rules: 'R1' }],
    ['toggle-auto-apply', { next: 'true' }],
    ['save-automation', { maxActionsPerDay: '10' }],
    ['toggle-lead-sms-optin', { next: 'true' }],
  ])('refuses %s from a non-owner and writes nothing', async (intent, fields) => {
    session.role = 'admin'
    const res = await post({ intent, ...fields })
    expect(res).toMatchObject({ ok: false, error: 'Only the owner can change this.' })
    expect(spend.saveMediaCaps).not.toHaveBeenCalled()
    expect(spend.saveGrossMargin).not.toHaveBeenCalled()
    expect(spend.saveRuleValues).not.toHaveBeenCalled()
    expect(spend.saveAutoApply).not.toHaveBeenCalled()
    expect(spend.saveAutomationLimits).not.toHaveBeenCalled()
    expect(setPipelineSettingAudited).not.toHaveBeenCalled()
  })

  it('saves caps through saveMediaCaps as the owner', async () => {
    const res = await post({ intent: 'save-caps', monthly: '600', daily: '20' })
    expect(res).toMatchObject({ ok: true, intent: 'save-caps', message: 'Caps saved.' })
    expect(spend.saveMediaCaps).toHaveBeenCalledWith({ monthly: '600', daily: '20' }, 'owner')
  })

  it('saves gross margin, rule values and the automation valves', async () => {
    await post({ intent: 'save-margin', margin: '45' })
    expect(spend.saveGrossMargin).toHaveBeenCalledWith('45', 'owner')

    const rules = await post({ intent: 'save-rules', rules: 'R1,nope', R1_x: '2' })
    expect(rules).toMatchObject({ ok: true, message: 'R1 saved.' })
    expect(spend.saveRuleValues).toHaveBeenCalledTimes(1)

    await post({ intent: 'toggle-auto-apply', next: 'true' })
    expect(spend.saveAutoApply).toHaveBeenCalledWith(true, 'owner')

    await post({ intent: 'save-automation', maxActionsPerDay: '10', maxStepPct: '20', leadCplCeiling: '8' })
    expect(spend.saveAutomationLimits).toHaveBeenCalledWith({ maxActionsPerDay: '10', maxStepPct: '20', leadCplCeiling: '8' }, 'owner')
  })

  it('refuses a rules save that names no known rule', async () => {
    expect(await post({ intent: 'save-rules', rules: 'nope' })).toMatchObject({ ok: false, error: 'Unknown rule.' })
  })

  it('writes the lead SMS valve with the unchanged audit source', async () => {
    expect(await post({ intent: 'toggle-lead-sms-optin', next: 'true' })).toMatchObject({ ok: true })
    expect(setPipelineSettingAudited).toHaveBeenCalledWith('lead_sms_optin_enabled', 'true', 'owner', 'admin.ad-studio.spend')
  })

  it('leaves the lead SMS valve alone when the environment forces it', async () => {
    sms.envOverride = true
    expect(await post({ intent: 'toggle-lead-sms-optin', next: 'false' })).toMatchObject({ ok: false })
    expect(setPipelineSettingAudited).not.toHaveBeenCalled()
  })

  it('previews a CSV without committing, and commits on import-commit', async () => {
    const file = new File(['a,b\n1,2\n'], 'shop.csv', { type: 'text/csv' })
    expect(await post({ intent: 'import-preview', source: 'shop', file })).toMatchObject({ ok: true, intent: 'import-preview' })
    expect(metrics.importShopCampaignsCsv).toHaveBeenCalledWith(expect.any(Uint8Array), { source: 'shop', commit: false })

    expect(await post({ intent: 'import-commit', source: 'google', file })).toMatchObject({ ok: true, intent: 'import-commit', message: 'Imported 3 rows.' })
    expect(metrics.importGoogleAdsCsv).toHaveBeenCalledWith(expect.any(Uint8Array), { source: 'google', commit: true })
  })

  it('asks for a source and a file before importing', async () => {
    expect(await post({ intent: 'import-preview', source: 'meta' })).toMatchObject({ ok: false, error: 'Pick Google Ads or Shop Campaigns.' })
    expect(await post({ intent: 'import-preview', source: 'shop' })).toMatchObject({ ok: false, error: 'Choose a CSV file first.' })
  })

  it('turns a lib input error into a message instead of a throw', async () => {
    spend.saveMediaCaps.mockRejectedValueOnce(new spend.SpendInputError('Daily cap must be a number.'))
    expect(await post({ intent: 'save-caps', monthly: 'x', daily: 'y' })).toMatchObject({ ok: false, error: 'Daily cap must be a number.' })
  })

  it('answers an unknown intent', async () => {
    expect(await post({ intent: 'nope' })).toMatchObject({ ok: false, error: 'Unknown intent.' })
  })
})
