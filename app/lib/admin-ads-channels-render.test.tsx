/**
 * Ticket #16438: what /admin/ads/channels renders. Server-rendered HTML from
 * real loadChannels output, so the test pins that prohibited channels never
 * get an enable control and that the table follows the admin mobile recipe
 * (ResponsiveTable wrapper plus a min-w floor, so the page body never
 * scrolls sideways at 375px).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoutesStub } from 'react-router'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import AdsChannels from '~/routes/admin.ads.channels'
import { CHECKLIST_ITEMS, PROHIBITED_REASON, loadChannels } from '~/lib/ads/channels-page.server'
import { listChannels } from '~/lib/ads/channels/registry.server'

async function render(): Promise<string> {
  const page = await loadChannels({
    channels: listChannels,
    health: async () => [],
    lastEntitySync: async () => [],
    lastInsightsPull: async () => [],
    checklist: async () => [
      { channel: 'meta', item: 'spend_cap', checkedAt: '2026-10-19T00:00:00.000Z', checkedBy: 'admin:mike@xdipx.com', evidence: '$20 a day' },
    ],
  })
  const loaderData = { page, now: '2026-10-19T15:00:00.000Z' }
  const Stub = createRoutesStub([{ id: 'channels', path: '/', Component: AdsChannels, loader: () => loaderData }])
  return renderToStaticMarkup(<Stub hydrationData={{ loaderData: { channels: loaderData } }} />)
}

describe('admin.ads.channels render', () => {
  it('gives each allowed or restricted channel nine checkboxes and prohibited channels none', async () => {
    const html = await render()
    const enableable = listChannels().filter(c => c.policyState !== 'prohibited').length
    const boxes = html.match(/type="checkbox"/g) ?? []
    expect(boxes.length).toBe(enableable * CHECKLIST_ITEMS.length)
    for (const id of ['tiktok', 'x', 'reddit', 'pinterest']) {
      expect(html).not.toContain(`name="channel" value="${id}"`)
    }
    expect(html.split(PROHIBITED_REASON).length - 1).toBe(4 * 2) // mutate cell and the prohibited list
  })

  it('wraps the table for horizontal scroll with a min-width floor', async () => {
    const html = await render()
    expect(html).toContain('overflow-x-auto')
    expect(html).toMatch(/<table class="[^"]*min-w-\[980px\]/)
  })

  it('shows saved evidence and the checked count', async () => {
    const html = await render()
    expect(html).toContain('value="$20 a day"')
    expect(html.replace(/<!-- -->/g, '')).toContain('1 of 9 checked')
  })

  it('writes no em-dashes', async () => {
    expect(await render()).not.toMatch(/\u2014/)
  })
})
