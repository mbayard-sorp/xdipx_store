/**
 * Creates/updates xdipx metafield definitions on Shopify Product objects
 * for the v2 (Emma) redesign.
 *
 * Idempotent: skips definitions that already exist (matched by namespace + key).
 *
 * Usage:
 *   npx tsx scripts/shopify-metafield-defs.ts
 *
 * Environment (reads from .env):
 *   SHOPIFY_STORE_DOMAIN  — e.g. xdipx.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN   — private-app Admin API token (shpat_...)
 *   SHOPIFY_ADMIN_API_VERSION (optional, default: 2025-01)
 */
import 'dotenv/config'

type MetafieldDef = {
  key:         string
  name:        string
  description: string
  type:        string
  validations?: Array<{ name: string; value: string }>
}

const DEFS: MetafieldDef[] = [
  // Phase 1 — Emma hero
  {
    key:         'map_restricted',
    name:        'MAP restricted',
    description: 'When true, UI must not advertise a discount or struck price.',
    type:        'boolean',
  },
  // Phase 6 — video thumbnails
  {
    key:         'hero_video',
    name:        'Hero video',
    description: 'JSON { src, poster, duration } for 9:16 hero video on cards + PDP gallery.',
    type:        'json',
  },
  // Phase 3 — Ask Emma taxonomy
  {
    key:         'mood_tags',
    name:        'Mood tags',
    description: 'Editorial mood taxonomy (e.g. slow-and-intimate, playful, adventurous).',
    type:        'list.single_line_text_field',
  },
  {
    key:         'audience_tags',
    name:        'Audience tags',
    description: 'Who it\'s for (me, us, gift).',
    type:        'list.single_line_text_field',
  },
  {
    key:         'matters_tags',
    name:        'What-matters tags',
    description: 'Surface-level concerns (quiet, soft-touch, travel-size, first-time, waterproof, rechargeable, hands-free, etc).',
    type:        'list.single_line_text_field',
  },
  // Phase 2 — sensation dial + voting
  {
    key:         'product_type_dial',
    name:        'Product type (for dial)',
    description: 'One of: air-pulsation | vibrator | wand | lube | wear. Drives which sensation dial dimensions render.',
    type:        'single_line_text_field',
  },
  {
    key:         'sensation_dial',
    name:        'Sensation dial values',
    description: 'JSON object with per-dimension integer ratings 1-5 (e.g. { intensity: 4, quietness: 3 }). Dimensions depend on product_type_dial.',
    type:        'json',
  },
  // Phase 2 — pairs-with copy
  {
    key:         'pairing_why',
    name:        'Pairing why (Emma copy)',
    description: 'JSON { [accessoryProductId]: "Emma voice explanation" } — copy for the Pairs-with card on PDP.',
    type:        'json',
  },
  // Emma hero — Claude-generated on deal promotion
  {
    key:         'emma_hero',
    name:        'Emma hero copy',
    description: 'JSON { variant, eyebrow, headline, body, aside, pullQuote?, generatedAt, voiceHash } — generated from pipelineSettings.brandVoice on deal activation.',
    type:        'json',
  },
]

const STORE = process.env['SHOPIFY_STORE_DOMAIN']
const TOKEN = process.env['SHOPIFY_ADMIN_TOKEN']
const VERSION = process.env['SHOPIFY_ADMIN_API_VERSION'] ?? '2025-01'

if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN must be set in .env')
  process.exit(1)
}

const ENDPOINT = `https://${STORE}/admin/api/${VERSION}/graphql.json`

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type':           'application/json',
      'X-Shopify-Access-Token': TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new Error(`Shopify ${res.status}: ${await res.text()}`)
  }
  const body = await res.json() as { data: T; errors?: Array<{ message: string }> }
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${body.errors.map(e => e.message).join('; ')}`)
  }
  return body.data
}

const CHECK_QUERY = `
  query CheckDef($ns: String!, $key: String!) {
    metafieldDefinitions(first: 1, namespace: $ns, key: $key, ownerType: PRODUCT) {
      nodes { id name }
    }
  }
`

const CREATE_MUTATION = `
  mutation CreateDef($def: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $def) {
      createdDefinition { id key name }
      userErrors { field message }
    }
  }
`

async function ensureDef(def: MetafieldDef) {
  const existing = await gql<{ metafieldDefinitions: { nodes: Array<{ id: string; name: string }> } }>(
    CHECK_QUERY,
    { ns: 'xdipx', key: def.key }
  )
  if (existing.metafieldDefinitions.nodes.length > 0) {
    console.log(`  ✓ xdipx.${def.key} — already exists`)
    return
  }
  const created = await gql<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string; key: string } | null
      userErrors: Array<{ field: string[]; message: string }>
    }
  }>(CREATE_MUTATION, {
    def: {
      namespace:   'xdipx',
      key:         def.key,
      name:        def.name,
      description: def.description,
      type:        def.type,
      ownerType:   'PRODUCT',
      validations: def.validations ?? [],
    },
  })
  const errors = created.metafieldDefinitionCreate.userErrors
  if (errors.length > 0) {
    console.error(`  ✗ xdipx.${def.key} — ${errors.map(e => e.message).join('; ')}`)
    return
  }
  console.log(`  + xdipx.${def.key} — created`)
}

async function main() {
  console.log(`Creating ${DEFS.length} xdipx metafield definitions on ${STORE}...`)
  for (const def of DEFS) {
    await ensureDef(def)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
