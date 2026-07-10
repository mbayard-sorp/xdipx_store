import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { generateBlogOutline } from '~/lib/claude.server'
import { buildKeywordContext } from '~/lib/seo-keywords.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const body = await request.json()
  const topic = String(body.topic ?? '').trim()
  if (!topic) return Response.json({ error: 'topic is required' }, { status: 400 })

  const manualKeywords: string[] = Array.isArray(body.keywords) ? body.keywords : []
  const category = body.category ? String(body.category) : undefined

  // Merge approved bank keywords (contentType 'blog') behind any manually
  // entered terms. Manual terms stay first so the admin can always steer;
  // the bank fills in when the field is left empty. Self-graceful: an
  // unconfigured or empty bank yields no extra terms.
  const ctx = await buildKeywordContext({ contentType: 'blog', topic })
  const bankTerms = [
    ...(ctx.primary ? [ctx.primary.term] : []),
    ...ctx.secondary.map(k => k.term),
    ...ctx.questions.map(k => k.term),
  ]
  const seen = new Set(manualKeywords.map(k => k.toLowerCase()))
  const keywords = [
    ...manualKeywords,
    ...bankTerms.filter(t => !seen.has(t.toLowerCase())),
  ].slice(0, 12)

  const outline = await generateBlogOutline(topic, keywords, category)
  return Response.json(outline)
}
