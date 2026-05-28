import { parse as parseCookie } from 'cookie'
import { db } from './db.server'
import { consentLog, tosAcceptance } from '../../db/schema'
import { getClientIP, hashIP } from './attribution.server'
import type { ConsentType } from '~/types'

// Cookie written by analytics.client.ts updateConsent(true).
// Value is a JSON object { marketing: boolean } so we can extend it later
// without changing the cookie name.
export const MARKETING_CONSENT_COOKIE = '__xdipx_consent'

/**
 * Synchronous server-side read of the marketing consent cookie.
 * Returns true only when the visitor has explicitly granted marketing consent
 * (the cookie contains { marketing: true }). Default/absent = false.
 */
export function getMarketingConsent(request: Request): boolean {
  const cookies = parseCookie(request.headers.get('Cookie') ?? '')
  const raw = cookies[MARKETING_CONSENT_COOKIE]
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as { marketing?: boolean }
    return parsed.marketing === true
  } catch {
    return false
  }
}

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
