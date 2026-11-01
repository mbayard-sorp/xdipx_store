/**
 * ExoClick conversion postback. A banner link carries
 * `?exoclid={conversions_tracking}`; root.tsx stores the id in a cookie, the
 * cart carries it as `_exoclid`, and the order webhook lands here, where we
 * echo it to ExoClick with the order's value. It is the only way ExoClick can
 * learn which clicks became sales, because checkout is on Shopify's domain.
 *
 * Format, from https://docs.exoclick.com/advertisers/conversion-tracking/conversion-tracking.md:
 * GET https://s.magsrv.com/tag.php?goal=<goal id>&tag=<click id>&value=<value>
 * The goal must be set up as S2S with a dynamic value. Set it to count one
 * conversion, so a Shopify webhook retry is refused as a duplicate rather than
 * counted twice.
 *
 * Does nothing until EXOCLICK_GOAL_ID is set, or when the shopper declined
 * marketing cookies. Runs inside Shopify's 5s webhook budget, so it times out
 * early and never retries.
 */

const POSTBACK_URL = 'https://s.magsrv.com/tag.php'
const TIMEOUT_MS = 2500

/** ExoClick's answer when a retry repeats a conversion it already has. */
const ALREADY_SAVED = 'already been notified'

interface PostbackOrder {
  total_price: string
  subtotal_price?: string
  note_attributes?: { name: string; value: string }[]
}

export type PostbackResult =
  | { ok: true; skipped?: 'no_click' | 'no_goal' | 'no_consent' }
  | { ok: false; error: string }

/** What the order earned: after discounts, before tax and shipping. */
export function postbackValue(order: PostbackOrder): string {
  const raw = parseFloat(order.subtotal_price ?? '')
  const value = Number.isFinite(raw) ? raw : parseFloat(order.total_price) || 0
  return value.toFixed(2)
}

export function buildPostbackUrl(goalId: string, clickId: string, value: string): string {
  const qs = new URLSearchParams({ goal: goalId, tag: clickId, value })
  return `${POSTBACK_URL}?${qs.toString()}`
}

export async function sendExoClickConversion(
  order: PostbackOrder,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PostbackResult> {
  const attr = (name: string) => order.note_attributes?.find(a => a.name === name)?.value
  const clickId = attr('_exoclid')
  if (!clickId) return { ok: true, skipped: 'no_click' }
  if (attr('_consent_state') === 'denied') return { ok: true, skipped: 'no_consent' }
  const goalId = env['EXOCLICK_GOAL_ID']?.trim()
  if (!goalId) return { ok: true, skipped: 'no_goal' }

  try {
    const res = await fetchImpl(buildPostbackUrl(goalId, clickId, postbackValue(order)), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.text()).trim()
    if (res.ok && (body.startsWith('OK') || body.includes(ALREADY_SAVED))) return { ok: true }
    return { ok: false, error: `${res.status} ${body.slice(0, 200)}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
