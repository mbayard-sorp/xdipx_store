/**
 * Unit tests for the IMAP connection probe in outreach-inbox.server.ts: the
 * pure parts (user masking, error sanitization, stage classification) plus
 * the probe flow against a mocked imapflow.
 *
 * Nothing here ever opens a socket: imapflow is mocked at module level, and
 * the poller's side-effect dependencies (db, Claude, owner alerts) are
 * stubbed because the module under test imports them at the top.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/claude.server', () => ({ generateWithSystem: vi.fn() }))
vi.mock('~/lib/owner-alerts.server', () => ({
  escapeHtml: (s: string) => s,
  sendOwnerEmail: vi.fn(),
}))

const imap = vi.hoisted(() => ({
  connect: vi.fn(),
  getMailboxLock: vi.fn(),
  logout: vi.fn(),
  close: vi.fn(),
  mailbox: undefined as unknown,
  lastOptions: undefined as unknown,
}))

vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(options: unknown) {
      imap.lastOptions = options
    }
    connect = imap.connect
    getMailboxLock = imap.getMailboxLock
    logout = imap.logout
    close = imap.close
    get mailbox() {
      return imap.mailbox
    }
  },
}))

import {
  classifyImapProbeFailure,
  maskImapUser,
  probeOutreachImap,
  sanitizeImapError,
} from '~/lib/outreach-inbox.server'

const PASS = 'sup3r-secret-pass'

const ENV_KEYS = [
  'OUTREACH_IMAP_HOST',
  'OUTREACH_IMAP_PORT',
  'OUTREACH_IMAP_USER',
  'OUTREACH_IMAP_PASS',
  'ZOHO_SMTP_USER',
  'ZOHO_SMTP_PASS',
] as const

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  imap.connect.mockReset().mockResolvedValue(undefined)
  imap.getMailboxLock.mockReset().mockResolvedValue({ release: vi.fn() })
  imap.logout.mockReset().mockResolvedValue(undefined)
  imap.close.mockReset()
  imap.mailbox = { exists: 0 }
  imap.lastOptions = undefined
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function setCreds() {
  process.env['OUTREACH_IMAP_USER'] = 'hello@xdipx.com'
  process.env['OUTREACH_IMAP_PASS'] = PASS
}

describe('maskImapUser', () => {
  it('keeps the first 2 chars and the @domain only', () => {
    expect(maskImapUser('hello@xdipx.com')).toBe('he***@xdipx.com')
  })

  it('handles a local part of 2 chars or fewer', () => {
    expect(maskImapUser('a@zoho.com')).toBe('a***@zoho.com')
    expect(maskImapUser('ab@zoho.com')).toBe('ab***@zoho.com')
  })

  it('masks a login with no @ down to its first 2 chars', () => {
    expect(maskImapUser('serviceaccount')).toBe('se***')
  })

  it('never reveals the rest of the local part', () => {
    expect(maskImapUser('hello@xdipx.com')).not.toContain('llo')
  })
})

describe('sanitizeImapError', () => {
  it('strips a message that contains the password string', () => {
    const out = sanitizeImapError(`command failed: LOGIN hello ${PASS} NO invalid`, [PASS])
    expect(out).not.toContain(PASS)
    expect(out).toBe('command failed: LOGIN hello [redacted] NO invalid')
  })

  it('strips every occurrence, not just the first', () => {
    const out = sanitizeImapError(`${PASS} then again ${PASS}`, [PASS])
    expect(out).toBe('[redacted] then again [redacted]')
  })

  it('treats the secret as a literal, not a regex', () => {
    const secret = 'p+ss(w0rd)?'
    const out = sanitizeImapError(`auth with p+ss(w0rd)? failed`, [secret])
    expect(out).toBe('auth with [redacted] failed')
  })

  it('ignores undefined and empty secrets and leaves clean messages alone', () => {
    expect(sanitizeImapError('connect ECONNREFUSED', [undefined, ''])).toBe('connect ECONNREFUSED')
  })
})

describe('classifyImapProbeFailure', () => {
  it('classifies imapflow authenticationFailed as auth', () => {
    const err = Object.assign(new Error('command failed'), { authenticationFailed: true })
    expect(classifyImapProbeFailure(err, 'connect')).toBe('auth')
  })

  it('classifies an AUTHENTICATIONFAILED response code as auth', () => {
    const err = Object.assign(new Error('NO LOGIN'), { serverResponseCode: 'AUTHENTICATIONFAILED' })
    expect(classifyImapProbeFailure(err, 'connect')).toBe('auth')
  })

  it('classifies credential-shaped messages as auth', () => {
    expect(classifyImapProbeFailure(new Error('Invalid credentials (Failure)'), 'connect')).toBe('auth')
    expect(classifyImapProbeFailure(new Error('Authentication failed'), 'connect')).toBe('auth')
  })

  it('leaves transport errors on the fallback stage', () => {
    expect(classifyImapProbeFailure(new Error('connect ECONNREFUSED 1.2.3.4:993'), 'connect')).toBe('connect')
    expect(classifyImapProbeFailure(new Error('NO such mailbox'), 'mailbox')).toBe('mailbox')
  })

  it('handles non-object errors via the fallback', () => {
    expect(classifyImapProbeFailure('boom', 'connect')).toBe('connect')
    expect(classifyImapProbeFailure(undefined, 'mailbox')).toBe('mailbox')
  })
})

describe('probeOutreachImap', () => {
  it('fails at the config stage without connecting when no credentials exist', async () => {
    const res = await probeOutreachImap()
    expect(res).toEqual({ ok: false, stage: 'config', error: 'IMAP credentials not configured' })
    expect(imap.connect).not.toHaveBeenCalled()
  })

  it('returns host, port, masked user, and message count on success', async () => {
    setCreds()
    imap.mailbox = { exists: 42 }
    const res = await probeOutreachImap()
    expect(res).toEqual({
      ok: true,
      host: 'imap.zoho.com',
      port: 993,
      user: 'he***@xdipx.com',
      mailbox: 'INBOX',
      messages: 42,
    })
    // The read-only open is the never-mark-seen guarantee.
    expect(imap.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true })
    expect(imap.logout).toHaveBeenCalled()
    expect(JSON.stringify(res)).not.toContain(PASS)
  })

  it('reports stage auth with a sanitized error when LOGIN is rejected', async () => {
    setCreds()
    imap.connect.mockRejectedValue(
      Object.assign(new Error(`command failed: LOGIN hello ${PASS} NO invalid`), {
        authenticationFailed: true,
      }),
    )
    imap.logout.mockRejectedValue(new Error('not connected'))
    const res = await probeOutreachImap()
    expect(res).toMatchObject({ ok: false, stage: 'auth' })
    expect(res.ok === false && res.error).not.toContain(PASS)
    expect(res.ok === false && res.error).toContain('[redacted]')
    // Failed logout falls back to a hard close.
    expect(imap.close).toHaveBeenCalled()
  })

  it('reports stage connect for a transport failure', async () => {
    setCreds()
    imap.connect.mockRejectedValue(new Error('connect ECONNREFUSED 1.2.3.4:993'))
    const res = await probeOutreachImap()
    expect(res).toMatchObject({ ok: false, stage: 'connect', error: 'connect ECONNREFUSED 1.2.3.4:993' })
  })

  it('reports stage mailbox when INBOX cannot be opened', async () => {
    setCreds()
    imap.getMailboxLock.mockRejectedValue(new Error('NO such mailbox'))
    const res = await probeOutreachImap()
    expect(res).toMatchObject({ ok: false, stage: 'mailbox', error: 'NO such mailbox' })
  })

  it('times out hard at 15s and tears the client down', async () => {
    setCreds()
    imap.connect.mockReturnValue(new Promise(() => {}))
    vi.useFakeTimers()
    try {
      const pending = probeOutreachImap()
      await vi.advanceTimersByTimeAsync(15000)
      const res = await pending
      expect(res).toMatchObject({ ok: false, stage: 'connect' })
      expect(res.ok === false && res.error).toMatch(/timed out after 15000ms/)
      expect(imap.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
