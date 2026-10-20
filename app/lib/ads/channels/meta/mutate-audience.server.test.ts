import { describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../../audience-sync-core'
import { MutationRefusedError } from '../errors'
import type { GraphClient, GraphJson } from './graph.server'
import { createMetaAudienceSync } from './mutate.server'

const ACCT = 'act_920738511029316'
const H = (i: number) => sha256Hex(`person${i}@example.com`)

function fakeGraph(existing: GraphJson[] = []) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = []
  const graph: GraphClient = {
    get: vi.fn(async () => ({})),
    getAll: vi.fn(async () => existing),
    post: vi.fn(async (path: string, body: Record<string, unknown> = {}) => {
      posts.push({ path, body })
      if (path.endsWith('/customaudiences')) return { id: '120000000000001' }
      const rows = ((body['payload'] as { data?: unknown[] } | undefined)?.data ?? []).length
      return { audience_id: path.split('/')[0], num_received: rows, num_invalid_entries: 0 }
    }),
  }
  return { graph, posts }
}

const sync = (graph: GraphClient, accountId: string | null = ACCT) =>
  createMetaAudienceSync({ graph, accountId: () => accountId, sessionId: () => 4242 })

describe('ensureCustomerListAudience', () => {
  it('creates a CUSTOM, USER_PROVIDED_ONLY audience when none carries the name', async () => {
    const { graph, posts } = fakeGraph([{ id: '1', name: 'Something else', subtype: 'CUSTOM' }])
    const out = await sync(graph).ensureCustomerListAudience({ name: 'xdipx buyers (exclude)', description: 'd' })
    expect(out).toMatchObject({ id: '120000000000001', created: true })
    expect(posts).toEqual([{
      path: `${ACCT}/customaudiences`,
      body: { name: 'xdipx buyers (exclude)', subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY', description: 'd' },
    }])
  })

  it('reuses the audience that already carries the exact name, and writes nothing', async () => {
    const { graph, posts } = fakeGraph([{ id: '777', name: 'xdipx buyers (exclude)', subtype: 'CUSTOM', operation_status: { code: 200 } }])
    const out = await sync(graph).ensureCustomerListAudience({ name: 'xdipx buyers (exclude)', description: 'd' })
    expect(out).toMatchObject({ id: '777', created: false })
    expect(posts).toEqual([])
  })

  it('refuses a same-named audience that is not a customer list, and two with the same name', async () => {
    const lal = fakeGraph([{ id: '8', name: 'xdipx leads (exclude)', subtype: 'LOOKALIKE' }])
    await expect(sync(lal.graph).ensureCustomerListAudience({ name: 'xdipx leads (exclude)', description: '' })).rejects.toThrow(MutationRefusedError)
    const twins = fakeGraph([{ id: '8', name: 'xdipx leads (exclude)', subtype: 'CUSTOM' }, { id: '9', name: 'xdipx leads (exclude)', subtype: 'CUSTOM' }])
    await expect(sync(twins.graph).ensureCustomerListAudience({ name: 'xdipx leads (exclude)', description: '' })).rejects.toThrow(/2 audiences/)
    expect(lal.posts.length + twins.posts.length).toBe(0)
  })

  it('dry run returns the create request without sending it', async () => {
    const { graph, posts } = fakeGraph()
    const out = await sync(graph).ensureCustomerListAudience({ name: 'xdipx leads (exclude)', description: 'd' }, { dryRun: true })
    expect(out).toMatchObject({ id: null, created: false, request: { path: `${ACCT}/customaudiences` } })
    expect(posts).toEqual([])
  })

  it('refuses without an ad account', async () => {
    const { graph } = fakeGraph()
    await expect(sync(graph, null).ensureCustomerListAudience({ name: 'x', description: '' })).rejects.toMatchObject({ code: 'not_configured' })
  })
})

describe('loadCustomerListMembers', () => {
  it('replaces an existing audience in 10,000-row batches under one session', async () => {
    const { graph, posts } = fakeGraph()
    const hashes = Array.from({ length: 10_001 }, (_, i) => H(i))
    const out = await sync(graph).loadCustomerListMembers('777', hashes, { fresh: false })
    expect(out).toMatchObject({ mode: 'usersreplace', sessionId: 4242, batches: 2, rows: 10_001, numReceived: 10_001 })
    expect(posts.map(p => p.path)).toEqual(['777/usersreplace', '777/usersreplace'])
    expect(posts.map(p => p.body['session'])).toEqual([
      { session_id: 4242, batch_seq: 1, last_batch_flag: false, estimated_num_total: 10_001 },
      { session_id: 4242, batch_seq: 2, last_batch_flag: true, estimated_num_total: 10_001 },
    ])
    const payload = posts[0]!.body['payload'] as { schema: string; data: string[][] }
    expect(payload.schema).toBe('EMAIL_SHA256')
    expect(payload.data[0]).toEqual([H(0)])
  })

  it('fills a fresh audience through /users', async () => {
    const { graph, posts } = fakeGraph()
    const out = await sync(graph).loadCustomerListMembers('777', [H(1), H(1), H(2)], { fresh: true })
    expect(out).toMatchObject({ mode: 'users', rows: 2, batches: 1 })
    expect(posts.map(p => p.path)).toEqual(['777/users'])
  })

  it('refuses anything that is not a SHA-256 digest before a byte leaves', async () => {
    const { graph, posts } = fakeGraph()
    await expect(sync(graph).loadCustomerListMembers('777', [H(1), 'jane@example.com'], { fresh: false })).rejects.toMatchObject({ code: 'bad_params' })
    await expect(sync(graph).loadCustomerListMembers('777', [H(1).toUpperCase()], { fresh: false })).rejects.toMatchObject({ code: 'bad_params' })
    await expect(sync(graph).loadCustomerListMembers('not-an-id', [H(1)], { fresh: false })).rejects.toMatchObject({ code: 'bad_target' })
    expect(posts).toEqual([])
  })

  it('sends nothing for an empty list, and nothing under dry run', async () => {
    const { graph, posts } = fakeGraph()
    expect(await sync(graph).loadCustomerListMembers('777', [], { fresh: false })).toMatchObject({ mode: 'skipped_empty', batches: 0 })
    const dry = await sync(graph).loadCustomerListMembers('777', [H(1), H(2)], { fresh: false, dryRun: true })
    expect(dry).toMatchObject({ mode: 'usersreplace', batches: 1, rows: 2 })
    expect(JSON.stringify(dry.requests)).not.toContain(H(1))
    expect(posts).toEqual([])
  })
})
