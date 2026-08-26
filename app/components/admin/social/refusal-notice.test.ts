import { describe, it, expect } from 'vitest'
import { refusalNoticesFor } from './refusal-notice'

const NO_DISMISS = { post: false, review: false, apply: false }

// The real refusal string decideManualPublish returns for the incident row
// (instagram, caption contains "clitoris"). The point of the ticket is that the
// term and the remedy already live in this string, so the banner must carry it
// through unchanged.
const LEXICON_REFUSAL =
  "Publish refused on a check that does not depend on anyone's judgment: " +
  'Caption, on-image text, or alt text carries removal-tier vocabulary: clitoris. ' +
  'Meta and TikTok remove accounts for this, they do not age-gate it. ' +
  'Rewrite in mechanism-and-health framing (e.g. "external stimulation", not the explicit term); ' +
  'do not use coded spellings, which the charter forbids and search blocks anyway.'

describe('refusalNoticesFor', () => {
  it('surfaces a refused Post-now with a plain heading, the term/remedy verbatim, and a Composer link', () => {
    const notices = refusalNoticesFor({
      postId: 107,
      post: { ok: false, error: LEXICON_REFUSAL },
      review: null,
      apply: null,
      dismissed: NO_DISMISS,
    })
    expect(notices).toHaveLength(1)
    const n = notices[0]!
    expect(n.source).toBe('post')
    expect(n.heading).toBe('Not published')
    // The offending term and the computed remedy ride through untouched.
    expect(n.message).toContain('clitoris')
    expect(n.message).toContain('external stimulation')
    // One-click path to fix it rather than hunting for the word.
    expect(n.action).toEqual({
      to: '/admin/socials/compose/107',
      label: 'Rewrite the caption in the Composer →',
    })
  })

  it('renders nothing while an action has not failed', () => {
    expect(
      refusalNoticesFor({
        postId: 1,
        post: undefined,
        review: { ok: true },
        apply: null,
        dismissed: NO_DISMISS,
      }),
    ).toEqual([])
  })

  it('hides a source once dismissed, and only that source', () => {
    const inputs = {
      postId: 5,
      post: { ok: false as const, error: LEXICON_REFUSAL },
      review: { ok: false as const, error: 'Bad decision' },
      apply: null,
    }
    const both = refusalNoticesFor({ ...inputs, dismissed: NO_DISMISS })
    expect(both.map(n => n.source)).toEqual(['post', 'review'])

    const onlyReview = refusalNoticesFor({ ...inputs, dismissed: { ...NO_DISMISS, post: true } })
    expect(onlyReview.map(n => n.source)).toEqual(['review'])
  })

  it('names each source plainly and falls back when the server sent no message', () => {
    const notices = refusalNoticesFor({
      postId: 9,
      post: { ok: false, error: '' },
      review: { ok: false },
      apply: { ok: false, error: '   ' },
      dismissed: NO_DISMISS,
    })
    expect(notices.map(n => [n.source, n.heading])).toEqual([
      ['post', 'Not published'],
      ['review', 'Not saved'],
      ['apply', 'Rework failed'],
    ])
    // A blank/whitespace error never renders a heading over an empty body.
    expect(notices.every(n => n.message.trim().length > 0)).toBe(true)
  })

  it('gives the review and apply refusals no Composer action (only Post-now offers the rewrite path)', () => {
    const notices = refusalNoticesFor({
      postId: 3,
      post: null,
      review: { ok: false, error: 'Feedback is required when requesting changes' },
      apply: { ok: false, error: 'Could not file the reworked draft.' },
      dismissed: NO_DISMISS,
    })
    expect(notices.map(n => n.source)).toEqual(['review', 'apply'])
    expect(notices.every(n => n.action === undefined)).toBe(true)
  })
})
