import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  campaignPushEnabled,
  parseCampaignBrief,
  resolveAudience,
  buildCampaignPayload,
  klaviyoCampaignEditUrl,
  buildCampaignOwnerEmail,
  pushApprovedCampaign,
  createKlaviyoCampaign,
  previewKlaviyoCampaign,
  listKlaviyoCampaigns,
  assignTemplateToMessage,
  createDailyTemplate,
  pushDailyEmailCampaign,
  EMAIL_CAMPAIGN_PUSH_VALVE,
  type CampaignPushDeps,
  type DailyCampaignPushDeps,
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
  it('treats a single alphanumeric token as an explicit list or segment id', () => {
    expect(resolveAudience('SEG6WpAwJ', env)).toEqual({ listId: 'SEG6WpAwJ', source: 'explicit' })
    expect(resolveAudience('  Y6g4XB12  ', env)).toEqual({ listId: 'Y6g4XB12', source: 'explicit' })
  })
  it('does not treat free-text prose or the bare env words as an explicit id', () => {
    expect(resolveAudience('the waitlist for X', env)).not.toEqual(expect.objectContaining({ source: 'explicit' }))
    expect(resolveAudience('waitlist', env)).not.toEqual(expect.objectContaining({ source: 'explicit' }))
    expect(resolveAudience('subscribers', env)).not.toEqual(expect.objectContaining({ source: 'explicit' }))
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

  it('keeps smart sending on and tells Klaviyo not to append its own tracking params', () => {
    const p = buildCampaignPayload({
      name: 'aug', subject: 'Sub', previewText: 'Prev', listId: 'MAIN1',
      fromEmail: 'hello@xdipx.com', fromLabel: 'xdipx',
    }) as any
    expect(p.data.attributes.use_smart_sending).toBe(true)
    expect(p.data.attributes.tracking_options.add_tracking_params).toBe(false)
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

// ─── Draft-only Campaigns client: create / preview / list (#4222) ───────────

describe('Klaviyo Campaigns client (draft-only, no send)', () => {
  const okJson = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as unknown as Response

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createKlaviyoCampaign POSTs to /campaigns/ and returns the new id', async () => {
    const fetchMock = vi.fn(async () => okJson({ data: { id: '01NEW', type: 'campaign' } }))
    vi.stubGlobal('fetch', fetchMock)

    const payload = buildCampaignPayload({
      name: 'aug', subject: 'Sub', previewText: 'Prev', listId: 'MAIN1',
      fromEmail: 'hello@xdipx.com', fromLabel: 'xdipx',
    })
    const res = await createKlaviyoCampaign(payload)

    expect(res).toEqual({ id: '01NEW' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://a.klaviyo.com/api/campaigns/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })

  it('createKlaviyoCampaign throws when Klaviyo returns no id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ data: {} })))
    await expect(createKlaviyoCampaign({ data: {} })).rejects.toThrow(/no id/)
  })

  it('previewKlaviyoCampaign GETs the campaign with its messages included', async () => {
    const fetchMock = vi.fn(async () => okJson({
      data: { id: '01ABC', type: 'campaign', attributes: { name: 'aug' } },
      included: [
        { id: 'm1', type: 'campaign-message', attributes: { definition: { channel: 'email' } } },
        { id: 't1', type: 'tag' }, // unrelated included resource, must be filtered out
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await previewKlaviyoCampaign('01ABC')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://a.klaviyo.com/api/campaigns/01ABC/?include=campaign-messages')
    expect(init.method).toBe('GET')
    expect(res.campaign.id).toBe('01ABC')
    expect(res.messages).toHaveLength(1)
    expect(res.messages[0]!.id).toBe('m1')
  })

  it('listKlaviyoCampaigns requires the channel filter Klaviyo mandates', async () => {
    const fetchMock = vi.fn(async () => okJson({ data: [{ id: 'c1', type: 'campaign' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await listKlaviyoCampaigns({ channel: 'email' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    // The filter is URL-encoded equals(messages.channel,"email").
    expect(url).toBe(
      'https://a.klaviyo.com/api/campaigns/?filter=' +
      encodeURIComponent('equals(messages.channel,"email")'),
    )
    expect(res.map(c => c.id)).toEqual(['c1'])
  })

  it('never touches a campaign-send-job endpoint (no send path)', async () => {
    const fetchMock = vi.fn(async () => okJson({ data: { id: 'x', type: 'campaign' }, included: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await createKlaviyoCampaign({ data: {} })
    await previewKlaviyoCampaign('x')
    await listKlaviyoCampaigns({ channel: 'email' })

    for (const call of fetchMock.mock.calls as unknown as unknown[][]) {
      expect(String(call[0])).not.toContain('campaign-send-job')
    }
  })

  it('createKlaviyoCampaign also returns the campaign-message id when the response carries one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({
      data: {
        id: '01NEW',
        type: 'campaign',
        relationships: { 'campaign-messages': { data: [{ id: 'MSG1', type: 'campaign-message' }] } },
      },
    })))
    const res = await createKlaviyoCampaign({ data: {} })
    expect(res).toEqual({ id: '01NEW', messageId: 'MSG1' })
  })

  it('assignTemplateToMessage POSTs to campaign-message-assign-template with the template relationship', async () => {
    const fetchMock = vi.fn(async () => okJson({}))
    vi.stubGlobal('fetch', fetchMock)

    await assignTemplateToMessage('MSG1', 'TPL1')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://a.klaviyo.com/api/campaign-message-assign-template/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      data: {
        type: 'campaign-message',
        id: 'MSG1',
        relationships: { template: { data: { type: 'template', id: 'TPL1' } } },
      },
    })
  })

  it('createDailyTemplate reuses the templates endpoint with a daily-keyed name', async () => {
    const fetchMock = vi.fn(async () => okJson({ data: { id: 'TPL1', type: 'template', attributes: { name: 'xdipx daily 2026-10-14' } } }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await createDailyTemplate({ dateKey: '2026-10-14', html: '<html></html>', text: 'plain' })

    expect(res).toEqual({ id: 'TPL1', name: 'xdipx daily 2026-10-14' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://a.klaviyo.com/api/templates/')
    const body = JSON.parse(init.body as string)
    expect(body.data.attributes.name).toBe('xdipx daily 2026-10-14')
    expect(body.data.attributes.editor_type).toBe('CODE')
    expect(body.data.attributes.html).toBe('<html></html>')
  })

  it('a grep test: no line of actual code (comments aside) names a campaign-send-job endpoint path', () => {
    // The module header deliberately documents, in prose, why there is no send
    // helper, so it names the forbidden endpoint in a comment. This grep scopes
    // itself to non-comment lines so that documentation does not fail its own check.
    const source = readFileSync(new URL('./klaviyo-campaigns.server.ts', import.meta.url), 'utf8')
    const codeLines = source.split('\n').filter((line) => {
      const trimmed = line.trim()
      return trimmed.length > 0 && !trimmed.startsWith('*') && !trimmed.startsWith('//')
    })
    for (const line of codeLines) {
      expect(line).not.toMatch(/campaign-send-jobs?/)
    }
  })
})

describe('pushDailyEmailCampaign (ticket #15000)', () => {
  const okJson = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as unknown as Response

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeDailyDeps(overrides: Partial<DailyCampaignPushDeps> = {}): DailyCampaignPushDeps {
    return {
      getSetting: vi.fn(async () => 'true'),
      createCampaign: createKlaviyoCampaign,
      createTemplate: createDailyTemplate,
      assignTemplate: assignTemplateToMessage,
      env: { apiKey: 'k', fromEmail: 'hello@xdipx.com', fromLabel: 'xdipx' },
      ...overrides,
    }
  }

  const INPUT = {
    dateKey: '2026-10-14',
    subject: 'What is new this week',
    previewText: 'A few fresh arrivals',
    listId: 'MAIN1',
    html: '<html>daily</html>',
    text: 'daily plain text',
  }

  it('calls create-campaign, create-template, then assign-template in that order, with the expected bodies', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.endsWith('/campaigns/')) {
        return okJson({
          data: {
            id: 'CAMP1',
            type: 'campaign',
            relationships: { 'campaign-messages': { data: [{ id: 'MSG1', type: 'campaign-message' }] } },
          },
        })
      }
      if (u.endsWith('/templates/')) {
        return okJson({ data: { id: 'TPL1', type: 'template', attributes: { name: 'xdipx daily 2026-10-14' } } })
      }
      if (u.endsWith('/campaign-message-assign-template/')) {
        return okJson({})
      }
      throw new Error(`unexpected fetch to ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await pushDailyEmailCampaign(INPUT, makeDailyDeps())

    expect(res).toEqual({ pushed: true, reason: 'ok', campaignId: 'CAMP1', templateId: 'TPL1' })

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    expect(calls).toHaveLength(3)
    expect(calls[0]![0]).toBe('https://a.klaviyo.com/api/campaigns/')
    expect(calls[1]![0]).toBe('https://a.klaviyo.com/api/templates/')
    expect(calls[2]![0]).toBe('https://a.klaviyo.com/api/campaign-message-assign-template/')

    const campaignBody = JSON.parse(calls[0]![1].body as string)
    expect(campaignBody.data.attributes.use_smart_sending).toBe(true)
    expect(campaignBody.data.attributes.tracking_options.add_tracking_params).toBe(false)

    const templateBody = JSON.parse(calls[1]![1].body as string)
    expect(templateBody.data.attributes.html).toBe(INPUT.html)
    expect(templateBody.data.attributes.text).toBe(INPUT.text)

    const assignBody = JSON.parse(calls[2]![1].body as string)
    expect(assignBody.data.id).toBe('MSG1')
    expect(assignBody.data.relationships.template.data.id).toBe('TPL1')
  })

  it('makes zero fetches when the valve is off', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await pushDailyEmailCampaign(INPUT, makeDailyDeps({ getSetting: vi.fn(async () => null) }))

    expect(res).toEqual({ pushed: false, reason: 'valve-off' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('short-circuits with zero fetches when no Klaviyo api key is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await pushDailyEmailCampaign(INPUT, makeDailyDeps({ env: { apiKey: undefined, fromEmail: 'a@b.c', fromLabel: 'x' } }))

    expect(res.reason).toBe('no-klaviyo-api-key')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never reaches create-template or assign-template when the campaign carries no message id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ data: { id: 'CAMP1', type: 'campaign' } })))

    const res = await pushDailyEmailCampaign(INPUT, makeDailyDeps())

    expect(res).toEqual({ pushed: false, reason: 'no-campaign-message-id', campaignId: 'CAMP1' })
  })
})
