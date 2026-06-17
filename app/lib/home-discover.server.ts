/**
 * "The Compass" discovery assembly — shared by the homepage variant-A branch
 * (`_layout._index.tsx`) and the standalone `/discover` route
 * (`_layout.discover.tsx`).
 *
 * Extracted verbatim from the homepage loader so the new traditional storefront
 * can take over `/` (variant 'b') while The Compass keeps its battle-tested
 * precompute / cold-miss / bot-fallback behavior at `/discover`.
 *
 * Server-only (`.server.ts`): never import from a client component.
 */

import { getDiscoveryRails, getDiscoveryVocab } from '~/lib/discovery.server'
import {
  readHomepagePayloadA, reshuffleRailsWithSeed, triggerHomepageWarm,
  buildHomeContentBlocks, type HomeContentBlocks,
} from '~/lib/homepage-payload.server'
import { isLikelyBot } from '~/lib/is-bot.server'
import { EMPTY_STATE } from '~/types/discovery'

// Variant-A loader-data shape, shared across the precompute / live / minimal
// assembly paths so the component renders identically regardless of source.
// `contentBlocks` is ALWAYS a promise: deferred (live) so it streams in below
// the rails, or pre-resolved (blob / minimal) so bots still get it buffered via
// onAllReady.
export interface VariantAData {
  variant: 'a'
  rails: Awaited<ReturnType<typeof getDiscoveryRails>>['rails']
  total: number
  welcomeBackEnabled: boolean
  moods: string[]
  audiences: string[]
  matters: string[]
  available: Awaited<ReturnType<typeof getDiscoveryRails>>['available']
  contentBlocks: Promise<HomeContentBlocks>
}

// Live assembly — request-time fan-out to discovery + vocab, with the CMS
// content blocks DEFERRED (un-awaited) so they never block the shell's TTFB for
// humans; bots get them buffered (onAllReady). This is the admin path AND the
// cold-miss fallback for humans.
export async function assembleVariantALive(
  welcomeBackEnabled: boolean,
): Promise<VariantAData> {
  const railSeed = Math.floor(Date.now() / 60_000)
  const [{ rails, total, available }, vocab] = await Promise.all([
    getDiscoveryRails(EMPTY_STATE, { perRail: 12, seed: railSeed }),
    getDiscoveryVocab(),
  ])
  return {
    variant: 'a',
    rails, total, welcomeBackEnabled,
    moods: vocab.moods, audiences: vocab.audiences, matters: vocab.matters,
    available,
    contentBlocks: buildHomeContentBlocks(), // deferred (un-awaited)
  }
}

// Minimal-but-valid 200 for BOTS on a total precompute miss. Rails from the
// discovery index (KV) only; CMS content blocks resolved empty. Still complete,
// indexable HTML — never the request-time fan-out / abort path.
export async function assembleVariantAMinimal(
  welcomeBackEnabled: boolean,
): Promise<VariantAData> {
  const railSeed = Math.floor(Date.now() / 60_000)
  const [{ rails, total, available }, vocab] = await Promise.all([
    getDiscoveryRails(EMPTY_STATE, { perRail: 12, seed: railSeed }),
    getDiscoveryVocab(),
  ])
  return {
    variant: 'a',
    rails, total, welcomeBackEnabled,
    moods: vocab.moods, audiences: vocab.audiences, matters: vocab.matters,
    available,
    contentBlocks: Promise.resolve({ sections: [], carouselProductMap: {} }),
  }
}

/**
 * Resolve the right VariantAData for a request, encapsulating the
 * admin / precompute-flag / warm-blob / cold-miss decision tree.
 *
 * Caller owns the response headers (admin gets no-store; everyone else gets the
 * edge-cache headers from the route's `headers` export).
 */
export async function loadVariantAData(
  request: Request,
  opts: { welcomeBackEnabled: boolean; isAdmin: boolean },
): Promise<VariantAData> {
  const { welcomeBackEnabled, isAdmin } = opts

  // Admin always gets live + no-store so template / Sanity edits propagate
  // immediately.
  if (isAdmin) return assembleVariantALive(welcomeBackEnabled)

  // Flag: when disabled, use today's live assembly (no precompute read). Flip
  // HOMEPAGE_PRECOMPUTE_ENABLED=true after observing populated blobs in prod.
  const precomputeEnabled =
    process.env['HOMEPAGE_PRECOMPUTE_ENABLED']?.trim().toLowerCase() === 'true'
  if (!precomputeEnabled) return assembleVariantALive(welcomeBackEnabled)

  const payload = await readHomepagePayloadA()
  if (payload) {
    // Warm-blob fast path — ZERO upstreams. Cheap per-request reshuffle so
    // edge-cached HTML still varies across the 60s window.
    const railSeed = Math.floor(Date.now() / 60_000)
    return {
      variant: 'a',
      rails: reshuffleRailsWithSeed(payload.rails, railSeed),
      total: payload.total,
      welcomeBackEnabled,
      moods: payload.moods,
      audiences: payload.audiences,
      matters: payload.matters,
      available: payload.available,
      // Pre-resolved (NOT deferred) so bots get complete buffered HTML via
      // onAllReady, while the existing <Suspense>/<Await> JSX stays unchanged.
      contentBlocks: Promise.resolve({
        sections: payload.sections,
        carouselProductMap: payload.carouselProductMap,
      }),
    }
  }

  // ── Cold miss (first deploy / evicted KV+Neon / version bump) ───────────
  // Fire-and-forget warm so the blob self-heals within one cron tick.
  triggerHomepageWarm()
  // Bots get the guaranteed-fast minimal-but-valid 200 (never the fan-out /
  // abort path); humans get today's live assembly with deferred blocks.
  return isLikelyBot(request)
    ? assembleVariantAMinimal(welcomeBackEnabled)
    : assembleVariantALive(welcomeBackEnabled)
}
