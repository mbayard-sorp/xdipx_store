import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
const sanityFetch = vi.fn()
const kvSet = vi.fn()
const readPayload = vi.fn()
const fileDetectionTicket = vi.fn(async (..._args: unknown[]) => 42)
const captureException = vi.fn()

vi.mock('~/lib/sanity.server', () => ({
  getClient: () => ({ fetch: sanityFetch }),
}))
vi.mock('~/lib/homepage-payload.server', () => ({
  readHomepagePayloadB: (...args: unknown[]) => readPayload(...args),
}))
vi.mock('~/lib/kv.server', () => ({ kvSet: (...args: unknown[]) => kvSet(...args) }))
vi.mock('~/lib/sentry.server', () => ({
  Sentry: { captureException: (...args: unknown[]) => captureException(...args) },
}))
vi.mock('~/lib/detection-tickets.server', () => ({
  fileDetectionTicket: (...args: unknown[]) => fileDetectionTicket(...args),
  makeDedupeKey: (...parts: unknown[]) => parts.join(':'),
  priorityFromSeverity: () => 3,
}))

import { runCategoryHealthcheck } from './category-healthcheck.server'

const GOOD_CATEGORY_HTML = [
  '<html><body>',
  '<section data-block="categoryMasthead">masthead</section>',
  '<script type="application/ld+json">{"@type":"FAQPage"}</script>',
  'x'.repeat(2000),
  '</body></html>',
].join('\n')

// A Response body reads once, and the check fetches more than one page (and
// retries), so every fetch call must mint a fresh Response.
function serveHtml(body: string, status = 200): void {
  fetchMock.mockImplementation(async () =>
    new Response(body, { status, headers: { 'content-type': 'text/html' } }),
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  fetchMock.mockReset()
  sanityFetch.mockReset()
  kvSet.mockReset()
  readPayload.mockReset()
  fileDetectionTicket.mockClear()
  captureException.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  readPayload.mockResolvedValue(null)
})

