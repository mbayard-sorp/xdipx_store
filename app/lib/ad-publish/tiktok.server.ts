/**
 * TikTok ads push — INERT STUB, policy-gated harder than Meta.
 *
 * POLICY: TikTok prohibits adult-product advertising outright with NO
 * carve-out. docs/ads-policy.md: "never propose, ever." This stub exists only
 * so the connector interface is total; it blocks every push for this catalog
 * regardless of keys or policyCheck wording, and the carve-out test is still
 * required so nothing slips through on a copy-paste.
 */

import type { AdPusher, AdPushResult } from './types'
import { citesHealthCarveOut } from './types'

export const tiktokAdPusher: AdPusher = {
  platform: 'tiktok',
  configured(): boolean {
    return !!process.env['TIKTOK_ADS_ACCESS_TOKEN']?.trim() && !!process.env['TIKTOK_ADVERTISER_ID']?.trim()
  },
  async pushPausedDraft(input): Promise<AdPushResult> {
    if (!citesHealthCarveOut(input.policyCheck)) {
      return {
        ok: false,
        reason: 'policy_blocked',
        detail: 'TikTok paid ads are prohibited for this catalog with no carve-out (docs/ads-policy.md: never propose, ever).',
      }
    }
    // Even a carve-out claim gets a hard stop on TikTok; the policy has no
    // lane here. Keys change nothing.
    return {
      ok: false,
      reason: 'policy_blocked',
      detail: 'TikTok has no policy lane for this catalog. Use Google restricted-serving or adult networks.',
    }
  },
}
