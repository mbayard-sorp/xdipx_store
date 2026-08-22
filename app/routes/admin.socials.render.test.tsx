/**
 * Render contract for /admin/socials (Social Studio). The live preview cannot
 * run until migration 083 exists in the database, so this test renders the
 * route component against a fixed loader payload through React Router's
 * static data router and asserts the workspace shape the owner asked for:
 * a queue row, a detail pane with the caption and alt text, the parsed gate
 * verdict, and the immediate-response actions (New image, Rework now,
 * Approve and run hard checks).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/session.server', () => ({ requireAdmin: async () => {}, getAdminUser: async () => ({ id: 1, name: 'mike', email: 'x', role: 'owner' }) }))
vi.mock('~/lib/twitter.server', () => ({ postManualTweet: vi.fn(), deleteAndLogTweet: vi.fn(), retryFailedPost: vi.fn(), postApprovedDraft: vi.fn() }))
vi.mock('~/lib/team.server', () => ({ getSocialFrequencies: vi.fn(), reviewSocialPost: vi.fn(), rescheduleSocialPost: vi.fn(), recordLivePostFeedback: vi.fn(), getValve: vi.fn(), VALVE_KEYS: {} }))
vi.mock('~/lib/pricing-webhook.server', () => ({ setPipelineSetting: vi.fn() }))
vi.mock('~/lib/social-publish/manual-publish-gate.server', () => ({ decideManualPublish: vi.fn() }))
vi.mock('~/lib/social-publish/stock-guard.server', () => ({ checkLinkedProductStock: vi.fn() }))
vi.mock('~/lib/social-publish-approve.server', () => ({ parseGateStamp: () => null }))
vi.mock('~/lib/social-admin-rework.server', () => ({ regenerateSocialImage: vi.fn(), reworkCaption: vi.fn(), createOwnerReworkRow: vi.fn(), ownerApprovePost: vi.fn() }))

import AdminSocialsPage from './admin.socials'

const row80 = {
  id: 80, platform: 'instagram', postType: 'manual', status: 'posted', reviewStatus: 'approved',
  tweetText: 'nobody hands you a care guide with your first vibrator, so here is the whole thing.\n\n#sexualwellness #toycare',
  editedText: null, feedback: '[publish-gate PASS by social-publish-gate on 2026-08-22, product: none]\nPASS. Viewed the image.',
  mediaUrls: ['https://cdn.shopify.com/s/files/1/0761/6872/4651/files/social-vibrator-field-guide-care-scene-20260822.jpg'],
  altText: 'Jade at a sunny bathroom sink rinsing her hands.', subject: 'toy care', imageBrief: 'cast member with the toy and the cleaner',
  createdAt: '2026-08-22T14:36:48Z', postedAt: '2026-08-22T20:00:00Z', createdBy: 'social-media-manager',
  scheduledFor: null, reworkedFrom: null, externalPostId: '17900000000000000', shopifyProductId: null, metricsJson: { likes: 12, saves: 4 },
}
const row81 = { ...row80, id: 81, status: 'draft', reviewStatus: 'pending_review', postedAt: null, externalPostId: null, feedback: null, tweetText: 'the door is staying closed for a while today.' }

const loaderData = {
  view: 'queue', platform: 'all', statusFilter: 'all', page: 1, pageSize: 50, totalForView: 2,
  posts: [row81, row80], selectedPost: row80, lineageParent: null, lineageChildren: [row81],
  stockByProduct: {}, counts: { needsReview: 1, approvedNoDate: 0, scheduledDated: 0, posted7d: 1 },
  frequencies: { instagram: 3, x: 1 }, igAutopublish: true, xAutopublish: false,
}

async function render(url: string) {
  const routes = [{ id: 'admin-socials', path: '/admin/socials', Component: AdminSocialsPage, loader: ({ request }: { request: Request }) => {
    const id = new URL(request.url).searchParams.get('post')
    const selectedPost = id === '81' ? row81 : row80
    return { ...loaderData, selectedPost }
  } }]
  const handler = createStaticHandler(routes)
  const context = await handler.query(new Request(`http://localhost${url}`))
  if (context instanceof Response) throw new Error('unexpected response')
  const router = createStaticRouter(handler.dataRoutes, context)
  return renderToString(<StaticRouterProvider router={router} context={context} />)
}

describe('/admin/socials render contract', () => {
  it('renders the workspace: queue row, detail pane, gate verdict, alt text, immediate-response actions', async () => {
    const html = await render('/admin/socials?view=queue&post=80')
    expect(html).toContain('the door is staying closed')
    expect(html).toContain('nobody hands you a care guide')
    expect(html).toContain('Jade at a sunny bathroom sink')
    expect(html).toMatch(/PASS/)
    expect(html).toMatch(/New image/i)
    expect(html).toMatch(/Rework now/i)
    expect(html).not.toMatch(/hard checks/i) // owner-approve is for drafts only
    expect(html).toMatch(/instagram\.com/)
    expect(html).not.toContain('—')
  })

  it('offers owner approval with hard checks on a draft', async () => {
    const html = await render('/admin/socials?view=queue&post=81')
    expect(html).toMatch(/hard checks/i)
  })
})
