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
  /** Metafield namespace. Defaults to 'xdipx' when omitted. Use 'custom' for
   *  fields that should live in Shopify's reserved namespace (e.g. parent/child
   *  taxonomy fields where Shopify's UI groups namespace=custom together). */
  namespace?:  string
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
  // Phase 7 — brand-aware title augmentation
  {
    key:         'original_title',
    name:        'Original title (manufacturer)',
    description: 'The manufacturer\'s original product title before Emma\'s SEO augmentation. Audit trail + rollback path. Empty when augmented=false.',
    type:        'single_line_text_field',
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
  // Phase 2 — sensation dial + voting (Phase 1 rebuild — expanded enum)
  {
    key:         'product_type_dial',
    name:        'Product type (for dial)',
    description: 'Top-level product taxonomy. One of: vibrator | dildo | anal | bondage | cock-ring | stroker | couples | harness | extender | pump | lube | massage | enhancer | wear | condom | wellness | novelty | book-media | sex-machine. Drives careInstructions branching, Ask Emma filters, sensation dial vocabulary, and IVR product-type self-restriction. Pair with custom.product_subtype_dial for finer-grained classification.',
    type:        'single_line_text_field',
  },
  // Phase 1 rebuild — hierarchical taxonomy: subtype scoped to product_type_dial parent.
  // Lives in 'custom' namespace per plan; keeps xdipx namespace focused on editorial fields.
  {
    namespace:   'custom',
    key:         'product_subtype_dial',
    name:        'Product subtype (for dial)',
    description: [
      'Subtype scoped to xdipx.product_type_dial parent. Closed enum per parent:',
      '• vibrator → bullet-egg | rabbit | g-spot | finger-clit | wand | air-pulsation | rotating-thrusting | remote | wearable',
      '• dildo → realistic | glass-metal | silicone | dual-density | non-phallic | vibrating | packer | large',
      '• anal → plug | prostate | beads | vibrating | dilator | douche-enema',
      '• bondage → paddle-whip | restraint | blindfold | gag | collar-leash | nipple | body-harness | sensory | electrostim',
      '• cock-ring → classic | vibrating | cock-ball-sling | ball-stretcher | set',
      '• stroker → vagina | mouth | pocket | non-realistic | vibrating | doll | disposable',
      '• couples → game-romance | bedroom-accessory | positioning-aid | swing-sling | wearable',
      '• harness → fabric | leather | vegan-leather | o-ring | set-kit',
      '• extender → sling | sleeve | vibrating | strap-on',
      '• pump → penis',
      '• lube → water-based | silicone-based | hybrid | flavored | natural | anal | warming-cooling | toy-cleaner',
      '• massage → body-care | candle | perfume-pheromone | hygiene | cbd',
      '• enhancer → desensitizer-relaxer | oral | arousal-gel | male-arousal | female-arousal | gummy-edible | pill',
      '• wear → mens-underwear | panty | bra-panty-set | bodysuit-teddy | bodystocking | hosiery | pasty | apparel | sock | accessory | plus-queen',
      '• condom → glyde | trojan | lifestyles | durex',
      '• wellness → kegel | dilator | douche-enema | hygiene | aftercare',
      '• novelty → candy-edible | pin-keychain | game | plushie-pillow | novelty-gift | party-supply',
      '• book-media → book | coloring-book',
      '• sex-machine → (no subtype — leave empty)',
    ].join('\n'),
    type:        'single_line_text_field',
  },
  {
    key:         'sensation_dial',
    name:        'Sensation dial values (legacy v1)',
    description: 'DEPRECATED — read-fallback only. JSON object with per-dimension integer ratings 1-5 (e.g. { intensity: 4, quietness: 3 }). Superseded by sensation_dial_v2.',
    type:        'json',
  },
  {
    key:         'sensation_dial_v2',
    name:        'Sensation dial (v2 — free-form)',
    description: 'JSON { items: [{ label: string, value: 1-5, proposed?: boolean }] }. 5–6 items. Labels are free-form; the per-type dialRegistry in Sanity is the preferred set, but Emma can propose new ones (proposed: true) for editor triage.',
    type:        'json',
  },
  // PDP — "In the Box" tab content (orchestrator-generated)
  {
    key:         'box_contents',
    name:        'Box contents',
    description: 'JSON string[] — what ships in the box ("1x toy", "1x charging cable", "1x pouch"). Renders in PDP "In the Box" tab.',
    type:        'json',
  },
  // PDP — "Specifications" tab content (orchestrator-generated, HTML table)
  {
    key:         'specifications',
    name:        'Specifications',
    description: 'HTML table of product specs (material, dimensions, runtime, etc.). Renders in PDP Specifications tab.',
    type:        'multi_line_text_field',
  },
  // PDP redesign — Care instructions (Emma-generated)
  {
    key:         'care_instructions',
    name:        'Care instructions',
    description: 'JSON string[] — 3–5 short imperative bullets ("Wipe with damp cloth", "No silicone-based lube"). Renders in PDP Care tab.',
    type:        'json',
  },
  // Phase 2 — pairs-with copy
  {
    key:         'pairing_why',
    name:        'Pairing why (Emma copy)',
    description: 'JSON { [accessoryProductId]: "Emma voice explanation" } — copy for the Pairs-with card on PDP.',
    type:        'json',
  },
  // PDP hero background — Imagen-generated, uploaded to Shopify Files CDN
  {
    key:         'mood_image_url',
    name:        'Mood image URL',
    description: 'Shopify Files CDN URL for the PDP hero background. Generated by the bulk-import orchestrator via Imagen.',
    type:        'single_line_text_field',
  },
  // Emma hero — Claude-generated on deal promotion
  {
    key:         'emma_hero',
    name:        'Emma hero copy',
    description: 'JSON { variant, eyebrow, headline, body, aside, pullQuote?, generatedAt, voiceHash } — generated from pipelineSettings.brandVoice on deal activation.',
    type:        'json',
  },
  // Alt-template "quiet endorsement" homepage — Haiku-generated per product
  {
    key:         'quiet_endorsement_copy',
    name:        'Quiet endorsement copy',
    description: 'JSON { eyebrow, subhead, body, bannerHeadline } — Haiku-generated Emma copy for the alt "quiet endorsement" homepage template.',
    type:        'json',
  },
  // Alt-template "pair bundle" homepage — Haiku-generated per primary product
  {
    key:         'pair_bundle_copy',
    name:        'Pair bundle copy',
    description: 'JSON { eyebrow, subhead, headline, body, bannerLine, pairedHandle, generatedAt } — Haiku-generated Emma copy for the alt "pair bundle" homepage template. Tied to a specific partner product by pairedHandle.',
    type:        'json',
  },
]

