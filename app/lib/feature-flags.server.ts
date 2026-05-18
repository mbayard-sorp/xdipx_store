/**
 * Deploy-controlled feature flags.
 *
 * Flags here gate code that has shipped but is not yet user-visible. They live
 * in environment variables so they can be flipped per-environment (preview vs
 * production) without an editorial workflow.
 *
 * Editorial toggles — featured products, banner state, copy variants — belong
 * in Sanity, not here. This module is for migration gates and rollouts.
 *
 * Server-only by the `.server.ts` suffix. Never import from client code; route
 * the boolean through a loader if a client component needs it.
 *
 * Convention:
 *   - Flag value is read as `process.env.NAME === 'true'`. Anything else (unset,
 *     `false`, `0`, empty string) is false.
 *   - One exported helper per flag — never a generic getter — so call sites
 *     grep cleanly and removal is mechanical when the flag retires.
 */

import { MATTERS_V2, type Matters } from '~/types/discovery'

/**
 * Returns the chip set the discovery UI should *display*.
 *
 * Not the same as the allow-list (`MATTERS` in app/types/discovery.ts), which
 * stays as the union of v1 + v2 during the transition so legacy data isn't
 * silently dropped from filter results. This helper picks the set the user
 * sees and interacts with.
 *
 * Server-only — must be called from a loader and the result passed through
 * to the client as a prop.
 */
export function getActiveMatters(): readonly Matters[] {
  return MATTERS_V2
}

/**
 * HOME_EMMA_CHAT=1 — swap EmmaSidekick for the full EmmaChatPanel on Variant A.
 * Off by default; flip per-environment in Vercel project settings.
 */
export function isEmmaChatEnabled(): boolean {
  return process.env.HOME_EMMA_CHAT === '1'
}
