/**
 * Ad platform push connectors — INERT STUBS with a structural policy guard.
 *
 * docs/ads-policy.md is binding: Meta and TikTok paid ads are PROHIBITED for
 * the pleasure catalog (Meta has a narrow health/wellness carve-out; TikTok
 * has none, ever). Those connectors therefore hard-return policy_blocked
 * unless the campaign's policyCheck explicitly cites the health carve-out,
 * EVEN ONCE API KEYS EXIST. Google restricted-serving is the viable
 * mainstream lane; adult ad networks are the other real lane (manual today).
 *
 * "Push" means create a PAUSED draft in-platform for the owner to launch by
 * hand. Nothing here ever activates or spends.
 */

export type AdPushResult =
  | { ok: true; externalCampaignId: string }
  | { ok: false; reason: 'not_configured' | 'policy_blocked' | 'error'; detail?: string }

export interface AdPusher {
  platform: 'meta' | 'tiktok' | 'google'
  configured(): boolean
  pushPausedDraft(input: {
    campaignId: number
    campaignName: string
    policyCheck: string
    creatives: Array<{ format: string; url: string; hookCopy: string | null }>
  }): Promise<AdPushResult>
}

/**
 * The health carve-out test: policyCheck must explicitly invoke it. Keyword
 * gate by design; the substantive judgment lives in the policyCheck text the
 * owner reviewed, this just makes "desire-forward creative to Meta" structurally
 * impossible to do casually.
 */
export function citesHealthCarveOut(policyCheck: string): boolean {
  return /health.{0,40}carve.?out|carve.?out.{0,40}health/is.test(policyCheck)
}