const STORE = process.env['SHOPIFY_STORE_DOMAIN']
// Match the app's env var (SHOPIFY_ADMIN_ACCESS_TOKEN) and also accept the
// legacy SHOPIFY_ADMIN_TOKEN name so existing scripts keep working.
const TOKEN = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_TOKEN']
const VERSION = process.env['SHOPIFY_ADMIN_API_VERSION'] ?? '2024-10'

if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env')
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
      nodes { id name access { storefront } }
    }
  }
`

const UPDATE_MUTATION = `
  mutation UpdateDef($def: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $def) {
      updatedDefinition { id key }
      userErrors { field message }
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
  const ns = def.namespace ?? 'xdipx'
  const existing = await gql<{
    metafieldDefinitions: {
      nodes: Array<{ id: string; name: string; access: { storefront: string | null } }>
    }
  }>(CHECK_QUERY, { ns, key: def.key })
  const node = existing.metafieldDefinitions.nodes[0]
  if (node) {
    if (node.access?.storefront !== 'PUBLIC_READ') {
      // Patch existing def to grant Storefront API access. Without this, the
      // Storefront API returns null for the metafield even when a value exists.
      const updated = await gql<{
        metafieldDefinitionUpdate: {
          updatedDefinition: { id: string } | null
          userErrors: Array<{ field: string[]; message: string }>
        }
      }>(UPDATE_MUTATION, {
        def: {
          namespace:  ns,
          key:        def.key,
          ownerType:  'PRODUCT',
          access:     { storefront: 'PUBLIC_READ' },
        },
      })
      const errs = updated.metafieldDefinitionUpdate.userErrors
      if (errs.length > 0) {
        console.error(`  ✗ ${ns}.${def.key} — update failed: ${errs.map(e => e.message).join('; ')}`)
      } else {
        console.log(`  ↻ ${ns}.${def.key} — granted storefront access`)
      }
    } else {
      console.log(`  ✓ ${ns}.${def.key} — already exists`)
    }
    return
  }
  const created = await gql<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string; key: string } | null
      userErrors: Array<{ field: string[]; message: string }>
    }
  }>(CREATE_MUTATION, {
    def: {
      namespace:   ns,
      key:         def.key,
      name:        def.name,
      description: def.description,
      type:        def.type,
      ownerType:   'PRODUCT',
      validations: def.validations ?? [],
      // Expose to Storefront API — without this, storefront queries return null
      // for the metafield even when a value is set.
      access: { storefront: 'PUBLIC_READ' },
    },
  })
  const errors = created.metafieldDefinitionCreate.userErrors
  if (errors.length > 0) {
    console.error(`  ✗ ${ns}.${def.key} — ${errors.map(e => e.message).join('; ')}`)
    return
  }
  console.log(`  + ${ns}.${def.key} — created`)
}

async function main() {
  console.log(`Ensuring ${DEFS.length} metafield definitions on ${STORE}...`)
  for (const def of DEFS) {
    await ensureDef(def)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
