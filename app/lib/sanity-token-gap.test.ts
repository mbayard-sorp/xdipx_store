import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ticket #4709 (supersedes #4344). The Sanity dataset requires auth for reads,
 * so a client built without SANITY_API_TOKEN resolves EVERY read to null/empty.
 * Two agents mis-read that unauthenticated empty GROQ as "the document does not
 * exist," and getEditorPhotoUrl()/the storefront emmaPhotoUrl resolver rendered
 * an empty slot with no signal about the real cause (a missing token in that
 * runtime). This proves the auth gap is now LOUD at the single getClient funnel
 * — a distinct console.error surfaces it in monitoring — so a tokenless read is
 * never again silently mistaken for an absent document.
 *
 * Lives in app/lib/ (not app/routes/) so flatRoutes() doesn't treat it as a
 * route module, matching app/lib/sanity-editor-miss.test.ts.
 */

// getClient captures projectId from env at module load — set it before the
// dynamic import below so getClient() builds a (mocked) client instead of
// short-circuiting to null. Leave SANITY_API_TOKEN unset to exercise the gap.
process.env['SANITY_PROJECT_ID'] = 'test-project'
delete process.env['SANITY_API_TOKEN']

vi.mock('@sanity/client', () => ({
  createClient: vi.fn((config: Record<string, unknown>) => ({
    config: () => config,
    fetch: vi.fn(async () => null),
  })),
}))
vi.mock('~/lib/kv.server', () => ({
  cached: vi.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
  invalidateCache: vi.fn(),
  kvDel: vi.fn(async () => undefined),
}))
vi.mock('~/lib/sanity-image', () => ({
  optimizeSanityImageUrls: (v: unknown) => v,
  sanityImageUrl: (v: unknown) => v,
}))
// Sentry is imported lazily/fire-and-forget inside getClient; stub it so the
// gap branch never reaches @sentry/node. The console.error is the assertion.
vi.mock('~/lib/sentry.server', () => ({ Sentry: { captureException: vi.fn() } }))

const { getClient } = await import('~/lib/sanity.server')

const GAP_MARKER = 'SANITY_API_TOKEN is missing while SANITY_PROJECT_ID is set'

function loggedErrors(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
}

describe('getClient makes a missing SANITY_API_TOKEN loud (#4709)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errSpy.mockRestore()
  })

  it('logs a distinct auth-gap error the first time a client is built without a token', () => {
    const client = getClient(false, false)
    // The client is still returned (behavior unchanged) — but the gap is loud.
    expect(client).not.toBeNull()
    const logged = loggedErrors(errSpy)
    expect(logged).toContain('[sanity]')
    expect(logged).toContain(GAP_MARKER)
    // The message must distinguish an auth gap from an absent document.
    expect(logged).toContain('not an absent document')
  })

  it('warns only once per process, not on every getClient call', () => {
    // The first call in this module instance already latched the warning above.
    getClient(false, false)
    getClient(true, false, 'raw')
    getClient(false, true)
    expect(loggedErrors(errSpy)).not.toContain(GAP_MARKER)
  })
})
