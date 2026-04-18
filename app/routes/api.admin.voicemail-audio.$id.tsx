/**
 * Server-side proxy for Twilio recordings. Twilio recording URLs require
 * basic auth with the account SID + auth token, so we cannot link to them
 * directly from the browser. This loader authenticates to Twilio, streams
 * the audio back to the admin user, and 403s anyone who isn't logged in.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { voicemails } from '~/../db/schema'

export async function loader({ params, request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const id = Number(params['id'])
  if (!Number.isFinite(id)) return new Response('bad id', { status: 400 })

  const rows = await db.select().from(voicemails).where(eq(voicemails.id, id)).limit(1)
  const vm = rows[0]
  if (!vm?.recordingUrl) return new Response('no recording', { status: 404 })

  // Allow-list: only proxy bona-fide Twilio recording URLs. Defends against
  // the case where a compromised/migrated DB row points elsewhere — this
  // endpoint carries Twilio basic auth, so it must never hit arbitrary hosts.
  let parsed: URL
  try {
    parsed = new URL(vm.recordingUrl)
  } catch {
    return new Response('invalid recording', { status: 400 })
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.twilio.com' || !parsed.pathname.includes('/Recordings/')) {
    console.error('[voicemail-proxy] rejected non-Twilio recording URL')
    return new Response('invalid recording', { status: 400 })
  }

  const sid = process.env['TWILIO_ACCOUNT_SID']
  const token = process.env['TWILIO_AUTH_TOKEN']
  if (!sid || !token) return new Response('twilio unconfigured', { status: 500 })

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  // Twilio recording URLs end in "/Recordings/RExxxx"; append ".mp3" for a playable format.
  const url = vm.recordingUrl.endsWith('.mp3') ? vm.recordingUrl : `${vm.recordingUrl}.mp3`

  const upstream = await fetch(url, { headers: { Authorization: `Basic ${auth}` } }).catch((err) => {
    console.error('[voicemail-proxy] upstream fetch failed', err)
    return null
  })
  if (!upstream) return new Response('recording unavailable', { status: 502 })
  if (!upstream.ok || !upstream.body) {
    console.error(`[voicemail-proxy] twilio returned ${upstream.status}`)
    return new Response('recording unavailable', { status: 502 })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
