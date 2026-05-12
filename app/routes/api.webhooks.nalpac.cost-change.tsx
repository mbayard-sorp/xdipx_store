import type { ActionFunctionArgs } from 'react-router'
import { timingSafeEqual } from 'node:crypto'
import { processNalpacCostChanges } from '~/lib/pricing-webhook.server'
import type { NalpacCostChangeEvent } from '~/lib/pricing-webhook.server'

function safeCompare(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ab.length !== bb.length) {
      // Length-constant path: compare against a fixed-length buffer to avoid
      // leaking length info, but still return false.
      timingSafeEqual(ab, ab)
      return false
    }
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

function isValidEvent(ev: unknown): ev is NalpacCostChangeEvent {
  if (!ev || typeof ev !== 'object') return false
  const e = ev as Record<string, unknown>
  if (typeof e['sku'] !== 'string' || !e['sku']) return false
  for (const key of ['wholesale', 'msrp', 'mapPrice', 'salePrice'] as const) {
    if (e[key] !== undefined && typeof e[key] !== 'number') return false
  }
  return true
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 })
  }

  const secret = process.env['NALPAC_WEBHOOK_SECRET']
  if (!secret) {
    return Response.json({ ok: false, error: 'Webhook secret not configured' }, { status: 500 })
  }

  const incoming = request.headers.get('x-nalpac-webhook-secret') ?? ''
  if (!safeCompare(secret, incoming)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>)['events'])) {
    return Response.json({ ok: false, error: 'Body must be { events: NalpacCostChangeEvent[] }' }, { status: 400 })
  }

  const events = (body as Record<string, unknown>)['events'] as unknown[]

  if (events.length > 200) {
    return Response.json({ ok: false, error: 'Too many events (max 200)' }, { status: 413 })
  }

  const valid: NalpacCostChangeEvent[] = []
  const bad: unknown[] = []
  for (const ev of events) {
    if (isValidEvent(ev)) valid.push(ev)
    else bad.push(ev)
  }

  if (bad.length > 0 && valid.length === 0) {
    return Response.json({ ok: false, error: 'No valid events in payload' }, { status: 400 })
  }

  try {
    const result = await processNalpacCostChanges(valid, 'webhook')

    if (result.errors[0]?.message === 'webhook disabled') {
      return Response.json({ ok: false, reason: 'disabled' }, { status: 503 })
    }

    return Response.json({ ok: true, result })
  } catch (err) {
    console.error('[nalpac-cost-change webhook]', err)
    return Response.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
