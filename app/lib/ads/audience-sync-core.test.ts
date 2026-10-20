import { describe, expect, it } from 'vitest'
import {
  AUDIENCE_SYNC_DEFS, audienceSyncKeyOfName, buildAudienceLists, buyerDecision, chunk, consentDecision,
  doNotUploadSet, hashEmail, hashPhone, isSha256Hex, normalizeEmail, normalizePhone, saleOptOutFromProperties, sha256Hex,
  type BuyerRow, type ConsentRow,
} from './audience-sync-core'

const ok = (email: string, over: Partial<ConsentRow> = {}): ConsentRow => ({
  email, consent: 'SUBSCRIBED', canReceiveEmailMarketing: true, suppressed: false, saleOptOut: false, ...over,
})
const buyer = (email: string, over: Partial<BuyerRow> = {}): BuyerRow => ({ ...ok(email), placedOrders: 1, cancelledOrders: 0, ...over })

describe('normalization and hashing (Meta customer list spec)', () => {
  it('trims and lowercases an email, and refuses one that is not an address', () => {
    expect(normalizeEmail('  Jane.Doe+x@Example.COM ')).toBe('jane.doe+x@example.com')
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })

  it('hashes the normalized email, so case and spacing do not change the digest', () => {
    const a = hashEmail('Jane@Example.com')
    expect(a).toBe(sha256Hex('jane@example.com'))
    expect(hashEmail('  jane@example.com\n')).toBe(a)
    expect(isSha256Hex(a)).toBe(true)
    expect(hashEmail('nope')).toBeNull()
  })

  it('turns a phone into country-code digits with no symbols or leading zeros', () => {
    expect(normalizePhone('(555) 987-6543')).toBe('15559876543')
    expect(normalizePhone('+1 555 987 6543')).toBe('15559876543')
    expect(normalizePhone('1-555-987-6543')).toBe('15559876543')
    expect(normalizePhone('+44 20 7946 0958')).toBe('442079460958')
    expect(normalizePhone('00447946095800')).toBe('447946095800')
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })

  it("matches Meta's published phone digest", () => {
    // developers.facebook.com custom audiences guide: SHA-256 of 15559876543.
    expect(hashPhone('+1 (555) 987-6543')).toBe('1ef970831d7963307784fa8688e8fce101a15685d62aa765fed23f3a2c576a4e')
  })
})

describe('the consent rule', () => {
  it('lets in only SUBSCRIBED, receivable, unsuppressed, not opted out', () => {
    expect(consentDecision(ok('a@x.co'))).toBeNull()
    expect(consentDecision(ok('a@x.co', { consent: 'NEVER_SUBSCRIBED' }))).toBe('no_marketing_consent')
    expect(consentDecision(ok('a@x.co', { consent: 'UNSUBSCRIBED' }))).toBe('no_marketing_consent')
    expect(consentDecision(ok('a@x.co', { consent: null }))).toBe('no_marketing_consent')
    expect(consentDecision(ok('a@x.co', { suppressed: true }))).toBe('suppressed')
    expect(consentDecision(ok('a@x.co', { canReceiveEmailMarketing: false }))).toBe('suppressed')
    expect(consentDecision(ok('a@x.co', { saleOptOut: true }))).toBe('sale_opt_out')
    expect(consentDecision(ok(''))).toBe('no_email')
  })

  it('needs a buyer to have an order that was not cancelled', () => {
    expect(buyerDecision(buyer('b@x.co'))).toBeNull()
    expect(buyerDecision(buyer('b@x.co', { placedOrders: 1, cancelledOrders: 1 }))).toBe('no_paid_order')
    expect(buyerDecision(buyer('b@x.co', { placedOrders: 0 }))).toBe('no_paid_order')
    expect(buyerDecision(buyer('b@x.co', { placedOrders: 2, cancelledOrders: 1 }))).toBeNull()
  })

  it('reads a sale or sharing opt-out from profile properties', () => {
    expect(saleOptOutFromProperties({ do_not_sell_or_share: true })).toBe(true)
    expect(saleOptOutFromProperties({ ccpa_opt_out: 'yes' })).toBe(true)
    expect(saleOptOutFromProperties({ ccpa_opt_out: 'false' })).toBe(false)
    expect(saleOptOutFromProperties({ interest: 'wand' })).toBe(false)
    expect(saleOptOutFromProperties(null)).toBe(false)
  })

  it('collects every no from either source into one do-not-upload set', () => {
    const set = doNotUploadSet([
      ok('A@x.co', { consent: 'UNSUBSCRIBED' }),
      ok('b@x.co', { suppressed: true }),
      ok('c@x.co', { saleOptOut: true }),
      ok('d@x.co', { consent: 'NEVER_SUBSCRIBED' }),
      ok('e@x.co'),
    ])
    expect([...set].sort()).toEqual(['a@x.co', 'b@x.co', 'c@x.co'])
  })
})

describe('buildAudienceLists', () => {
  it('hashes, de-duplicates and sorts, and a no on one list keeps the email off the other', () => {
    const lists = buildAudienceLists(
      [buyer('one@x.co'), buyer('ONE@x.co'), buyer('two@x.co'), buyer('gone@x.co', { cancelledOrders: 1 }), buyer('quit@x.co')],
      [ok('lead@x.co'), ok('lead@x.co'), ok('quit@x.co', { consent: 'UNSUBSCRIBED' }), ok('never@x.co', { consent: 'NEVER_SUBSCRIBED' })],
    )
    expect(lists.buyers).toEqual([sha256Hex('one@x.co'), sha256Hex('two@x.co')].sort())
    expect(lists.leads).toEqual([sha256Hex('lead@x.co')])
    expect(lists.counts.buyers).toEqual({ read: 5, included: 2, skipped: { no_paid_order: 1, do_not_upload: 1 } })
    expect(lists.counts.leads).toEqual({ read: 4, included: 1, skipped: { no_marketing_consent: 2 } })
  })

  it('never puts a raw email in its output', () => {
    const lists = buildAudienceLists([buyer('secret@x.co')], [ok('other@x.co')])
    const out = JSON.stringify(lists)
    expect(out).not.toContain('secret')
    expect(out).not.toContain('other@')
    expect([...lists.buyers, ...lists.leads].every(isSha256Hex)).toBe(true)
  })
})

describe('names and batching', () => {
  it('recognizes the two sync audiences by name, loosely', () => {
    expect(audienceSyncKeyOfName(AUDIENCE_SYNC_DEFS.buyers.name)).toBe('buyers')
    expect(audienceSyncKeyOfName('  XDIPX   leads (exclude) ')).toBe('leads')
    expect(audienceSyncKeyOfName('Shopify customers')).toBeNull()
    expect(audienceSyncKeyOfName(null)).toBeNull()
  })

  it('splits into batches of at most 10,000', () => {
    const items = Array.from({ length: 25_001 }, (_, i) => i)
    expect(chunk(items).map(b => b.length)).toEqual([10_000, 10_000, 5_001])
    expect(chunk([])).toEqual([])
  })
})
