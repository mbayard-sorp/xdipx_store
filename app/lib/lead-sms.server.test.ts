/**
 * Twilio double opt-in for the paid-lead funnel (app/lib/lead-sms.server.ts).
 *
 * The DB is a small in-memory fake keyed by the drizzle table object each
 * query names (the same shape as api-team-import-candidate-action.test.ts),
 * with the bound value pulled out of the eq() condition so phone and id
 * filters behave. Twilio is a mocked sendSms: no test here can text anyone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { leadSmsSubscriptions, pipelineSettings, smsOptouts } from '../../db/schema'

type Row = Record<string, unknown> & { id: number }

const h = vi.hoisted(() => ({
  sendSms: vi.fn<(to: string, body: string) => Promise<string>>(),
  optouts: new Set<string>(),
  subs: [] as Array<Record<string, unknown> & { id: number }>,
  settings: {} as Record<string, string>,
  nextId: 1,
}))

vi.mock('~/lib/twilio.server', () => ({ sendSms: h.sendSms }))

/** Bound values inside a drizzle SQL condition (eq(col, value) carries a Param chunk). */
function boundValues(cond: unknown): unknown[] {
  const chunks = (cond as { queryChunks?: unknown[] })?.queryChunks ?? []
  return chunks
    .filter((c): c is { value: unknown } => !!c && typeof c === 'object' && 'value' in c && 'encoder' in c)
    .map(c => c.value)
}

vi.mock('~/lib/db.server', () => {
  const rowsFor = (table: unknown, cond?: unknown): Row[] => {
    const [v] = boundValues(cond)
    if (table === smsOptouts) return [...h.optouts].filter(p => v === undefined || p === v).map((p, i) => ({ id: i + 1, phone: p }))
    if (table === leadSmsSubscriptions) return h.subs.filter(r => v === undefined || r['phone'] === v || r['id'] === v)
    if (table === pipelineSettings) return Object.entries(h.settings).filter(([k]) => v === undefined || k === v).map(([key, value], i) => ({ id: i + 1, key, value }))
    throw new Error('unexpected table')
  }
  const selectChain = (table: unknown, cond?: unknown) => {
    let rows = rowsFor(table, cond)
    const chain = {
      orderBy: () => { rows = [...rows].reverse(); return chain },
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
      then: (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    }
    return chain
  }
  return {
    db: {
      select: () => ({ from: (table: unknown) => ({ where: (cond: unknown) => selectChain(table, cond) }) }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => {
            if (table !== leadSmsSubscriptions) throw new Error('unexpected insert')
            const row = { id: h.nextId++, welcomeSentAt: null, confirmedAt: null, createdAt: new Date(), ...v }
            h.subs.push(row)
            return [{ id: row.id }]
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: async (cond: unknown) => {
            if (table !== leadSmsSubscriptions) throw new Error('unexpected update')
            const [id] = boundValues(cond)
            for (const r of h.subs) if (r.id === id) Object.assign(r, patch)
          },
        }),
      }),
    },
  }
})

import { confirmationSms, enrollLeadSms, handleLeadSmsInbound, welcomeSms } from './lead-sms.server'
import { LEAD_INTERESTS } from './lead-interests'

const PHONE = '+15555550100'
const LEAD = { phone: PHONE, email: 'ann@example.com', firstName: 'Ann', interest: 'wands' as const, source: 'curious-hello', consentedAt: new Date('2026-10-19T18:00:00Z') }

/** GSM-7 basic charset plus the extension characters a two-segment budget still counts as one each. */
const GSM7 = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\n\r]*$/
/** Two concatenated GSM-7 segments carry 153 characters each. */
const TWO_SEGMENTS = 306

beforeEach(() => {
  process.env['LEAD_SMS_OPTIN_ENABLED'] = '1'
  h.sendSms.mockReset()
  h.sendSms.mockResolvedValue('SM_sent')
  h.optouts.clear()
  h.subs.length = 0
  h.settings = {}
  h.nextId = 1
})
afterEach(() => {
  delete process.env['LEAD_SMS_OPTIN_ENABLED']
})

