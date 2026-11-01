import { describe, it, expect } from 'vitest'
import { analyticsOnByDefault, consentDefaultScript } from './analytics-default'

function run(script: string, env: { stored?: string; gpc?: boolean; storageThrows?: boolean }) {
  const calls: unknown[][] = []
  const win: Record<string, unknown> = {}
  const localStorage = {
    getItem: () => {
      if (env.storageThrows) throw new Error('blocked')
      return env.stored ?? null
    },
  }
  new Function('gtag', 'window', 'localStorage', 'navigator', script)(
    (...args: unknown[]) => calls.push(args),
    win,
    localStorage,
    { globalPrivacyControl: env.gpc ?? false },
  )
  return { consent: calls[0]?.[2] as Record<string, string>, flag: win['__xdipxAnalyticsOn'] }
}

describe('analyticsOnByDefault', () => {
  it('is on only for US visitors on the bridge host', () => {
    expect(analyticsOnByDefault(true, 'US')).toBe(true)
    expect(analyticsOnByDefault(true, 'DE')).toBe(false)
    expect(analyticsOnByDefault(true, null)).toBe(false)
    expect(analyticsOnByDefault(false, 'US')).toBe(false)
  })
})

describe('consentDefaultScript', () => {
  it('keeps everything denied when off', () => {
    const { consent, flag } = run(consentDefaultScript(false), {})
    expect(consent['analytics_storage']).toBe('denied')
    expect(flag).toBeUndefined()
  })

  it('starts analytics only, never ads, for a visitor with no choice stored', () => {
    const { consent, flag } = run(consentDefaultScript(true), {})
    expect(consent).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
    expect(flag).toBe(true)
  })

  it('respects a stored choice and Global Privacy Control', () => {
    expect(run(consentDefaultScript(true), { stored: '{"type":"essential_only"}' }).consent['analytics_storage']).toBe('denied')
    expect(run(consentDefaultScript(true), { gpc: true }).consent['analytics_storage']).toBe('denied')
  })

  it('stays denied when storage cannot be read', () => {
    expect(run(consentDefaultScript(true), { storageThrows: true }).consent['analytics_storage']).toBe('denied')
  })
})
