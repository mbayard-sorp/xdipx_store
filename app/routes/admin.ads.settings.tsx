/**
 * /admin/ads/settings: the console's Settings page (ticket #16413, plan
 * section 7 phase 3c). It is the old Ad Studio Spend tab moved here as is;
 * /admin/ad-studio/spend now redirects to it.
 *
 * Cap control (owner-only edit), media versus compute bands, planned versus
 * actual per campaign and lane, the CSV drop zone, the lead SMS toggle and
 * lead funnel card, the Automation section (the four auto-apply valves), and
 * the rule recipes. Every write goes through setPipelineSettingAudited with
 * actor 'owner'. The audit source stays 'admin.ad-studio.spend' (here and in
 * ad-spend.server.ts) so a valve's history reads as one series across the
 * move. Admins (non-owners) see everything read-only; the action refuses
 * their saves.
 *
 * The CSV box runs the same import PR-G exposes to the routine at
 * /api/team/ad-metrics, here behind the admin session: preview parses and
 * matches and writes nothing, commit writes and rolls spend up to ad_spend.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { isRouteErrorResponse, useLoaderData, useNavigation, useRevalidator, useRouteError } from 'react-router'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import { AdMetricsError, importGoogleAdsCsv, importShopCampaignsCsv } from '~/lib/ad-metrics.server'
import { RULE_IDS, type RuleId } from '~/lib/ad-rules-core'
import {
  SpendInputError, getSpendOverview, saveAutoApply, saveAutomationLimits, saveGrossMargin, saveMediaCaps, saveRuleValues,
} from '~/lib/ad-spend.server'
import { AutomationControls } from '~/components/admin/ads/AutomationControls'
import { CapControl } from '~/components/admin/ads/CapControl'
import { CsvDropZone } from '~/components/admin/ads/CsvDropZone'
import { PlanVsActual } from '~/components/admin/ads/PlanVsActual'
import { RuleRecipes } from '~/components/admin/ads/RuleRecipes'
import { SpendBand } from '~/components/admin/ads/SpendBand'
import { LeadFunnelCard } from '~/components/admin/ads/LeadFunnelCard'
import { buildLeadFunnelReport } from '~/lib/lead-funnel-report.server'
import { isLeadSmsOptinEnabled, leadSmsOptinEnvOverride } from '~/lib/lead-sms-optin.server'
import { setPipelineSettingAudited } from '~/lib/settings.server'
import { VALVE_KEYS } from '~/lib/team-keys'
import { BandSkeleton, CapSkeleton, ErrorSlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Settings - Ads - xdipx Admin' }]

const ACTION_PATH = '/admin/ads/settings'
const MAX_FILE_BYTES = 8 * 1024 * 1024

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const [admin, overview, smsOptin] = await Promise.all([getAdminUser(request), getSpendOverview(), isLeadSmsOptinEnabled()])
  // Streamed (not awaited): Klaviyo + GA4 reads must not block the page.
  return {
    isOwner: admin?.role === 'owner',
    overview,
    leadFunnel: buildLeadFunnelReport(),
    leadSmsOptin: { enabled: smsOptin, envForced: leadSmsOptinEnvOverride() !== null },
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const admin = await getAdminUser(request)
  const isOwner = admin?.role === 'owner'

  try {
    if (intent === 'import-preview' || intent === 'import-commit') {
      const source = String(form.get('source') ?? '')
      if (source !== 'google' && source !== 'shop') return { ok: false as const, intent, error: 'Pick Google Ads or Shop Campaigns.' }
      const file = form.get('file')
      if (!(file instanceof File) || file.size === 0) return { ok: false as const, intent, error: 'Choose a CSV file first.' }
      if (file.size > MAX_FILE_BYTES) return { ok: false as const, intent, error: 'That file is over 8 MB. Export a shorter date range.' }
      const buf = new Uint8Array(await file.arrayBuffer())
      const commit = intent === 'import-commit'
      const result = source === 'google'
        ? await importGoogleAdsCsv(buf, { source: 'google', commit })
        : await importShopCampaignsCsv(buf, { source: 'shop', commit })
      if (!commit) return { ok: true as const, intent: 'import-preview' as const, result }
      return { ok: true as const, intent: 'import-commit' as const, result, message: `Imported ${result.fileRows} rows.` }
    }

    if (intent === 'toggle-lead-sms-optin') {
      if (!isOwner) return { ok: false as const, intent, error: 'Only the owner can change this.' }
      if (leadSmsOptinEnvOverride() !== null) return { ok: false as const, intent, error: 'LEAD_SMS_OPTIN_ENABLED is set in the environment, so the valve does not decide this.' }
      const next = String(form.get('next') ?? '') === 'true' ? 'true' : 'false'
      await setPipelineSettingAudited(VALVE_KEYS.leadSmsOptin, next, 'owner', 'admin.ad-studio.spend')
      return {
        ok: true as const,
        intent,
        message: next === 'true'
          ? 'Lead SMS opt-in is on. /hello asks for a phone number and SMS consent.'
          : 'Lead SMS opt-in is off. /hello asks for email only and /api/lead ignores phone and SMS consent.',
      }
    }

    if (intent === 'toggle-auto-apply' || intent === 'save-automation') {
      if (!isOwner) return { ok: false as const, intent, error: 'Only the owner can change this.' }
      if (intent === 'toggle-auto-apply') {
        const saved = await saveAutoApply(String(form.get('next') ?? '') === 'true', 'owner')
        return { ok: true as const, intent, message: saved.message }
      }
      const saved = await saveAutomationLimits({
        maxActionsPerDay: form.get('maxActionsPerDay'),
        maxStepPct: form.get('maxStepPct'),
        leadCplCeiling: form.get('leadCplCeiling'),
      }, 'owner')
      return { ok: true as const, intent, message: saved.message }
    }

    if (intent === 'save-caps' || intent === 'save-rules' || intent === 'save-margin') {
      if (!isOwner) return { ok: false as const, intent, error: 'Only the owner can change this.' }
      if (intent === 'save-caps') {
        const saved = await saveMediaCaps({ monthly: form.get('monthly'), daily: form.get('daily') }, 'owner')
        return { ok: true as const, intent, message: saved.message }
      }
      if (intent === 'save-margin') {
        const saved = await saveGrossMargin(form.get('margin'), 'owner')
        return { ok: true as const, intent, message: saved.message }
      }
      const rules = String(form.get('rules') ?? '').split(',').filter((r): r is RuleId => (RULE_IDS as readonly string[]).includes(r))
      if (rules.length === 0) return { ok: false as const, intent, error: 'Unknown rule.' }
      const values = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'))
      for (const r of rules) await saveRuleValues(r, values, 'owner')
      return { ok: true as const, intent, message: `${rules.join(' and ')} saved.` }
    }
  } catch (err) {
    if (err instanceof SpendInputError || err instanceof AdMetricsError) return { ok: false as const, intent, error: err.message }
    console.error('[ads settings] action failed', err)
    return { ok: false as const, intent, error: 'That did not save. Try again.' }
  }
  return { ok: false as const, intent, error: 'Unknown intent.' }
}

export default function AdsSettings() {
  const { isOwner, overview: o, leadFunnel, leadSmsOptin } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const loading = navigation.state === 'loading' && navigation.location?.pathname === ACTION_PATH

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Settings</h1>
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2">
        <div className="order-1">
          {loading ? <CapSkeleton /> : <CapControl data={{ month: o.month, monthlyCapCents: o.monthlyCapCents, dailyCapCents: o.dailyCapCents }} isOwner={isOwner} actionPath={ACTION_PATH} />}
        </div>
        <div className="order-2 lg:order-3 lg:col-span-2">
          {loading ? <BandSkeleton /> : (
            <SpendBand band={{
              mediaTodayCents: o.mediaTodayCents, dailyCapCents: o.dailyCapCents,
              computeTodayCents: o.computeTodayCents, computeCapCents: o.computeCapCents,
              monthSpentCents: o.month.spentCents, monthlyCapCents: o.monthlyCapCents, spendEnabled: o.spendEnabled,
            }} />
          )}
        </div>
        <div className="order-3 lg:order-4 lg:col-span-2">
          <PlanVsActual
            plan7={o.plan7}
            plan30={o.plan30}
            onEmptyAction={() => document.getElementById('csv-import')?.focus()}
          />
        </div>
        <div className="order-4 lg:order-2">
          <CsvDropZone actionPath={ACTION_PATH} />
        </div>
        <div className="order-5 lg:col-span-2">
          <LeadFunnelCard report={leadFunnel} smsOptin={leadSmsOptin} isOwner={isOwner} actionPath={ACTION_PATH} />
        </div>
        <div className="order-6 lg:col-span-2">
          <AutomationControls data={{ ...o.automation, spendEnabled: o.spendEnabled }} isOwner={isOwner} actionPath={ACTION_PATH} />
        </div>
        <div className="order-7 lg:col-span-2">
          <RuleRecipes thresholds={o.thresholds} grossMarginPct={o.grossMarginPct} isOwner={isOwner} actionPath={ACTION_PATH} />
        </div>
      </div>
    </div>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  const revalidator = useRevalidator()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Settings</h1>
      <ErrorSlab
        title="Couldn't load Settings."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
