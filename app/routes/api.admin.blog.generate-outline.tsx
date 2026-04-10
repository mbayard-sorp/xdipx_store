import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { generateBlogOutline } from '~/lib/claude.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const body = await request.json()
  const topic = String(body.topic ?? '').trim()
  if (!topic) return Response.json({ error: 'topic is required' }, { status: 400 })

  const keywords = Array.isArray(body.keywords) ? body.keywords : []
  const category = body.category ? String(body.category) : undefined

  const outline = await generateBlogOutline(topic, keywords, category)
  return Response.json(outline)
}
