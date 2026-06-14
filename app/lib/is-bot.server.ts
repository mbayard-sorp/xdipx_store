/**
 * Server-only User-Agent bot check. Thin wrapper over `isbot` (already a dep,
 * used in entry.server.tsx) so loaders can branch the precompute fast-path:
 * bots must never risk the request-time fan-out / abort path.
 */
import { isbot } from 'isbot'

export function isLikelyBot(request: Request): boolean {
  const ua = request.headers.get('user-agent')
  return !!ua && isbot(ua)
}
