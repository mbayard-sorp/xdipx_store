/**
 * /api/webhooks/meta-leadgen: Meta Page webhook for Instant Form leads.
 *
 * GET is Meta's subscription handshake (hub.challenge echo). POST carries
 * `leadgen` changes, signed with X-Hub-Signature-256 under the app secret.
 * Each lead is ingested before responding (app/lib/meta-crm.server.ts):
 * Vercel discards work started after the response, and Meta gives a webhook
 * well over the few seconds an ingest takes. A lead whose ingest fails still
 * answers 200, because the hourly /cron/meta-crm-sync backfill reads the form
 * directly and retries it; a non-200 would only make Meta resend the whole
 * batch, including leads that already went through.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { extractLeadgenChanges } from '~/lib/meta-crm-core'
import { ingestLead, verifySubscription, verifyWebhookSignature } from '~/lib/meta-crm.server'

/** A single delivery never carries more than a handful; this bounds the work. */
const MAX_LEADS_PER_DELIVERY = 25

export async function loader({ request }: LoaderFunctionArgs) {
  const challenge = verifySubscription(new URL(request.url).searchParams)
  if (challenge === null) return new Response('Forbidden', { status: 403 })
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const raw = await request.text().catch(() => '')
  if (!verifyWebhookSignature(raw, request.headers.get('x-hub-signature-256'))) {
    console.warn('[meta-leadgen] rejected: bad or missing signature')
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const changes = extractLeadgenChanges(body).slice(0, MAX_LEADS_PER_DELIVERY)
  const results = []
  for (const change of changes) results.push(await ingestLead(change))
  const failed = results.filter(r => r.outcome === 'failed').length
  if (failed > 0) console.error(`[meta-leadgen] ${failed} of ${results.length} leads failed to ingest; the backfill retries them`)
  return Response.json({ ok: true, received: changes.length, failed })
}
