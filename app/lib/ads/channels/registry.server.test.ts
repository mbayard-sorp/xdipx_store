import { describe, expect, it } from 'vitest'
import { getChannel, listChannels } from './registry.server'

describe('channel registry', () => {
  it('returns the Meta entry with its read-only adapter', () => {
    const meta = getChannel('meta')
    expect(meta?.policyState).toBe('restricted')
    expect(meta?.adapter?.id).toBe('meta')
    expect(meta?.adapter?.capabilities).toEqual({ read: true, insights: true, mutate: [], audiences: 'read', preview: false })
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

  it('has adapters only for Meta in this phase', () => {
    expect(listChannels().filter(c => c.hasAdapter).map(c => c.id)).toEqual(['meta'])
  })

  it('lists ids once each, with a policy note on every row', () => {
    const listed = listChannels()
    expect(new Set(listed.map(c => c.id)).size).toBe(listed.length)
    for (const c of listed) expect(c.policyNote.length).toBeGreaterThan(0)
    expect(listed.map(c => c.id)).toEqual(expect.arrayContaining(['meta', 'microsoft', 'google', 'snap']))
  })
})
