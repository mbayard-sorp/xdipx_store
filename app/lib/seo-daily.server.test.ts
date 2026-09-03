// formatRegressedUrlsSuffix (ticket #7247). The indexed-drop anomaly used to
// fire with a bare week-over-week percentage and no way to investigate it:
// "Investigate what changed on the affected URLs before it caches" named no
// URLs, because the underlying query only ever counted regressions, never
// listed them. This is the pure formatting slice of the fix — the SQL query
// itself (fetchRegressedUrls, inline in runSeoDaily) reuses the exact WHERE
// predicate already proven in production by transitions.regressed, just over
// a wider window, so it is not re-tested here; only the query LIMIT changed.
// seo-daily.server.ts pulls in db.server (and through it the real Neon/otel
// stack), checkout-probe.server, team.server, and owner-alerts.server at
// module load time. None of that runs in this file (formatRegressedUrlsSuffix
// is pure), so every one is stubbed at the module boundary purely to make the
// import safe, the same pattern owner-digest.server.test.ts uses.
import { describe, expect, it, vi } from 'vitest'
vi.mock('~/lib/db.server', () => ({ db: { execute: vi.fn() } }))
vi.mock('~/lib/homepage-healthcheck.server', () => ({ extractJsonLd: vi.fn() }))
vi.mock('~/lib/checkout-probe.server', () => ({ checkUrl: vi.fn() }))
vi.mock('~/lib/team.server', () => ({ createSuggestion: vi.fn() }))
vi.mock('~/lib/owner-alerts.server', () => ({ sendOwnerEmail: vi.fn(), escapeHtml: (s: string) => s }))

import { formatRegressedUrlsSuffix, type RegressedUrl } from './seo-daily.server'

function url(over: Partial<RegressedUrl> = {}): RegressedUrl {
  return {
    url: 'https://xdipx.com/products/example',
    previousCoverageState: 'Submitted and indexed',
    coverageState: 'Crawled - currently not indexed',
    verdict: 'NEUTRAL',
    changedAt: '2026-09-02T10:00:00Z',
    ...over,
  }
}

describe('formatRegressedUrlsSuffix', () => {
  it('says plainly when no per-URL regression matched, rather than repeating an un-investigable line', () => {
    expect(formatRegressedUrlsSuffix([])).toBe(
      ' No per-URL regression matched this window in gsc_url_inspections; the drop may be sitemap churn rather than a tracked coverage regression.',
    )
  })

  it('names the URL and its state transition', () => {
    const out = formatRegressedUrlsSuffix([url({ url: 'https://xdipx.com/products/a' })])
    expect(out).toBe(
      ' Affected: https://xdipx.com/products/a (Submitted and indexed -> Crawled - currently not indexed)',
    )
  })

  it('falls back to verdict when coverageState is null', () => {
    const out = formatRegressedUrlsSuffix([url({ coverageState: null, verdict: 'FAIL' })])
    expect(out).toContain('-> FAIL)')
  })

  it('falls back to "indexed" when previousCoverageState is null', () => {
    const out = formatRegressedUrlsSuffix([url({ previousCoverageState: null })])
    expect(out).toContain('(indexed ->')
  })

  it('caps the named list and counts the rest, default max 8', () => {
    const rows = Array.from({ length: 11 }, (_, i) => url({ url: `https://xdipx.com/products/p${i}` }))
    const out = formatRegressedUrlsSuffix(rows)
    expect(out).toContain('p0')
    expect(out).toContain('p7')
    expect(out).not.toContain('p8')
    expect(out).toContain('+3 more')
  })

  it('respects a custom max', () => {
    const rows = Array.from({ length: 5 }, (_, i) => url({ url: `https://xdipx.com/products/p${i}` }))
    const out = formatRegressedUrlsSuffix(rows, 2)
    expect(out).toContain('p1')
    expect(out).not.toContain('p2')
    expect(out).toContain('+3 more')
  })

  it('omits the "+N more" suffix when nothing was truncated', () => {
    const out = formatRegressedUrlsSuffix([url(), url({ url: 'https://xdipx.com/products/b' })])
    expect(out).not.toContain('more')
  })
})
