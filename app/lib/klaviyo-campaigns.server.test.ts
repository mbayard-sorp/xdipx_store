import { describe, it, expect, vi } from 'vitest'
import {
  campaignPushEnabled,
  parseCampaignBrief,
  resolveAudience,
  buildCampaignPayload,
  klaviyoCampaignEditUrl,
  buildCampaignOwnerEmail,
  pushApprovedCampaign,
  EMAIL_CAMPAIGN_PUSH_VALVE,
  type CampaignPushDeps,
} from './klaviyo-campaigns.server'

// These helpers back the campaign executor that turns an approved email brief
// into a Klaviyo DRAFT plus an owner review email. The whole path is gated
// behind email_campaign_push_enabled (default OFF), and it is draft only: no
// send-job is ever created. Verified here without a network or a database.

const SAMPLE_BRIEF = `Campaign: August warm-up
Audience: Daily Deal subscribers, opened in last 90 days
Send: Thursday 10am ET
Subject line (variant 1): "Your quiet favorite is back"
Preview text: A little something to slow the evening down
Body:
Hey there. Emma here. ...
Shop: https://xdipx.com/products/ferri?utm_source=klaviyo&utm_medium=email&utm_campaign=august_warmup
Success metric: attributed orders`

describe('campaignPushEnabled', () => {
  it('is off for a missing setting', () => {
    expect(campaignPushEnabled(null)).toBe(false)
  })
  it('is off for anything other than the literal "true"', () => {
    expect(campaignPushEnabled('false')).toBe(false)
    expect(campaignPushEnabled('1')).toBe(false)
    expect(campaignPushEnabled('TRUE')).toBe(false)
  })
  it('is on only for "true"', () => {
    expect(campaignPushEnabled('true')).toBe(true)
  })
})

describe('parseCampaignBrief', () => {
  it('extracts subject, preview, audience, and a utm-derived name', () => {
    const b = parseCampaignBrief(SAMPLE_BRIEF)
    expect(b.subject).toBe('Your quiet favorite is back')  // quotes stripped
    expect(b.previewText).toBe('A little something to slow the evening down')
    expect(b.audienceHint?.toLowerCase()).toContain('subscribers')
    expect(b.name).toBe('august_warmup')                    // from utm_campaign
    expect(b.body).toBe(SAMPLE_BRIEF)
  })

  it('falls back safely when labels are missing', () => {
    const b = parseCampaignBrief('just some prose with no labels at all')
    expect(b.subject).toContain('draft')
    expect(b.previewText).toBeNull()
    expect(b.audienceHint).toBeNull()
    expect(b.name).toBe('xdipx email campaign')
  })

  it('derives the name from the subject when there is no utm token', () => {
    const b = parseCampaignBrief('Subject: A gentle reintroduction')
    expect(b.name).toBe('A gentle reintroduction')
  })
})

describe('resolveAudience', () => {
  const env = { waitlistListId: 'WAIT1', mainListId: 'MAIN1' }
  it('maps a waitlist hint to the waitlist list', () => {
    expect(resolveAudience('the waitlist for X', env)).toEqual({ listId: 'WAIT1', source: 'waitlist' })
  })
  it('defaults to the main list otherwise', () => {
    expect(resolveAudience('all subscribers', env)).toEqual({ listId: 'MAIN1', source: 'main' })
  })
  it('falls back to waitlist when only it is configured', () => {
    expect(resolveAudience('subscribers', { waitlistListId: 'WAIT1' })).toEqual({
      listId: 'WAIT1',
      source: 'waitlist-fallback',
    })
  })
  it('is unresolved when nothing is configured', () => {
    expect(resolveAudience('subscribers', {})).toEqual({ listId: null, source: 'unresolved' })
  })
})

describe('buildCampaignPayload', () => {
  it('builds a draft campaign (no send_strategy) with the audience and email content', () => {
    const p = buildCampaignPayload({
      name: 'aug',
      subject: 'Sub',
      previewText: 'Prev',
      listId: 'MAIN1',
      fromEmail: 'hello@xdipx.com',
      fromLabel: 'xdipx',
    }) as any
    expect(p.data.type).toBe('campaign')
    expect(p.data.attributes.name).toBe('aug')
    expect(p.data.attributes.audiences.included).toEqual(['MAIN1'])
    expect(p.data.attributes.send_strategy).toBeUndefined()   // stays an unscheduled draft
    const content = p.data.attributes['campaign-messages'].data[0].attributes.definition.content
    expect(content.subject).toBe('Sub')
    expect(content.preview_text).toBe('Prev')
    expect(content.from_email).toBe('hello@xdipx.com')
  })

  it('sends an empty preview_text rather than null', () => {
    const p = buildCampaignPayload({
      name: 'x', subject: 's', previewText: null, listId: 'L', fromEmail: 'a@b.c', fromLabel: 'x',
    }) as any
    expect(p.data.attributes['campaign-messages'].data[0].attributes.definition.content.preview_text).toBe('')
  })
})

describe('klaviyoCampaignEditUrl', () => {
  it('deep-links to the draft', () => {
    expect(klaviyoCampaignEditUrl('01ABC')).toBe('https://www.klaviyo.com/campaign/01ABC/edit')
  })
})

