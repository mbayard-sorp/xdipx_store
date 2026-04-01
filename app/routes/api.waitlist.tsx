import type { ActionFunctionArgs } from 'react-router'
import { subscribeToDailyDeal, subscribeToWaitlist } from '~/lib/klaviyo.server'

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')
  const email  = (form.get('email') as string | null)?.trim()

  if (intent === 'subscribe') {
    if (!email) return Response.json({ error: 'Email required' }, { status: 400 })
    await subscribeToDailyDeal(email)
    return Response.json({ ok: true })
  }

  if (intent === 'waitlist') {
    if (!email) return Response.json({ error: 'Email required' }, { status: 400 })
    const handle = form.get('handle') as string
    await subscribeToWaitlist(email, handle)
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown intent' }, { status: 400 })
}
