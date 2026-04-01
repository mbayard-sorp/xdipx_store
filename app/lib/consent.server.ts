import { db } from './db.server'
import { consentLog, tosAcceptance } from '../../db/schema'
import { getClientIP, hashIP } from './attribution.server'
import type { ConsentType } from '~/types'

export async function logConsent(
  request: Request,
  opts: {
    sessionId: string
    customerId?: string
    consentType: ConsentType
    policyVersion: string
  },
): Promise<void> {
  await db.insert(consentLog).values({
    sessionId:     opts.sessionId,
    customerId:    opts.customerId ?? null,
    ipHash:        hashIP(getClientIP(request)),
    consentGiven:  true,
    consentType:   opts.consentType,
    policyVersion: opts.policyVersion,
  })
}

export async function logTosAcceptance(
  request: Request,
  opts: {
    customerId: string
    email?: string
    tosVersion: string
    method: 'checkout' | 'account_creation' | 'explicit_click'
  },
): Promise<void> {
  await db.insert(tosAcceptance).values({
    customerId:       opts.customerId,
    email:            opts.email ?? null,
    tosVersion:       opts.tosVersion,
    ipHash:           hashIP(getClientIP(request)),
    acceptanceMethod: opts.method,
  })
}
