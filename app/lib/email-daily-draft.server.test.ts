/**
 * POST /api/team/email draft/preview orchestration (ticket #15002). All
 * Klaviyo/DB/list-membership side effects are injected deps, so this file
 * touches no network and no database.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import {
  draftDailyEmail,
  previewDailyEmail,
  type DraftDeps,
} from './email-daily-draft.server'
import { isSendDayDefault, type EmailSection } from './email-daily.server'
import type { DailyCampaignPushDeps, DailyCampaignPushResult } from './klaviyo-campaigns.server'

const SECTIONS: EmailSection[] = [{ kind: 'emmaNote', note: 'A quiet favorite is back.' }]

const BASE_INPUT = {
  date: '2026-11-03', // Tuesday — a default send day
  sections: SECTIONS,
  subject: 'Your quiet favorite is back',
  audienceListId: 'RLFrJY',
}

function fakeDeps(overrides: Partial<DraftDeps> = {}): DraftDeps & {
  calls: { listProfiles: number; syncAudience: number; pushCampaign: number; insertSend: number; sendOwnerEmail: number }
} {
  const calls = { listProfiles: 0, syncAudience: 0, pushCampaign: 0, insertSend: 0, sendOwnerEmail: 0 }
  const deps: DraftDeps = {
    isSendDay: async (date) => isSendDayDefault(date),
    getExistingSend: async () => null,
    listProfiles: async () => {
      calls.listProfiles++
      return [{ id: 'p1', email: 'a@example.com' }]
    },
    syncAudience: async () => {
      calls.syncAudience++
      return { attempted: 1, succeeded: 1, failed: 0 }
    },
    pushCampaign: async (): Promise<DailyCampaignPushResult> => {
      calls.pushCampaign++
      return { pushed: true, reason: 'ok', campaignId: 'CAMP1', templateId: 'TPL1' }
    },
    pushDeps: {} as DailyCampaignPushDeps,
    insertSend: async (values) => {
      calls.insertSend++
      return { id: 1, createdAt: new Date(), sentAt: null, approvedBy: null, ...values } as never
    },
    sendOwnerEmail: (async () => {
      calls.sendOwnerEmail++
      return { sent: true }
    }) as DraftDeps['sendOwnerEmail'],
    today: () => '2026-11-02',
    ...overrides,
  }
  return { ...deps, calls }
}

describe('previewDailyEmail', () => {
  it('renders HTML/text with no DB or Klaviyo calls', () => {
    const result = previewDailyEmail(BASE_INPUT)
    expect(result.campaignKey).toBe('daily-20261103')
    expect(result.html).toContain('A quiet favorite is back.')
    expect(result.text).toContain('A quiet favorite is back.')
  })

  it('rejects a missing subject', () => {
    const { subject: _drop, ...rest } = BASE_INPUT
    expect(() => previewDailyEmail(rest)).toThrow(/subject/)
  })
})

describe('draftDailyEmail', () => {
  it('refuses a Wednesday (not a default send day)', async () => {
    const deps = fakeDeps()
    await expect(draftDailyEmail({ ...BASE_INPUT, date: '2026-11-04' }, deps)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('not a send day'),
    })
  })

  it('refuses a date more than one day from today', async () => {
    const deps = fakeDeps()
    await expect(draftDailyEmail({ ...BASE_INPUT, date: '2026-11-19' }, deps)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('valve off: pushCampaign reports valve-off, and the preview HTML still comes back with no DB write', async () => {
    const deps = fakeDeps({
      pushCampaign: async () => ({ pushed: false, reason: 'valve-off' }),
    })
    const result = await draftDailyEmail(BASE_INPUT, deps)
    expect(result).toMatchObject({ pushed: false, reason: 'valve-off' })
    expect(result.html).toContain('A quiet favorite is back.')
    expect(deps.calls.insertSend).toBe(0)
    expect(deps.calls.sendOwnerEmail).toBe(0)
  })

  it('a repeat draft for the same campaign_key returns the existing row and makes no new Klaviyo calls', async () => {
    const existingRow = {
      id: 7, campaignKey: 'daily-20261103', status: 'drafted',
      klaviyoCampaignId: 'CAMP-OLD', klaviyoTemplateId: 'TPL-OLD',
    } as never
    const deps = fakeDeps({ getExistingSend: async () => existingRow })
    const result = await draftDailyEmail(BASE_INPUT, deps)
    expect(result).toMatchObject({ pushed: true, reason: 'already-exists', row: existingRow })
    expect(deps.calls.listProfiles).toBe(0)
    expect(deps.calls.syncAudience).toBe(0)
    expect(deps.calls.pushCampaign).toBe(0)
    expect(deps.calls.insertSend).toBe(0)
    expect(deps.calls.sendOwnerEmail).toBe(0)
  })

  it('on a fresh push: syncs the audience, pushes the campaign, writes the row, and emails the owner', async () => {
    const deps = fakeDeps()
    const result = await draftDailyEmail(BASE_INPUT, deps)
    expect(result.pushed).toBe(true)
    expect(result.reason).toBe('ok')
    expect(deps.calls.listProfiles).toBe(1)
    expect(deps.calls.syncAudience).toBe(1)
    expect(deps.calls.pushCampaign).toBe(1)
    expect(deps.calls.insertSend).toBe(1)
    expect(deps.calls.sendOwnerEmail).toBe(1)
  })

  it('add-on sync failure does not block the draft', async () => {
    const deps = fakeDeps({
      listProfiles: async () => {
        throw new Error('klaviyo down')
      },
    })
    const result = await draftDailyEmail(BASE_INPUT, deps)
    expect(result.pushed).toBe(true)
    expect(result.addonSync).toBeUndefined()
  })
})
