import { describe, expect, it, vi } from 'vitest'

// Never touch the real database from a test: .env DATABASE_URL is production.
vi.mock('~/lib/db.server', () => ({ db: {} }))

import type { AdActionRow, NewAdAction } from './ledger.server'
import { isLegalTransition, type AdActionStatus } from './ledger-core'
import type { BuyerRow, ConsentRow } from './audience-sync-core'
import {
  consentRowFrom, klaviyoExcludeListIds, runAudienceSync,
  type AudienceSources, type AudienceSyncDeps, type AudienceSyncLedger, type AudienceSyncMeta,
} from './audience-sync.server'

const NOW = new Date('2026-10-25T09:20:00Z')

const consent = (email: string, over: Partial<ConsentRow> = {}): ConsentRow => ({
  email, consent: 'SUBSCRIBED', canReceiveEmailMarketing: true, suppressed: false, saleOptOut: false, ...over,
})
const buyer = (email: string): BuyerRow => ({ ...consent(email), placedOrders: 1, cancelledOrders: 0 })

const SOURCES: AudienceSources = {
  buyers: [buyer('b1@x.co'), buyer('b2@x.co')],
  leads: [consent('l1@x.co'), consent('l2@x.co', { consent: 'UNSUBSCRIBED' })],
  klaviyoListIds: ['UHiJc9'],
  gaps: [],
}

function memoryLedger() {
  const rows: AdActionRow[] = []
  let id = 1
  const ledger: AudienceSyncLedger = {
    findByKey: async key => rows.find(r => r.idempotencyKey === key) ?? null,
    insert: async (input: NewAdAction) => {
      if (rows.some(r => r.idempotencyKey === input.idempotencyKey)) return { inserted: false, row: null }
      const row = {
        id: id++, idempotencyKey: input.idempotencyKey, platform: input.platform, targetLevel: input.targetLevel,
        targetExternalId: input.targetExternalId, verb: input.verb, params: input.params ?? null, before: input.before ?? null,
        after: input.after ?? null, proposedBy: input.proposedBy, reason: input.reason ?? null, ruleEventId: null,
        tier: input.tier, status: input.status ?? 'proposed', approvedBy: null, approvedAt: null, appliedAt: null,
        platformResponse: null, error: null, expiresAt: null, createdAt: NOW,
      } as AdActionRow
      rows.push(row)
      return { inserted: true, row }
    },
    transition: async (rowId: number, to: AdActionStatus, actor: string, extra = {}) => {
      const row = rows.find(r => r.id === rowId)
      if (!row || !isLegalTransition(row.status, to)) throw new Error(`illegal ${row?.status} -> ${to}`)
      Object.assign(row, { status: to, ...(to === 'approved' ? { approvedBy: actor } : {}) })
      if (extra.after !== undefined) row.after = extra.after
      if (extra.error !== undefined) row.error = extra.error
      if (extra.platformResponse !== undefined) row.platformResponse = extra.platformResponse
      return row
    },
  }
  return { ledger, rows }
}

function fakeMeta(opts: { existing?: boolean; failOn?: 'buyers' | 'leads' } = {}) {
  const uploads: Array<{ id: string; rows: number; fresh: boolean }> = []
  const meta: AudienceSyncMeta = {
    ensureCustomerListAudience: vi.fn(async (def: { name: string }) => ({
      id: def.name.includes('buyers') ? '9001' : '9002', created: !opts.existing, subtype: 'CUSTOM', operationStatus: null, request: null,
    })),
    loadCustomerListMembers: vi.fn(async (id: string, hashes: readonly string[], o: { fresh: boolean }) => {
      if ((opts.failOn === 'buyers' && id === '9001') || (opts.failOn === 'leads' && id === '9002')) throw new Error('Graph POST refused: replace in progress')
      uploads.push({ id, rows: hashes.length, fresh: o.fresh })
      const mode: 'users' | 'usersreplace' = o.fresh ? 'users' : 'usersreplace'
      return { audienceId: id, mode, sessionId: 1, batches: 1, rows: hashes.length, numReceived: hashes.length, numInvalid: 0, requests: [] }
    }),
  }
  return { meta, uploads }
}

function deps(over: Partial<AudienceSyncDeps> & { ledger: AudienceSyncLedger }): AudienceSyncDeps {
  return {
    enabled: async () => true,
    credentials: () => ({ token: 'tok', accountId: 'act_1' }),
    readSources: async () => SOURCES,
    refreshMirror: vi.fn(async () => ({})),
    now: () => NOW,
    ...over,
  }
}

describe('runAudienceSync: dry runs', () => {
  it('valve off: one dry_run row with the counts, and Meta is never touched', async () => {
    const { ledger, rows } = memoryLedger()
    const { meta } = fakeMeta()
    const metaFactory = vi.fn(async () => meta)
    const res = await runAudienceSync(deps({ ledger, enabled: async () => false, meta: metaFactory }))
    expect(res.status).toBe('dry_run')
    expect(res.reason).toMatch(/ads_audience_sync_enabled is off/)
    expect(metaFactory).not.toHaveBeenCalled()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'dry_run', verb: 'audience_sync', tier: 'auto', targetLevel: 'audience', targetExternalId: 'm8_exclusions', proposedBy: 'rule:M8' })
    expect(res.counts).toMatchObject({ buyers: { included: 2 }, leads: { included: 1 } })
    expect(res.audiences).toMatchObject({ buyers: { mode: 'would_send', rows: 2 }, leads: { mode: 'would_send', rows: 1 } })
  })

  it('token missing: a dry run even with the valve on', async () => {
    const { ledger, rows } = memoryLedger()
    const metaFactory = vi.fn()
    const res = await runAudienceSync(deps({ ledger, credentials: () => ({ token: null, accountId: 'act_1' }), meta: metaFactory }))
    expect(res.status).toBe('dry_run')
    expect(res.reason).toMatch(/Meta access token not set/)
    expect(metaFactory).not.toHaveBeenCalled()
    expect(rows.map(r => r.status)).toEqual(['dry_run'])
  })

  it('a second dry run the same day writes no second row', async () => {
    const { ledger, rows } = memoryLedger()
    await runAudienceSync(deps({ ledger, enabled: async () => false }))
    const again = await runAudienceSync(deps({ ledger, enabled: async () => false }))
    expect(again.status).toBe('dry_run')
    expect(rows).toHaveLength(1)
  })

  it('stores counts only: no email and no digest in the ledger row', async () => {
    const { ledger, rows } = memoryLedger()
    await runAudienceSync(deps({ ledger, enabled: async () => false }))
    const stored = JSON.stringify(rows)
    expect(stored).not.toContain('@x.co')
    expect(stored).not.toMatch(/[0-9a-f]{64}/)
  })
})

