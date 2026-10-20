import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyFile } from '../migration-classify.server'
import type { ChannelCapabilities } from './channels/types'
import {
  CHECKLIST_ITEMS, PROHIBITED_REASON, capabilitiesWords, checklistFor, isChecklistItem, mutateStateFor,
  type ChecklistRow,
} from './channels-core'

const CAPS: ChannelCapabilities = { read: true, insights: true, mutate: ['pause', 'resume'], audiences: 'read', preview: false }

function allChecked(channel: string): ChecklistRow[] {
  return CHECKLIST_ITEMS.map(i => ({
    channel, item: i.key, checkedAt: '2026-10-19T12:00:00.000Z', checkedBy: 'admin:mike@xdipx.com', evidence: 'proof',
  }))
}

describe('CHECKLIST_ITEMS', () => {
  it('holds the nine items from plan section 6, in order', () => {
    expect(CHECKLIST_ITEMS.map(i => i.key)).toEqual([
      'policy_row', 'account_ids', 'billing_descriptor', 'token_health', 'insights_smoke',
      'paused_create_smoke', 'utm_template', 'cron_expectations', 'spend_cap',
    ])
    expect(new Set(CHECKLIST_ITEMS.map(i => i.key)).size).toBe(9)
  })

  it('carries the plan wording that matters', () => {
    const labels = CHECKLIST_ITEMS.map(i => i.label).join('\n')
    expect(labels).toContain('verified with date and source URL')
    expect(labels).toContain('test or sandbox account')
    expect(labels).toContain('Billing descriptor XDIPX confirmed')
    expect(labels).toContain('health probe green')
    expect(labels).toContain('reconciles with the platform UI')
    expect(labels).toContain('create PAUSED, read back through entity sync, delete')
    expect(labels).toContain('utm_content=<creative id>')
    expect(labels).toContain('cron-expectations.ts entry')
    expect(labels).toContain('Platform-side spend cap set')
  })

  it('has no em-dashes anywhere', () => {
    for (const i of CHECKLIST_ITEMS) expect(`${i.label} ${i.evidenceHint}`).not.toMatch(/\u2014/)
  })

  it('knows its own keys and nothing else', () => {
    expect(isChecklistItem('spend_cap')).toBe(true)
    expect(isChecklistItem('enable_mutate')).toBe(false)
  })
})

describe('checklistFor', () => {
  it('never gives a prohibited channel a checklist', () => {
    for (const id of ['tiktok', 'x', 'reddit', 'pinterest']) {
      expect(checklistFor(id, 'prohibited', allChecked(id))).toBeNull()
    }
  })

  it('reads open items as unchecked and ignores other channels and unknown keys', () => {
    const rows: ChecklistRow[] = [
      { channel: 'meta', item: 'spend_cap', checkedAt: '2026-10-19T00:00:00.000Z', checkedBy: 'admin:a', evidence: '$20/day' },
      { channel: 'meta', item: 'utm_template', checkedAt: null, checkedBy: 'admin:a', evidence: 'old' },
      { channel: 'meta', item: 'retired_item', checkedAt: '2026-10-19T00:00:00.000Z', checkedBy: 'admin:a', evidence: null },
      { channel: 'snap', item: 'policy_row', checkedAt: '2026-10-19T00:00:00.000Z', checkedBy: 'admin:a', evidence: 'x' },
    ]
    const list = checklistFor('meta', 'restricted', rows)!
    expect(list).toHaveLength(9)
    expect(list.filter(i => i.checked).map(i => i.key)).toEqual(['spend_cap'])
    expect(list.find(i => i.key === 'utm_template')).toMatchObject({ checked: false, evidence: 'old', checkedBy: 'admin:a' })
    expect(list.find(i => i.key === 'policy_row')?.checked).toBe(false)
  })
})

describe('mutateStateFor', () => {
  it('blocks a prohibited channel with the plan reason, whatever else is true', () => {
    const m = mutateStateFor({ policyState: 'prohibited', hasAdapter: false, capabilities: null, checklist: null })
    expect(m).toEqual({ mutateBlocked: true, reasons: [PROHIBITED_REASON], checkedCount: 0, totalCount: 9 })
    expect(PROHIBITED_REASON).toBe('policy: prohibited, no adapter')
  })

  it('blocks while any item is open', () => {
    const rows = allChecked('meta').slice(0, 8)
    const m = mutateStateFor({ policyState: 'restricted', hasAdapter: true, capabilities: CAPS, checklist: checklistFor('meta', 'restricted', rows) })
    expect(m.mutateBlocked).toBe(true)
    expect(m.checkedCount).toBe(8)
    expect(m.reasons).toEqual(['1 of 9 checklist items open'])
  })

  it('opens only when all nine are checked and the adapter can mutate', () => {
    const m = mutateStateFor({ policyState: 'restricted', hasAdapter: true, capabilities: CAPS, checklist: checklistFor('meta', 'restricted', allChecked('meta')) })
    expect(m).toEqual({ mutateBlocked: false, reasons: [], checkedCount: 9, totalCount: 9 })
  })

  it('stays blocked with all nine checked but no adapter, or no mutate verbs', () => {
    const list = checklistFor('snap', 'restricted', allChecked('snap'))
    expect(mutateStateFor({ policyState: 'restricted', hasAdapter: false, capabilities: null, checklist: list }))
      .toMatchObject({ mutateBlocked: true, reasons: ['no adapter yet'] })
    expect(mutateStateFor({ policyState: 'allowed', hasAdapter: true, capabilities: { ...CAPS, mutate: [] }, checklist: list }))
      .toMatchObject({ mutateBlocked: true, reasons: ['the adapter has no mutate verbs'] })
  })
})

describe('the ExoClick row', () => {
  const EXO_CAPS: ChannelCapabilities = { read: true, insights: true, mutate: [], audiences: 'none', preview: false }

  it('gets the full nine-item checklist as an allowed channel', () => {
    const list = checklistFor('adult:exoclick', 'allowed', [])
    expect(list?.map(i => i.key)).toEqual(CHECKLIST_ITEMS.map(i => i.key))
    expect(list?.every(i => !i.checked)).toBe(true)
  })

  it('stays mutate-blocked with an open checklist, and still blocked once green because mutate is empty', () => {
    const open = mutateStateFor({ policyState: 'allowed', hasAdapter: true, capabilities: EXO_CAPS, checklist: checklistFor('adult:exoclick', 'allowed', []) })
    expect(open).toMatchObject({ mutateBlocked: true, checkedCount: 0, reasons: ['9 of 9 checklist items open', 'the adapter has no mutate verbs'] })
    const green = mutateStateFor({
      policyState: 'allowed', hasAdapter: true, capabilities: EXO_CAPS,
      checklist: checklistFor('adult:exoclick', 'allowed', allChecked('adult:exoclick')),
    })
    expect(green).toMatchObject({ mutateBlocked: true, checkedCount: 9, reasons: ['the adapter has no mutate verbs'] })
  })

  it('reads as read and insights on the page', () => {
    expect(capabilitiesWords(EXO_CAPS)).toBe('read, insights')
  })
})

describe('capabilitiesWords', () => {
  it('lists what the adapter can do', () => {
    expect(capabilitiesWords(CAPS)).toBe('read, insights, mutate: pause, resume, audiences: read')
    expect(capabilitiesWords(null)).toBe('none')
  })
})

describe('migration 135', () => {
  it('classifies as additive', () => {
    const sql = readFileSync(join(process.cwd(), 'db/migrations/135_ad_channel_checklist.sql'), 'utf8')
    expect(classifyFile(sql).verdict).toBe('auto')
  })
})
