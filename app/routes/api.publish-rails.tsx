import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDealByShopifyId } from '~/lib/shopify.server'
import {
  publishEmmaRailDraft,
  patchEmmaRail,
  addRailRefToHomepage,
  addRailRefToProductPage,
  getRailDraftsForDeal,
} from '~/lib/sanity.server'

interface RailEdit {
  _id: string                             // draft id
  target: 'homepage' | 'pdp'
  heading?: string
  eyebrow?: string
  emmaAside?: string
  productHandles?: string[]
  layout?: 'carousel' | 'grid' | 'grid-3'
  bgStyle?: 'white' | 'cream' | 'mist' | 'charcoal' | 'purple'
  ctaLabel?: string
  ctaLink?: string
  order?: number
  skip?: boolean                          // admin opted not to publish this one
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let body: { dealId?: string; rails?: RailEdit[] } = {}
  try {
    body = (await request.json()) as { dealId?: string; rails?: RailEdit[] }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.dealId) return Response.json({ error: 'Missing dealId' }, { status: 400 })
  const rails = body.rails ?? []
  if (!rails.length) return Response.json({ error: 'No rails to publish' }, { status: 400 })

  const numericId = body.dealId.replace('gid://shopify/Product/', '')
  const deal = await getDealByShopifyId(numericId)
  if (!deal) return Response.json({ error: `Deal ${body.dealId} not found` }, { status: 404 })

  const published: { draftId: string; publishedId: string; target: 'homepage' | 'pdp' }[] = []
  const errors: { draftId: string; error: string }[] = []

  for (const rail of rails) {
    if (rail.skip) continue
    try {
      // Apply admin edits to the draft first so the published doc has them.
      // `target` is critical here — admins can flip a rail from pdp → homepage
      // (or vice versa) in the flyout. We must persist that change to the doc
      // BEFORE routing the ref, otherwise the doc says one thing and the ref
      // lives in the other surface (the bug we're fixing).
      const patch: Record<string, unknown> = {}
      if (rail.heading        !== undefined) patch.heading        = rail.heading
      if (rail.eyebrow        !== undefined) patch.eyebrow        = rail.eyebrow
      if (rail.emmaAside      !== undefined) patch.emmaAside      = rail.emmaAside
      if (rail.productHandles !== undefined) patch.productHandles = rail.productHandles
      if (rail.layout         !== undefined) patch.layout         = rail.layout
      if (rail.bgStyle        !== undefined) patch.bgStyle        = rail.bgStyle
      if (rail.ctaLabel       !== undefined) patch.ctaLabel       = rail.ctaLabel
      if (rail.ctaLink        !== undefined) patch.ctaLink        = rail.ctaLink
      if (rail.order          !== undefined) patch.order          = rail.order
      if (rail.target         !== undefined) patch.target         = rail.target

      if (Object.keys(patch).length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await patchEmmaRail(rail._id, patch as any)
      }

      const { _id: publishedId } = await publishEmmaRailDraft(rail._id)

      // Route the ref based on the rail's own (now-patched) target — single
      // source of truth, doc and ref can't drift.
      if (rail.target === 'homepage') {
        await addRailRefToHomepage(publishedId)
      } else {
        await addRailRefToProductPage(deal.handle, publishedId)
      }

      published.push({ draftId: rail._id, publishedId, target: rail.target })
    } catch (err) {
      console.error('[api.publish-rails] failed:', rail._id, err)
      errors.push({ draftId: rail._id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const drafts = await getRailDraftsForDeal(deal.id)
  return Response.json({ published, errors, drafts })
}
