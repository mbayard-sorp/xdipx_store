import { describe, it, expect } from 'vitest'
import { analyticsOnByDefault, consentDefaultScript, ga4DirectConfigScript, ga4ScriptTagLoad } from './analytics-default'

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

// ticket #19435: gtag.js replays the dataLayer array in push order on load,
// and an 'event' pushed ahead of its own 'config' call has no measurement ID
// to attach to, so it is dropped rather than sent. The two script builders
// below MUST stay split the way they are: the config call goes in the eager
// bootstrap (app/root.tsx's analyticsBootstrap, synchronous, before React
// hydrates), the script tag load in the deferred one (analyticsLoader,
// behind interaction/idle/timeout). These tests pin that split so the two
// calls can't silently drift back into the same (deferred) bucket.
describe('ga4DirectConfigScript / ga4ScriptTagLoad', () => {
  it('the config script carries js and config, never the script tag itself', () => {
    const script = ga4DirectConfigScript('G-TEST123')
    expect(script).toContain("gtag('js'")
    expect(script).toContain("gtag('config','G-TEST123'")
    expect(script).toContain('send_page_view:false')
    expect(script).not.toContain('googletagmanager.com')
  })

  it('the script-tag loader only injects the script, never config', () => {
    const script = ga4ScriptTagLoad('G-TEST123')
    expect(script).toContain("inject('https://www.googletagmanager.com/gtag/js?id=G-TEST123')")
    expect(script).not.toContain("gtag('config'")
    expect(script).not.toContain("gtag('js'")
  })

  it('replaying js/config then an event (the eager-bootstrap order) keeps the event, unlike the reverse', () => {
    // A minimal stand-in for gtag.js's real behavior: an 'event' command is
    // only recorded once some 'config' command has already been processed.
    function replay(commands: unknown[][]): { configured: boolean; events: string[] } {
      let configured = false
      const events: string[] = []
      for (const c of commands) {
        if (c[0] === 'config') configured = true
        if (c[0] === 'event' && configured) events.push(c[1] as string)
      }
      return { configured, events }
    }
    const configFirst: unknown[][] = [['js', new Date()], ['config', 'G-TEST123'], ['event', 'page_view']]
    expect(replay(configFirst).events).toEqual(['page_view'])

    const eventFirst: unknown[][] = [['event', 'page_view'], ['js', new Date()], ['config', 'G-TEST123']]
    expect(replay(eventFirst).events).toEqual([])
  })
})
