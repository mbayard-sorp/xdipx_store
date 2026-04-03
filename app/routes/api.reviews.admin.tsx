/**
 * POST /api/reviews/admin
 * Admin actions: approve, reject, spam, feature, reply, suggest-reply, delete, bulk-*
 * Protected by session auth guard.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  updateReviewStatus,
  updateReviewReply,
  updateReviewFeatured,
  deleteReview,
  getReviewById,
} from '~/lib/reviews.server'
import { generateReviewResponseSuggestion } from '~/lib/reviews-ai.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return Response.json({ ok: true })
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const intent    = formData.get('intent') as string | null
  const reviewId  = formData.get('reviewId') as string | null

  if (!intent) {
    return Response.json({ error: 'Missing intent' }, { status: 400 })
  }

  // ── Bulk actions ──
  if (intent.startsWith('bulk-')) {
    const idsRaw = formData.get('ids') as string | null
    if (!idsRaw) return Response.json({ error: 'Missing ids' }, { status: 400 })

    let ids: string[]
    try {
      ids = JSON.parse(idsRaw) as string[]
    } catch {
      return Response.json({ error: 'Invalid ids JSON' }, { status: 400 })
    }

    const bulkAction = intent.replace('bulk-', '') as 'approve' | 'reject' | 'spam' | 'delete'
    const results = await Promise.allSettled(ids.map(async id => {
      if (bulkAction === 'delete') {
        return deleteReview(id)
      }
      return updateReviewStatus(id, bulkAction as 'approved' | 'rejected' | 'spam', {
        moderatedBy: 'admin-bulk',
      })
    }))

    const failed = results.filter(r => r.status === 'rejected').length
    return Response.json({ ok: true, processed: ids.length, failed })
  }

  // ── Single review actions ──
  if (!reviewId) {
    return Response.json({ error: 'Missing reviewId' }, { status: 400 })
  }

  switch (intent) {
    case 'approve': {
      const updated = await updateReviewStatus(reviewId, 'approved', { moderatedBy: 'admin' })
      return Response.json({ ok: true, review: updated })
    }

    case 'reject': {
      const note = (formData.get('moderationNote') as string | null) ?? undefined
      const updated = await updateReviewStatus(reviewId, 'rejected', { moderatedBy: 'admin', moderationNote: note })
      return Response.json({ ok: true, review: updated })
    }

    case 'spam': {
      const updated = await updateReviewStatus(reviewId, 'spam', { moderatedBy: 'admin' })
      return Response.json({ ok: true, review: updated })
    }

    case 'feature': {
      const isFeatured = formData.get('isFeatured') === 'true'
      await updateReviewFeatured(reviewId, isFeatured)
      return Response.json({ ok: true })
    }

    case 'reply': {
      const replyBody = (formData.get('replyBody') as string | null)?.trim()
      if (!replyBody) return Response.json({ error: 'replyBody is required' }, { status: 400 })
      const updated = await updateReviewReply(reviewId, replyBody)
      return Response.json({ ok: true, review: updated })
    }

    case 'suggest-reply': {
      const review = await getReviewById(reviewId)
      if (!review) return Response.json({ error: 'Review not found' }, { status: 404 })
      const suggestion = await generateReviewResponseSuggestion(review)
      return Response.json({ ok: true, suggestion })
    }

    case 'delete': {
      await deleteReview(reviewId)
      return Response.json({ ok: true })
    }

    default:
      return Response.json({ error: `Unknown intent: ${intent}` }, { status: 400 })
  }
}
