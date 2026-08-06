/**
 * Internal endpoint called by the Fly.io IVR service after a voicemail row is
 * inserted. Fires a Klaviyo event so the admin notification flow sends an
 * email. Shared-secret guarded.
 */
import type { ActionFunctionArgs } from 'react-router'
import { verifyInternalSecret } from '~/lib/env.server'
import { notifyVoicemailReceived } from '~/lib/ivr-voicemail.server'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

  if (!verifyInternalSecret(request.headers.get('x-internal-secret'), 'INTERNAL_API_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  const body = (await request.json()) as {
    callSid: string
    fromNumber: string
    callbackNumber: string | null
    summary: string
    contextOrderNumber: string | null
  }

  // Shared with the pre-agent <Record> gates so the Klaviyo event shape and the
  // ADMIN_NOTIFICATION_EMAIL guard have a single source of truth. Never throws.
  const notified = await notifyVoicemailReceived({
    callSid: body.callSid,
    fromNumber: body.fromNumber,
    callbackNumber: body.callbackNumber,
    summary: body.summary,
    contextOrderNumber: body.contextOrderNumber,
  })

  return Response.json({ ok: true, notified })
}
