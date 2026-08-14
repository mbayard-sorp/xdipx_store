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
      source: (s('source') as 'batch' | 'sync' | 'agent-sdk') ?? 'agent-sdk',
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
