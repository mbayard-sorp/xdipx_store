import { describe, expect, it } from 'vitest'
import { decideSlugPrecheck } from '~/lib/content-slug-precheck'

// ticket #3401/#3405: the Step 3 slug pre-check read the raw perspective, so a
// blogPost held as an unpublished draft (e.g. a gate-BLOCKed post, Step 5 item 4)
// looked exactly like a taken slug and a later run skipped past it, orphaning the
// finished draft (run 327). These tests pin the corrected decision table.

describe('decideSlugPrecheck', () => {
  it('reports the slug free when nothing exists at it', () => {
    expect(decideSlugPrecheck({ publishedId: null, draftId: null })).toEqual({
      action: 'slug-free',
      reason: 'no-post-at-slug',
    })
  })

  it('reports the slug taken when a published post exists, even if a draft also exists', () => {
    expect(
      decideSlugPrecheck({ publishedId: 'blogPost-foo', draftId: 'drafts.blogPost-foo' }),
    ).toEqual({ action: 'slug-taken', reason: 'published' })
  })

  it('reports the slug taken when only a published post exists', () => {
    expect(decideSlugPrecheck({ publishedId: 'blogPost-foo', draftId: null })).toEqual({
      action: 'slug-taken',
      reason: 'published',
    })
  })

  it('resumes the unpublished draft instead of treating the slug as taken (the bug)', () => {
    expect(
      decideSlugPrecheck({ publishedId: null, draftId: 'drafts.blogPost-which-dildo-material-is-best' }),
    ).toEqual({
      action: 'resume-draft',
      reason: 'unpublished-draft',
      draftId: 'drafts.blogPost-which-dildo-material-is-best',
    })
  })

  it('never reports slug-free when an unpublished draft is present', () => {
    const result = decideSlugPrecheck({ publishedId: null, draftId: 'drafts.blogPost-bar' })
    expect(result.action).not.toBe('slug-free')
  })
})
