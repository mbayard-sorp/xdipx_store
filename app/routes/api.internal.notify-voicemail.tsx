/**
 * Internal endpoint called by the Fly.io IVR service after a voicemail row is
 * inserted. Fires a Klaviyo event so the admin notification flow sends an
 * email. Shared-secret guarded.
 */
import type { ActionFunctionArgs } from 'react-router'
import { trackEvent } from '~/lib/klaviyo.server'
import { verifyInternalSecret } from '~/lib/env.server'

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

  const adminEmail = process.env['ADMIN_NOTIFICATION_EMAIL']
  if (!adminEmail) {
    // Voicemail is already stored; just log and 200.
    console.warn('[notify-voicemail] ADMIN_NOTIFICATION_EMAIL not set — skipping Klaviyo event')
    return Response.json({ ok: true, notified: false })
  }

  try {
    await trackEvent(adminEmail, 'IVR Voicemail Received', {
      call_sid: body.callSid,
      from_number: body.fromNumber,
      callback_number: body.callbackNumber,
      summary: body.summary,
      context_order_number: body.contextOrderNumber,
      admin_url: `https://xdipx.com/admin/voicemails`,
    })
  } catch (err) {
    console.error('[notify-voicemail] klaviyo trackEvent failed', err)
    return Response.json({ ok: true, notified: false }, { status: 200 })
  }

  return Response.json({ ok: true, notified: true })
}
