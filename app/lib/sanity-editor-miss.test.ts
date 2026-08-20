import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ticket #4346 (split from #4344). getEditor() used to return null SILENTLY
 * when singleton.editor was absent (or present with no name). That propagated
 * through getEditorPhotoUrl() and the storefront emmaPhotoUrl resolver, so an
 * absent canonical Emma likeness rendered an empty slot with no signal — which
 * is exactly why the missing production singleton went unnoticed. This proves
 * the miss is now LOUD: a distinct console.error surfaces it in monitoring.
 *
 * Lives in app/lib/ (not app/routes/) so flatRoutes() doesn't treat it as a
 * route module, matching app/lib/sanity-home-seo.test.ts.
 */

// getEditor captures projectId from env at module load — set it before the
// dynamic import below so getClient() builds a (mocked) client instead of
// short-circuiting to null.
process.env['SANITY_PROJECT_ID'] = 'test-project'

let nextFetchResult: unknown = null

vi.mock('@sanity/client', () => ({
  createClient: vi.fn(() => ({ fetch: vi.fn(async () => nextFetchResult) })),
}))
vi.mock('~/lib/kv.server', () => ({
  cached: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  invalidateCache: vi.fn(),
  kvDel: vi.fn(async () => undefined),
}))
vi.mock('~/lib/sanity-image', () => ({
  optimizeSanityImageUrls: (v: unknown) => v,
  sanityImageUrl: (v: unknown) => v,
}))
// Sentry is imported lazily/fire-and-forget inside getEditor; stub it so the
// miss branch never reaches @sentry/node. The console.error is the signal we
// assert on (the Sentry call is best-effort and races the return).
vi.mock('~/lib/sentry.server', () => ({ Sentry: { captureException: vi.fn() } }))

const { getEditor } = await import('~/lib/sanity.server')

const MISS_MARKER = 'getEditor: canonical Emma likeness unavailable'

function loggedErrors(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
}

describe('getEditor makes an absent singleton.editor loud (#4346)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errSpy.mockRestore()
  })

  it('reports the miss when the singleton document is missing', async () => {
    nextFetchResult = null
    const editor = await getEditor(true)
    expect(editor).toBeNull()
    const logged = loggedErrors(errSpy)
    expect(logged).toContain('[sanity]')
    expect(logged).toContain(MISS_MARKER)
    expect(logged).toContain('singleton.editor document is missing')
  })

  it('reports the miss when the document exists but has no name', async () => {
    nextFetchResult = { role: 'Editor', photoUrl: 'https://cdn/x.jpg' }
    const editor = await getEditor(true)
    expect(editor).toBeNull()
    const logged = loggedErrors(errSpy)
    expect(logged).toContain(MISS_MARKER)
    expect(logged).toContain('singleton.editor exists but has no name')
  })

  it('does NOT report a miss when the singleton resolves with a name', async () => {
    nextFetchResult = { name: 'Emma', role: 'Editor' }
    const editor = await getEditor(true)
    expect(editor?.name).toBe('Emma')
    expect(loggedErrors(errSpy)).not.toContain(MISS_MARKER)
  })
})
