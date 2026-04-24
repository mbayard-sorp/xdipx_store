/**
 * Re-saves existing metafield values via Admin API so they associate with the
 * just-created metafield definitions. Without this, values written *before*
 * a definition existed remain ad-hoc and Storefront API returns null.
 *
 * Uses metafieldsSet (the same mutation pushProductToShopify uses), which
 * upserts by namespace+key and links to the matching definition automatically.
 *
 * Usage: bun run scripts/relink-metafields-to-defs.ts <numericProductId> [<id> …]
 *        bun run scripts/relink-metafields-to-defs.ts --all-test
 */
import 'dotenv/config'

const STORE = process.env['SHOPIFY_STORE_DOMAIN']
const TOKEN = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_TOKEN']
const VERSION = process.env['SHOPIFY_ADMIN_API_VERSION'] ?? '2024-10'
if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env')
  process.exit(1)
}

const KEYS_TO_RELINK = ['sensation_dial_v2', 'care_instructions', 'box_contents', 'specifications']
const TYPES: Record<string, string> = {
  sensation_dial_v2: 'json',
  care_instructions: 'json',
  box_contents:      'json',
  specifications:    'multi_line_text_field',
}

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.error('usage: bun run scripts/relink-metafields-to-defs.ts <numericProductId> [<id> …]')
  process.exit(1)
}

async function rest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`https://${STORE}/admin/api/${VERSION}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN! },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Shopify ${method} ${path} → ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${STORE}/admin/api/${VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN! },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${await res.text()}`)
  const body = await res.json() as { data: T; errors?: Array<{ message: string }> }
  if (body.errors?.length) throw new Error(`GraphQL errors: ${body.errors.map(e => e.message).join('; ')}`)
  return body.data
}

const SET_MUTATION = `
  mutation MfSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message }
    }
  }
`

for (const id of ids) {
  const { metafields } = await rest<{ metafields: { namespace: string; key: string; type: string; value: string }[] }>(
    `/products/${id}/metafields.json?namespace=xdipx&limit=250`,
  )
  const existing = new Map(metafields.map(m => [m.key, m]))
  const ownerId = `gid://shopify/Product/${id}`

  const payload: { ownerId: string; namespace: string; key: string; type: string; value: string }[] = []
  for (const key of KEYS_TO_RELINK) {
    const mf = existing.get(key)
    if (!mf) {
      console.log(`  ${id} ${key}: not present, skipping`)
      continue
    }
    payload.push({ ownerId, namespace: 'xdipx', key, type: TYPES[key]!, value: mf.value })
  }
  if (payload.length === 0) {
    console.log(`  ${id}: nothing to relink`)
    continue
  }

  const result = await gql<{ metafieldsSet: { metafields: { id: string; key: string }[]; userErrors: { field: string[]; message: string }[] } }>(
    SET_MUTATION,
    { metafields: payload },
  )
  if (result.metafieldsSet.userErrors.length > 0) {
    console.error(`  ${id} ✗`, result.metafieldsSet.userErrors)
  } else {
    console.log(`  ${id} ✓ relinked: ${result.metafieldsSet.metafields.map(m => m.key).join(', ')}`)
  }
}
process.exit(0)
