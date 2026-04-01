import type { ActionFunctionArgs } from 'react-router'
import { generateMoodImage } from '~/lib/imagen.server'

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const categoriesRaw = form.get('categories') as string

  let categories: string[] = []
  try {
    categories = JSON.parse(categoriesRaw)
  } catch {
    categories = categoriesRaw ? categoriesRaw.split(',').map(c => c.trim()) : []
  }

  const images = await generateMoodImage({ categories })

  // Return base64 encoded images
  return Response.json({
    images: images.map(buf => `data:image/png;base64,${buf.toString('base64')}`),
  })
}