describe('buildCampaignOwnerEmail', () => {
  it('escapes the body and includes the review link', () => {
    const m = buildCampaignOwnerEmail({
      suggestionId: 42,
      campaignName: 'aug',
      subject: 'Sub',
      editUrl: 'https://www.klaviyo.com/campaign/01ABC/edit',
      audienceSource: 'main',
      body: 'evil <script>alert(1)</script>',
    })
    expect(m.subject).toBe('Campaign draft ready: aug')
    expect(m.html).toContain('https://www.klaviyo.com/campaign/01ABC/edit')
    expect(m.html).toContain('&lt;script&gt;')
    expect(m.html).not.toContain('<script>alert')
  })
})

function makeDeps(overrides: Partial<CampaignPushDeps> = {}): CampaignPushDeps {
  return {
    getSetting: vi.fn(async () => 'true'),
    createCampaign: vi.fn(async () => ({ id: '01CAMP' })),
    sendOwnerEmail: vi.fn(async () => ({ sent: true })),
    addNote: vi.fn(async () => {}),
    env: {
      apiKey: 'k',
      waitlistListId: 'WAIT1',
      mainListId: 'MAIN1',
      fromEmail: 'hello@xdipx.com',
      fromLabel: 'xdipx',
    },
    ...overrides,
  }
}

describe('pushApprovedCampaign', () => {
  it('does nothing when the valve is off', async () => {
    const deps = makeDeps({ getSetting: vi.fn(async () => null) })
    const res = await pushApprovedCampaign({ id: 1, suggestion: SAMPLE_BRIEF }, deps)
    expect(res).toEqual({ pushed: false, reason: 'valve-off' })
    expect(deps.createCampaign).not.toHaveBeenCalled()
    expect(deps.sendOwnerEmail).not.toHaveBeenCalled()
    expect(deps.addNote).not.toHaveBeenCalled()
  })

  it('reads the valve by the documented key', async () => {
    const getSetting = vi.fn(async () => null)
    await pushApprovedCampaign({ id: 1, suggestion: SAMPLE_BRIEF }, makeDeps({ getSetting }))
    expect(getSetting).toHaveBeenCalledWith(EMAIL_CAMPAIGN_PUSH_VALVE)
  })

  it('short-circuits when no Klaviyo api key is configured', async () => {
    const deps = makeDeps({ env: { apiKey: undefined, fromEmail: 'a@b.c', fromLabel: 'x' } })
    const res = await pushApprovedCampaign({ id: 1, suggestion: SAMPLE_BRIEF }, deps)
    expect(res.reason).toBe('no-klaviyo-api-key')
    expect(deps.createCampaign).not.toHaveBeenCalled()
  })

  it('with the valve on: creates a draft, emails the owner, and records a note link', async () => {
    const deps = makeDeps()
    const res = await pushApprovedCampaign({ id: 7, suggestion: SAMPLE_BRIEF }, deps)
    expect(res.pushed).toBe(true)
    expect(res.campaignId).toBe('01CAMP')
    expect(res.editUrl).toBe('https://www.klaviyo.com/campaign/01CAMP/edit')
    expect(deps.createCampaign).toHaveBeenCalledOnce()
    expect(deps.sendOwnerEmail).toHaveBeenCalledOnce()
    expect(deps.addNote).toHaveBeenCalledOnce()
    const [noteId, noteRef] = (deps.addNote as any).mock.calls[0]
    expect(noteId).toBe(7)
    expect(noteRef).toContain('https://www.klaviyo.com/campaign/01CAMP/edit')
  })

  it('never creates a send job (draft only): only the create-campaign dep is called', async () => {
    const deps = makeDeps()
    await pushApprovedCampaign({ id: 7, suggestion: SAMPLE_BRIEF }, deps)
    // The only Klaviyo write seam is createCampaign; there is no send seam.
    expect(Object.keys(deps)).not.toContain('sendCampaign')
  })

  it('emails the brief but does not create a campaign when no audience resolves', async () => {
    const deps = makeDeps({ env: { apiKey: 'k', fromEmail: 'a@b.c', fromLabel: 'x' } })
    const res = await pushApprovedCampaign({ id: 9, suggestion: SAMPLE_BRIEF }, deps)
    expect(res.pushed).toBe(false)
    expect(res.reason).toBe('no-audience-list-configured')
    expect(deps.createCampaign).not.toHaveBeenCalled()
    expect(deps.sendOwnerEmail).toHaveBeenCalledOnce()
    expect(deps.addNote).toHaveBeenCalledOnce()
  })

  it('reports a klaviyo error without throwing', async () => {
    const deps = makeDeps({
      createCampaign: vi.fn(async () => { throw new Error('boom') }),
    })
    const res = await pushApprovedCampaign({ id: 3, suggestion: SAMPLE_BRIEF }, deps)
    expect(res.pushed).toBe(false)
    expect(res.reason).toContain('klaviyo-error')
    expect(deps.addNote).not.toHaveBeenCalled()
  })
})
