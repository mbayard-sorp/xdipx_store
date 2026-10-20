import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockerInput } from '~/lib/owner-blockers-core'
import type { ChannelAdapter, TokenHealth } from './channels/types'
import {
  assessTokenHealth,
  recordChannelReadiness,
  runAdsTokenHealth,
  tokenBlockerDedupeKey,
  tokenEnvVar,
  type ChannelHealthRow,
  type HealthChannel,
} from './token-health.server'

const NOW = new Date('2026-10-19T08:35:00Z')
const DAY = 86_400_000
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString()

function fakeChannel(health: TokenHealth | (() => Promise<TokenHealth>)): HealthChannel {
  const adapter = {
    id: 'meta',
    auth: { health: typeof health === 'function' ? health : async () => health },
  } as unknown as ChannelAdapter
  return { id: 'meta', label: 'Meta (Facebook, Instagram)', adapter }
}

const VALID: TokenHealth = {
  valid: true, expiresAt: null, dataAccessExpiresAt: inDays(80),
  scopes: ['ads_read', 'ads_management'], checkedAt: NOW.toISOString(),
}
const EXPIRING: TokenHealth = { ...VALID, expiresAt: inDays(10) }
const INVALID: TokenHealth = {
  valid: false, expiresAt: null, scopes: [], checkedAt: NOW.toISOString(), error: 'Session has expired',
}

/**
 * An in-memory stand-in for fileBlocker that keeps its dedupe-by-key
 * behaviour, so a repeat day can be shown to refresh one row rather than add
 * a second. Nothing here touches Neon or Meta.
 */
function fakeBlockerStore() {
  const rows = new Map<string, { id: number; input: BlockerInput }>()
  let next = 1
  const file = vi.fn(async (input: BlockerInput) => {
    const existing = rows.get(input.dedupeKey)
    if (existing) {
      existing.input = input
      return { id: existing.id, created: false, reopened: false }
    }
    const id = next++
    rows.set(input.dedupeKey, { id, input })
    return { id, created: true, reopened: false }
  })
  return { rows, file }
}

function run(health: TokenHealth, store = fakeBlockerStore(), saved: ChannelHealthRow[] = []) {
  return {
    store,
    saved,
    result: runAdsTokenHealth({
      channels: () => [fakeChannel(health)],
      fileBlocker: store.file,
      saveHealth: async row => { saved.push(row) },
      now: () => NOW,
      env: { META_ADS_ACCESS_TOKEN: 'tok' },
    }),
  }
}

describe('runAdsTokenHealth', () => {
  it('files nothing for a valid token and stores the reading', async () => {
    const { store, saved, result } = run(VALID)
    const r = await result
    expect(store.file).not.toHaveBeenCalled()
    expect(r.failed).toBe(false)
    expect(r.channels[0]).toMatchObject({ channel: 'meta', state: 'ok', blocker: null, saved: true })
    expect(saved).toEqual([expect.objectContaining({
      channel: 'meta', state: 'ok', valid: true, scopes: ['ads_read', 'ads_management'], envVar: 'META_ADS_ACCESS_TOKEN',
    })])
  })

  it('files exactly one blocker for a token expiring in 10 days, naming the env var and expiry', async () => {
    const { store, result } = run(EXPIRING)
    const r = await result
    expect(store.file).toHaveBeenCalledTimes(1)
    const input = store.file.mock.calls[0]![0]
    expect(input).toMatchObject({
      dedupeKey: tokenBlockerDedupeKey('meta'),
      category: 'credential',
      priority: 2,
      verifyProbe: 'ad_token_healthy',
      verifyArg: 'meta',
    })
    expect(input.title).toContain('META_ADS_ACCESS_TOKEN')
    expect(input.title).toContain('2026-10-29')
    expect(input.detail).toContain('10 days left')
    expect(r.channels[0]).toMatchObject({ state: 'expiring', daysLeft: 10, blocker: { id: 1, created: true } })
  })

  it('files exactly one blocker for an invalid token', async () => {
    const { store, result } = run(INVALID)
    const r = await result
    expect(store.file).toHaveBeenCalledTimes(1)
    const input = store.file.mock.calls[0]![0]
    expect(input).toMatchObject({ priority: 1, verifyProbe: 'ad_token_healthy', verifyArg: 'meta' })
    expect(input.title).toBe('Meta (Facebook, Instagram) ads token is invalid: rotate META_ADS_ACCESS_TOKEN')
    expect(input.detail).toContain('Session has expired')
    expect(r.channels[0]).toMatchObject({ state: 'invalid', blocker: { created: true } })
  })

  it('refreshes the same row on a repeat day instead of stacking a second', async () => {
    const store = fakeBlockerStore()
    await run(EXPIRING, store).result
    const second = await run({ ...EXPIRING, expiresAt: inDays(9) }, store).result
    expect(store.rows.size).toBe(1)
    expect(second.channels[0]!.blocker).toEqual({ id: 1, created: false, reopened: false })
  })

  it('files nothing when the platform could not be asked', async () => {
    for (const error of ['network', 'rate_limited', 'bad_response', 'api_error']) {
      const { store, result } = run({ ...INVALID, error })
      const r = await result
      expect(store.file, error).not.toHaveBeenCalled()
      expect(r.channels[0]!.state).toBe('unknown')
    }
  })

  it('treats a throwing adapter as could-not-ask', async () => {
    const store = fakeBlockerStore()
    const r = await runAdsTokenHealth({
      channels: () => [fakeChannel(async () => { throw new Error('boom') })],
      fileBlocker: store.file,
      saveHealth: async () => {},
      now: () => NOW,
    })
    expect(store.file).not.toHaveBeenCalled()
    expect(r.channels[0]!.state).toBe('unknown')
  })

  it('reports failure when a needed blocker cannot be filed, and keeps going', async () => {
    const r = await runAdsTokenHealth({
      channels: () => [fakeChannel(INVALID)],
      fileBlocker: async () => { throw new Error('db down') },
      saveHealth: async () => { throw new Error('db down') },
      now: () => NOW,
    })
    expect(r.failed).toBe(true)
    expect(r.channels[0]).toMatchObject({ state: 'invalid', blocker: null, saved: false })
    expect(r.channels[0]!.blockerError).toContain('db down')
  })

  it('keeps a not-ready reason in error, reads ok, and files no blocker', async () => {
    const store = fakeBlockerStore()
    const saved: ChannelHealthRow[] = []
    const r = await runAdsTokenHealth({
      channels: () => [fakeChannel({ ...VALID, ready: false, notReadyReason: 'account_inactive' })],
      fileBlocker: store.file,
      saveHealth: async row => { saved.push(row) },
      now: () => NOW,
    })
    expect(store.file).not.toHaveBeenCalled()
    expect(saved[0]).toMatchObject({ state: 'ok', valid: true, error: 'not_ready:account_inactive' })
    expect(r.channels[0]!.blocker).toBeNull()
  })
})

