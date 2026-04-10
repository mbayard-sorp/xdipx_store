import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { generateBlogSEO } from '~/lib/claude.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const body = await request.json()
  const title = String(body.title ?? '').trim()
  const excerpt = String(body.excerpt ?? '').trim()
  if (!title) return Response.json({ error: 'title is required' }, { status: 400 })

  const seo = await generateBlogSEO(title, excerpt)
  return Response.json(seo)
}
