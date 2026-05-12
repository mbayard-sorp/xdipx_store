import type { ActionFunctionArgs } from 'react-router'
import { data } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDistinctProductTypes } from '~/lib/shopify.server'
import { setCachedProductTypes } from '~/lib/pricing-agent.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  if (request.method !== 'POST') {
    return data({ ok: false, error: 'method not allowed' }, { status: 405 })
  }
  try {
    const types = await getDistinctProductTypes({ force: true })
    await setCachedProductTypes(types)
    return { ok: true, count: types.length, refreshedAt: new Date().toISOString(), types }
  } catch (err) {
    console.error('[api.pricing.refresh-product-types]', err)
    return data({ ok: false, error: String(err) }, { status: 500 })
  }
}
