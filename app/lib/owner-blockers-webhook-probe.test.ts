/**
 * The `webhook_registered` probe runner.
 *
 * Separate from owner-blockers.test.ts because that file deliberately imports
 * only `owner-blockers-core` (pure, no Neon client). This one needs the server
 * module, where the runner lives.
 */
import { describe, it, expect } from 'vitest'
import { PROBES } from '~/lib/owner-blockers.server'

type Probe = { describe: (a: string) => string; run: (a: string) => Promise<boolean | null> }

describe('webhook_registered runner', () => {
  const probe = () => (PROBES as unknown as Record<string, Probe>)['webhook_registered']!

  it('is wired into PROBES', () => {
    expect(probe()).toBeDefined()
    expect(typeof probe().run).toBe('function')
  })

  it('returns null, NOT false, when Shopify credentials are absent', async () => {
    const domain = process.env['SHOPIFY_STORE_DOMAIN']
    const token = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']
    delete process.env['SHOPIFY_STORE_DOMAIN']
    delete process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']
    try {
      // "I could not ask" must never be reported as "it is not there".
      // Collapsing those two is what turned a healthy integration into a P1
      // owner blocker whose stated remedy would have broken six live
      // subscriptions by re-registering them under a different HMAC secret.
      await expect(probe().run('all')).resolves.toBeNull()
    } finally {
      if (domain) process.env['SHOPIFY_STORE_DOMAIN'] = domain
      if (token) process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] = token
    }
  })
})
