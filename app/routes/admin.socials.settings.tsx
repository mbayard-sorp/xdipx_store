/**
 * /admin/socials/settings: per-platform posting frequency (social_freq_*)
 * and a read-only view of the autopublish valves. The `set-frequency` intent
 * moved here unchanged from the old single-route Social Studio.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getSocialFrequencies, getValve, VALVE_KEYS } from '~/lib/team.server'
import { setPipelineSetting } from '~/lib/pricing-webhook.server'
import { SOCIAL_PLATFORMS, socialFreqKey } from '~/lib/team-keys'
import { FrequencyPanel } from '~/components/admin/social/FrequencyPanel'

const FREQ_ALLOWED_KEYS = SOCIAL_PLATFORMS.map(p => socialFreqKey(p))

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const [frequencies, igAutopublish, xAutopublish] = await Promise.all([
    getSocialFrequencies(),
    getValve(VALVE_KEYS.instagramAutopublish),
    getValve(VALVE_KEYS.xAutopublish),
  ])
  return { frequencies, igAutopublish, xAutopublish }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'set-frequency') {
    const key = form.get('key') as string | null
    const raw = form.get('value') as string | null
    const value = raw == null ? NaN : parseInt(raw, 10)
    if (!key || !FREQ_ALLOWED_KEYS.includes(key)) {
      return { ok: false, error: `Invalid key: ${key}` }
    }
    if (!Number.isFinite(value) || value < 0 || value > 5) {
      return { ok: false, error: 'Frequency must be 0-5 posts/day' }
    }
    await setPipelineSetting(key, String(value))
    return { ok: true, saved: key }
  }

  return { ok: false, error: 'Unknown intent' }
}

export default function SocialsSettings() {
  const { frequencies, igAutopublish, xAutopublish } = useLoaderData<typeof loader>()
  return (
    <FrequencyPanel
      frequencies={frequencies}
      igAutopublish={igAutopublish}
      xAutopublish={xAutopublish}
    />
  )
}
