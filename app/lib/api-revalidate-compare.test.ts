/**
 * POST /api/revalidate/compare (ticket #19398): a comparison publish must
 * bust the comparison caches and ping /compare paths, and must never touch
 * the blogPost caches or ping a /notebook path — that confusion (calling
 * /api/revalidate/blog for a comparison slug) is the bug this endpoint
 * exists to retire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidated: string[] = []
const kvDeleted: string[] = []
const pinged: string[][] = []

vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))
vi.mock('~/lib/kv.server', () => ({
  invalidateCache: (prefix: string) => { invalidated.push(prefix) },
  kvDel: async (key: string) => { kvDeleted.push(key) },
}))
vi.mock('~/lib/search-ping.server', () => ({
  pingSearchEngines: async (paths: string[]) => { pinged.push(paths) },
}))

// Lives in app/lib rather than next to the route: anything in app/routes is
// picked up by flatRoutes/typegen as a route module, tests included.
import { action } from '~/routes/api.revalidate.compare'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/revalidate/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  invalidated.length = 0
  kvDeleted.length = 0
  pinged.length = 0
})

describe('POST /api/revalidate/compare', () => {
  it('busts comparison:{slug}, comparison:list and md:compare:{slug} on both cache layers', async () => {
    const res = await post({ slug: 'wand-vs-bullet' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, slug: 'wand-vs-bullet' })

    const expectedKeys = ['comparison:wand-vs-bullet', 'comparison:list', 'md:compare:wand-vs-bullet']
    expect(invalidated.sort()).toEqual([...expectedKeys].sort())
    expect(kvDeleted.sort()).toEqual([...expectedKeys].sort())
  })

  it('never touches a blogPost cache key', async () => {
    await post({ slug: 'wand-vs-bullet' })
    for (const key of [...invalidated, ...kvDeleted]) {
      expect(key.startsWith('md:notebook:')).toBe(false)
    }
  })

  it('pings /compare paths, never a /notebook path', async () => {
    await post({ slug: 'wand-vs-bullet' })
    expect(pinged).toHaveLength(1)
    expect(pinged[0]).toEqual(['/compare/wand-vs-bullet', '/compare/wand-vs-bullet.md', '/compare'])
    for (const path of pinged[0]!) expect(path.startsWith('/notebook')).toBe(false)
  })

  it('rejects a bad slug without invalidating or pinging anything', async () => {
    const res = await post({ slug: 'Not A Slug!' })
    expect(res.status).toBe(400)
    expect(invalidated).toHaveLength(0)
    expect(kvDeleted).toHaveLength(0)
    expect(pinged).toHaveLength(0)
  })

  it('rejects a non-POST method', async () => {
    const request = new Request('http://localhost/api/revalidate/compare', { method: 'GET' })
    const res = await action({ request, params: {}, context: {} } as never) as Response
    expect(res.status).toBe(405)
  })
})
