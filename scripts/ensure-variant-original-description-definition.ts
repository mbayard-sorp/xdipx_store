/**
 * Idempotent: ensure the `custom.original_description` metafield definition
 * exists on ProductVariant owners. Run once before
 * `import-variant-original-descriptions.ts`.
 *
 *   npx tsx scripts/ensure-variant-original-description-definition.ts          # dry-run
 *   npx tsx scripts/ensure-variant-original-description-definition.ts --apply
 *
 * Per docs/descriptions-metafield-spec.md §6:
 *   namespace = custom · key = original_description (singular)
 *   type = multi_line_text_field · owner = ProductVariant
 *   storefront access = PUBLIC_READ
 *
 * Note: the same key exists at PRODUCT level too (set by pushProductToShopify
 * with the master row's Nalpac description). Shopify treats them as separate
 * metafields scoped by owner type — no conflict, but the PDP renderer must
 * read from the variant for the per-variant copy.
 */

import 'dotenv/config'
import { ensureMetafieldDefinition } from '~/lib/shopify.server'

const DEFINITION = {
  namespace:        'custom',
  key:              'original_description',
  type:             'multi_line_text_field',
  name:             'Original Description (variant)',
  description:      'Original Nalpac product description for this specific variant. Includes per-size dimensions, weights, ingredients (lubes), etc.',
  ownerType:        'PRODUCTVARIANT' as const,
  storefrontAccess: true,
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  console.log('─── Ensure variant metafield definition ───')
  console.log(`Mode:       ${apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`Definition: ${DEFINITION.namespace}.${DEFINITION.key} (${DEFINITION.type}, owner=${DEFINITION.ownerType}, storefront=${DEFINITION.storefrontAccess ? 'PUBLIC_READ' : 'NONE'})`)

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
