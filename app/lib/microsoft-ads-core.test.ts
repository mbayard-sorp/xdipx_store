import { describe, expect, it } from 'vitest'
import {
  SANDBOX_DEVELOPER_TOKEN, decryptToken, describeErrors, encryptToken, extractErrors, isThrottle,
  missingConfig, msAdsConfig, msAdsEnv, msAdsScope, requestHeaders, serviceUrl,
} from '~/lib/microsoft-ads-core'
import { platformForLane } from '~/lib/ad-render-rules'

const KEY = 'k'.repeat(40)

describe('environment', () => {
  it('defaults to sandbox unless production is explicit', () => {
    expect(msAdsEnv({})).toBe('sandbox')
    expect(msAdsEnv({ MSADS_ENV: 'prod' })).toBe('sandbox')
    expect(msAdsEnv({ MSADS_ENV: 'production' })).toBe('production')
  })

  it('reads per-environment ids and never uses the production token in sandbox', () => {
    const env = {
      MSADS_CLIENT_ID: 'cid', MSADS_CLIENT_SECRET: 'sec', MSADS_TOKEN_KEY: KEY,
      MSADS_DEVELOPER_TOKEN: 'PRODTOKEN', MSADS_CUSTOMER_ID: '1', MSADS_ACCOUNT_ID: '2',
      MSADS_SANDBOX_CUSTOMER_ID: '10', MSADS_SANDBOX_ACCOUNT_ID: '20',
    }
    const sandbox = msAdsConfig(env)
    expect(sandbox).toMatchObject({ env: 'sandbox', developerToken: SANDBOX_DEVELOPER_TOKEN, customerId: '10', accountId: '20' })
    const prod = msAdsConfig({ ...env, MSADS_ENV: 'production' })
    expect(prod).toMatchObject({ env: 'production', developerToken: 'PRODTOKEN', customerId: '1', accountId: '2' })
  })

  it('asks for the si.ads resource in sandbox and ads in production', () => {
    expect(msAdsScope('sandbox')).toBe('https://si.ads.microsoft.com/msads.manage offline_access')
    expect(msAdsScope('production')).toBe('https://ads.microsoft.com/msads.manage offline_access')
  })

  it('names the missing vars for the active environment', () => {
    expect(missingConfig({})).toEqual([
      'MSADS_CLIENT_ID', 'MSADS_CLIENT_SECRET', 'MSADS_TOKEN_KEY', 'MSADS_SANDBOX_CUSTOMER_ID', 'MSADS_SANDBOX_ACCOUNT_ID',
    ])
    expect(missingConfig({ MSADS_ENV: 'production' })).toContain('MSADS_DEVELOPER_TOKEN')
  })
})

describe('requests', () => {
  it('builds sandbox and production REST urls', () => {
    expect(serviceUrl('sandbox', 'CampaignManagement', '/Campaigns/QueryByAccountId'))
      .toBe('https://campaign.api.sandbox.bingads.microsoft.com/CampaignManagement/v13/Campaigns/QueryByAccountId')
    expect(serviceUrl('production', 'CustomerManagement', 'User/Query'))
      .toBe('https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/User/Query')
  })

  it('sends Bearer auth and only the account headers asked for', () => {
    expect(requestHeaders({ accessToken: 'a', developerToken: 'd' })).toEqual({
      Authorization: 'Bearer a', DeveloperToken: 'd', 'Content-Type': 'application/json', Accept: 'application/json',
    })
    expect(requestHeaders({ accessToken: 'a', developerToken: 'd', customerId: '1', accountId: '2' }))
      .toMatchObject({ CustomerId: '1', CustomerAccountId: '2' })
  })
})

describe('errors', () => {
  it('separates faults from partial errors and skips null slots', () => {
    const body = {
      OperationErrors: [{ Code: 1001, ErrorCode: 'UserIsNotAuthorized', Message: 'nope' }],
      PartialErrors:   [null, { Code: 4102, ErrorCode: 'CampaignNameExists', Message: 'dupe', Index: 1 }],
    }
    const { fault, partial } = extractErrors(body)
    expect(fault).toEqual([{ code: 1001, errorCode: 'UserIsNotAuthorized', message: 'nope', index: null }])
    expect(partial).toEqual([{ code: 4102, errorCode: 'CampaignNameExists', message: 'dupe', index: 1 }])
    expect(describeErrors(fault)).toBe('1001: nope')
  })

  it('returns nothing for clean or non-object bodies', () => {
    expect(extractErrors({ Campaigns: [] })).toEqual({ fault: [], partial: [] })
    expect(extractErrors(null)).toEqual({ fault: [], partial: [] })
  })

  it('recognises CallRateExceeded by code or name', () => {
    expect(isThrottle([{ code: 117, errorCode: null, message: '', index: null }])).toBe(true)
    expect(isThrottle([{ code: null, errorCode: 'CallRateExceeded', message: '', index: null }])).toBe(true)
    expect(isThrottle([{ code: 1001, errorCode: null, message: '', index: null }])).toBe(false)
  })
})

describe('token encryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const stored = encryptToken('M.R3_BAY.refresh-token', KEY)
    expect(stored.startsWith('v1.')).toBe(true)
    expect(stored).not.toContain('refresh-token')
    expect(decryptToken(stored, KEY)).toBe('M.R3_BAY.refresh-token')
  })

  it('uses a fresh IV each time', () => {
    expect(encryptToken('same', KEY)).not.toBe(encryptToken('same', KEY))
  })

  it('rejects a wrong key, tampering, and short keys', () => {
    const stored = encryptToken('secret', KEY)
    expect(() => decryptToken(stored, 'x'.repeat(40))).toThrow()
    const parts = stored.split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => decryptToken(parts.join('.'), KEY)).toThrow()
    expect(() => encryptToken('secret', 'short')).toThrow(/32 characters/)
  })
})

describe('platformForLane', () => {
  it('keeps integrated platforms and folds the rest into other', () => {
    expect(platformForLane('microsoft')).toBe('microsoft')
    expect(platformForLane('google')).toBe('google')
    expect(platformForLane('meta')).toBe('meta')
    expect(platformForLane('snap')).toBe('other')
    expect(platformForLane('adult')).toBe('other')
  })
})
