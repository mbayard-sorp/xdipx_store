/**
 * Google Ads push — INERT STUB. The one viable mainstream paid lane
 * (restricted-serving: adult category serves on search intent, 18+, "Limited"
 * status is the normal state).
 *
 * Future implementation (Google Ads API): create a Campaign with
 * status: PAUSED under GOOGLE_ADS_CUSTOMER_ID (developer token + OAuth
 * refresh token), responsive search / Performance Max assets from the
 * creative batch, compliant non-explicit imagery only. Owner launches in the
 * Google Ads UI by hand.
 */

import type { AdPusher, AdPushResult } from './types'

export const googleAdPusher: AdPusher = {
  platform: 'google',
  configured(): boolean {
    return !!process.env['GOOGLE_ADS_DEVELOPER_TOKEN']?.trim()
      && !!process.env['GOOGLE_ADS_CUSTOMER_ID']?.trim()
      && !!process.env['GOOGLE_ADS_OAUTH_REFRESH_TOKEN']?.trim()
  },
  async pushPausedDraft(_input): Promise<AdPushResult> {
    if (!this.configured()) return { ok: false, reason: 'not_configured' }
    return { ok: false, reason: 'not_configured', detail: 'Google Ads pusher not yet implemented' }
  },
}
