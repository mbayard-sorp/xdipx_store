import { getVaultDeals } from '~/lib/shopify.server'
import type { VaultDeal } from '~/types'

// Google Merchant Center restricts most sexual-wellness products — do not submit
// this feed to Google Merchant without reviewing their adult-content policy.
// The feed is still consumed by non-Google shopping agents and general retrieval crawlers.

function xmlEscape(s: string): string {
  return s
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g, '&apos;')
}

function toEntry(d: VaultDeal): string {
  const link        = `https://xdipx.com/products/${d.handle}`
  const image       = d.images[0]?.url ?? ''
  const title       = xmlEscape(d.seoTitle)
  const brand       = xmlEscape(d.brand || 'xdipx')
  const description = xmlEscape(
    `${d.seoTitle} — curated by xdipx. Adult wellness product, shipped discreetly. Featured deal date ${d.dealDate}.`
  )
  const availability = d.qty > 0 ? 'in stock' : 'out of stock'
  const price        = `${d.dealPrice.toFixed(2)} USD`

  return `    <item>
      <g:id>${xmlEscape(d.id)}</g:id>
      <g:title>${title}</g:title>
      <g:description>${description}</g:description>
      <g:link>${xmlEscape(link)}</g:link>
      <g:image_link>${xmlEscape(image)}</g:image_link>
      <g:availability>${availability}</g:availability>
      <g:price>${price}</g:price>
      <g:brand>${brand}</g:brand>
      <g:condition>new</g:condition>
      <g:adult>yes</g:adult>
      <g:identifier_exists>false</g:identifier_exists>
      <g:google_product_category>469</g:google_product_category>
    </item>`
}

export async function loader() {
  const pageSize = 50
  const maxPages = 10
  const all: VaultDeal[] = []
  let page = 1
  let hasNext = true
  while (hasNext && page <= maxPages) {
    const { deals, hasNextPage } = await getVaultDeals(page, pageSize)
    all.push(...deals)
    hasNext = hasNextPage
    page += 1
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>xdipx — Daily Wellness Deals</title>
    <link>https://xdipx.com</link>
    <description>Curated adult wellness and intimacy products, one featured daily deal.</description>
${all.map(toEntry).join('\n')}
  </channel>
</rss>`

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
    },
  })
}
