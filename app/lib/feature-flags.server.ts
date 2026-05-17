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

/**
 * Gates the v2 "What Matters" chip set (12-chip vocabulary, sentence-case).
 *
 * When false (default): the discovery flow shows the v1 chip set and reads/writes
 * the legacy `xdipx.matters_tags` vocabulary.
 * When true: the discovery flow shows the v2 12-chip set and reads from the
 * normalized vocabulary post-backfill.
 *
 * Flip to `true` only after step 5.5 (full-catalog backfill) clears the launch
 * gate of >=80% catalog coverage on `xdipx.matters_tags`.
 *
 * See: docs/what-matters-final-signoff.md
 */
export function mattersV2Enabled(): boolean {
  return process.env['MATTERS_V2_ENABLED'] === 'true'
}
