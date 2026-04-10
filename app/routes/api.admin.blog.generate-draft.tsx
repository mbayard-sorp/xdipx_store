import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { generateBlogDraft } from '~/lib/claude.server'
import type { BlogOutline } from '~/lib/claude.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const body = await request.json()
  const outline = body.outline as BlogOutline | undefined
  if (!outline?.title || !outline?.sections?.length) {
    return Response.json({ error: 'outline with title and sections is required' }, { status: 400 })
  }

  const html = await generateBlogDraft(outline)
  return Response.json({ html })
}
