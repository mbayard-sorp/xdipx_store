/**
 * Meta (FB/IG) ads push — INERT STUB, policy-gated.
 *
 * Future implementation (Marketing API): POST /act_{META_AD_ACCOUNT_ID}/campaigns
 * { name, objective, status: 'PAUSED', special_ad_categories: [] } -> id; then
 * adsets + adcreatives from the creative URLs, all PAUSED. The owner launches
 * in Ads Manager by hand.
 *
 * POLICY: Meta prohibits ads for adult products; only genuinely clinical
 * sexual/reproductive health SKUs fit the carve-out (18+, medical-efficacy
 * framing, never pleasure). The pleasure catalog can never ride along.
 */

import type { AdPusher, AdPushResult } from './types'
import { citesHealthCarveOut } from './types'

export const metaAdPusher: AdPusher = {
  platform: 'meta',
  configured(): boolean {
    return !!process.env['META_ADS_ACCESS_TOKEN']?.trim() && !!process.env['META_AD_ACCOUNT_ID']?.trim()
  },
  async pushPausedDraft(input): Promise<AdPushResult> {
    if (!citesHealthCarveOut(input.policyCheck)) {
      return {
        ok: false,
        reason: 'policy_blocked',
        detail: 'Meta paid ads are prohibited for the pleasure catalog (docs/ads-policy.md). Only campaigns whose policyCheck explicitly cites the health/wellness carve-out may push here.',
      }
    }
    if (!this.configured()) return { ok: false, reason: 'not_configured' }
    return { ok: false, reason: 'not_configured', detail: 'Meta pusher not yet implemented' }
  },
}
