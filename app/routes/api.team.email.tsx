/**
 * POST /api/team/email — the daily promo email program's team-token
 * endpoint (ticket #15002). The cloud routine has no Klaviyo key, so the
 * server does the Klaviyo work; see docs/store-team/routine-email-daily.md
 * Step 6 for the full op contract and app/lib/email-daily-draft.server.ts
 * for the implementation.
 *
 *   { op: 'draft', date, runId?, sections, products?, seasonalTheme?,
 *     emmaNote?, hypothesis?, subject, previewText?, audienceListId }
 *     -> DraftResult. Idempotent on campaign_key (daily-YYYYMMDD). Refuses
 *        a non-send day and a date more than one day from today (409).
 *
 *   { op: 'preview', same input } -> { campaignKey, html, text }. Pure
 *     render: no Klaviyo calls, no DB row.
 *
 *   { op: 'ledger', since? } -> { sends: LedgerRow[] }. email_sends joined
 *     to each row's latest email_campaign_metrics pull.
 *
 *   { op: 'revisions' } -> { sends: RevisionRow[] }. email_sends rows the
 *     owner sent back for changes via /admin/email's "Request changes"
 *     action (ticket #17445), oldest first.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import { DailyDraftError, draftDailyEmail, getEmailLedger, getEmailRevisions, previewDailyEmail } from '~/lib/email-daily-draft.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    if (body['op'] === 'preview') {
      return Response.json(previewDailyEmail(body))
    }
    if (body['op'] === 'draft') {
      return Response.json(await draftDailyEmail(body))
    }
    if (body['op'] === 'ledger') {
      const since = typeof body['since'] === 'string' ? body['since'] : undefined
      return Response.json({ sends: await getEmailLedger(since) })
    }
    if (body['op'] === 'revisions') {
      return Response.json({ sends: await getEmailRevisions() })
    }
    return new Response("Bad Request: op must be 'draft', 'preview', 'ledger', or 'revisions'", { status: 400 })
  } catch (err) {
    if (err instanceof DailyDraftError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    return apiError('api.team.email', err)
  }
}
