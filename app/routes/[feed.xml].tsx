import { getFeedDeals, getFeedCatalogProducts, type FeedCatalogProduct } from '~/lib/shopify.server'
import {
  gmcProductCategory,
  gmcGender,
  gmcCustomLabel0,
  gmcCustomLabel1,
  gmcCustomLabel2,
  gmcCustomLabel4,
  mapAllowsAdvertisedDiscount,
  parseSpecValue,
} from '~/lib/gmc-metafields.server'
import { cached } from '~/lib/kv.server'
import { feedShippingLines, stripDollarAmounts } from '~/lib/gmc-feed'
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

function toEntry(d: VaultDeal): string {
  const link          = `https://xdipx.com/products/${d.handle}`
  const title         = xmlEscape(d.seoTitle)
  const brand         = xmlEscape(d.brand || 'xdipx')
  const availability  = d.qty > 0 ? 'in stock' : 'out of stock'
  const price         = fmtPrice(d.dealPrice)

  // Description: prefer seo_meta_description, fall back to template.
  // stripDollarAmounts: generated descriptions must never carry a literal
  // price -- the pricing agent moves prices daily and a stale "$29.99"
  // reads as misrepresentation in Merchant Center (ticket #3425).
  const rawDesc = stripDollarAmounts(opt(d.seoDesc))
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
  // MAP-gated: when MAP equals the regular price (or map_restricted is set),
  // no advertised discount -- the item carries a single g:price at dealPrice.
  let salePriceTag = ''
  const msrp = d.msrp
  const originalPriceNum = d.originalPrice ? parseFloat(d.originalPrice) : msrp
  if (
    Number.isFinite(originalPriceNum) &&
    originalPriceNum > 0 &&
    d.dealPrice < originalPriceNum &&
    mapAllowsAdvertisedDiscount(d.mapPrice, d.mapRestricted ?? false, originalPriceNum)
  ) {
    // No <g:sale_price_effective_date>: it was derived from the xdipx.deal_date
    // metafield, a daily-deal scheduling slot that is retired. A sale_price with
    // no date range means "active now", which matches what checkout charges.
    salePriceTag = `\n      <g:sale_price>${fmtPrice(d.dealPrice)}</g:sale_price>`
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
  const label3 = opt(d.gmcLabel3)
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
  // Shipping mirrors checkout for a single-unit cart at the deal price:
  // $9.99 US Standard, free when the item alone clears the threshold
  // (HI/AK/PR clear at their higher threshold). See app/lib/gmc-feed.ts.
  lines.push(...feedShippingLines(d.dealPrice))
  lines.push(`      <g:min_handling_time>1</g:min_handling_time>`)
  lines.push(`      <g:max_handling_time>3</g:max_handling_time>`)
  lines.push(`    </item>`)

  return lines.join('\n')
}

/**
 * Lean catalog entry -- required Merchant fields plus category/identifiers,
 * without the heavy per-item extras (highlights, specs, custom labels) so the
 * ~4k-product catalog stays a reasonable response size. Deal-tagged products
 * get the rich toEntry() treatment instead.
 */
function toLeanEntry(p: FeedCatalogProduct): string {
  const link  = `https://xdipx.com/products/${p.handle}`
  const title = xmlEscape(p.title)
  const brand = xmlEscape(p.brand || 'xdipx')
  const description = xmlEscape(
    stripDollarAmounts(opt(p.description)) ||
    `${p.title} curated by xdipx. Adult wellness product, shipped discreetly.`
  )

  // Regular price for strikethrough framing: confirmed original_price
  // metafield first, else the variant compareAtPrice.
  const regular = p.originalPrice ?? p.compareAtPrice ?? 0
  const onSale =
    regular > 0 &&
    p.price < regular &&
    mapAllowsAdvertisedDiscount(p.mapPrice, p.mapRestricted, regular)

  const gtin = opt(p.barcode)
  const googleProductCategory = opt(p.gmcCategory) || gmcProductCategory(opt(p.productTypeDial) || null)
  const productType = p.productTypeDial ? (DIAL_TO_PRODUCT_TYPE[p.productTypeDial] ?? xmlEscape(p.productTypeDial)) : ''

  const lines: string[] = []
  lines.push(`    <item>`)
  lines.push(`      <g:id>${xmlEscape(p.id)}</g:id>`)
  lines.push(`      <g:title>${title}</g:title>`)
  lines.push(`      <g:description>${description}</g:description>`)
  lines.push(`      <g:link>${xmlEscape(link)}</g:link>`)
  if (p.imageUrl) {
    lines.push(`      <g:image_link>${xmlEscape(p.imageUrl)}</g:image_link>`)
  }
  lines.push(`      <g:availability>${p.availableForSale ? 'in stock' : 'out of stock'}</g:availability>`)
  if (onSale) {
    lines.push(`      <g:price>${fmtPrice(regular)}</g:price>`)
    // No effective-date range: catalog markdowns are open-ended, and GMC
    // treats a dateless sale_price as active now, which matches checkout.
    lines.push(`      <g:sale_price>${fmtPrice(p.price)}</g:sale_price>`)
  } else {
    lines.push(`      <g:price>${fmtPrice(p.price)}</g:price>`)
  }
  lines.push(`      <g:brand>${brand}</g:brand>`)
  lines.push(`      <g:condition>new</g:condition>`)
  lines.push(`      <g:adult>yes</g:adult>`)
  lines.push(`      <g:age_group>adult</g:age_group>`)
  lines.push(`      <g:google_product_category>${xmlEscape(googleProductCategory)}</g:google_product_category>`)
  if (productType) {
    lines.push(`      <g:product_type>${xmlEscape(productType)}</g:product_type>`)
  }
  lines.push(`      <g:item_group_id>${xmlEscape(p.handle)}</g:item_group_id>`)
  if (gtin) {
    lines.push(`      <g:gtin>${xmlEscape(gtin)}</g:gtin>`)
    lines.push(`      <g:identifier_exists>true</g:identifier_exists>`)
  } else {
    lines.push(`      <g:identifier_exists>false</g:identifier_exists>`)
  }
  // Shipping on every item (ticket #3425): a missing block defaults to the
  // Merchant Center account setting, and an absent-or-0.00 feed while
  // checkout charges $9.99 is a misrepresentation suspension risk. The
  // ~0.5MB it adds across ~4k items is the cost of an honest feed.
  lines.push(...feedShippingLines(p.price))
  lines.push(`    </item>`)

  return lines.join('\n')
}

async function buildFeedXml(): Promise<string> {
  // Rich entries: deal-tagged products (live deal + archived vault), full GMC
  // treatment. Cursor-paginated; cap well above the current vault size.
  const dealProducts: VaultDeal[] = []
  let after: string | null = null
  for (let page = 0; page < 10; page++) {
    const { deals, hasNextPage, endCursor } = await getFeedDeals(after, 50)
    dealProducts.push(...deals)
    if (!hasNextPage || !endCursor) break
    after = endCursor
  }

  // Lean entries: every live, purchasable product not already emitted above.
  const dealIds = new Set(dealProducts.map(d => d.id))
  const catalog = (await getFeedCatalogProducts()).filter(
    p => !dealIds.has(p.id) && p.price > 0,
  )

  const items = [
    ...dealProducts.map(toEntry),
    ...catalog.map(toLeanEntry),
  ].join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>xdipx -- Product Feed</title>
    <link>https://xdipx.com</link>
    <description>Curated adult wellness and intimacy products. Full live catalog plus the current featured deal.</description>
${items}
  </channel>
</rss>`
}

export async function loader() {
  // The XML is a plain string, safe to round-trip through cached()'s KV JSON
  // layer (no Map/Set/Date). If the payload ever exceeds the KV value limit,
  // kvSet degrades to the in-memory L1 with a warn, so the route still serves;
  // the CDN s-maxage below absorbs most traffic either way.
  // v2: real shipping blocks + price-free descriptions (ticket #3425); the
  // key bump serves the new shape immediately instead of after KV TTL.
  const body = await cached('feed:xml:v2', 900, buildFeedXml)

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
    },
  })
}
