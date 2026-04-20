import type { ActionFunctionArgs } from 'react-router'
import { getCustomerToken } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { castDialVote, getDialAggregates } from '~/lib/dial-votes.server'

const MAX_DIMENSION_LEN = 40
const VALID_VOTES = new Set([1, -1])

export async function action({ request }: ActionFunctionArgs) {
  const customerToken = await getCustomerToken(request)
  if (!customerToken) {
    return Response.json({ ok: false, error: 'Sign in to vote.' }, { status: 401 })
  }

  let profile
  try {
    profile = await customerAPI(customerToken).getProfile()
  } catch {
    return Response.json({ ok: false, error: 'Session expired.' }, { status: 401 })
  }
  if (!profile) {
    return Response.json({ ok: false, error: 'Profile unavailable.' }, { status: 401 })
  }

  const form = await request.formData()
  const shopifyProductId = String(form.get('shopifyProductId') ?? '').trim()
  const dimension        = String(form.get('dimension')        ?? '').trim()
  const voteRaw          = Number(form.get('vote'))

  if (!shopifyProductId || !dimension) {
    return Response.json({ ok: false, error: 'Missing productId or dimension.' }, { status: 400 })
  }
  if (dimension.length > MAX_DIMENSION_LEN) {
    return Response.json({ ok: false, error: 'Dimension too long.' }, { status: 400 })
  }
  if (!VALID_VOTES.has(voteRaw)) {
    return Response.json({ ok: false, error: 'Vote must be +1 or -1.' }, { status: 400 })
  }

  const result = await castDialVote({
    shopifyProductId,
    dimension,
    customerGid: profile.id,
    vote:        voteRaw as 1 | -1,
  })
  if (!result.ok) {
    return Response.json({ ok: false, error: result.reason }, { status: 409 })
  }

  const aggregates = await getDialAggregates(shopifyProductId)
  return Response.json({ ok: true, aggregates })
}
