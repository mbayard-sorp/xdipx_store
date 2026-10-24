import { describe, expect, it } from 'vitest'
import {
  buildCrmStageData,
  CRM_STAGES,
  crmEventId,
  extractLeadgenChanges,
  matchInterest,
  parseLeadFieldData,
} from './meta-crm-core'

const LEAD_ID = '1234567890123456789'

describe('buildCrmStageData', () => {
  it('matches the shape Meta documents for a CRM stage event', () => {
    const json = buildCrmStageData({
      leadId: '1234567890123456',
      stage: CRM_STAGES.lead,
      eventId: 'crm_lead_1234567890123456',
      eventTime: 1673035686,
      user: { em: 'a'.repeat(64), ph: 'b'.repeat(64) },
    })
    expect(JSON.parse(json)).toEqual([{
      action_source: 'system_generated',
      custom_data: { event_source: 'crm', lead_event_source: 'xdipx' },
      event_name: 'Lead',
      event_id: 'crm_lead_1234567890123456',
      event_time: 1673035686,
      user_data: { lead_id: 1234567890123456, em: ['a'.repeat(64)], ph: ['b'.repeat(64)] },
    }])
  })

  it('sends lead_id as a bare number without losing digits past 2^53', () => {
    const json = buildCrmStageData({ leadId: LEAD_ID, stage: CRM_STAGES.converted, eventId: 'x', eventTime: 1, user: {} })
    expect(json).toContain(`"lead_id":${LEAD_ID}`)
    expect(json).not.toContain(`"${LEAD_ID}"`)
  })

  it('omits match keys it does not have', () => {
    const [row] = JSON.parse(buildCrmStageData({ leadId: LEAD_ID, stage: CRM_STAGES.lead, eventId: 'x', eventTime: 1, user: { em: null } }))
    expect(Object.keys(row.user_data)).toEqual(['lead_id'])
  })

  it('refuses anything that is not a digits-only lead id', () => {
    expect(() => buildCrmStageData({ leadId: '1,"x":2', stage: CRM_STAGES.lead, eventId: 'x', eventTime: 1, user: {} })).toThrow()
  })
})

describe('crmEventId', () => {
  it('is stable per lead and stage', () => {
    expect(crmEventId(LEAD_ID, CRM_STAGES.lead)).toBe(`crm_lead_${LEAD_ID}`)
    expect(crmEventId(LEAD_ID, CRM_STAGES.converted)).toBe(`crm_converted_${LEAD_ID}`)
  })
})

describe('extractLeadgenChanges', () => {
  const body = {
    object: 'page',
    entry: [{
      id: '111',
      time: 1792800000,
      changes: [
        { field: 'leadgen', value: { leadgen_id: LEAD_ID, form_id: '222', page_id: '111', ad_id: '333', adgroup_id: '444', created_time: 1792800000 } },
        { field: 'leadgen', value: { leadgen_id: LEAD_ID, form_id: '222' } },
        { field: 'feed', value: { item: 'post' } },
        { field: 'leadgen', value: { leadgen_id: 'not-a-number' } },
      ],
    }],
  }

  it('keeps leadgen changes, drops duplicates, other fields and bad ids', () => {
    expect(extractLeadgenChanges(body)).toEqual([{
      leadId: LEAD_ID, formId: '222', pageId: '111', adId: '333', adsetId: '444', createdTime: 1792800000,
    }])
  })

  it('ignores anything that is not a page webhook', () => {
    expect(extractLeadgenChanges({ object: 'instagram', entry: body.entry })).toEqual([])
    expect(extractLeadgenChanges(null)).toEqual([])
  })

  it('rejects a numeric id that already lost precision', () => {
    const lossy = { object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: 1234567890123456789 } }] }] }
    expect(extractLeadgenChanges(lossy)).toEqual([])
  })
})

describe('parseLeadFieldData', () => {
  it('reads the standard questions and maps the interest answer', () => {
    expect(parseLeadFieldData([
      { name: 'email', values: ['Ann@Example.com '] },
      { name: 'phone_number', values: ['+15555550123'] },
      { name: 'full_name', values: ['Ann Lee'] },
      { name: 'what_are_you_curious_about?', values: ['Hands-free and suction'] },
    ])).toEqual({ email: 'Ann@Example.com', phone: '+15555550123', firstName: 'Ann', interest: 'hands-free' })
  })

  it('prefers first_name over full_name and tolerates junk', () => {
    expect(parseLeadFieldData([
      { name: 'first_name', values: ['Bo'] },
      { name: 'full_name', values: ['Robert Smith'] },
      { name: 'interest', values: ['nonsense'] },
      { nope: true },
    ])).toEqual({ email: null, phone: null, firstName: 'Bo', interest: null })
    expect(parseLeadFieldData(undefined)).toEqual({ email: null, phone: null, firstName: null, interest: null })
  })
})

describe('matchInterest', () => {
  it('accepts slugs and labels', () => {
    expect(matchInterest('wands')).toBe('wands')
    expect(matchInterest('For two, near or far')).toBe('for-two')
    expect(matchInterest('back door')).toBe('back-door')
    expect(matchInterest('')).toBeNull()
  })
})
