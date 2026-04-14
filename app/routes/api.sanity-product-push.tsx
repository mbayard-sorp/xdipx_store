import type { ActionFunctionArgs } from 'react-router'
import { timingSafeEqual } from 'node:crypto'
import { pushProductToShopify } from '~/lib/shopify.server'
import type { ProductPageDoc } from '~/lib/shopify.server'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * POST /api/sanity-product-push
 *
 * Sanity webhook — called when a productPage document is published.
 * Pushes all editable fields back to Shopify (product fields + xdipx metafields).
 *
 * Register in Sanity at:
 *   sanity.io/manage → your project → API → Webhooks → Create webhook
 *   URL:    https://xdipx.com/api/sanity-product-push
 *   Filter: _type == "productPage"
 *   Trigger: on publish
 *   HTTP method: POST
 *   Secret header: x-sanity-webhook-secret: <SANITY_WEBHOOK_SECRET>
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const expected = process.env['SANITY_WEBHOOK_SECRET']
  const secret = request.headers.get('x-sanity-webhook-secret')
  if (!expected || !secret || !safeEqual(secret, expected)) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  if (body['_type'] !== 'productPage' || !body['shopifyProductId']) {
    return new Response('Not a productPage or missing shopifyProductId', { status: 200 })
  }

  const doc: ProductPageDoc = {
    shopifyProductId: body['shopifyProductId'] as string,
    title:            body['title']            as string | undefined,
    vendor:           body['vendor']           as string | undefined,
    tags:             body['tags']             as string[] | undefined,
    description:      body['description']      as string | undefined,
    seoTitle:         body['seoTitle']         as string | undefined,
    seoDescription:   body['seoDescription']   as string | undefined,
    tagline:          body['tagline']          as string | undefined,
    fullStory:        body['fullStory']        as string | undefined,
    worksForHim:      body['worksForHim']      as string | undefined,
    worksForHer:      body['worksForHer']      as string | undefined,
    featureBullets:   body['featureBullets']   as string[] | undefined,
    moodImageUrl:     body['moodImageUrl']     as string | undefined,
    category:         body['category']         as string | undefined,
    dealStatus:       body['dealStatus']       as string | undefined,
    dealDate:         body['dealDate']         as string | undefined,
    originalPrice:    body['originalPrice']    as number | undefined,
    wholesaleCost:    body['wholesaleCost']    as number | undefined,
    mapPrice:         body['mapPrice']         as number | undefined,
    nalpacSku:        body['nalpacSku']        as string | undefined,
  }

  try {
    await pushProductToShopify(doc)
    console.log(`[sanity-push] synced product ${doc.shopifyProductId} to Shopify`)
    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('[sanity-push] error:', err)
    return new Response('Sync failed', { status: 500 })
  }
}
