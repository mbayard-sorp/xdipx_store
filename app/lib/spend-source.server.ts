import { MAX_SUBSCRIPTION_SOURCES } from '~/lib/model-pricing.server'

/**
 * Keep the stored `source` inside the known vocabulary.
 *
 * Known Max-subscription aliases pass through unchanged so `estimateCostUsd`
 * can zero-rate them (see MAX_SUBSCRIPTION_SOURCES). 'batch' and 'sync' are the
 * real API-key sources and pass through so they stay priced.
 *
 * #5929: an UNRECOGNISED label is normalised to a Max-billed source ('cloud-
 * routine') instead of being stored verbatim and priced at the premium tier.
 * The `/api/homepage-team/spend` endpoint that calls this exists solely so
 * cloud routines record their Max-subscription usage without DB creds, and
 * every routine logs `source:"agent-sdk"`; real API-key spend ('batch'/'sync')
 * is logged in-app by token-log.server.ts, not through that endpoint. So the
 * only way an unrecognised label reaches it is a routine that mislabelled its
 * Max usage (a feature name in the source column, a new Max alias), and pricing
 * that at Opus list rates is exactly what manufactured the phantom budget
 * charges this fixes: a 2026-08-21 'anthropic-max' row booked $43.50 and closed
 * the social gate, and run 528 skipped on a ~3649c counter against a ~4c real
 * spend. Charging Max usage as if real money moved is the bug, so an unknown
 * Max-endpoint label defaults to zero-rated rather than premium. The premium-
 * tier default for a genuinely unknown source is preserved where it belongs —
 * `estimateCostUsd`, which every in-app real-money caller goes through — so this
 * narrowing cannot blind a budget gate to real API spend. Still warned so the
 * caller gets its label fixed instead of relying on this fallback forever.
 *
 * Lives in a `.server.ts` module rather than inline in the route: it references
 * the server-only model-pricing module, and a route may only export server code
 * through loader/action/middleware/headers (React Router tree-shakes those from
 * the client bundle; any other export importing a `.server` module breaks the
 * build). This keeps it importable by both the route action and its unit test.
 */
export function normalizeSpendSource(raw: string | undefined): string {
  if (!raw) return 'agent-sdk'
  const known = new Set([...MAX_SUBSCRIPTION_SOURCES, 'batch', 'sync'])
  if (known.has(raw)) return raw
  console.warn(`[spend] unrecognised token source "${raw}"; treating it as Max-billed (cloud-routine) ` +
    'and pricing it at zero. Add it to MAX_SUBSCRIPTION_SOURCES or fix the caller to send a known source.')
  return 'cloud-routine'
}
