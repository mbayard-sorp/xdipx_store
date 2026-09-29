/**
 * End-to-end (mocked) tests for the inbound-support-email pipeline (ticket
 * #12095). Nothing here opens a real socket or calls the real Anthropic API:
 * imapflow, mailparser, Claude, and owner-alerts are all mocked, matching the
 * pattern in outreach-imap-probe.test.ts. The real database is production and
 * the send path talks to live SMTP, so db.server is mocked too.
 *
 * The DONE WHEN this ticket asks for ("an inbound pipeline routes a real test
 * message to customer-service-emma and produces a draft-only reply, confirmed
 * end to end") is exercised here as far as this sandbox can: no
 * ANTHROPIC_API_KEY or live IMAP credentials are available in this
 * environment (see routine-dev-daily.md 3h), so "end to end" means every hop
 * of the pipeline -- IMAP fetch, outreach-thread skip, Claude draft call,
 * DB write, owner alert -- proven against mocks that assert on the exact
 * shape each hop is called with, plus a real read of docs/emma-voice.md for
 * the system prompt (emma-voice.server.ts is not mocked). Live verification
 * against the real mailbox and a real model call needs to run in an
 * environment with those credentials.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResults: [] as unknown[][],
  inserts: [] as Array<Record<string, unknown>>,
}

vi.mock('~/lib/db.server', () => {
  const chain = () => {
    const c: Record<string, unknown> = {}
    c['where'] = () => c
    c['then'] = (resolve: (v: unknown) => void) => resolve(state.selectResults.shift() ?? [])
    return c
  }
  return {
    db: {
      select: () => ({ from: () => chain() }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          state.inserts.push(v)
          return Promise.resolve()
        },
      }),
    },
  }
})

const draftMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/claude.server', () => ({ generateWithSystem: draftMock }))

const sendOwnerEmailMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/owner-alerts.server', () => ({
  escapeHtml: (s: string) => s,
  sendOwnerEmail: sendOwnerEmailMock,
}))

const settingMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: settingMock }))

// Trivial re-implementation for the test double, mirroring
// outreach-inbox.server.ts's real (unmocked in production) header parser.
function headerValue(raw: string, name: string): string | null {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ')
  const re = new RegExp(`^${name}:[ \\t]*(.+)$`, 'im')
  return unfolded.match(re)?.[1]?.trim() ?? null
}

const imap = vi.hoisted(() => ({
  connect: vi.fn(),
  getMailboxLock: vi.fn(),
  search: vi.fn(),
  fetchOne: vi.fn(),
  logout: vi.fn(),
  close: vi.fn(),
  mailbox: undefined as unknown,
}))

const resolveImapConfigMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/outreach-inbox.server', () => ({
  resolveImapConfig: resolveImapConfigMock,
  createImapClient: async () => ({
    connect: imap.connect,
    getMailboxLock: imap.getMailboxLock,
    search: imap.search,
    fetchOne: imap.fetchOne,
    logout: imap.logout,
    close: imap.close,
    get mailbox() {
      return imap.mailbox
    },
  }),
  headerValue,
}))

vi.mock('mailparser', () => ({
  simpleParser: vi.fn(async () => ({
    subject: 'Where is my order?',
    text: 'Hi, my order has not arrived yet. Can you check on it?',
    date: new Date('2026-09-29T12:00:00Z'),
    from: { value: [{ address: 'jane@example.com' }] },
  })),
}))

import { draftSupportReply, pollSupportInbox } from '~/lib/support-inbox.server'

function headersBuffer(fields: Record<string, string>) {
  const raw = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\r\n')
  return { toString: () => raw }
}

beforeEach(() => {
  state.selectResults = []
  state.inserts = []
  draftMock.mockReset().mockResolvedValue('Hi Jane, checking that now for you. Emma')
  sendOwnerEmailMock.mockReset().mockResolvedValue({ sent: true })
  settingMock.mockReset().mockResolvedValue('true')
  imap.connect.mockReset().mockResolvedValue(undefined)
  imap.getMailboxLock.mockReset().mockResolvedValue({ release: vi.fn() })
  imap.search.mockReset().mockResolvedValue([42])
  imap.fetchOne.mockReset().mockImplementation(async (_uid: string, opts: Record<string, unknown>) => {
    if (opts['source']) return { source: Buffer.from('raw mime, unused by the mocked parser') }
    return {
      headers: headersBuffer({ 'Message-ID': '<inbound-1@example.com>' }),
      envelope: { subject: 'Where is my order?', from: [{ address: 'jane@example.com' }] },
    }
  })
  imap.logout.mockReset().mockResolvedValue(undefined)
  imap.close.mockReset()
  imap.mailbox = { uidValidity: 1n }
  resolveImapConfigMock.mockReset().mockReturnValue({
    host: 'imap.zoho.com', port: 993, user: 'hello@xdipx.com', pass: 'x',
  })
})

describe('draftSupportReply', () => {
  it('drafts a normal reply when Claude does not flag escalation', async () => {
    draftMock.mockResolvedValue('Hi Jane, checking that now for you. Emma')
    const out = await draftSupportReply({ fromEmail: 'jane@example.com', subject: 'Order?', bodyText: 'hi' })
    expect(out.needsHumanReview).toBe(false)
    expect(out.replyText).toContain('Emma')
    expect(draftMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'support-inbox',
      caller: 'support-inbox-draft',
    }))
  })

  it('flags escalation when Claude opens with the NEEDS HUMAN REVIEW marker', async () => {
    draftMock.mockResolvedValue('[NEEDS HUMAN REVIEW: fraud claim mentioned]\n\nEmma')
    const out = await draftSupportReply({ fromEmail: null, subject: null, bodyText: 'chargeback!' })
    expect(out.needsHumanReview).toBe(true)
  })
})

describe('pollSupportInbox', () => {
  it('no-ops before touching IMAP when the valve is off', async () => {
    settingMock.mockResolvedValue(null)
    const res = await pollSupportInbox()
    expect(res).toEqual({ ok: true, scanned: 0, drafted: 0 })
    expect(imap.connect).not.toHaveBeenCalled()
    expect(draftMock).not.toHaveBeenCalled()
  })

  it('routes a genuine inbound message to a draft-only reply, stored and emailed to the owner', async () => {
    state.selectResults = [[], []] // no known outreach outbound ids, nothing seen yet
    const res = await pollSupportInbox()
    expect(res).toEqual({ ok: true, scanned: 1, drafted: 1 })

    expect(draftMock).toHaveBeenCalledTimes(1)
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      messageId: '<inbound-1@example.com>',
      fromEmail: 'jane@example.com',
      subject: 'Where is my order?',
      draftReply: 'Hi Jane, checking that now for you. Emma',
      needsHumanReview: false,
    })

    // Draft-only: the owner is told, nothing is sent to the customer.
    expect(sendOwnerEmailMock).toHaveBeenCalledTimes(1)
    const [subject, html, opts] = sendOwnerEmailMock.mock.calls[0]!
    expect(subject).toContain('Support draft ready')
    expect(html).toContain('Hi Jane, checking that now for you. Emma')
    expect(opts).toMatchObject({ escalation: 'inbox' })

    // Never marks the message seen, never deletes/moves/flags.
    expect(imap.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true })
  })

  it('leaves an outreach-thread reply completely alone', async () => {
    imap.fetchOne.mockImplementation(async (_uid: string, opts: Record<string, unknown>) => {
      if (opts['source']) return { source: Buffer.from('unused') }
      return {
        headers: headersBuffer({ 'In-Reply-To': '<outbound-99@xdipx.com>', 'Message-ID': '<inbound-2@example.com>' }),
        envelope: {},
      }
    })
    // The outbound-ids query returns the id this message replies to.
    state.selectResults = [[{ messageId: '<outbound-99@xdipx.com>' }], []]

    const res = await pollSupportInbox()
    expect(res).toEqual({ ok: true, scanned: 1, drafted: 0 })
    expect(draftMock).not.toHaveBeenCalled()
    expect(state.inserts).toHaveLength(0)
    expect(sendOwnerEmailMock).not.toHaveBeenCalled()
  })

  it('does not re-draft a message it has already processed', async () => {
    // Already stored under this exact dedupe key.
    state.selectResults = [[], [{ messageId: '<inbound-1@example.com>' }]]
    const res = await pollSupportInbox()
    expect(res).toEqual({ ok: true, scanned: 1, drafted: 0 })
    expect(draftMock).not.toHaveBeenCalled()
    expect(state.inserts).toHaveLength(0)
  })

  it('reports a clean error, not a throw, when IMAP credentials are absent', async () => {
    resolveImapConfigMock.mockReturnValue(null)
    const res = await pollSupportInbox()
    expect(res).toEqual({ ok: false, scanned: 0, drafted: 0, error: 'IMAP credentials not configured' })
  })
})