describe('enrollLeadSms', () => {
  it('writes a pending row and sends exactly one confirmation text', async () => {
    const res = await enrollLeadSms(LEAD)
    expect(res).toEqual({ outcome: 'pending', id: 1, messageSid: 'SM_sent' })
    expect(h.subs).toHaveLength(1)
    expect(h.subs[0]).toMatchObject({ phone: PHONE, email: 'ann@example.com', firstName: 'Ann', interest: 'wands', source: 'curious-hello', status: 'pending', confirmMessageSid: 'SM_sent' })
    expect(h.sendSms).toHaveBeenCalledTimes(1)
    const [to, body] = h.sendSms.mock.calls[0]!
    expect(to).toBe(PHONE)
    expect(body).toBe('xdipx: Reply YES to confirm texts from Emma. You asked about wands on curious.xdipx.com. Msg freq varies. Reply HELP for help, STOP to cancel. Msg&data rates may apply.')
  })

  it('records a number already in sms_optouts as opted_out and sends nothing', async () => {
    h.optouts.add(PHONE)
    const res = await enrollLeadSms(LEAD)
    expect(res).toEqual({ outcome: 'opted_out', id: 1 })
    expect(h.subs[0]).toMatchObject({ status: 'opted_out' })
    expect(h.subs[0]!['optedOutAt']).toBeInstanceOf(Date)
    expect(h.sendSms).not.toHaveBeenCalled()
  })

  it('does nothing when the switch is off (no env override, no valve row)', async () => {
    delete process.env['LEAD_SMS_OPTIN_ENABLED']
    expect(await enrollLeadSms(LEAD)).toEqual({ outcome: 'disabled' })
    expect(h.subs).toHaveLength(0)
    expect(h.sendSms).not.toHaveBeenCalled()
  })

  it('reads the lead_sms_optin_enabled valve row when the env override is absent', async () => {
    delete process.env['LEAD_SMS_OPTIN_ENABLED']
    h.settings['lead_sms_optin_enabled'] = 'true'
    expect((await enrollLeadSms(LEAD)).outcome).toBe('pending')
  })

  it('keeps the row pending when the confirmation send fails', async () => {
    h.sendSms.mockRejectedValueOnce(new Error('Twilio down'))
    const res = await enrollLeadSms(LEAD)
    expect(res).toEqual({ outcome: 'pending', id: 1, messageSid: null })
    expect(h.subs[0]).toMatchObject({ status: 'pending' })
  })
})

