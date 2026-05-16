import { getFeedDeals } from '~/lib/shopify.server'
import {
  gmcProductCategory,
  gmcGender,
  gmcCustomLabel0,
  gmcCustomLabel1,
  gmcCustomLabel2,
  gmcCustomLabel3,
  gmcCustomLabel4,
  parseSpecValue,
} from '~/lib/gmc-metafields.server'
import type { VaultDeal } from '~/types'

// Google Merchant Center restricts most sexual-wellness products -- do not submit
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

/** Returns an empty string when value is null/undefined/empty -- caller skips the tag. */
function opt(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/** Formats a price number as "X.XX USD". */
function fmtPrice(n: number): string {
  return `${n.toFixed(2)} USD`
}

/**
 * Human-readable product type for g:product_type.
 * Formats the product_type_dial value into a navigable path string.
 */
const DIAL_TO_PRODUCT_TYPE: Record<string, string> = {
  vibrator:     'Vibrators',
  dildo:        'Dildos',
  anal:         'Anal Toys',
  bondage:      'Bondage',
  'cock-ring':  'Cock Rings',
  stroker:      'Strokers',
  couples:      'Couples Toys',
  harness:      'Strap-On Harnesses',
  extender:     'Extenders',
  pump:         'Pumps',
  lube:         'Lubes & Oils',
  massage:      'Massage & Body Care',
  wellness:     'Wellness',
  condom:       'Condoms',
  wear:         'Lingerie & Apparel',
  enhancer:     'Enhancers',
  novelty:      'Novelty & Gifts',
  'sex-machine':'Sex Machines',
  'book-media': 'Books & Media',
}

/**
 * Formats a deal_date ISO string into a GMC sale_price_effective_date range.
 * The deal runs from midnight on deal_date through end-of-day the next day (PT).
 * Format: 2026-05-16T00:00-07:00/2026-05-17T23:59-07:00
 */
function salePriceEffectiveDate(dealDate: string): string | null {
  if (!dealDate) return null
  // Accept ISO date strings like "2026-05-16" or "2026-05-16T..."
  const dateOnly = dealDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null
  const [year, month, day] = dateOnly.split('-').map(Number)
  if (!year || !month || !day) return null

  // next day
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  const ny = next.getUTCFullYear()
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0')
  const nd = String(next.getUTCDate()).padStart(2, '0')

  return `${dateOnly}T00:00-07:00/${ny}-${nm}-${nd}T23:59-07:00`
}

function toEntry(d: VaultDeal): string {
  const link          = `https://xdipx.com/products/${d.handle}`
  const title         = xmlEscape(d.seoTitle)
  const brand         = xmlEscape(d.brand || 'xdipx')
  const availability  = d.qty > 0 ? 'in stock' : 'out of stock'
  const price         = fmtPrice(d.dealPrice)

  // Description: prefer seo_meta_description, fall back to template
  const rawDesc = opt(d.seoDesc)
  const description = xmlEscape(
    rawDesc ||
    `${d.seoTitle} curated by xdipx. Adult wellness product, shipped discreetly.`
  )

  // Images
  const primaryImage   = d.images[0]?.url ?? ''
  const additionalImgs = d.images.slice(1).map(img => img.url)
  const lifestyleImage = opt(d.moodImageUrl)

  // GMC category -- prefer metafield, fall back to derived
  const googleProductCategory = opt(d.gmcCategory) || gmcProductCategory(opt(d.productTypeDial) || null)

  // Product type path
  const dialVal = opt(d.gmcLabel0) || opt(d.productTypeDial)
  const productType = dialVal ? (DIAL_TO_PRODUCT_TYPE[dialVal] ?? xmlEscape(dialVal)) : ''

  // Identifiers
  const gtinRaw = opt(d.barcode)
  const mpnRaw  = opt(d.gmcMpn)

  // GMC sale_price semantics: g:price = original/regular price (strikethrough),
  // g:sale_price = current deal price. Only emit sale_price when we have a
  // confirmed originalPrice metafield so the values are never inverted.
  // Products without originalPrice metafield show only g:price at dealPrice.
  let salePriceTag = ''
  const msrp = d.msrp
  const originalPriceNum = d.originalPrice ? parseFloat(d.originalPrice) : msrp
  if (
    Number.isFinite(originalPriceNum) &&
    originalPriceNum > 0 &&
    d.dealPrice < originalPriceNum
  ) {
    salePriceTag = `\n      <g:sale_price>${fmtPrice(d.dealPrice)}</g:sale_price>`
    const effDate = salePriceEffectiveDate(d.dealDate)
    if (effDate) {
      salePriceTag += `\n      <g:sale_price_effective_date>${effDate}</g:sale_price_effective_date>`
    }
  }

  // GMC attribute fields -- only emit when present
  const ageGroup = opt(d.gmcAgeGroup) || 'adult'
  const condition = 'new'

  // Gender -- prefer metafield, fall back to derived
  const genderVal = opt(d.gmcGender) || gmcGender(d.audienceTags ?? [])

  // Custom labels -- prefer metafields, fall back to derived
  const label0 = opt(d.gmcLabel0) || gmcCustomLabel0(opt(d.productTypeDial) || null)
  const label1 = opt(d.gmcLabel1) || gmcCustomLabel1(d.audienceTags ?? [])
  const label2 = opt(d.gmcLabel2) || gmcCustomLabel2(d.dealScore ?? null)
  const label3 = opt(d.gmcLabel3) || gmcCustomLabel3(d.isDailyDeal ?? false)
  const label4 = opt(d.gmcLabel4) || gmcCustomLabel4(d.dealPrice)

  const colorVal    = opt(d.gmcColor)    || parseSpecValue(d.specifications ?? [], 'color')    || ''
  const materialVal = opt(d.gmcMaterial) || parseSpecValue(d.specifications ?? [], 'material') || ''
  const sizeVal     = opt(d.gmcSize)     || parseSpecValue(d.specifications ?? [], 'size')     || ''

  // Feature bullets (max 10)
  const bullets = (d.featureBullets ?? []).slice(0, 10)

  // Specifications -> product_detail
  const specs = d.specifications ?? []

  // Build the item XML
  const lines: string[] = []
  lines.push(`    <item>`)
  lines.push(`      <g:id>${xmlEscape(d.id)}</g:id>`)
  lines.push(`      <g:title>${title}</g:title>`)
  lines.push(`      <g:description>${description}</g:description>`)
  lines.push(`      <g:link>${xmlEscape(link)}</g:link>`)
  lines.push(`      <g:canonical_link>${xmlEscape(link)}</g:canonical_link>`)
  if (primaryImage) {
    lines.push(`      <g:image_link>${xmlEscape(primaryImage)}</g:image_link>`)
  }
  for (const imgUrl of additionalImgs) {
    lines.push(`      <g:additional_image_link>${xmlEscape(imgUrl)}</g:additional_image_link>`)
  }
  if (lifestyleImage) {
    lines.push(`      <g:lifestyle_image_link>${xmlEscape(lifestyleImage)}</g:lifestyle_image_link>`)
  }
  lines.push(`      <g:availability>${availability}</g:availability>`)
  // For sale products: price is the regular/original price, sale_price is the deal price
  if (salePriceTag) {
    lines.push(`      <g:price>${fmtPrice(originalPriceNum)}</g:price>${salePriceTag}`)
  } else {
    lines.push(`      <g:price>${price}</g:price>`)
  }
  lines.push(`      <g:brand>${brand}</g:brand>`)
  lines.push(`      <g:condition>${condition}</g:condition>`)
  lines.push(`      <g:adult>yes</g:adult>`)
  lines.push(`      <g:age_group>${xmlEscape(ageGroup)}</g:age_group>`)
  lines.push(`      <g:gender>${xmlEscape(genderVal)}</g:gender>`)
  lines.push(`      <g:google_product_category>${xmlEscape(googleProductCategory)}</g:google_product_category>`)
  if (productType) {
    lines.push(`      <g:product_type>${xmlEscape(productType)}</g:product_type>`)
  }
  // item_group_id: use handle as the group key (all variants of a product share it)
  lines.push(`      <g:item_group_id>${xmlEscape(d.handle)}</g:item_group_id>`)
  if (gtinRaw) {
    lines.push(`      <g:gtin>${xmlEscape(gtinRaw)}</g:gtin>`)
    lines.push(`      <g:identifier_exists>true</g:identifier_exists>`)
  } else {
    lines.push(`      <g:identifier_exists>false</g:identifier_exists>`)
  }
  if (mpnRaw) {
    lines.push(`      <g:mpn>${xmlEscape(mpnRaw)}</g:mpn>`)
  }
  if (colorVal)    lines.push(`      <g:color>${xmlEscape(colorVal)}</g:color>`)
  if (materialVal) lines.push(`      <g:material>${xmlEscape(materialVal)}</g:material>`)
  if (sizeVal)     lines.push(`      <g:size>${xmlEscape(sizeVal)}</g:size>`)
  if (label0) lines.push(`      <g:custom_label_0>${xmlEscape(label0)}</g:custom_label_0>`)
  if (label1) lines.push(`      <g:custom_label_1>${xmlEscape(label1)}</g:custom_label_1>`)
  if (label2) lines.push(`      <g:custom_label_2>${xmlEscape(label2)}</g:custom_label_2>`)
  if (label3) lines.push(`      <g:custom_label_3>${xmlEscape(label3)}</g:custom_label_3>`)
  if (label4) lines.push(`      <g:custom_label_4>${xmlEscape(label4)}</g:custom_label_4>`)
  for (const bullet of bullets) {
    if (bullet.trim()) {
      lines.push(`      <g:product_highlight>${xmlEscape(bullet.trim())}</g:product_highlight>`)
    }
  }
  for (const spec of specs) {
    const colonIdx = spec.indexOf(':')
    if (colonIdx === -1) continue
    const attrName  = spec.slice(0, colonIdx).trim()
    const attrValue = spec.slice(colonIdx + 1).trim()
    if (!attrName || !attrValue) continue
    lines.push(
      `      <g:product_detail>` +
      `<g:section_name>Specs</g:section_name>` +
      `<g:attribute_name>${xmlEscape(attrName)}</g:attribute_name>` +
      `<g:attribute_value>${xmlEscape(attrValue)}</g:attribute_value>` +
      `</g:product_detail>`
    )
  }
  lines.push(`      <g:shipping><g:country>US</g:country><g:service>Standard</g:service><g:price>0.00 USD</g:price></g:shipping>`)
  lines.push(`      <g:min_handling_time>1</g:min_handling_time>`)
  lines.push(`      <g:max_handling_time>3</g:max_handling_time>`)
  lines.push(`    </item>`)

  return lines.join('\n')
}

export async function loader() {
  const pageSize = 50
  const maxPages = 10
  const all: VaultDeal[] = []
  let page = 1
  let hasNext = true
  while (hasNext && page <= maxPages) {
    const { deals, hasNextPage } = await getFeedDeals(page, pageSize)
    all.push(...deals)
    hasNext = hasNextPage
    page += 1
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>xdipx -- Daily Wellness Deals</title>
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
