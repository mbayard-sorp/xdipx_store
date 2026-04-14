#!/usr/bin/env node
// Usage: node scripts/check-product-title.mjs <handle>
// Compares what Shopify Admin API (source of truth) vs Storefront API (what your site sees) return.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const handle = process.argv[2]
if (!handle) {
  console.error('Usage: node scripts/check-product-title.mjs <handle>')
  process.exit(1)
}

// Load .env
try {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {}

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN

if (!DOMAIN || !STOREFRONT_TOKEN) {
  console.error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_ACCESS_TOKEN in .env')
  process.exit(1)
}

async function storefront() {
  const res = await fetch(`https://${DOMAIN}/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
    },
    body: JSON.stringify({
      query: `query($h: String!) {
        product(handle: $h) {
          id
          title
          handle
          tags
          updatedAt
          tagline: metafield(namespace: "xdipx", key: "tagline") { value }
          dealStatus: metafield(namespace: "xdipx", key: "deal_status") { value }
        }
      }`,
      variables: { h: handle },
    }),
  })
  return res.json()
}

async function admin() {
  if (!ADMIN_TOKEN) return { skipped: 'No SHOPIFY_ADMIN_ACCESS_TOKEN in .env' }
  const res = await fetch(`https://${DOMAIN}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({
      query: `query($q: String!) {
        products(first: 1, query: $q) {
          edges { node {
            id
            title
            handle
            tags
            updatedAt
            tagline: metafield(namespace: "xdipx", key: "tagline") { value }
            dealStatus: metafield(namespace: "xdipx", key: "deal_status") { value }
          } }
        }
      }`,
      variables: { q: `handle:${handle}` },
    }),
  })
  return res.json()
}

const [sf, ad] = await Promise.all([storefront(), admin()])

console.log('\n=== Storefront API (what your site sees) ===')
console.log(JSON.stringify(sf?.data?.product ?? sf, null, 2))

console.log('\n=== Admin API (source of truth) ===')
const adminNode = ad?.data?.products?.edges?.[0]?.node
console.log(JSON.stringify(adminNode ?? ad, null, 2))

if (adminNode && sf?.data?.product) {
  const same = adminNode.title === sf.data.product.title
  console.log(`\n=== Verdict ===`)
  console.log(same
    ? 'Titles MATCH. If the site still shows old title, it is browser/edge cache or a metafield (e.g. tagline), not Shopify.'
    : `Titles DIFFER. Admin="${adminNode.title}" Storefront="${sf.data.product.title}". This is Shopify Storefront CDN lag (~60s) — wait and retry.`)
}
