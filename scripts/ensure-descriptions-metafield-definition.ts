/**
 * Idempotent: ensure the `custom.original_descriptions` metafield definition
 * exists on Product owners. Run once before `import-descriptions-metafield.ts`.
 *
 *   npx tsx scripts/ensure-descriptions-metafield-definition.ts          # dry-run
 *   npx tsx scripts/ensure-descriptions-metafield-definition.ts --apply
 *
 * Per docs/descriptions-metafield-spec.md §3:
 *   namespace = custom · key = original_descriptions · type = json
 *   storefront access = PUBLIC_READ
 */

import 'dotenv/config'
import { ensureMetafieldDefinition } from '~/lib/shopify.server'

const DEFINITION = {
  namespace:        'custom',
  key:              'original_descriptions',
  type:             'json',
  name:             'Original Descriptions (per-variant)',
  description:      'Per-variant original Nalpac descriptions. JSON array of {sku, title, color, size, fluid_oz, description}.',
  ownerType:        'PRODUCT' as const,
  storefrontAccess: true,
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  console.log('─── Ensure metafield definition ───')
  console.log(`Mode:       ${apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`Definition: ${DEFINITION.namespace}.${DEFINITION.key} (${DEFINITION.type}, storefront=${DEFINITION.storefrontAccess ? 'PUBLIC_READ' : 'NONE'})`)

  if (!apply) {
    console.log('Dry-run — re-run with --apply to create the definition if missing.')
    return
  }

  const { created } = await ensureMetafieldDefinition(DEFINITION)
  console.log(created ? '✓ Created definition.' : '· Definition already existed — no change.')
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
