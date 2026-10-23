/**
 * scripts/fix-bare-reference-17400.ts
 *
 * Ticket #17400. `resolveBareProductReference` (app/lib/shopify.server.ts) is
 * a filename/altText heuristic by design: it has no way to see that a frame
 * carries a printed hang tag with a barcode when the filename and altText
 * name neither ("93482B.jpg", altText ""). For
 * sportsheets-edge-mine-silicone-paddle it picked 93482B.jpg (the back of
 * the hang tag) as the "confirmed bare frame". Re-running the resolver
 * against the same unchanged media list reproduces the identical wrong pick,
 * so this is not fixable by re-running the heuristic (routine-dev-daily.md's
 * DONE WHEN second option); the only real fix is a hand-verified override.
 *
 * social-art-director's finding (eyeballed each of the 7 images) named
 * 93482C.jpg and 93482E.jpg as the two clean, text-free bare frames. This
 * script independently re-confirms that against the live Shopify media (not
 * just trusting the ticket text, per routine-dev-daily.md Step 4: ticket
 * text is a lead, not a binding spec) and writes the correction with
 * `method: 'manual'`, so the stored metafield honestly records this was a
 * hand-verified override, not a heuristic or vision-model verdict (the same
 * pattern `scripts/vision-check-bare-reference.ts` already uses for
 * `method: 'vision'`).
 *
 * One-off and intentionally not generalized into a reusable CLI: this is the
 * second hand-verified override of its kind in the repo (the vision script
 * covers the general case at catalog scale), so a one-off script matches
 * precedent (scripts/regate-verify-11029.ts, scripts/audit-vision-verdicts.ts).
 *
 * Usage: npx tsx scripts/fix-bare-reference-17400.ts
 */
import './_load-env'
import { adminGraphQL, updateProductMetafield } from '../app/lib/shopify.server'

const HANDLE = 'sportsheets-edge-mine-silicone-paddle'
const CHOSEN_FILENAME = '93482C.jpg'

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

  const images = product.images.edges.map(e => e.node)
  const index = images.findIndex(img => (img.url.split('?')[0] ?? '').split('/').pop()?.startsWith(CHOSEN_FILENAME.replace('.jpg', '')))
  if (index === -1) throw new Error(`${CHOSEN_FILENAME} not found in current media list`)
  const chosen = images[index]!

  const metafieldValue = {
    url: chosen.url,
    index,
    reason: 'manual override (#17400): 93482B.jpg (the heuristic\'s prior pick) is the back of the printed hang tag with a barcode; the filename/altText heuristic has no signal for that. Hand-verified against the live media: 93482C.jpg is a clean, text-free, straight-on bare frame.',
    resolvedAt: new Date().toISOString(),
    method: 'manual' as const,
  }

  await updateProductMetafield(product.id, 'bare_product_reference', JSON.stringify(metafieldValue), 'json')
  console.log('Wrote xdipx.bare_product_reference:', JSON.stringify(metafieldValue, null, 2))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
