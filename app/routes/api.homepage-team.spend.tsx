/**
 * POST /api/homepage-team/spend
 *
 * Thin wrapper so the cloud routine records spend without DB creds. Writes to
 * api_token_log (the same table /admin/usage reads), so team spend shows up
 * alongside everything else.
 *
 *   { kind: 'image', model, count, feature?, caller?, productId?, sku?, refId?, requestId? }
 *   { kind: 'tokens', model, source, inputTokens, outputTokens, cacheCreationTokens?,
 *     cacheReadTokens?, feature?, caller?, requestCount? }
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/homepage-team.server'
import { logApiTokens, logImageCost } from '~/lib/token-log.server'
import { MAX_SUBSCRIPTION_SOURCES } from '~/lib/model-pricing.server'

/**
 * Keep the stored `source` inside the known vocabulary.
 *
 * Known Max-subscription aliases pass through unchanged so `estimateCostUsd`
 * can zero-rate them (see MAX_SUBSCRIPTION_SOURCES). 'batch' and 'sync' are the
 * real API-key sources. Anything else is kept as-is for the audit trail but
 * warned about, because a silent unknown is how a feature name ended up in the
 * source column.
 */
function normalizeSpendSource(raw: string | undefined): string {
  if (!raw) return 'agent-sdk'
  const known = new Set([...MAX_SUBSCRIPTION_SOURCES, 'batch', 'sync'])
  if (known.has(raw)) return raw
  console.warn(`[spend] unrecognised token source "${raw}"; pricing it at the premium tier. ` +
    'Add it to MAX_SUBSCRIPTION_SOURCES if it is Max-billed, or fix the caller.')
  return raw
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined)
  const n = (k: string) => (typeof b[k] === 'number' ? (b[k] as number) : undefined)

  if (b['kind'] === 'image') {
    await logImageCost({
      feature: s('feature') ?? 'homepage-images',
      model: s('model') ?? 'fal/flux-dev',
      count: n('count') ?? 1,
      ...(s('caller') ? { caller: s('caller')! } : {}),
      ...(s('productId') ? { productId: s('productId')! } : {}),
      ...(s('sku') ? { sku: s('sku')! } : {}),
      ...(s('refId') ? { refId: s('refId')! } : {}),
      ...(s('requestId') ? { requestId: s('requestId')! } : {}),
    })
  } else {
    await logApiTokens({
      feature: s('feature') ?? 'homepage-merchandise',
      model: s('model') ?? 'claude-sonnet-4-6',
      // Validated, not cast. This was `s('source') as 'batch'|'sync'|'agent-sdk'`,
      // a bare assertion with no runtime check, so any string a caller sent was
      // stored verbatim: 'anthropic-max', 'max-subscription', 'cloud-routine',
      // and once the feature name 'social-drafts'. Only the literal 'agent-sdk'
      // was zero-rated, so Max-subscription usage under any other label was
      // priced at Opus list rates and charged against team budget gates. One
      // such row closed the social gate on 2026-08-21 with $43.50 of cost that
      // was never actually spent. An unrecognised label still prices
      // conservatively (estimateCostUsd defaults to the Opus tier), but it is
      // logged so the caller gets fixed instead of silently mispricing forever.
      source: normalizeSpendSource(s('source')),
      inputTokens: n('inputTokens') ?? 0,
      outputTokens: n('outputTokens') ?? 0,
      ...(n('cacheCreationTokens') != null ? { cacheCreationTokens: n('cacheCreationTokens')! } : {}),
      ...(n('cacheReadTokens') != null ? { cacheReadTokens: n('cacheReadTokens')! } : {}),
      ...(n('requestCount') != null ? { requestCount: n('requestCount')! } : {}),
      ...(s('caller') ? { caller: s('caller')! } : {}),
    })
  }
  return Response.json({ ok: true })
}
