import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QA_AGE_BYPASS_HEADER, isQaAgeBypassRequest, qaAgeBypassToken } from './qa-preview.server'

const SECRET_KEYS = ['TEAM_TOKEN', 'HOMEPAGE_TEAM_TOKEN', 'CRON_SECRET'] as const
const saved: Record<string, string | undefined> = {}

function req(headerValue?: string): Request {
  return new Request('https://example.com/', {
    headers: headerValue === undefined ? {} : { [QA_AGE_BYPASS_HEADER]: headerValue },
  })
}

beforeEach(() => {
  for (const k of SECRET_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of SECRET_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('qa age-gate bypass (ticket #2826)', () => {
  it('is inert with no secret configured: no token to send, nothing verifies', () => {
    expect(qaAgeBypassToken()).toBeNull()
    expect(isQaAgeBypassRequest(req('anything'))).toBe(false)
  })

  it('round-trips: the sent token verifies on a deployment with the same secret', () => {
    process.env['CRON_SECRET'] = 'shh'
    const token = qaAgeBypassToken()
    expect(token).toBeTruthy()
    expect(isQaAgeBypassRequest(req(token!))).toBe(true)
  })

  it('never accepts the raw secret, a guess, or an absent header', () => {
    process.env['CRON_SECRET'] = 'shh'
    expect(isQaAgeBypassRequest(req('shh'))).toBe(false)
    expect(isQaAgeBypassRequest(req('deadbeef'.repeat(8)))).toBe(false)
    expect(isQaAgeBypassRequest(req())).toBe(false)
  })

  it('a token minted under one secret does not verify under a different one', () => {
    process.env['CRON_SECRET'] = 'sender-secret'
    const token = qaAgeBypassToken()!
    process.env['CRON_SECRET'] = 'receiver-secret'
    expect(isQaAgeBypassRequest(req(token))).toBe(false)
  })

  it('accepts a match against any configured secret in the chain', () => {
    process.env['CRON_SECRET'] = 'cron'
    const cronToken = qaAgeBypassToken()!
    // Receiver has TEAM_TOKEN first but the same CRON_SECRET later in the chain.
    process.env['TEAM_TOKEN'] = 'team'
    expect(isQaAgeBypassRequest(req(cronToken))).toBe(true)
  })
})
