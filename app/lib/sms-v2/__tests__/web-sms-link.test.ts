/**
 * app/lib/sms-v2/__tests__/web-sms-link.test.ts
 *
 * Ticket #3916. Unit tests for the web<->SMS opt-in linker: it's the write
 * path that finally populates web_conversations.customer_gid, which used to
 * be structurally dead on the web channel (nothing ever wrote it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getOrCreateConversation: vi.fn(),
  applyStateWrites: vi.fn(),
  bridgeSummary: vi.fn((s: string | null) => (s ? `From a previous conversation: ${s}` : null)),
  getOrCreateWebConversation: vi.fn(),
  applyWebStateWrites: vi.fn(),
  isOptedOut: vi.fn(),
  hasAgeConsent: vi.fn(),
  sendSms: vi.fn(),
  findCustomerByPhone: vi.fn(),
  getProductByHandle: vi.fn(),
  pickCrossChannelTemplate: vi.fn(() => 'CROSS_CHANNEL_TEMPLATE_STUB'),
}))

vi.mock('../conversation.server', () => ({
  getOrCreateConversation: h.getOrCreateConversation,
  applyStateWrites: h.applyStateWrites,
  bridgeSummary: h.bridgeSummary,
}))

vi.mock('../web-conversation.server', () => ({
  getOrCreateWebConversation: h.getOrCreateWebConversation,
  applyWebStateWrites: h.applyWebStateWrites,
}))

vi.mock('~/lib/sms-processor.server', () => ({
  isOptedOut: h.isOptedOut,
  hasAgeConsent: h.hasAgeConsent,
}))

vi.mock('~/lib/twilio.server', () => ({
  sendSms: h.sendSms,
}))

vi.mock('~/lib/shopify.server', () => ({
  findCustomerByPhone: h.findCustomerByPhone,
  getProductByHandle: h.getProductByHandle,
}))

vi.mock('../templates/compliance-templates', () => ({
  AGE_GATE_REPLY: 'AGE_GATE_REPLY_STUB',
}))

vi.mock('../templates/cross-channel-templates', () => ({
  pickCrossChannelTemplate: h.pickCrossChannelTemplate,
}))

import { linkWebSessionToSms, normalizePhoneToE164 } from '../web-sms-link.server'

const baseWebRow = {
  sessionId: 'sess-1',
  conversationId: 'conv-web-1',
  stage: 'DISCOVERY',
  currentPitchHandle: null,
  currentUpsellHandle: null,
  lastQuoteUrl: null,
  lastQuoteItems: null,
  lastQuoteCreatedAt: null,
  customerGid: null,
  customerFirstName: null,
  customerDefaultZip: null,
  pageHandle: null,
  pageRoute: null,
  stageSetAt: new Date(),
  lastActiveAt: new Date(),
  discoveryState: null,
  discoveredSlots: {},
  pendingPdpUrl: null,
  conversationSummary: null,
  pitchedHandlesLog: null,
}

const baseSmsRow = {
  phone: '+15550001111',
  stage: 'GREETING',
  currentPitchHandle: null,
  currentUpsellHandle: null,
  lastQuoteUrl: null,
  lastQuoteItems: null,
  lastQuoteCreatedAt: null,
  customerGid: null,
  customerFirstName: null,
  customerDefaultZip: null,
  stageSetAt: new Date(),
  lastActiveAt: new Date(),
  conversationId: 'conv-sms-1',
  discoveryState: null,
  discoveredSlots: {},
  pendingPdpUrl: null,
  conversationSummary: null,
  pitchedHandlesLog: null,
}

describe('normalizePhoneToE164', () => {
  it('accepts a 10-digit US number and prepends +1', () => {
    expect(normalizePhoneToE164('555 000 1111')).toBe('+15550001111')
  })
  it('accepts an 11-digit number already carrying the leading 1', () => {
    expect(normalizePhoneToE164('1-555-000-1111')).toBe('+15550001111')
  })
  it('passes through a well-formed E.164 number unchanged', () => {
    expect(normalizePhoneToE164('+15550001111')).toBe('+15550001111')
  })
  it('rejects garbage input', () => {
    expect(normalizePhoneToE164('not a phone')).toBeNull()
    expect(normalizePhoneToE164('123')).toBeNull()
  })
})

describe('linkWebSessionToSms (#3916)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    h.bridgeSummary.mockImplementation((s: string | null) => (s ? `From a previous conversation: ${s}` : null))
    h.pickCrossChannelTemplate.mockReturnValue('CROSS_CHANNEL_TEMPLATE_STUB')
  })

  it('refuses to link an opted-out phone and never sends', async () => {
    h.isOptedOut.mockResolvedValue(true)

    const result = await linkWebSessionToSms({ sessionId: 'sess-1', phone: '+15550001111' })

    expect(result).toEqual({ ok: false, reason: 'opted_out' })
    expect(h.sendSms).not.toHaveBeenCalled()
    expect(h.getOrCreateConversation).not.toHaveBeenCalled()
  })

  it('a brand-new, unconsented phone gets the AGE_GATE_REPLY and both rows get linked via a fresh Shopify lookup', async () => {
    h.isOptedOut.mockResolvedValue(false)
    h.hasAgeConsent.mockResolvedValue(false)
    h.getOrCreateWebConversation.mockResolvedValue({ ...baseWebRow })
    h.getOrCreateConversation.mockResolvedValue({ ...baseSmsRow })
    h.findCustomerByPhone.mockResolvedValue({ id: 'gid://shopify/Customer/42', email: null, firstName: null, lastName: null, defaultAddress: null })
    h.sendSms.mockResolvedValue('SM123')

    const result = await linkWebSessionToSms({ sessionId: 'sess-1', phone: '+15550001111' })

    expect(result).toMatchObject({ ok: true, sent: true, alreadyConsented: false, customerGidLinked: true })
    expect(h.sendSms).toHaveBeenCalledWith('+15550001111', 'AGE_GATE_REPLY_STUB')
    expect(h.applyWebStateWrites).toHaveBeenCalledWith('sess-1', { customerGid: 'gid://shopify/Customer/42' })
    expect(h.applyStateWrites).toHaveBeenCalledWith('+15550001111', { customerGid: 'gid://shopify/Customer/42' })
  })

  it('an already-consented phone gets the reviewed cross-channel continuation copy, not the age gate', async () => {
    h.isOptedOut.mockResolvedValue(false)
    h.hasAgeConsent.mockResolvedValue(true)
    h.getOrCreateWebConversation.mockResolvedValue({ ...baseWebRow, customerGid: 'gid://shopify/Customer/9', currentPitchHandle: 'aurora-wand' })
    h.getOrCreateConversation.mockResolvedValue({ ...baseSmsRow, customerGid: 'gid://shopify/Customer/9' })
    h.getProductByHandle.mockResolvedValue({ title: 'Aurora Wand' })
    h.sendSms.mockResolvedValue('SM124')

    const result = await linkWebSessionToSms({ sessionId: 'sess-1', phone: '+15550001111' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.alreadyConsented).toBe(true)
    expect(h.sendSms).toHaveBeenCalledWith('+15550001111', 'CROSS_CHANNEL_TEMPLATE_STUB')
    expect(h.pickCrossChannelTemplate).toHaveBeenCalledWith(
      { channelLabel: 'the site', productTitle: 'Aurora Wand' },
      'sms',
    )
    // Both rows already carried the same gid — no redundant writes.
    expect(h.applyWebStateWrites).not.toHaveBeenCalled()
    expect(h.applyStateWrites).not.toHaveBeenCalledWith('+15550001111', expect.objectContaining({ customerGid: expect.anything() }))
  })

  it('bridges the web pitch context onto a brand-new SMS row without clobbering existing SMS state', async () => {
    h.isOptedOut.mockResolvedValue(false)
    h.hasAgeConsent.mockResolvedValue(false)
    h.getOrCreateWebConversation.mockResolvedValue({
      ...baseWebRow,
      currentPitchHandle: 'aurora-wand',
      lastQuoteUrl: 'https://xdipx.com/products/aurora-wand',
      conversationSummary: 'Customer was comparing wands.',
    })
    h.getOrCreateConversation.mockResolvedValue({ ...baseSmsRow, currentPitchHandle: 'already-set-handle' })
    h.findCustomerByPhone.mockResolvedValue(null)
    h.sendSms.mockResolvedValue('SM125')

    await linkWebSessionToSms({ sessionId: 'sess-1', phone: '+15550001111' })

    // currentPitchHandle was already set on the SMS row — must not be clobbered.
    expect(h.applyStateWrites).toHaveBeenCalledWith('+15550001111', {
      lastQuoteUrl: 'https://xdipx.com/products/aurora-wand',
      conversationSummary: 'From a previous conversation: Customer was comparing wands.',
    })
  })

  it('a failed SMS send is reported honestly (ok:true, sent:false) — never silent', async () => {
    h.isOptedOut.mockResolvedValue(false)
    h.hasAgeConsent.mockResolvedValue(false)
    h.getOrCreateWebConversation.mockResolvedValue({ ...baseWebRow })
    h.getOrCreateConversation.mockResolvedValue({ ...baseSmsRow })
    h.findCustomerByPhone.mockResolvedValue(null)
    h.sendSms.mockRejectedValue(new Error('Twilio down'))

    const result = await linkWebSessionToSms({ sessionId: 'sess-1', phone: '+15550001111' })

    expect(result).toMatchObject({ ok: true, sent: false })
  })
})
