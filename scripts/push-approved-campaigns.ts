import './_load-env'
import { inArray, eq, and } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { suggestionLinks } from '../db/schema'
import { listSuggestions } from '../app/lib/team.server'
import {
  pushApprovedCampaign,
  defaultCampaignPushDeps,
  campaignPushEnabled,
  EMAIL_CAMPAIGN_PUSH_VALVE,
} from '../app/lib/klaviyo-campaigns.server'

/**
 * Execution step for the weekly email routine: turn every APPROVED campaign
 * brief into a Klaviyo DRAFT plus an owner review email. Valve-gated by
 * `email_campaign_push_enabled` (default OFF): with the valve off this exits
 * without touching Klaviyo, the owner inbox, or any ticket.
 *
 * Idempotent: a campaign row that already carries a Klaviyo draft note link is
 * skipped, so re-running the routine does not create duplicate drafts. Nothing
 * is ever sent or scheduled; sending stays a manual step in Klaviyo.
 */

const DRAFT_NOTE_MARKER = 'klaviyo.com/campaign'

async function alreadyPushed(id: number): Promise<boolean> {
  const links = await db
    .select({ ref: suggestionLinks.ref })
    .from(suggestionLinks)
    .where(and(eq(suggestionLinks.suggestionId, id), eq(suggestionLinks.kind, 'note')))
  return links.some(l => (l.ref ?? '').includes(DRAFT_NOTE_MARKER))
}

async function main(): Promise<void> {
  const deps = defaultCampaignPushDeps()

  if (!campaignPushEnabled(await deps.getSetting(EMAIL_CAMPAIGN_PUSH_VALVE))) {
    console.log(`[push-campaigns] ${EMAIL_CAMPAIGN_PUSH_VALVE} is off. Nothing to do.`)
    return
  }

  const rows = await listSuggestions({
    team: 'email',
    kinds: ['campaign'],
    statuses: ['approved'],
    orderBy: 'age',
  })

  if (rows.length === 0) {
    console.log('[push-campaigns] No approved campaign briefs. Clean run.')
    return
  }

  let pushed = 0
  let skipped = 0
  for (const row of rows) {
    if (await alreadyPushed(row.id)) {
      skipped++
      console.log(`[push-campaigns] #${row.id} already has a Klaviyo draft. Skipping.`)
      continue
    }
    const res = await pushApprovedCampaign({ id: row.id, suggestion: row.suggestion }, deps)
    if (res.pushed) {
      pushed++
      console.log(`[push-campaigns] #${row.id} drafted: ${res.editUrl} (owner emailed: ${res.ownerEmailed})`)
    } else {
      console.log(`[push-campaigns] #${row.id} not drafted: ${res.reason}`)
    }
  }

  console.log(`[push-campaigns] done. drafted=${pushed} skipped=${skipped} of ${rows.length} approved.`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[push-campaigns] failed:', err)
    process.exit(1)
  })
