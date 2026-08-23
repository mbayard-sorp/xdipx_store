/**
 * Wiring for the scheduled publish tick: which platforms run, and what each
 * one's valve, caps, and publisher are.
 *
 * This exists as its own module rather than inside `server/cron.ts` for the
 * same reason the job does. `server/cron*.ts` is a protected path, so anything
 * that lives there is an owner-merged PR and sits outside the test suite.
 * Keeping the handler down to "call this and await it" means adding a platform
 * later is an ordinary reviewable change, and it means the decisions below are
 * testable.
 *
 * Order matters: Instagram runs first. If X is going to exhaust a per-invocation
 * time budget, the platform whose enforcement is account-level and retroactive
 * should already have had its turn, including its removal watch.
 */

import {
  runSocialPublishTick,
  estimateXSpendThisMonthUsd,
  DEFAULT_MAX_PER_DAY,
  type PublishTickDeps,
  type PublishTickResult,
  type PublishPlatform,
  type PostRow,
} from './social-publish-job.server'
import type { PublishMedia } from './social-publish/types'

/** Fallback when `x_publish_max_per_day` is unset. Owner decision 2026-08-16. */
export const X_DEFAULT_MAX_PER_DAY = 2

/**
 * Fallback when `x_publish_max_spend_usd_month` is unset. Owner decision
 * 2026-08-16: $15/mo, which is roughly 75 linked posts, comfortably above a
 * 2/day cadence while still being a real ceiling rather than a formality.
 */
export const X_DEFAULT_MAX_SPEND_USD_MONTH = 15

/** Read a numeric pipeline setting, falling back when unset or unparseable. */
async function numericSetting(key: string, fallback: number): Promise<number> {
  const { getPipelineSetting } = await import('./feed-processor.server')
  const raw = await getPipelineSetting(key)
  const n = raw == null ? NaN : parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * Turn a row into the publisher's media shape.
 *
 * Shared by both platforms because the decision is about the row, not the
 * destination: what kind of media a draft carries does not change with where it
 * is going. Each adapter then rejects what it cannot handle (X refuses video,
 * Instagram refuses a one-item carousel).
 */
export function mediaForPost(post: PostRow):
  | { ok: true; media: PublishMedia }
  | { ok: false; detail: string } {
  const urls = post.mediaUrls ?? []
  const first = urls[0]
  if (!first) return { ok: false, detail: 'Draft has no media URL' }

  const isVideo = post.videoJobId != null || !!first.split('?')[0]?.endsWith('.mp4')
  if (isVideo) {
    return {
      ok: true,
      media: { kind: 'video', videoUrl: first, ...(post.posterUrl ? { posterUrl: post.posterUrl } : {}) },
    }
  }
  return {
    ok: true,
    media: urls.length > 1 ? { kind: 'carousel', imageUrls: urls } : { kind: 'image', imageUrl: first },
  }
}

/** The publish closure both platforms share, routed through the registry. */
async function publishViaRegistry(post: PostRow) {
  const { getPublisher } = await import('./social-publish/registry.server')
  const { parseGateStamp } = await import('./social-publish-approve.server')
  const publisher = getPublisher(post.platform)
  if (!publisher) return { ok: false as const, detail: `No publisher for ${post.platform}` }

  const media = mediaForPost(post)
  if (!media.ok) return { ok: false as const, detail: media.detail }

  const out = await publisher.publish({
    postId: post.id,
    media: media.media,
    caption: post.editedText?.trim() || post.tweetText,
    // The featured product from the gate stamp, for adapters that can tag it
    // on the post (#3744). Additive only; adapters without tagging ignore it.
    productTagHandle: parseGateStamp(post.feedback)?.productHandle ?? null,
    // Accessibility description (migration 084). Additive only; adapters
    // without alt-text support ignore it.
    altText: post.altText ?? null,
  })
  if (out.ok && out.note) console.warn(`[social-publish] post ${post.id}: ${out.note}`)
  // Thread the adapter's note (e.g. "published untagged: product not approved
  // for tagging") back through the return so it reaches the tick report, not
  // only the Vercel console (#3744). An untagged-with-reason publish must be
  // distinguishable from a normal tagged one in the run event.
  return out.ok
    ? { ok: true as const, externalPostId: out.externalPostId, ...(out.note ? { note: out.note } : {}) }
    : { ok: false as const, detail: out.detail ?? out.reason ?? 'Publish failed' }
}

/** Instagram's deps: valve, daily cap, publisher, and its removal watch. */
export async function instagramTickDeps(): Promise<PublishTickDeps> {
  const { getValve, VALVE_KEYS } = await import('./team.server')
  return {
    platform: 'instagram',
    isEnabled: () => getValve(VALVE_KEYS.instagramAutopublish),
    maxPerDay: () => numericSetting('instagram_publish_max_per_day', DEFAULT_MAX_PER_DAY),
    publish: publishViaRegistry,
  }
}

/**
 * X's deps.
 *
 * Two differences from Instagram, both deliberate.
 *
 * The spend guard is supplied, because X bills per post. Instagram passes
 * neither half and so is never budget-checked.
 *
 * The removal watch is supplied explicitly rather than left to default. The
 * default is `runRemovalWatch`, which reads Instagram media state through the
 * Graph API and, on a pattern, turns the INSTAGRAM valve off. Running it under
 * an X tick would check the wrong account and could disable the wrong channel.
 * `runXRemovalWatch` (ticket #3745) is the X-side mirror: same step-down and
 * valve-off semantics against `social_freq_x` and `x_autopublish_enabled`.
 */
export async function xTickDeps(): Promise<PublishTickDeps> {
  const { getValve, VALVE_KEYS } = await import('./team.server')
  return {
    platform: 'x',
    isEnabled: () => getValve(VALVE_KEYS.xAutopublish),
    maxPerDay: () => numericSetting('x_publish_max_per_day', X_DEFAULT_MAX_PER_DAY),
    monthSpendUsd: () => estimateXSpendThisMonthUsd(),
    maxSpendUsd: () => numericSetting('x_publish_max_spend_usd_month', X_DEFAULT_MAX_SPEND_USD_MONTH),
    publish: publishViaRegistry,
    removalWatch: async () => {
      const { runXRemovalWatch } = await import('./x-removal-watch.server')
      return runXRemovalWatch()
    },
  }
}

/** Platforms the scheduled tick runs, in order. */
export const SCHEDULED_PUBLISH_PLATFORMS: readonly PublishPlatform[] = ['instagram', 'x']

/**
 * Run one tick per platform and return every result.
 *
 * A platform that throws does not stop the others: a Meta outage must not stop
 * X from publishing, and vice versa. Each failure is returned as its own result
 * so the cron response still shows what happened.
 *
 * AWAIT this before responding. Work that continues after the response is
 * discarded on Vercel, which is how six Shopify webhook handlers silently did
 * nothing for months.
 */
export async function runAllSocialPublishTicks(): Promise<PublishTickResult[]> {
  const depsFor: Record<PublishPlatform, () => Promise<PublishTickDeps>> = {
    instagram: instagramTickDeps,
    x: xTickDeps,
  }

  const results: PublishTickResult[] = []
  for (const platform of SCHEDULED_PUBLISH_PLATFORMS) {
    try {
      results.push(await runSocialPublishTick(await depsFor[platform]()))
    } catch (err) {
      console.error(`[social-publish] ${platform} tick failed:`, err)
      results.push({
        skipped: `error: ${(err as Error).message}`,
        swept: 0,
        attempts: [],
        publishedToday: 0,
        platform,
      })
    }
  }
  return results
}
