/**
 * Decides which error view a bridge-route failure gets (ticket #16146).
 *
 * The bridge route (app/routes/bridge.$slug.tsx, re-exported by $slug.tsx) also
 * matches single-segment paths on xdipx.com, where it must 404 into the
 * storefront's root boundary. Its loader marks that case with `{ bridge: false }`
 * on the thrown data. Every other failure in the route (bridge-host 404s, thrown
 * Errors, 500s) happens after the host gate passed, so it is a bridge-host error
 * and gets the funnel-native view (docs/ads-policy.md M1).
 *
 * Client-safe: no .server imports.
 */

export const STOREFRONT_404 = { bridge: false } as const
export const BRIDGE_404 = { bridge: true } as const

/** True when the failure belongs on the bridge host, false for a storefront 404. */
export function isBridgeError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const e = error as { status?: unknown; data?: unknown }
    if (typeof e.status === 'number' && e.data && typeof e.data === 'object') {
      if ((e.data as { bridge?: unknown }).bridge === false) return false
    }
  }
  return true
}

/** HTTP status to show for a bridge error: the thrown status, else 500. */
export function bridgeErrorStatus(error: unknown): number {
  if (error && typeof error === 'object') {
    const s = (error as { status?: unknown }).status
    if (typeof s === 'number' && s >= 400 && s < 600) return s
  }
  return 500
}
