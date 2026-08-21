/**
 * The Sanity `drafts` perspective, and the deprecated name it replaced.
 *
 * `previewDrafts` was renamed to `drafts`; the client logs a deprecation
 * warning on every call and Sanity says the old name will be removed in a
 * future API version. `getApprovedCastMembers()` is on that path, so a silent
 * removal would take the social routine's cast lookup with it.
 */
import { describe, it, expect } from 'vitest'
import { getClient, type SanityPerspective } from '~/lib/sanity.server'

function perspectiveOf(client: unknown): string | undefined {
  return (client as { config?: () => { perspective?: string } } | null)?.config?.().perspective
}

describe('getClient perspective', () => {
  it('defaults to published for a normal read', () => {
    expect(perspectiveOf(getClient(false, false))).toBe('published')
  })

  it('uses drafts, not the deprecated previewDrafts, when preview is on', () => {
    expect(perspectiveOf(getClient(false, true))).toBe('drafts')
  })

  it('normalizes an explicit previewDrafts to drafts rather than passing it through', () => {
    // Back-compat: a caller outside this repo may still send the old name.
    expect(perspectiveOf(getClient(false, true, 'previewDrafts'))).toBe('drafts')
  })

  it('passes raw and published through untouched', () => {
    expect(perspectiveOf(getClient(true, false, 'raw'))).toBe('raw')
    expect(perspectiveOf(getClient(true, false, 'published'))).toBe('published')
  })

  it('never emits the deprecated name', () => {
    const seen: Array<SanityPerspective | undefined> = [undefined, 'raw', 'published', 'drafts', 'previewDrafts']
    for (const p of seen) {
      for (const preview of [true, false]) {
        expect(perspectiveOf(getClient(false, preview, p))).not.toBe('previewDrafts')
      }
    }
  })
})
