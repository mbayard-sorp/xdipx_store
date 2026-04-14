/**
 * /api/reviews
 * GET  — list approved reviews for a product
 * POST — submit a new review (multipart/form-data)
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router'
import { getProductReviews, createReview, getInviteByToken, markInviteClicked, getReviewSettings, updateReviewStatus, updateReviewAI } from '~/lib/reviews.server'
import { analyzeReview } from '~/lib/reviews-ai.server'
import { kvSet, kvIncr } from '~/lib/kv.server'
import { rejectIfBot } from '~/lib/botid.server'

// ─── Loader: GET /api/reviews?productId=X ────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const url        = new URL(request.url)
  const productId  = url.searchParams.get('productId')
  const sort       = url.searchParams.get('sort')   ?? 'newest'
  const filter     = url.searchParams.get('filter') ?? 'all'
  const page       = parseInt(url.searchParams.get('page') ?? '1', 10)
  const perPage    = parseInt(url.searchParams.get('perPage') ?? '10', 10)

  if (!productId) {
    return Response.json({ error: 'productId is required' }, { status: 400 })
  }

  const { reviews, total } = await getProductReviews(productId, { sort, filter, page, perPage })
  return Response.json({ reviews, total, page, perPage })
}

// ─── Action: POST /api/reviews ────────────────────────────────────────────

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() ?? 'unknown'
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const bot = await rejectIfBot()
  if (bot) return bot

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ errors: { general: 'Invalid form data.' } }, { status: 400 })
  }

  // ── Honeypot check ──
  const honeypot = formData.get('website') as string | null
  if (honeypot && honeypot.trim() !== '') {
    // Silent 201 — don't reveal we detected spam
    return Response.json({ ok: true }, { status: 201 })
  }

  // ── Rate limiting via KV ──
  const ip      = getClientIp(request)
  const rlKey   = `review:ratelimit:submit:${ip}`
  const count   = await kvIncr(rlKey)
  if (count === 1) {
    // Set 1h expiry on first increment
    await kvSet(rlKey, count, 3600)
  }
  if (count > 3) {
    return Response.json({ errors: { general: 'Too many submissions. Please try again later.' } }, { status: 429 })
  }

  // ── Field extraction ──
  const shopifyProductId = (formData.get('shopifyProductId') as string | null)?.trim()
  const inviteToken      = (formData.get('inviteToken')      as string | null)?.trim() || undefined
  const reviewerName     = (formData.get('reviewerName')     as string | null)?.trim()
  const reviewerEmail    = (formData.get('reviewerEmail')    as string | null)?.trim()
  const ratingRaw        = formData.get('rating')
  const title            = (formData.get('title')            as string | null)?.trim() || undefined
  const body             = (formData.get('body')             as string | null)?.trim() || undefined
  const isVerifiedStr    = formData.get('isVerifiedPurchase')

  // ── Validation ──
  const errors: Record<string, string> = {}
  if (!shopifyProductId) errors['shopifyProductId'] = 'Product ID is required.'
  if (!reviewerName)     errors['reviewerName']     = 'Name is required.'
  if (!reviewerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reviewerEmail)) {
    errors['reviewerEmail'] = 'Valid email is required.'
  }
  const rating = parseInt(String(ratingRaw), 10)
  if (isNaN(rating) || rating < 1 || rating > 5) {
    errors['rating'] = 'Please select a star rating.'
  }

  if (Object.keys(errors).length > 0) {
    return Response.json({ errors }, { status: 422 })
  }

  // ── Load settings ──
  const settings = await getReviewSettings()

  if (settings.requireTitle && !title) {
    return Response.json({ errors: { title: 'A review title is required.' } }, { status: 422 })
  }
  if (settings.minBodyLength > 0 && (!body || body.length < settings.minBodyLength)) {
    return Response.json({ errors: { body: `Review must be at least ${settings.minBodyLength} characters.` } }, { status: 422 })
  }

  // ── Invite token verification ──
  let isVerifiedPurchase = isVerifiedStr === 'true'
  let resolvedInviteToken: string | undefined

  if (inviteToken) {
    const invite = await getInviteByToken(inviteToken)
    if (invite && invite.status !== 'expired') {
      const inviteAge = Date.now() - new Date(invite.sentAt).getTime()
      const sevenDays = 7 * 24 * 60 * 60 * 1000
      if (inviteAge < sevenDays && invite.shopifyProductId === shopifyProductId) {
        isVerifiedPurchase = true
        resolvedInviteToken = inviteToken
        await markInviteClicked(inviteToken)
      }
    }
  }

  // ── Media: handle file uploads ──
  // @vercel/blob is not in package.json — skip media upload, store placeholder
  // TODO: Install @vercel/blob and implement actual upload when VERCEL_BLOB_TOKEN is available
  const mediaUrls: { url: string; thumbnailUrl?: string; mediaType: 'image' | 'video' }[] = []
  // Files are submitted as media_0, media_1, etc. but we skip actual upload for now.
  // If VERCEL_BLOB_TOKEN were set, we'd use put() from @vercel/blob here.

  // ── Create review ──
  const review = await createReview({
    shopifyProductId:  shopifyProductId!,
    reviewerName:      reviewerName!,
    reviewerEmail:     reviewerEmail!,
    rating,
    title,
    body,
    isVerifiedPurchase,
    source:            inviteToken ? 'email_invite' : 'organic',
    inviteToken:       resolvedInviteToken,
    ipAddress:         ip,
    userAgent:         request.headers.get('user-agent') ?? undefined,
    mediaUrls:         mediaUrls.length > 0 ? mediaUrls : undefined,
  })

  // ── AI analysis (non-blocking) ──
  analyzeReview({ title, body, rating }).then(async analysis => {
    await updateReviewAI(review.id, {
      aiSentiment: analysis.sentiment,
      aiSummary:   analysis.summary,
      aiSpamScore: analysis.spamScore,
    })

    // Auto-moderate based on settings + AI
    if (analysis.spamScore >= settings.spamThreshold) {
      await updateReviewStatus(review.id, 'spam', { moderationNote: analysis.spamReason ?? 'AI flagged as spam', moderatedBy: 'ai' })
    } else if (settings.autoApprove && analysis.suggestedStatus !== 'spam') {
      await updateReviewStatus(review.id, 'approved', { moderatedBy: 'ai-auto' })
    }

    // Invalidate pending count cache
    await kvSet('review:stats:pending', null, 1)
  }).catch(err => {
    console.error('[reviews:ai-analysis]', err)
  })

  return Response.json({ ok: true, reviewId: review.id }, { status: 201 })
}