describe('runCategoryHealthcheck', () => {
  it('is healthy with zero checks when nothing is live yet', async () => {
    sanityFetch.mockResolvedValue({ categories: [], drops: [] })
    const result = await runCategoryHealthcheck()
    expect(result).toMatchObject({ ok: true, liveDocs: 0, checks: [], alerted: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(kvSet).toHaveBeenCalledOnce()
  })

  it('passes a live category page whose masthead marker renders', async () => {
    sanityFetch.mockResolvedValue({ categories: ['pleasure'], drops: [] })
    serveHtml(GOOD_CATEGORY_HTML)
    const result = await runCategoryHealthcheck()
    expect(result.ok).toBe(true)
    expect(result.liveDocs).toBe(1)
    expect(result.checks[0]?.path).toBe('/collections/pleasure')
    expect(captureException).not.toHaveBeenCalled()
  })

  it('fails when a live doc serves the fallback (no masthead marker) and files a ticket', async () => {
    sanityFetch.mockResolvedValue({ categories: ['pleasure'], drops: [] })
    serveHtml(`<html><body>${'x'.repeat(2000)}</body></html>`)
    const result = await runCategoryHealthcheck()
    expect(result.ok).toBe(false)
    expect(result.checks[0]?.problems.join(' ')).toContain('data-block="categoryMasthead"')
    expect(captureException).toHaveBeenCalledOnce()
    expect(fileDetectionTicket).toHaveBeenCalledOnce()
    expect(result.ticketsFiled).toEqual([42])
  }, 20_000)

  it('flags duplicate FAQPage JSON-LD nodes', async () => {
    sanityFetch.mockResolvedValue({ categories: ['pleasure'], drops: [] })
    const dupe = GOOD_CATEGORY_HTML.replace(
      '</body></html>',
      '<script type="application/ld+json">{"@type":"FAQPage"}</script></body></html>',
    )
    serveHtml(dupe)
    const result = await runCategoryHealthcheck()
    expect(result.ok).toBe(false)
    expect(result.checks[0]?.problems.join(' ')).toContain('FAQPage')
  }, 20_000)

  it('checks the drop surfaces at their real routes', async () => {
    sanityFetch.mockResolvedValue({ categories: [], drops: ['new', 'on-sale'] })
    serveHtml(`<html><body><section data-block="dropMasthead"></section>${'x'.repeat(2000)}</body></html>`)
    const result = await runCategoryHealthcheck()
    expect(result.ok).toBe(true)
    expect(result.checks.map((c) => c.path).sort()).toEqual(['/collections/on-sale', '/new'])
  })

  // A deck the renderer will actually place, carrying something to render.
  const LIVE_DECK = {
    panelDeck: { rows: [{ key: 'r1', kind: 'square', items: [{ key: 't1', label: 'Pleasure', href: '/collections/pleasure' }] }] },
    layout: { sections: [{ _type: 'panelDeckSection', _key: 'deck', enabled: true }] },
  }

  it('asserts the deck when the renderer will place it AND it has something to render', async () => {
    sanityFetch.mockResolvedValue({ categories: [], drops: [] })
    readPayload.mockResolvedValue(LIVE_DECK)
    serveHtml(`<html><body><a data-panel="tint/1/1/pleasure"></a>${'x'.repeat(2000)}</body></html>`)
    const result = await runCategoryHealthcheck()
    expect(result.checks.map((c) => c.surface)).toEqual(['deck'])
    expect(result.ok).toBe(true)
    expect(result.emptyDeckPublished).toBeUndefined()
  })

  it('skips the deck assertion while the marker is disabled (pre-flip)', async () => {
    sanityFetch.mockResolvedValue({ categories: [], drops: [] })
    readPayload.mockResolvedValue({
      panelDeck: { rows: [] },
      layout: { sections: [{ _type: 'panelDeckSection', _key: 'deck', enabled: false }] },
    })
    const result = await runCategoryHealthcheck()
    expect(result.checks).toEqual([])
    expect(result.ok).toBe(true)
    // An unplaced empty deck is unused content, not a defect.
    expect(result.emptyDeckPublished).toBeUndefined()
  })

  // ── #8414: the two ways a placed deck legally renders nothing ─────────────
  // Both used to produce a red sweep against a page behaving exactly as coded,
  // because this file read `layout.sections` with a predicate of its own rather
  // than asking the renderer.

  it('does not assert data-panel when the deck is placed but every row is empty', async () => {
    sanityFetch.mockResolvedValue({ categories: [], drops: [] })
    readPayload.mockResolvedValue({
      panelDeck: { rows: [{ key: 'r1', kind: 'square', items: [] }] },
      layout: { sections: [{ _type: 'panelDeckSection', _key: 'deck', enabled: true }] },
    })
    // PanelDeck returns null here, so the served page legitimately has no
    // data-panel. Asserting it would accuse the renderer of a content problem.
    serveHtml(`<html><body>no deck here${'x'.repeat(2000)}</body></html>`)
    const result = await runCategoryHealthcheck()
    expect(result.checks).toEqual([])
    expect(result.ok).toBe(true)
    // Skipped, but not silently: the reserved slot is rendering a hole.
    expect(result.emptyDeckPublished).toBe(true)
  })

  it('still asserts the deck when the layout places it with no usable band', async () => {
    // The regression itself. resolveBandOrder used to fall back to
    // DEFAULT_BAND_ORDER here and drop the deck slot, so the deck rendered
    // nowhere while this check demanded it be on screen. Now the resolver keeps
    // the placement, so the assertion is legitimate and a missing marker is a
    // real failure again.
    sanityFetch.mockResolvedValue({ categories: [], drops: [] })
    readPayload.mockResolvedValue(LIVE_DECK)
    serveHtml(`<html><body>fallback, no deck${'x'.repeat(2000)}</body></html>`)
    const result = await runCategoryHealthcheck()
    expect(result.ok).toBe(false)
    expect(result.checks.map((c) => c.surface)).toEqual(['deck'])
    expect(result.checks[0]?.problems.join(' ')).toContain('data-panel=')
  })

  it('gives a deck failure deck-shaped remediation, not the category-masthead advice', async () => {
    sanityFetch.mockResolvedValue({ categories: [], drops: [] })
    readPayload.mockResolvedValue(LIVE_DECK)
    serveHtml(`<html><body>fallback, no deck${'x'.repeat(2000)}</body></html>`)
    await runCategoryHealthcheck()
    const filed = fileDetectionTicket.mock.calls.at(-1)?.[0] as { suggestion: string }
    expect(filed.suggestion).toContain('homepage panel deck, not a category masthead')
    expect(filed.suggestion).toContain('warm-homepage-b')
    // The old text told the reader to unpublish the doc, which for the deck
    // deletes the navigation layer instead of rolling anything back.
    expect(filed.suggestion).not.toContain('Unpublishing the doc')
  })
})
