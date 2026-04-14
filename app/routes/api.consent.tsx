import type { ActionFunctionArgs } from 'react-router'
import { db }         from '~/lib/db.server'
import { consentLog } from '../../db/schema'
import { getClientIP, hashIP } from '~/lib/attribution.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import type { ConsentType } from '~/types'

export async function action({ request }: ActionFunctionArgs) {
  const rl = await checkRateLimit(request, 'consent', 10, 3600)
  if (!rl.ok) return rateLimited()

  const body = await request.json() as {
    session_id:     string
    customer_id?:   string
    consent_type:   ConsentType
    policy_version: string
  }

  await db.insert(consentLog).values({
    sessionId:     body.session_id,
    customerId:    body.customer_id ?? null,
    ipHash:        hashIP(getClientIP(request)),
    consentGiven:  true,
    consentType:   body.consent_type,
    policyVersion: body.policy_version,
  })

  return Response.json({ ok: true })
}
