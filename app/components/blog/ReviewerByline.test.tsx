/**
 * Ticket #12096: the reviewer byline must never render a fabricated or
 * stale-but-deactivated reviewer, and must render the real one plainly when
 * present. No preview/screenshot tool was available in this session
 * (routine-dev-daily.md 4c); this is the source-level fallback -- the
 * className strings mirror SeriesNav's already-approved trust-footer
 * pattern (bg-paper-2 container, border-line, ink token hierarchy) rather
 * than inventing new layout, so the visual risk is low.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReviewerByline } from './ReviewerByline'
import type { HealthReviewer } from '~/types/cms'

const REVIEWER: HealthReviewer = {
  name: 'Jane Doe',
  credentials: 'RN, AASECT-certified sex educator',
  bio: 'Reviews sexual health content for clarity and accuracy.',
}

describe('ReviewerByline', () => {
  it('renders nothing when there is no reviewer', () => {
    expect(renderToStaticMarkup(<ReviewerByline reviewer={null} />)).toBe('')
    expect(renderToStaticMarkup(<ReviewerByline reviewer={undefined} />)).toBe('')
  })

  it('renders nothing for a deactivated reviewer', () => {
    const html = renderToStaticMarkup(<ReviewerByline reviewer={{ ...REVIEWER, active: false }} />)
    expect(html).toBe('')
  })

  it('renders the name and credentials for an active reviewer', () => {
    const html = renderToStaticMarkup(<ReviewerByline reviewer={REVIEWER} />)
    expect(html).toContain('Reviewed by Jane Doe')
    expect(html).toContain('RN, AASECT-certified sex educator')
    expect(html).toContain('Reviews sexual health content for clarity and accuracy.')
  })

  it('treats a missing active flag as active (default true)', () => {
    const { active: _active, ...withoutActive } = REVIEWER as HealthReviewer & { active?: boolean }
    const html = renderToStaticMarkup(<ReviewerByline reviewer={withoutActive} />)
    expect(html).toContain('Reviewed by Jane Doe')
  })
})
