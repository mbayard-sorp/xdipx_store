import { describe, expect, it, vi } from 'vitest'

// Never touch the real database from a test: .env DATABASE_URL is production.
vi.mock('~/lib/db.server', () => ({ db: {} }))

import { listChannels } from './channels/registry.server'
import {
  CHECKLIST_ITEMS, ChecklistInputError, PROHIBITED_REASON, loadChannels, toggleChecklistItem,
  type ChannelsSource, type ChecklistWrite,
} from './channels-page.server'

const NOW = new Date('2026-10-19T15:00:00Z')

function source(over: Partial<ChannelsSource> = {}): ChannelsSource {
  return {
    channels: listChannels,
    health: async () => [],
    lastEntitySync: async () => [],
    lastInsightsPull: async () => [],
    checklist: async () => [],
    ...over,
  }
}

describe('loadChannels', () => {
  it('returns every registry channel, prohibited ones without a checklist', async () => {
    const page = await loadChannels(source())
    expect(page.failed).toEqual([])
    expect(page.channels.map(c => c.id)).toEqual(listChannels().map(c => c.id))
    for (const c of page.channels) {
      if (c.policyState === 'prohibited') {
        expect(c.checklist).toBeNull()
        expect(c.hasAdapter).toBe(false)
        expect(c.mutate).toMatchObject({ mutateBlocked: true, reasons: [PROHIBITED_REASON] })
      } else {
        expect(c.checklist).toHaveLength(9)
        expect(c.mutate.mutateBlocked).toBe(true)
      }
    }
    const prohibited = page.channels.filter(c => c.policyState === 'prohibited').map(c => c.id).sort()
    expect(prohibited).toEqual(['pinterest', 'reddit', 'tiktok', 'x'])
  })

  it('joins token health, sync and pull freshness by platform', async () => {
    const page = await loadChannels(source({
      health: async () => [{
        channel: 'meta', checkedAt: '2026-10-19T06:00:00.000Z', state: 'ok', valid: true, expiresAt: '2026-12-01T00:00:00.000Z',
        dataAccessExpiresAt: null, scopes: ['ads_read'], error: null, envVar: 'META_ACCESS_TOKEN',
      }],
      lastEntitySync: async () => [{ platform: 'meta', at: new Date(NOW.getTime() - 3_600_000) }],
      lastInsightsPull: async () => [{ platform: 'meta', at: new Date(NOW.getTime() - 600_000) }, { platform: 'snap', at: null }],
    }))
    const meta = page.channels.find(c => c.id === 'meta')!
    expect(meta.token).toEqual({ state: 'ok', checkedAt: '2026-10-19T06:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', error: null })
    expect(meta.lastEntitySyncAt).toBe('2026-10-19T14:00:00.000Z')
    expect(meta.lastInsightsPullAt).toBe('2026-10-19T14:50:00.000Z')
    const snap = page.channels.find(c => c.id === 'snap')!
    expect(snap.token).toBeNull()
    expect(snap.lastInsightsPullAt).toBeNull()
  })

  it('opens mutate for meta only when all nine items are checked', async () => {
    const rows = CHECKLIST_ITEMS.map(i => ({ channel: 'meta', item: i.key, checkedAt: NOW.toISOString(), checkedBy: 'admin:a', evidence: 'ok' }))
    const page = await loadChannels(source({ checklist: async () => rows }))
    const meta = page.channels.find(c => c.id === 'meta')!
    expect(meta.mutate.checkedCount).toBe(9)
    // Meta's adapter exposes mutate verbs only once phase 5a lands; either way
    // the checklist reason is gone.
    expect(meta.mutate.reasons.some(r => r.includes('checklist'))).toBe(false)
  })

  it('names a failed read and leaves every checklist open', async () => {
    const page = await loadChannels(source({
      checklist: async () => { throw new Error('relation "ad_channel_checklist" does not exist') },
      health: async () => { throw new Error('boom') },
    }))
    expect(page.failed.sort()).toEqual(['checklist', 'token health'])
    for (const c of page.channels) expect(c.mutate.mutateBlocked).toBe(true)
  })
})

describe('toggleChecklistItem', () => {
  function capture() {
    const writes: ChecklistWrite[] = []
    return { writes, deps: { write: async (r: ChecklistWrite) => { writes.push(r) }, now: () => NOW } }
  }

  it('checks an item with evidence and stamps who and when', async () => {
    const { writes, deps } = capture()
    await toggleChecklistItem('meta', 'spend_cap', true, 'admin:mike@xdipx.com', '  $20 a day, set 2026-10-19  ', deps)
    expect(writes).toEqual([{
      channel: 'meta', item: 'spend_cap', checkedAt: NOW, checkedBy: 'admin:mike@xdipx.com', evidence: '$20 a day, set 2026-10-19',
    }])
  })

  it('unchecks and keeps the evidence', async () => {
    const { writes, deps } = capture()
    await toggleChecklistItem('adult:exoclick', 'utm_template', false, 'admin:a', 'old proof', deps)
    expect(writes[0]).toMatchObject({ channel: 'adult:exoclick', checkedAt: null, evidence: 'old proof' })
  })

  it('refuses a check with no evidence', async () => {
    const { writes, deps } = capture()
    await expect(toggleChecklistItem('meta', 'spend_cap', true, 'admin:a', '   ', deps)).rejects.toBeInstanceOf(ChecklistInputError)
    expect(writes).toEqual([])
  })

  it('refuses prohibited channels, unknown channels and unknown items', async () => {
    const { writes, deps } = capture()
    for (const id of ['tiktok', 'x', 'reddit', 'pinterest']) {
      await expect(toggleChecklistItem(id, 'policy_row', true, 'admin:a', 'proof', deps)).rejects.toBeInstanceOf(ChecklistInputError)
    }
    await expect(toggleChecklistItem('myspace', 'policy_row', true, 'admin:a', 'proof', deps)).rejects.toBeInstanceOf(ChecklistInputError)
    await expect(toggleChecklistItem('meta', 'enable_mutate', true, 'admin:a', 'proof', deps)).rejects.toBeInstanceOf(ChecklistInputError)
    await expect(toggleChecklistItem('meta', 'spend_cap', true, '  ', 'proof', deps)).rejects.toBeInstanceOf(ChecklistInputError)
    expect(writes).toEqual([])
  })
})
