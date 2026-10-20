/**
 * /admin/ad-studio/live: retired as a page. The Live tab's job moved to the
 * ads console tree at /admin/ads/tree (ticket #16413, plan section 7 phase
 * 3c); a GET redirects there with its query string intact.
 *
 * The live-action and live-undo actions stay here unchanged, so anything that
 * still posts to LIVE_ACTION_PATH (LiveActions.tsx) keeps working until the
 * action ledger (phases 4c and 5) replaces them. A tap on a real creative goes
 * through applyRuleAction (paused_at, pause_reason, budget_multiplier, the
 * event row, the platform seam). A tap on a sample row only records the
 * decision.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import { AdMetricsError, isLiveActionKind, recordLiveAction, undoLiveAction } from '~/lib/ad-metrics.server'
import { applyRuleAction } from '~/lib/ad-rules.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return redirect(`/admin/ads/tree${new URL(request.url).search}`, 302)
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const admin = await getAdminUser(request)
  const appliedBy = admin?.email || 'owner'
  try {
    if (intent === 'live-action') {
      const kind = String(form.get('kind') ?? '')
      if (!isLiveActionKind(kind)) return { ok: false as const, intent, error: 'Unknown action.' }
      const key = String(form.get('key') ?? '')
      if (!key.startsWith('sample:') && !(Number.isInteger(Number(key)) && Number(key) > 0)) {
        return { ok: false as const, intent, error: 'Unknown creative.' }
      }
      const ruleId = String(form.get('ruleId') ?? '') || null
      const resolves = Number(form.get('resolvesEventId'))
      const result = key.startsWith('sample:')
        ? await recordLiveAction({
            key, kind, ruleId, appliedBy,
            resolvesEventId: Number.isInteger(resolves) && resolves > 0 ? resolves : null,
          })
        : await applyRuleAction(Number(key), kind, appliedBy, { ruleId })
      return { ok: true as const, intent, eventId: result.eventId, message: result.message, kind }
    }
    if (intent === 'live-undo') {
      const id = Number(form.get('eventId'))
      if (!Number.isInteger(id) || id <= 0) return { ok: false as const, intent, error: 'Nothing to undo.' }
      await undoLiveAction(id, appliedBy)
      return { ok: true as const, intent, message: 'Undone.' }
    }
  } catch (err) {
    if (err instanceof AdMetricsError) return { ok: false as const, intent, error: err.message }
    console.error('[ad-studio live] action failed', err)
    return { ok: false as const, intent, error: 'That did not save. Try again.' }
  }
  return { ok: false as const, intent, error: 'Unknown intent.' }
}