describe('runAudienceSync: live', () => {
  it('creates both audiences, fills them, closes the row applied and refreshes the mirror', async () => {
    const { ledger, rows } = memoryLedger()
    const { meta, uploads } = fakeMeta()
    const refreshMirror = vi.fn(async () => ({}))
    const res = await runAudienceSync(deps({ ledger, meta: async () => meta, refreshMirror }))
    expect(res.status).toBe('applied')
    expect(uploads).toEqual([{ id: '9001', rows: 2, fresh: true }, { id: '9002', rows: 1, fresh: true }])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'applied', approvedBy: 'auto', verb: 'audience_sync' })
    expect(rows[0]!.after).toMatchObject({ audiences: { buyers: { id: '9001', created: true, mode: 'users' }, leads: { id: '9002', mode: 'users' } } })
    expect(refreshMirror).toHaveBeenCalledOnce()
    expect(JSON.stringify(rows)).not.toMatch(/[0-9a-f]{64}/)
  })

  it('replaces members of audiences that already exist', async () => {
    const { ledger } = memoryLedger()
    const { meta, uploads } = fakeMeta({ existing: true })
    await runAudienceSync(deps({ ledger, meta: async () => meta }))
    expect(uploads.map(u => u.fresh)).toEqual([false, false])
  })

  it('a Graph failure closes the row failed with what got done, and a retry opens a new attempt', async () => {
    const { ledger, rows } = memoryLedger()
    const failing = fakeMeta({ failOn: 'leads' })
    const res = await runAudienceSync(deps({ ledger, meta: async () => failing.meta }))
    expect(res.status).toBe('failed')
    expect(res.error).toMatch(/replace in progress/)
    expect(rows[0]).toMatchObject({ status: 'failed' })
    expect(rows[0]!.after).toMatchObject({ audiences: { buyers: { id: '9001', mode: 'users' } } })

    const retry = await runAudienceSync(deps({ ledger, meta: async () => fakeMeta({ existing: true }).meta }))
    expect(retry.status).toBe('applied')
    expect(rows.map(r => r.status)).toEqual(['failed', 'applied'])
  })

  it('an applied run today stops a second upload', async () => {
    const { ledger } = memoryLedger()
    await runAudienceSync(deps({ ledger, meta: async () => fakeMeta().meta }))
    const second = fakeMeta()
    const res = await runAudienceSync(deps({ ledger, meta: async () => second.meta }))
    expect(res.status).toBe('skipped')
    expect(second.uploads).toEqual([])
  })

  it('a source failure with the valve on fails the row and sends nothing', async () => {
    const { ledger, rows } = memoryLedger()
    const metaFactory = vi.fn()
    const res = await runAudienceSync(deps({ ledger, readSources: async () => { throw new Error('Klaviyo GET failed: HTTP 503') }, meta: metaFactory }))
    expect(res.status).toBe('failed')
    expect(metaFactory).not.toHaveBeenCalled()
    expect(rows[0]).toMatchObject({ status: 'failed' })
  })
})

describe('Klaviyo readers', () => {
  it('reads consent, suppression and the sale opt-out off a profile', () => {
    expect(consentRowFrom({
      email: 'a@x.co',
      properties: { do_not_sell_or_share: true },
      subscriptions: { email: { marketing: { consent: 'SUBSCRIBED', can_receive_email_marketing: true, suppression: [], list_suppressions: [{ list_id: 'L' }] } } },
    })).toEqual({ email: 'a@x.co', consent: 'SUBSCRIBED', canReceiveEmailMarketing: true, suppressed: true, saleOptOut: true })
    expect(consentRowFrom({ email: 'b@x.co' })).toEqual({ email: 'b@x.co', consent: null, canReceiveEmailMarketing: null, suppressed: false, saleOptOut: false })
  })

  it('takes the subscriber lists from env, with an explicit override winning', () => {
    expect(klaviyoExcludeListIds({ KLAVIYO_LIST_ID_PAID_LEADS: 'P', KLAVIYO_LIST_ID_DAILY_DEAL: 'D' } as NodeJS.ProcessEnv)).toEqual(['P', 'D'])
    expect(klaviyoExcludeListIds({ KLAVIYO_LIST_ID_PAID_LEADS: 'P', KLAVIYO_LIST_ID_EMAIL_LIST: 'E' } as NodeJS.ProcessEnv)).toEqual(['P', 'E'])
    expect(klaviyoExcludeListIds({ KLAVIYO_LIST_ID_PAID_LEADS: 'P', ADS_EXCLUDE_KLAVIYO_LIST_IDS: ' X, Y ,X' } as NodeJS.ProcessEnv)).toEqual(['X', 'Y'])
    expect(klaviyoExcludeListIds({} as NodeJS.ProcessEnv)).toEqual([])
  })
})
