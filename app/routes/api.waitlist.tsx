import type { ActionFunctionArgs } from 'react-router'
import { subscribeToDailyDeal, subscribeToWaitlist } from '~/lib/klaviyo.server'

// Loader required so fetcher revalidation doesn't 404
export async function loader() {
  return Response.json(null)
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')
  const email  = (form.get('email') as string | null)?.trim()

  if (intent === 'subscribe') {
    if (!email) return Response.json({ error: 'Email required' }, { status: 400 })
    try {
      await subscribeToDailyDeal(email)
    } catch (err) {
      console.error('Daily deal subscribe error:', err)
      return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
    return Response.json({ ok: true })
  }

  if (intent === 'waitlist') {
    if (!email) return Response.json({ error: 'Email required' }, { status: 400 })
    const handle = form.get('handle') as string
    try {
      await subscribeToWaitlist(email, handle)
    } catch (err) {
      console.error('Waitlist signup error:', err)
      return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown intent' }, { status: 400 })
}
