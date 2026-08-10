import type { ActionFunctionArgs } from 'react-router'
import { generateImage } from '~/lib/generate-image.server'
import { requireAdmin } from '~/lib/session.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const categoriesRaw = form.get('categories') as string

  let categories: string[] = []
  try {
    categories = JSON.parse(categoriesRaw)
  } catch {
    categories = categoriesRaw ? categoriesRaw.split(',').map(c => c.trim()) : []
  }

  const { buffers } = await generateImage({
    categories,
    feature: 'admin-images',
    caller: 'api.generate-image',
  })

  // Return base64 encoded images
  return Response.json({
    images: buffers.map(buf => `data:image/png;base64,${buf.toString('base64')}`),
  })
}
