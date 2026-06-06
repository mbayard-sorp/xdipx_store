import type { ActionFunctionArgs } from 'react-router'
import { generateCopy } from '~/lib/claude.server'
import { requireAdmin } from '~/lib/session.server'
import { getCollectionList } from '~/lib/shopify.server'
import { enqueueFieldRegenJob } from '~/lib/field-regen-runner.server'
import type { GenerateCopyRequest } from '~/types'

// Field types that can be auto-applied to Shopify metafields via the batch
// runner and therefore benefit from async enqueueing. Requires a productId
// to be included in the form data.
const BATCHABLE_TYPES = new Set<GenerateCopyRequest['type']>([
  'tagline',
  'full_story',
  'both_ways',
  'seo_meta',
  'specifications',
  'box_contents',
  'bullets',
])

// API-only route — no default export
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const type = form.get('type') as GenerateCopyRequest['type']
  const productId = (form.get('productId') as string | null)?.trim() ?? ''
  const sku = (form.get('sku') as string | null)?.trim() ?? productId

  let product: GenerateCopyRequest['product']
  try {
    product = JSON.parse(form.get('product') as string)
  } catch {
    return Response.json({ error: 'Invalid product JSON' }, { status: 400 })
  }

  if (!type || !product) {
    return Response.json({ error: 'Missing type or product' }, { status: 400 })
  }

  // Batchable types with a productId: enqueue a field-regen job and return
  // immediately. The cron poller drives the batch; results auto-apply when
  // the batch completes. Callers poll /admin/async-jobs?jobId=<id>.
  if (BATCHABLE_TYPES.has(type) && productId) {
    const { jobId } = await enqueueFieldRegenJob({
      kind:      'copy-fields',
      productId,
      sku,
      product: {
        title:       product.title,
        brand:       product.brand,
        description: product.description,
        categories:  product.categories,
        ...(product.dealPrice !== undefined ? { dealPrice: product.dealPrice } : {}),
        ...(product.msrp      !== undefined ? { msrp:      product.msrp      } : {}),
      },
      fields: [type],
    })
    return Response.json({ ok: true, jobId, status: 'queued' })
  }

  // Inline-review types (endorsement, pair_bundle, quiet_endorsement,
  // email_subjects, blog_article) or batchable types without a productId:
  // run synchronously so the admin sees the result immediately for review/save.

  // Endorsement copy needs the live collection roster so the AI can pick
  // real handles for "I'm also into" + the two contextual rails. Cached for
  // 5 minutes by getCollectionList(), so cheap to fetch on every call.
  let availableCollections: GenerateCopyRequest['availableCollections']
  if (type === 'endorsement') {
    try {
      const list = await getCollectionList()
      availableCollections = list.map(c => ({
        handle: c.handle,
        title:  c.title,
        ...(c.description ? { description: c.description.slice(0, 120) } : {}),
      }))
    } catch (err) {
      console.error('[api.generate-copy] collection list fetch failed:', err)
    }
  }

  const result = await generateCopy({
    type,
    product,
    ...(availableCollections ? { availableCollections } : {}),
  })
  return Response.json({ result })
}