describe('handleLeadSmsInbound', () => {
  it('YES confirms a pending row and sends the welcome exactly once, even on a retry', async () => {
    await enrollLeadSms(LEAD)
    h.sendSms.mockClear()

    expect(await handleLeadSmsInbound(PHONE, 'Yes', 'SM_in1')).toBe('confirmed')
    expect(h.subs[0]).toMatchObject({ status: 'confirmed', confirmedVia: 'yes', welcomeMessageSid: 'SM_sent' })
    expect(h.subs[0]!['confirmedAt']).toBeInstanceOf(Date)
    expect(h.subs[0]!['welcomeSentAt']).toBeInstanceOf(Date)
    expect(h.sendSms).toHaveBeenCalledTimes(1)
    const [to, body] = h.sendSms.mock.calls[0]!
    expect(to).toBe(PHONE)
    expect(body).toContain('Hi Ann')
    expect(body).toContain('CURIOUS15 takes 15% off $30+ orders, one use per customer, Lovense and Playground excluded.')
    expect(body).toContain('https://xdipx.com/discount/CURIOUS15?redirect=' + encodeURIComponent('/collections/wands?'))
    expect(body.endsWith('Reply HELP for help, STOP to cancel.')).toBe(true)
    expect(body.length).toBeLessThanOrEqual(TWO_SEGMENTS)

    // A second YES (or a Twilio webhook retry) is a no-op: the row is confirmed, nothing resends.
    expect(await handleLeadSmsInbound(PHONE, 'YES', 'SM_in2')).toBe('none')
    expect(h.sendSms).toHaveBeenCalledTimes(1)
  })

  it('START also confirms a pending row (the registered flow accepts YES or START)', async () => {
    await enrollLeadSms(LEAD)
    h.sendSms.mockClear()
    expect(await handleLeadSmsInbound(PHONE, 'START')).toBe('confirmed')
    expect(h.subs[0]).toMatchObject({ status: 'confirmed', confirmedVia: 'start' })
    expect(h.sendSms).toHaveBeenCalledTimes(1)
  })

  it('STOP after confirmation flips the row to opted_out and sends nothing', async () => {
    await enrollLeadSms(LEAD)
    await handleLeadSmsInbound(PHONE, 'yes')
    h.sendSms.mockClear()

    expect(await handleLeadSmsInbound(PHONE, 'STOP')).toBe('opted_out')
    expect(h.subs[0]).toMatchObject({ status: 'opted_out' })
    expect(h.subs[0]!['optedOutAt']).toBeInstanceOf(Date)
    expect(h.sendSms).not.toHaveBeenCalled()
    // YES after STOP does not re-subscribe; only START does.
    expect(await handleLeadSmsInbound(PHONE, 'yes')).toBe('none')
    expect(h.subs[0]).toMatchObject({ status: 'opted_out' })
    expect(h.sendSms).not.toHaveBeenCalled()
  })

  it('START after STOP resumes the row without a second welcome', async () => {
    await enrollLeadSms(LEAD)
    await handleLeadSmsInbound(PHONE, 'yes')
    await handleLeadSmsInbound(PHONE, 'stop')
    h.sendSms.mockClear()
    expect(await handleLeadSmsInbound(PHONE, 'start')).toBe('resumed')
    expect(h.subs[0]).toMatchObject({ status: 'confirmed', optedOutAt: null })
    expect(h.sendSms).not.toHaveBeenCalled()
  })

  it('ignores numbers with no lead row and bodies that are not YES/START/STOP', async () => {
    expect(await handleLeadSmsInbound(PHONE, 'yes')).toBe('none')
    await enrollLeadSms(LEAD)
    h.sendSms.mockClear()
    expect(await handleLeadSmsInbound(PHONE, 'show me wands under $50')).toBe('none')
    expect(await handleLeadSmsInbound(PHONE, 'help')).toBe('none')
    expect(h.subs[0]).toMatchObject({ status: 'pending' })
    expect(h.sendSms).not.toHaveBeenCalled()
  })
})

describe('copy budget', () => {
  it('every welcome fits two GSM-7 segments for every interest and the longest greeting name', () => {
    for (const interest of [...LEAD_INTERESTS.map(i => i.slug), null]) {
      const body = welcomeSms('Christopher', interest)
      expect(body.length, `${interest}: ${body}`).toBeLessThanOrEqual(TWO_SEGMENTS)
      expect(GSM7.test(body), `${interest} is not GSM-7`).toBe(true)
      expect(body).not.toContain('\u2014')
    }
  })

  it('greets with "there" when the first name would not fit or is not plain letters', () => {
    expect(welcomeSms('Bartholomew-Alexander', 'wands')).toContain('Hi there,')
    expect(welcomeSms('Ann 🙂', 'wands')).toContain('Hi Ann,')
    expect(welcomeSms('😀', 'wands')).toContain('Hi there,')
    expect(welcomeSms("O'Neil", 'wands')).toContain("Hi O'Neil,")
  })

  it('confirmation texts fit two segments, carry the carrier closers, and name the funnel', () => {
    for (const interest of [...LEAD_INTERESTS.map(i => i.slug), null]) {
      const body = confirmationSms(interest)
      expect(body.length).toBeLessThanOrEqual(TWO_SEGMENTS)
      expect(GSM7.test(body)).toBe(true)
      expect(body.startsWith('xdipx: Reply YES to confirm texts from Emma.')).toBe(true)
      expect(body).toContain('curious.xdipx.com')
      expect(body.endsWith('Reply HELP for help, STOP to cancel. Msg&data rates may apply.')).toBe(true)
    }
    expect(confirmationSms(null)).toContain('You signed up on curious.xdipx.com.')
  })
})