describe('recordChannelReadiness', () => {
  it('stores the reason from the cron reading, and clears it with null', async () => {
    const saved: ChannelHealthRow[] = []
    const saveHealth = async (row: ChannelHealthRow) => { saved.push(row) }
    const reading: TokenHealth = { valid: true, expiresAt: null, expiryUnknown: true, scopes: ['msads.manage'], checkedAt: NOW.toISOString() }
    await recordChannelReadiness('microsoft', reading, 'account_inactive', { saveHealth, now: () => NOW, env: {} })
    await recordChannelReadiness('microsoft', { ...reading, ready: false, notReadyReason: 'account_inactive' }, null, { saveHealth, now: () => NOW, env: {} })
    expect(saved.map(s => [s.channel, s.state, s.error])).toEqual([
      ['microsoft', 'ok', 'not_ready:account_inactive'],
      ['microsoft', 'ok', null],
    ])
  })
})

describe('assessTokenHealth', () => {
  it('flags the data access window when it is the nearer expiry', () => {
    const a = assessTokenHealth({ ...VALID, expiresAt: null, dataAccessExpiresAt: inDays(5) }, NOW)
    expect(a).toMatchObject({ state: 'expiring', expiryKind: 'data_access', daysLeft: 5 })
  })

  it('reads a token 14 or more days out as ok', () => {
    expect(assessTokenHealth({ ...VALID, expiresAt: inDays(14) }, NOW).state).toBe('ok')
    expect(assessTokenHealth({ ...VALID, expiresAt: inDays(13.9) }, NOW).state).toBe('expiring')
  })

  it('reads a missing or refused token as invalid', () => {
    expect(assessTokenHealth({ ...INVALID, error: 'not_configured' }, NOW).state).toBe('invalid')
    expect(assessTokenHealth({ ...INVALID, error: 'token_rejected' }, NOW).state).toBe('invalid')
  })
})

describe('tokenEnvVar', () => {
  it('names the Meta env var actually in use', () => {
    expect(tokenEnvVar('meta', { META_ADS_ACCESS_TOKEN: 'a', META_ACCESS_TOKEN: 'b' })).toBe('META_ADS_ACCESS_TOKEN')
    expect(tokenEnvVar('meta', { META_ACCESS_TOKEN: 'b' })).toBe('META_ACCESS_TOKEN')
    expect(tokenEnvVar('meta', {})).toBe('META_ADS_ACCESS_TOKEN (or META_ACCESS_TOKEN)')
  })
})

describe('ad_token_healthy probe', () => {
  afterEach(() => {
    vi.doUnmock('~/lib/ads/token-health.server')
    vi.resetModules()
  })

  for (const [verdict, expected] of [[true, true], [false, false], [null, null]] as const) {
    it(`passes the token check's ${String(verdict)} through`, async () => {
      vi.doMock('~/lib/ads/token-health.server', () => ({ probeChannelToken: async () => verdict }))
      const { PROBES, PROBE_DESCRIPTIONS } = await import('~/lib/owner-blockers.server')
      expect(await PROBES['ad_token_healthy']!.run('meta')).toBe(expected)
      expect(PROBE_DESCRIPTIONS['ad_token_healthy']!('meta'))
        .toBe('the meta ads token is valid and at least 14 days from expiring')
    })
  }

  it('reads a channel with no adapter as could-not-ask', async () => {
    const { probeChannelToken } = await import('./token-health.server')
    expect(await probeChannelToken('reddit')).toBeNull()
    expect(await probeChannelToken('nope')).toBeNull()
  })
})
