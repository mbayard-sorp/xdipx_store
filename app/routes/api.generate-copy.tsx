import type { ActionFunctionArgs } from 'react-router'
import { generateCopy } from '~/lib/claude.server'
import { requireAdmin } from '~/lib/session.server'
import { getCollectionList } from '~/lib/shopify.server'
import type { GenerateCopyRequest } from '~/types'

// API-only route — no default export
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const type = form.get('type') as GenerateCopyRequest['type']

  let product: GenerateCopyRequest['product']
  try {
    product = JSON.parse(form.get('product') as string)
  } catch {
    return Response.json({ error: 'Invalid product JSON' }, { status: 400 })
  }

  if (!type || !product) {
    return Response.json({ error: 'Missing type or product' }, { status: 400 })
  }

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
