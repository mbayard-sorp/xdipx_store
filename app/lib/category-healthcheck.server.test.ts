import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
const sanityFetch = vi.fn()
const kvSet = vi.fn()
const readPayload = vi.fn()
const fileDetectionTicket = vi.fn(async () => 42)
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

  it('asserts the deck only when the payload carries one AND the layout places it enabled', async () => {
    sanityFetch.mockResolvedValue({ categories: [], drops: [] })
    readPayload.mockResolvedValue({
      panelDeck: { rows: [] },
      layout: { sections: [{ _type: 'panelDeckSection', _key: 'deck', enabled: true }] },
    })
    serveHtml(`<html><body><a data-panel="tint/1/1/pleasure"></a>${'x'.repeat(2000)}</body></html>`)
    const result = await runCategoryHealthcheck()
    expect(result.checks.map((c) => c.surface)).toEqual(['deck'])
    expect(result.ok).toBe(true)
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
  })
})
