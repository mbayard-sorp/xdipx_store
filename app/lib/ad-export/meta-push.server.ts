/**
 * Meta paused draft: the push step, now a thin wrapper (phase 6a, ticket
 * #16434). The Graph calls moved to metaCreatePaused in
 * app/lib/ads/channels/meta/mutate.server.ts, reached through
 * dispatchCreatePaused in channels/apply.server.ts, which writes one
 * owner-tier ad_actions row per attempt. This file keeps the old refusal
 * order and error codes so the Creatives tab action works unchanged:
 *
 *   1. valve off                       -> MetaPushError('spend_disabled')
 *   2. token, account or page missing  -> MetaPushError('not_configured')
 *   3. payload not a safe paused draft -> MetaPushError('not_exportable')
 *   4. already created on Meta         -> MetaPushError('already_pushed')
 *   5. the five Graph calls, all PAUSED, run by the adapter
 *
 * The valve is checked first, so with ads_spend_enabled off nothing else is
 * read or sent.
 */
import type { ApplyDeps } from '~/lib/ads/channels/apply.server'
import { MutationRefusedError } from '~/lib/ads/channels/errors'
import type { MetaCredentials } from '~/lib/ads/channels/meta/credentials'
import type { MetaCreatePausedInput, MetaCreatePausedResult } from '~/lib/ads/channels/meta/mutate.server'
import { MetaPushError, isMetaDraftPayload } from './meta-payload'

export { metaCredentialsFromEnv, type MetaCredentials } from '~/lib/ads/channels/meta/credentials'

export interface MetaPushDeps {
  spendEnabled: () => Promise<boolean>
  credentials: () => MetaCredentials
  /** The admin who pressed the button. Becomes proposed_by and pushedBy. */
  actor?: string
  /** Test seam into the dispatcher: store, settings and adapter. */
  apply?: ApplyDeps
}

export type MetaPushExisting = NonNullable<MetaCreatePausedInput['existing']>
export type MetaPushResult = MetaCreatePausedResult

/** Create the paused draft for one ad of a payload set. Never creates anything ACTIVE. */
export async function pushMetaDraft(
  payload: unknown,
  adCreativeId: number,
  existing: MetaPushExisting,
  deps: MetaPushDeps,
): Promise<MetaPushResult> {
  if (!(await deps.spendEnabled())) {
    throw new MetaPushError('spend_disabled', 'Spend is off (ads_spend_enabled is false). Nothing was sent to Meta.')
  }
  const cred = deps.credentials()
  const missing = [!cred.token && 'META_ADS_ACCESS_TOKEN', !cred.accountId && 'META_AD_ACCOUNT_ID', !cred.pageId && 'META_PAGE_ID'].filter(Boolean)
  if (missing.length) throw new MetaPushError('not_configured', `Meta is not configured: ${missing.join(', ')} not set. Nothing was sent.`)
  if (!isMetaDraftPayload(payload)) throw new MetaPushError('not_exportable', 'No ready Meta payload on this creative. Build it first.')
  MetaPushError.assertSafe(payload)

  const { dispatchCreatePaused } = await import('~/lib/ads/channels/apply.server')
  const actor = deps.actor ?? 'owner'
  const input: MetaCreatePausedInput = { payload, adCreativeId, existing, actor }
  try {
    const { created } = await dispatchCreatePaused({ platform: 'meta', adCreativeId, input, proposedBy: actor }, deps.apply)
    return created as MetaPushResult
  } catch (err) {
    if (err instanceof MutationRefusedError) {
      if (err.code === 'spend_disabled') throw new MetaPushError('spend_disabled', 'Spend is off (ads_spend_enabled is false). Nothing was sent to Meta.')
      if (err.code === 'already_applied') throw new MetaPushError('already_pushed', err.message)
      throw new MetaPushError('not_exportable', err.message)
    }
    throw err
  }
}
