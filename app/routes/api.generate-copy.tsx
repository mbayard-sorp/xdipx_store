import type { ActionFunctionArgs } from 'react-router'
import { generateCopy } from '~/lib/claude.server'
import type { GenerateCopyRequest } from '~/types'

// API-only route — no default export
export async function action({ request }: ActionFunctionArgs) {
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

  const result = await generateCopy({ type, product })
  return Response.json({ result })
}
