import type { ActionFunctionArgs } from 'react-router'
import { generateRails, type GenerateRailsResult } from '~/lib/claude.server'
import { requireAdmin } from '~/lib/session.server'
import { getDealByShopifyId, getDealByHandle, getAccessoryProducts, setPairingWhy } from '~/lib/shopify.server'
import { createEmmaRailDraft, getRailDraftsForDeal } from '~/lib/sanity.server'

// API-only — no default export. POST { dealId } → generates rails as Sanity drafts
// + writes pairing_why metafield, returns drafts for the admin flyout.
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let body: { dealId?: string } = {}
  try {
    body = (await request.json()) as { dealId?: string }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.dealId) return Response.json({ error: 'Missing dealId' }, { status: 400 })

  const numericId = body.dealId.replace('gid://shopify/Product/', '')
  const deal = await getDealByShopifyId(numericId)
  if (!deal) return Response.json({ error: `Deal ${body.dealId} not found` }, { status: 404 })

  const partner = deal.pairBundleCopy?.pairedHandle
    ? await getDealByHandle(deal.pairBundleCopy.pairedHandle)
    : null

  const accessories = deal.accessoryProductIds?.length
    ? (await getAccessoryProducts(deal.accessoryProductIds)).map(p => ({
        id: p.id,
        title: p.title,
        ...(p.brand !== undefined ? { brand: p.brand } : {}),
      }))
    : []

  let result: GenerateRailsResult
  try {
    result = await generateRails({
      deal,
      ...(partner ? { partner } : {}),
      accessories,
    })
  } catch (err) {
    console.error('[api.generate-rails] generation failed:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Generation failed' }, { status: 500 })
  }

  // Persist rails as Sanity drafts
  const persisted: { _id: string; target: 'homepage' | 'pdp'; heading: string }[] = []
  for (const rail of result.rails) {
    try {
      const draft = await createEmmaRailDraft({
        heading: rail.heading,
        ...(rail.eyebrow   ? { eyebrow: rail.eyebrow } : {}),
        ...(rail.emmaAside ? { emmaAside: rail.emmaAside } : {}),
        productHandles: rail.productHandles,
        ...(rail.layout   ? { layout: rail.layout } : {}),
        ...(rail.bgStyle  ? { bgStyle: rail.bgStyle } : {}),
        ...(rail.ctaLabel ? { ctaLabel: rail.ctaLabel } : {}),
        ...(rail.ctaLink  ? { ctaLink: rail.ctaLink } : {}),
        target: rail.target,
        rationale: rail.rationale,
        sourceDealId: deal.id,
      })
      persisted.push({ _id: draft._id, target: rail.target, heading: rail.heading })
    } catch (err) {
      console.error('[api.generate-rails] failed to persist rail:', rail.heading, err)
    }
  }

  // Persist pairing_why blurbs (merge into existing metafield)
  if (result.pairingWhy.length) {
    const blurbs: Record<string, string> = {}
    for (const p of result.pairingWhy) blurbs[p.accessoryProductId] = p.blurb
    try {
      await setPairingWhy(deal.id, blurbs, { merge: true })
    } catch (err) {
      console.error('[api.generate-rails] failed to write pairing_why:', err)
    }
  }

  // Return all drafts for this deal so the flyout has the full editable list
  const drafts = await getRailDraftsForDeal(deal.id)

  return Response.json({
    persisted,
    drafts,
    pairingWhy: result.pairingWhy,
    candidatePoolSize: result.candidatePoolSize,
    turns: result.turns,
  })
}
