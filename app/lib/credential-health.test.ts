import { describe, expect, it } from 'vitest'

import {
  INTEGRATIONS,
  credentialDedupeKey,
  integration,
  shouldFile,
} from '~/lib/credential-health'

describe('the registry', () => {
  it('gives every integration a key, a lane and a place to go', () => {
    for (const i of INTEGRATIONS) {
      expect(i.key, 'key').toMatch(/^[a-z][a-z0-9-]*$/)
      expect(i.envVars.length, `${i.key} envVars`).toBeGreaterThan(0)
      expect(i.ownerTeam, `${i.key} ownerTeam`).toBeTruthy()
      expect(i.whereToGo.length, `${i.key} whereToGo`).toBeGreaterThan(10)
    }
  })

  it('says what actually stops for each one', () => {
    // The blocker's `unblocks` line is this string. "Instagram breaks" is not
    // an answer the owner can act on at 7am; "removal detection, which is the
    // safety net under autopublish" is.
    for (const i of INTEGRATIONS) {
      expect(i.breaks.length, `${i.key} breaks`).toBeGreaterThan(40)
    }
  })

  it('has no duplicate keys, which would collapse two blockers into one row', () => {
    const keys = INTEGRATIONS.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('covers the credential whose expiry this program was written about', () => {
    // An expired IG_GRAPH_ACCESS_TOKEN is indistinguishable from a takedown to
    // the removal watcher, which then halves posting volume — and until Stage
    // G4 there was no way back up.
    const ig = integration('instagram')
    expect(ig?.envVars).toContain('IG_GRAPH_ACCESS_TOKEN')
  })

  it('marks the money path where it exists', () => {
    expect(integration('shopify-admin')?.moneyPath).toBe(true)
    expect(integration('shopify-storefront')?.moneyPath).toBe(true)
    // Vercel is money-path for a non-obvious reason worth keeping true: the log
    // read is check 4 of the conversion-delivery watcher.
    expect(integration('vercel')?.moneyPath).toBe(true)
  })

  it('does not know integrations it was never told about', () => {
    expect(integration('mailchimp')).toBeNull()
  })
})

describe('what gets filed', () => {
  const req = integration('github')!
  const opt = integration('runpod')!

  it('files on an authoritative rejection', () => {
    expect(shouldFile(req, 'dead')).toBe(true)
    expect(shouldFile(opt, 'dead')).toBe(true)
  })

  it('never files on a could-not-ask', () => {
    // The whole discipline. This runs every six hours against nine third-party
    // APIs, so transient failures are certain, and a blocker list that fills
    // with them is a blocker list nobody reads. It is also #4702 as a rule:
    // unreachable from this process is not proof of broken.
    expect(shouldFile(req, 'unknown')).toBe(false)
    expect(shouldFile(opt, 'unknown')).toBe(false)
  })

  it('never files on a healthy credential', () => {
    expect(shouldFile(req, 'live')).toBe(false)
  })

  it('files a missing value only when the fleet needs it', () => {
    // Several of these are legitimately switched off. An absent value there is
    // a decision, not a defect.
    expect(shouldFile(req, 'unconfigured')).toBe(true)
    expect(shouldFile(opt, 'unconfigured')).toBe(false)
  })

  it('uses one stable dedupe key per integration', () => {
    // A credential that dies, is renewed, and dies again is one row with a
    // history, not three rows. Canonical form, so it cannot repeat the
    // new-product cap bug where the writer and the reader disagreed on shape.
    expect(credentialDedupeKey('instagram')).toBe('credential-instagram')
    expect(credentialDedupeKey('instagram')).toBe(credentialDedupeKey('instagram'))
  })
})
