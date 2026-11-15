/**
 * ExoClick banner policy (docs/ads-policy.md, Adult ad networks row). Pure and
 * client-safe. Lives apart from adapter.server.ts so mutate.server.ts can run
 * the same check on a banner upload without importing the adapter back.
 */
import type { PolicyContext, PolicyRefusal, PolicyVerdict } from '../types'

export const EXOCLICK_CHANNEL = 'adult:exoclick' as const

/** The four UTMs docs/ads-policy.md makes mandatory on every adult-network banner URL. */
export const REQUIRED_UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const

export interface ExoPolicyContext extends PolicyContext {
  /** Every banner destination URL the action would put on ExoClick. */
  bannerUrls?: readonly string[]
}

/**
 * Allowed only when every banner URL carries utm_source, utm_medium,
 * utm_campaign and utm_content with a value. Each missing parameter is its
 * own refusal, named. Mirrored ExoClick variations that ExoClick rejected
 * also refuse, the same way Meta and Microsoft disapprovals do.
 */
export function exoclickPolicyCheck(ctx: ExoPolicyContext): PolicyVerdict {
  const refusals: PolicyRefusal[] = ctx.mirror
    .filter(r => r.platform === EXOCLICK_CHANNEL && r.effectiveStatus === 'DISAPPROVED')
    .map(r => ({
      code: 'exoclick_rejected',
      message: `ExoClick ${r.level} ${r.externalId}${r.name ? ` (${r.name})` : ''} was rejected in review. Resolve it before changing anything on ExoClick.`,
      ref: { platform: EXOCLICK_CHANNEL, level: r.level, externalId: r.externalId },
    }))
  for (const raw of ctx.bannerUrls ?? []) {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      refusals.push({ code: 'exoclick_bad_url', message: `Banner URL is not a valid URL: ${raw.slice(0, 200)}` })
      continue
    }
    for (const p of REQUIRED_UTMS) {
      if (!u.searchParams.get(p)?.trim()) {
        refusals.push({
          code: 'exoclick_missing_utm',
          message: `Banner URL ${u.origin}${u.pathname} is missing ${p}. docs/ads-policy.md makes utm_source, utm_medium, utm_campaign and utm_content mandatory on every adult-network banner.`,
        })
      }
    }
  }
  return { ok: refusals.length === 0, refusals }
}

