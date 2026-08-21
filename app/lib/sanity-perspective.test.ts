import { describe, expect, it, vi } from 'vitest'

/**
 * The Sanity `drafts` perspective, and the deprecated name it replaced.
 *
 * `previewDrafts` was renamed to `drafts`; the client warns on every call and
 * Sanity says the old name will be removed in a future API version.
 * `getApprovedCastMembers()` runs on that path, so a silent removal would take
 * the social routine's cast lookup with it.
 *
 * getClient captures projectId from env AT MODULE LOAD and returns null
 * without it, so the env is set before the dynamic import below and
 * @sanity/client is mocked to echo its config back. Without both, this file
 * passes on a developer machine that happens to have .env loaded and fails in
 * CI, which is exactly the credential-shaped false reading this rename exists
 * to stop repeating.
 */
process.env['SANITY_PROJECT_ID'] = 'test-project'

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

const { getClient } = await import('~/lib/sanity.server')

type Perspective = 'raw' | 'published' | 'drafts' | 'previewDrafts'

function perspectiveOf(withToken: boolean, preview: boolean, p?: Perspective): unknown {
  const client = getClient(withToken, preview, p) as { config?: () => { perspective?: unknown } } | null
  return client?.config?.().perspective
}

describe('getClient perspective', () => {
  it('defaults to published for a normal read', () => {
    expect(perspectiveOf(false, false)).toBe('published')
  })

  it('uses drafts, not the deprecated previewDrafts, when preview is on', () => {
    expect(perspectiveOf(false, true)).toBe('drafts')
  })

  it('normalizes an explicit previewDrafts to drafts rather than passing it through', () => {
    // Back-compat: a caller outside this repo may still send the old name.
    expect(perspectiveOf(false, true, 'previewDrafts')).toBe('drafts')
  })

  it('passes raw and published through untouched', () => {
    expect(perspectiveOf(true, false, 'raw')).toBe('raw')
    expect(perspectiveOf(true, false, 'published')).toBe('published')
  })

  it('never emits the deprecated name, for any input combination', () => {
    const inputs: Array<Perspective | undefined> = [undefined, 'raw', 'published', 'drafts', 'previewDrafts']
    for (const p of inputs) {
      for (const preview of [true, false]) {
        for (const withToken of [true, false]) {
          expect(perspectiveOf(withToken, preview, p)).not.toBe('previewDrafts')
        }
      }
    }
  })
})
