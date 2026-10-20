import { describe, expect, it } from 'vitest'
import { getChannel, listChannels } from './registry.server'

describe('channel registry', () => {
  it('returns the Meta entry with its read-only adapter', () => {
    const meta = getChannel('meta')
    expect(meta?.policyState).toBe('restricted')
    expect(meta?.adapter?.id).toBe('meta')
    expect(meta?.adapter?.capabilities).toEqual({ read: true, insights: true, mutate: ['pause', 'resume', 'set_budget'], audiences: 'read', preview: false })
  })

  it('returns null for a channel the table does not list', () => {
    expect(getChannel('myspace')).toBeNull()
    expect(getChannel('adult:unvetted')).toBeNull()
  })

  it('lists every prohibited channel as prohibited with no adapter', () => {
    const listed = listChannels()
    for (const id of ['tiktok', 'x', 'reddit', 'pinterest'] as const) {
      const row = listed.find(c => c.id === id)
      expect(row, id).toBeDefined()
      expect(row?.policyState).toBe('prohibited')
      expect(row?.hasAdapter).toBe(false)
      expect(row?.capabilities).toBeNull()
      const entry = getChannel(id)
      expect(entry?.policyState).toBe('prohibited')
      expect(entry?.adapter).toBeNull()
    }
  })

  it('gives every prohibited listing no adapter, whatever its id', () => {
    for (const c of listChannels().filter(c => c.policyState === 'prohibited')) expect(c.hasAdapter).toBe(false)
  })

  it('has adapters for Meta, Microsoft and ExoClick in this phase', () => {
    expect(listChannels().filter(c => c.hasAdapter).map(c => c.id)).toEqual(['meta', 'microsoft', 'adult:exoclick'])
  })

  it('lists ExoClick as allowed with read and insights, no mutations, and the adult-lane source aliases', () => {
    const exo = listChannels().find(c => c.id === 'adult:exoclick')
    expect(exo).toMatchObject({ policyState: 'allowed', hasAdapter: true, label: 'ExoClick' })
    expect(exo?.capabilities).toEqual({ read: true, insights: true, mutate: [], audiences: 'none', preview: false })
    expect(exo?.policyNote).toMatch(/docs\/ads-policy\.md/)
    expect(exo?.policyNote).toMatch(/register 10/)
    expect(exo?.policyNote).toMatch(/nudity definition/)
    expect(exo?.policyNote).toMatch(/utm_content/)
    expect(exo?.policyNote).not.toMatch(/\u2014/)
    const entry = getChannel('adult:exoclick')
    expect(entry?.adapter?.id).toBe('adult:exoclick')
    // 'adnetwork' is what ad-export/common.ts stamps as utm_source on adult-lane banners.
    expect(entry?.sourceAliases).toEqual(['exoclick', 'adnetwork'])
  })

  it('keeps JuicyAds and TrafficJunky allowed but without an adapter', () => {
    for (const id of ['adult:juicyads', 'adult:trafficjunky']) {
      expect(listChannels().find(c => c.id === id)).toMatchObject({ policyState: 'allowed', hasAdapter: false })
    }
  })

  it('lists Microsoft as restricted with read and insights, and no mutations while the program is pending', () => {
    const ms = listChannels().find(c => c.id === 'microsoft')
    expect(ms).toMatchObject({ policyState: 'restricted', hasAdapter: true })
    expect(ms?.capabilities).toEqual({ read: true, insights: true, mutate: [], audiences: 'none', preview: false })
    expect(ms?.policyNote).toMatch(/Adult Advertising Program/)
    expect(ms?.policyNote).toMatch(/188472831 is Pending/)
    expect(getChannel('microsoft')?.adapter?.id).toBe('microsoft')
  })

  it('lists ids once each, with a policy note on every row', () => {
    const listed = listChannels()
    expect(new Set(listed.map(c => c.id)).size).toBe(listed.length)
    for (const c of listed) expect(c.policyNote.length).toBeGreaterThan(0)
    expect(listed.map(c => c.id)).toEqual(expect.arrayContaining(['meta', 'microsoft', 'google', 'snap']))
  })
})
