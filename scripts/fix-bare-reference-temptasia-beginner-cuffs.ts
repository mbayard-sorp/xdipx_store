/**
 * scripts/fix-bare-reference-temptasia-beginner-cuffs.ts
 *
 * Ticket #21538. `resolveBareProductReference` (app/lib/shopify.server.ts)
 * confirmed index 1 (`91835A_027fdd42-....jpg`) as the "bare frame" for
 * temptasia-beginner-cuffs, `method: 'heuristic'`. It is not: the filename
 * carries no packaging signal because it is a Shopify dedupe-suffixed copy of
 * `91835A.jpg` (image index 0) — the two files are byte-identical — and both
 * show the retail carton (with the printed "Temptasia" wordmark, a model, and
 * the box copy) next to the cuffs, not the product alone.
 *
 * Hand-verified against all four of the product's live Shopify images (fetched
 * and eyeballed, not inferred from the ticket text per routine-dev-daily.md
 * Step 4): index 0 and index 1 are the byte-identical black-cuffs carton shot
 * (confirmed via md5sum: both 8b84cbce562cb59d8ad6bc803691ac34); index 2
 * (`91837A.jpg`) is the same carton composition in the pink colorway; index 3
 * (`91834A_af75a026-....jpg`) is the same composition again, desaturated.
 * Every image in this product's gallery pairs the cuffs with their retail
 * carton and printed brand text — none is a bare, text-free product frame.
 * So unlike `scripts/fix-bare-reference-17400.ts` (which had a genuinely bare
 * sibling frame to redirect to), there is nothing to redirect to here: the
 * reference is cleared to `url: null` with `method: 'manual'`, the same
 * honest-refusal shape `resolveBareProductReference` itself returns when no
 * frame qualifies.
 *
 * Also recorded as a second, separate occurrence (after row #19560) of the
 * printed-brand-text-on-the-reference defect class: a heuristic-confirmed
 * `bare_product_reference` can resolve to a frame carrying visible packaging
 * and brand text with no filename/altText signal to catch it, because the
 * heuristic is text-only. That generalization is out of scope for this
 * one-off script; see ticket #21538's PR body for the full note.
 *
 * Usage: npx tsx scripts/fix-bare-reference-temptasia-beginner-cuffs.ts
 */
import './_load-env'
import { adminGraphQL, updateProductMetafield } from '../app/lib/shopify.server'

const HANDLE = 'temptasia-beginner-cuffs'

async function main() {
  const data = await adminGraphQL<{
    productByHandle: {
      id: string
      images: { edges: Array<{ node: { url: string; altText: string | null } }> }
    } | null
  }>(`
    query P($handle: String!) {
      productByHandle(handle: $handle) {
        id
        images(first: 20) { edges { node { url altText } } }
      }
    }
  `, { handle: HANDLE })

  const product = data.productByHandle
  if (!product) throw new Error(`product not found for handle ${HANDLE}`)

  const metafieldValue = {
    url: null,
    index: null,
    reason:
      'manual override (#21538): every image in this product\'s gallery (4 entries, 3 distinct ' +
      'after dedupe) pairs the cuffs with their retail carton and printed brand text. The prior ' +
      'heuristic pick (index 1, 91835A_027fdd42-....jpg) is byte-identical to index 0 and is the ' +
      'carton, not the product alone; no sibling frame in the gallery is bare. Hand-verified ' +
      'against all 4 live images.',
    resolvedAt: new Date().toISOString(),
    method: 'manual' as const,
  }

  await updateProductMetafield(product.id, 'bare_product_reference', JSON.stringify(metafieldValue), 'json')
  console.log('Wrote xdipx.bare_product_reference:', JSON.stringify(metafieldValue, null, 2))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
