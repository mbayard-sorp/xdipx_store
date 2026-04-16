/**
 * Internal proxy for ai-agent Q&A tools. Lets the Fly IVR reuse the same
 * searchProducts / getProductDetails / listTodaysCollections logic (and MAP
 * rules) that runs on SMS, without duplicating the Shopify client.
 */
import type { ActionFunctionArgs } from 'react-router'
import { runQaTool } from '~/lib/ai-agent/tools.server'
import { verifyInternalSecret } from '~/lib/env.server'

export async function action({ request }: ActionFunctionArgs) {
  if (!verifyInternalSecret(request.headers.get('x-internal-secret'), 'INTERNAL_API_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as
    | { tool?: string; input?: Record<string, unknown>; phone?: string; channel?: 'voice' | 'sms' }
    | null
  if (!body?.tool) return Response.json({ ok: false, error: 'missing tool' }, { status: 400 })

  const result = await runQaTool(body.tool, body.input ?? {}, {
    channel: body.channel ?? 'voice',
    ...(body.phone ? { phone: body.phone } : {}),
  })
  return Response.json(result)
}
