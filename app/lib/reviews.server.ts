/**
 * reviews.server.ts — All review DB operations.
 * Uses raw SQL via neon for complex join queries.
 */
import { neon } from '@neondatabase/serverless'
import { kvGetMemo, kvSet, primeKvMemo } from '~/lib/kv.server'
import type {
  Review,
  ReviewMedia,
  ReviewAttributeRating,
  ReviewAggregate,
  ReviewInvite,
  ReviewSettings,
  ReviewStats,
  CreateReviewInput,
  CreateInviteInput,
  AdminReviewFilters,
} from '~/types/reviews'

const sql = neon(process.env['DATABASE_URL']!)

// ─── Row → Type mappers ────────────────────────────────────────────────────

function rowToReview(row: Record<string, unknown>): Review {
  return {
    id:                  row['id'] as string,
    shopifyProductId:    row['shopify_product_id'] as string,
    shopifyOrderId:      (row['shopify_order_id'] as string | null) ?? null,
    shopifyCustomerId:   (row['shopify_customer_id'] as string | null) ?? null,
    reviewerName:        row['reviewer_name'] as string,
    reviewerEmail:       row['reviewer_email'] as string,
    rating:              row['rating'] as number,
    title:               (row['title'] as string | null) ?? null,
    body:                (row['body'] as string | null) ?? null,
    status:              row['status'] as Review['status'],
    isVerifiedPurchase:  row['is_verified_purchase'] as boolean,
    isFeatured:          row['is_featured'] as boolean,
    isIncentivized:      row['is_incentivized'] as boolean,
    helpfulYes:          row['helpful_yes'] as number,
    helpfulNo:           row['helpful_no'] as number,
    aiSentiment:         (row['ai_sentiment'] as Review['aiSentiment']) ?? null,
    aiSummary:           (row['ai_summary'] as string | null) ?? null,
    aiSpamScore:         row['ai_spam_score'] != null ? parseFloat(row['ai_spam_score'] as string) : null,
    moderationNote:      (row['moderation_note'] as string | null) ?? null,
    moderatedBy:         (row['moderated_by'] as string | null) ?? null,
    moderatedAt:         row['moderated_at'] ? new Date(row['moderated_at'] as string).toISOString() : null,
    replyBody:           (row['reply_body'] as string | null) ?? null,
    replyAt:             row['reply_at'] ? new Date(row['reply_at'] as string).toISOString() : null,
    source:              row['source'] as Review['source'],
    inviteToken:         (row['invite_token'] as string | null) ?? null,
    inviteTokenUsedAt:   row['invite_token_used_at'] ? new Date(row['invite_token_used_at'] as string).toISOString() : null,
    ipAddress:           (row['ip_address'] as string | null) ?? null,
    userAgent:           (row['user_agent'] as string | null) ?? null,
    createdAt:           new Date(row['created_at'] as string).toISOString(),
    updatedAt:           new Date(row['updated_at'] as string).toISOString(),
  }
}

function rowToMedia(row: Record<string, unknown>): ReviewMedia {
  return {
    id:           row['id'] as string,
    reviewId:     row['review_id'] as string,
    mediaType:    row['media_type'] as 'image' | 'video',
    url:          row['url'] as string,
    thumbnailUrl: (row['thumbnail_url'] as string | null) ?? null,
    sortOrder:    row['sort_order'] as number,
    createdAt:    new Date(row['created_at'] as string).toISOString(),
  }
}

function rowToAttributeRating(row: Record<string, unknown>): ReviewAttributeRating {
  return {
    id:            row['id'] as string,
    reviewId:      row['review_id'] as string,
    attributeName: row['attribute_name'] as string,
    rating:        row['rating'] as number,
  }
}

function rowToAggregate(row: Record<string, unknown>): ReviewAggregate {
  return {
    shopifyProductId: row['shopify_product_id'] as string,
    totalCount:       row['total_count'] as number,
    approvedCount:    row['approved_count'] as number,
    averageRating:    parseFloat(row['average_rating'] as string),
    rating1Count:     row['rating_1_count'] as number,
    rating2Count:     row['rating_2_count'] as number,
    rating3Count:     row['rating_3_count'] as number,
    rating4Count:     row['rating_4_count'] as number,
    rating5Count:     row['rating_5_count'] as number,
    verifiedCount:    row['verified_count'] as number,
    withPhotoCount:   row['with_photo_count'] as number,
    lastUpdated:      new Date(row['last_updated'] as string).toISOString(),
  }
}

function rowToInvite(row: Record<string, unknown>): ReviewInvite {
  return {
    id:               row['id'] as string,
    shopifyOrderId:   row['shopify_order_id'] as string,
    shopifyCustomerId:(row['shopify_customer_id'] as string | null) ?? null,
    shopifyProductId: row['shopify_product_id'] as string,
    reviewerEmail:    row['reviewer_email'] as string,
    reviewerName:     row['reviewer_name'] as string,
    inviteToken:      row['invite_token'] as string,
    sentAt:           new Date(row['sent_at'] as string).toISOString(),
    openedAt:         row['opened_at'] ? new Date(row['opened_at'] as string).toISOString() : null,
    clickedAt:        row['clicked_at'] ? new Date(row['clicked_at'] as string).toISOString() : null,
    completedAt:      row['completed_at'] ? new Date(row['completed_at'] as string).toISOString() : null,
    reminderSentAt:   row['reminder_sent_at'] ? new Date(row['reminder_sent_at'] as string).toISOString() : null,
    sendAfter:        row['send_after'] ? new Date(row['send_after'] as string).toISOString() : null,
    status:           row['status'] as ReviewInvite['status'],
  }
}

// ─── Public: product reviews ───────────────────────────────────────────────

export interface GetProductReviewsOpts {
  status?: string
  sort?: string
  filter?: string
  page?: number
  perPage?: number
}

export async function getProductReviews(
  shopifyProductId: string,
  opts: GetProductReviewsOpts = {},
): Promise<{ reviews: Review[]; total: number }> {
  const {
    status = 'approved',
    sort = 'newest',
    filter = 'all',
    page = 1,
    perPage = 10,
  } = opts

  // Only cache public approved-review queries. Admin queries (pending, spam, etc.)
  // must always be fresh so moderators see the latest state.
  const ck = `reviews:v1:${shopifyProductId}:${status}:${sort}:${filter}:${page}:${perPage}`
  if (status === 'approved') {
    const hit = await kvGetMemo<{ reviews: Review[]; total: number }>(ck, 60)
    if (hit) return hit
  }

  const offset = (page - 1) * perPage

  let orderBy = 'r.created_at DESC'
  if (sort === 'oldest')  orderBy = 'r.created_at ASC'
  if (sort === 'highest') orderBy = 'r.rating DESC, r.created_at DESC'
  if (sort === 'lowest')  orderBy = 'r.rating ASC, r.created_at DESC'
  if (sort === 'helpful') orderBy = 'r.helpful_yes DESC, r.created_at DESC'

  let filterClause = ''
  if (filter === 'verified')   filterClause = 'AND r.is_verified_purchase = true'
  if (filter === 'with_photo') filterClause = 'AND EXISTS (SELECT 1 FROM review_media rm2 WHERE rm2.review_id = r.id)'
  if (filter === '5star')  filterClause = 'AND r.rating = 5'
  if (filter === '4star')  filterClause = 'AND r.rating = 4'
  if (filter === '3star')  filterClause = 'AND r.rating = 3'
  if (filter === '2star')  filterClause = 'AND r.rating = 2'
  if (filter === '1star')  filterClause = 'AND r.rating = 1'

  // All values in filterClause come from validated enum comparisons (never user input)
  const reviewQ   = `SELECT r.* FROM reviews r WHERE r.shopify_product_id = $1 AND r.status = $2 ${filterClause} ORDER BY ${orderBy} LIMIT $3 OFFSET $4`
  const countQ    = `SELECT COUNT(*) as total FROM reviews r WHERE r.shopify_product_id = $1 AND r.status = $2 ${filterClause}`
  const [rows, countRows] = await Promise.all([
    sql(reviewQ, [shopifyProductId, status, perPage, offset]),
    sql(countQ,  [shopifyProductId, status]),
  ])

  if (rows.length === 0) {
    const empty = { reviews: [], total: 0 }
    // Most products have zero reviews and KV never stores an entry for them,
    // so memoize the empty result to stop the per-view kvGet miss.
    if (status === 'approved') primeKvMemo(ck, empty)
    return empty
  }

  const reviewIds = rows.map(r => r['id'] as string)
  const [mediaRows, attrRows] = await Promise.all([
    sql`SELECT * FROM review_media WHERE review_id = ANY(${reviewIds}) ORDER BY sort_order ASC`,
    sql`SELECT * FROM review_attribute_ratings WHERE review_id = ANY(${reviewIds})`,
  ])

  const mediaByReview = new Map<string, ReviewMedia[]>()
  for (const m of mediaRows) {
    const rid = m['review_id'] as string
    if (!mediaByReview.has(rid)) mediaByReview.set(rid, [])
    mediaByReview.get(rid)!.push(rowToMedia(m as Record<string, unknown>))
  }

  const attrByReview = new Map<string, ReviewAttributeRating[]>()
  for (const a of attrRows) {
    const rid = a['review_id'] as string
    if (!attrByReview.has(rid)) attrByReview.set(rid, [])
    attrByReview.get(rid)!.push(rowToAttributeRating(a as Record<string, unknown>))
  }

  const reviews = rows.map(r => {
    const review = rowToReview(r as Record<string, unknown>)
    review.media = mediaByReview.get(review.id) ?? []
    review.attributeRatings = attrByReview.get(review.id) ?? []
    return review
  })

  const total = parseInt((countRows[0]?.['total'] as string) ?? '0', 10)
  const result = { reviews, total }

  // Populate KV cache for approved queries so repeat homepage SSR hits are ~2ms.
  if (status === 'approved') {
    kvSet(ck, result, 300).catch(() => {})
    primeKvMemo(ck, result)
  }

  return result
}

// ─── Public: aggregate ─────────────────────────────────────────────────────

export async function getProductAggregate(shopifyProductId: string): Promise<ReviewAggregate | null> {
  const ck = `aggregate:v1:${shopifyProductId}`
  const hit = await kvGetMemo<ReviewAggregate>(ck, 60)
  if (hit) return hit

  const rows = await sql`
    SELECT * FROM review_aggregates WHERE shopify_product_id = ${shopifyProductId}
  `
  if (!rows[0]) return null
  const agg = rowToAggregate(rows[0] as Record<string, unknown>)
  kvSet(ck, agg, 300).catch(() => {})
  primeKvMemo(ck, agg)
  return agg
}

// ─── Admin: review queue ───────────────────────────────────────────────────

export async function getAdminReviewQueue(
  filters: AdminReviewFilters = {},
): Promise<{ reviews: Review[]; total: number }> {
  const {
    status,
    productId,
    search,
    sort = 'newest',
    page = 1,
    perPage = 20,
  } = filters

  const offset = (page - 1) * perPage
  const conditions: string[] = []
  const params: unknown[] = []
  let pIdx = 1

  if (status && status !== 'all') {
    conditions.push(`r.status = $${pIdx++}`)
    params.push(status)
  }
  if (productId) {
    conditions.push(`r.shopify_product_id = $${pIdx++}`)
    params.push(productId)
  }
  if (search) {
    conditions.push(`(r.reviewer_name ILIKE $${pIdx} OR r.title ILIKE $${pIdx} OR r.body ILIKE $${pIdx})`)
    params.push(`%${search}%`)
    pIdx++
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  let orderBy = 'r.created_at DESC'
  if (sort === 'oldest')    orderBy = 'r.created_at ASC'
  if (sort === 'highest')   orderBy = 'r.rating DESC'
  if (sort === 'lowest')    orderBy = 'r.rating ASC'
  if (sort === 'spam_risk') orderBy = 'r.ai_spam_score DESC NULLS LAST'

  // Build parameterized queries using neon's tagged template
  // For dynamic WHERE clauses we use unsafe() carefully with params validated above
  // orderBy values come from enum comparison only — safe to interpolate
  const baseQuery  = `SELECT r.* FROM reviews r ${whereClause} ORDER BY ${orderBy} LIMIT $${pIdx} OFFSET $${pIdx + 1}`
  const countQuery = `SELECT COUNT(*) as total FROM reviews r ${whereClause}`

  const allParams = [...params, perPage, offset]

  const [rows, countRows] = await Promise.all([
    sql(baseQuery,  allParams),
    sql(countQuery, params),
  ])

  if (rows.length === 0) return { reviews: [], total: 0 }

  const typedRows = rows as Record<string, unknown>[]
  const reviewIds = typedRows.map(r => r['id'] as string)
  const mediaRows = await sql`SELECT * FROM review_media WHERE review_id = ANY(${reviewIds}) ORDER BY sort_order ASC`

  const mediaByReview = new Map<string, ReviewMedia[]>()
  for (const m of mediaRows) {
    const rid = (m as Record<string, unknown>)['review_id'] as string
    if (!mediaByReview.has(rid)) mediaByReview.set(rid, [])
    mediaByReview.get(rid)!.push(rowToMedia(m as Record<string, unknown>))
  }

  const reviews = typedRows.map(r => {
    const review = rowToReview(r)
    review.media = mediaByReview.get(review.id) ?? []
    return review
  })

  const total = parseInt(((countRows[0] as Record<string, unknown>)?.['total'] as string) ?? '0', 10)
  return { reviews, total }
}

// ─── Admin: stats ──────────────────────────────────────────────────────────

export async function getReviewStats(): Promise<ReviewStats> {
  const [countRows, avgRows, inviteRows, conversionRows] = await Promise.all([
    sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending')  as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'spam')     as spam
      FROM reviews
    `,
    sql`
      SELECT COALESCE(AVG(rating) FILTER (WHERE status = 'approved'), 0) as avg_rating
      FROM reviews
    `,
    sql`SELECT COUNT(*) as sent FROM review_invites`,
    sql`SELECT COUNT(*) as completed FROM review_invites WHERE status = 'completed'`,
  ])

  const c = countRows[0] as Record<string, unknown>
  const total     = parseInt((c?.['total']    as string) ?? '0', 10)
  const pending   = parseInt((c?.['pending']  as string) ?? '0', 10)
  const approved  = parseInt((c?.['approved'] as string) ?? '0', 10)
  const rejected  = parseInt((c?.['rejected'] as string) ?? '0', 10)
  const spam      = parseInt((c?.['spam']     as string) ?? '0', 10)
  const avgRating = parseFloat((avgRows[0]?.['avg_rating'] as string) ?? '0')
  const sent      = parseInt((inviteRows[0]?.['sent'] as string) ?? '0', 10)
  const completed = parseInt((conversionRows[0]?.['completed'] as string) ?? '0', 10)

  return {
    totalReviews:          total,
    pendingReviews:        pending,
    approvedReviews:       approved,
    rejectedReviews:       rejected,
    spamReviews:           spam,
    averageRating:         avgRating,
    totalInvitesSent:      sent,
    inviteConversionRate:  sent > 0 ? completed / sent : 0,
  }
}

// ─── Admin: reviews per day (last 30 days) ─────────────────────────────────

export async function getReviewsPerDay(): Promise<{ date: string; count: number }[]> {
  const rows = await sql`
    SELECT
      date_trunc('day', created_at)::date::text as date,
      COUNT(*) as count
    FROM reviews
    WHERE created_at > now() - interval '30 days'
    GROUP BY date_trunc('day', created_at)
    ORDER BY date_trunc('day', created_at)
  `
  return rows.map(r => ({
    date:  r['date'] as string,
    count: parseInt(r['count'] as string, 10),
  }))
}

// ─── Admin: products with review aggregates ────────────────────────────────

export async function getProductsWithReviews(): Promise<{
  shopifyProductId: string
  totalCount: number
  approvedCount: number
  averageRating: number
  verifiedCount: number
}[]> {
  const rows = await sql`
    SELECT
      shopify_product_id,
      total_count,
      approved_count,
      average_rating,
      verified_count
    FROM review_aggregates
    ORDER BY approved_count DESC
  `
  return rows.map(r => ({
    shopifyProductId: r['shopify_product_id'] as string,
    totalCount:       r['total_count'] as number,
    approvedCount:    r['approved_count'] as number,
    averageRating:    parseFloat(r['average_rating'] as string),
    verifiedCount:    r['verified_count'] as number,
  }))
}

// ─── Create review ─────────────────────────────────────────────────────────

export async function createReview(input: CreateReviewInput): Promise<Review> {
  const rows = await sql`
    INSERT INTO reviews (
      shopify_product_id, shopify_order_id, shopify_customer_id,
      reviewer_name, reviewer_email, rating, title, body,
      is_verified_purchase, is_incentivized, source, invite_token,
      ip_address, user_agent, updated_at
    ) VALUES (
      ${input.shopifyProductId},
      ${input.shopifyOrderId ?? null},
      ${input.shopifyCustomerId ?? null},
      ${input.reviewerName},
      ${input.reviewerEmail},
      ${input.rating},
      ${input.title ?? null},
      ${input.body ?? null},
      ${input.isVerifiedPurchase ?? false},
      ${input.isIncentivized ?? false},
      ${input.source ?? 'organic'},
      ${input.inviteToken ?? null},
      ${input.ipAddress ?? null},
      ${input.userAgent ?? null},
      now()
    )
    RETURNING *
  `

  const review = rowToReview(rows[0] as Record<string, unknown>)

  // Insert attribute ratings if provided
  if (input.attributeRatings && Object.keys(input.attributeRatings).length > 0) {
    for (const [name, rating] of Object.entries(input.attributeRatings)) {
      await sql`
        INSERT INTO review_attribute_ratings (review_id, attribute_name, rating)
        VALUES (${review.id}, ${name}, ${rating})
      `
    }
  }

  // Insert media if provided
  if (input.mediaUrls && input.mediaUrls.length > 0) {
    for (let i = 0; i < input.mediaUrls.length; i++) {
      const m = input.mediaUrls[i]!
      await sql`
        INSERT INTO review_media (review_id, media_type, url, thumbnail_url, sort_order)
        VALUES (${review.id}, ${m.mediaType}, ${m.url}, ${m.thumbnailUrl ?? null}, ${i})
      `
    }
  }

  // Mark invite token as used if provided
  if (input.inviteToken) {
    await sql`
      UPDATE review_invites
      SET status = 'completed', completed_at = now()
      WHERE invite_token = ${input.inviteToken}::uuid
    `.catch(() => {/* non-critical */})
  }

  return review
}

// ─── Update review (moderation) ────────────────────────────────────────────

export async function updateReviewStatus(
  id: string,
  status: Review['status'],
  opts: { moderationNote?: string | undefined; moderatedBy?: string | undefined } = {},
): Promise<Review> {
  const rows = await sql`
    UPDATE reviews
    SET
      status         = ${status},
      moderation_note = ${opts.moderationNote ?? null},
      moderated_by   = ${opts.moderatedBy ?? null},
      moderated_at   = now(),
      updated_at     = now()
    WHERE id = ${id}::uuid
    RETURNING *
  `
  return rowToReview(rows[0] as Record<string, unknown>)
}

export async function updateReviewAI(
  id: string,
  ai: { aiSentiment: string; aiSummary: string; aiSpamScore: number },
): Promise<void> {
  await sql`
    UPDATE reviews
    SET
      ai_sentiment = ${ai.aiSentiment},
      ai_summary   = ${ai.aiSummary},
      ai_spam_score = ${ai.aiSpamScore},
      updated_at   = now()
    WHERE id = ${id}::uuid
  `
}

export async function updateReviewReply(id: string, replyBody: string): Promise<Review> {
  const rows = await sql`
    UPDATE reviews
    SET reply_body = ${replyBody}, reply_at = now(), updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING *
  `
  return rowToReview(rows[0] as Record<string, unknown>)
}

export async function updateReviewFeatured(id: string, isFeatured: boolean): Promise<void> {
  await sql`
    UPDATE reviews SET is_featured = ${isFeatured}, updated_at = now() WHERE id = ${id}::uuid
  `
}

export async function deleteReview(id: string): Promise<void> {
  await sql`DELETE FROM reviews WHERE id = ${id}::uuid`
}

// ─── Helpful votes ─────────────────────────────────────────────────────────

export async function voteHelpful(id: string, vote: 'yes' | 'no'): Promise<{ helpfulYes: number; helpfulNo: number }> {
  // col is derived from a controlled literal — safe to interpolate
  const col = vote === 'yes' ? 'helpful_yes' : 'helpful_no'
  const rows = await sql(
    `UPDATE reviews SET ${col} = ${col} + 1, updated_at = now() WHERE id = $1::uuid RETURNING helpful_yes, helpful_no`,
    [id],
  )
  const row = rows[0] as Record<string, unknown>
  return {
    helpfulYes: row['helpful_yes'] as number,
    helpfulNo:  row['helpful_no'] as number,
  }
}

// ─── Get single review ─────────────────────────────────────────────────────

export async function getReviewById(id: string): Promise<Review | null> {
  const rows = await sql`SELECT * FROM reviews WHERE id = ${id}::uuid`
  if (!rows[0]) return null
  const review = rowToReview(rows[0] as Record<string, unknown>)

  const [mediaRows, attrRows] = await Promise.all([
    sql`SELECT * FROM review_media WHERE review_id = ${id}::uuid ORDER BY sort_order`,
    sql`SELECT * FROM review_attribute_ratings WHERE review_id = ${id}::uuid`,
  ])

  review.media = mediaRows.map(m => rowToMedia(m as Record<string, unknown>))
  review.attributeRatings = attrRows.map(a => rowToAttributeRating(a as Record<string, unknown>))
  return review
}

// ─── Invites ───────────────────────────────────────────────────────────────

export async function createInvite(input: CreateInviteInput): Promise<ReviewInvite> {
  const rows = input.sendAfter
    ? await sql`
        INSERT INTO review_invites (
          shopify_order_id, shopify_customer_id, shopify_product_id,
          reviewer_email, reviewer_name, status, send_after
        ) VALUES (
          ${input.shopifyOrderId},
          ${input.shopifyCustomerId ?? null},
          ${input.shopifyProductId},
          ${input.reviewerEmail},
          ${input.reviewerName},
          'scheduled',
          ${input.sendAfter.toISOString()}
        )
        RETURNING *
      `
    : await sql`
        INSERT INTO review_invites (
          shopify_order_id, shopify_customer_id, shopify_product_id,
          reviewer_email, reviewer_name
        ) VALUES (
          ${input.shopifyOrderId},
          ${input.shopifyCustomerId ?? null},
          ${input.shopifyProductId},
          ${input.reviewerEmail},
          ${input.reviewerName}
        )
        RETURNING *
      `
  return rowToInvite(rows[0] as Record<string, unknown>)
}

/**
 * Product ids already invited for an order, so the fulfillment webhook (which
 * Shopify fires per fulfillment event and retries) and the backfill script can
 * both be idempotent. review_invites has no unique constraint on
 * (order, product); this check is the dedupe.
 */
export async function getInvitedProductIdsForOrder(shopifyOrderId: string): Promise<Set<string>> {
  const rows = await sql`
    SELECT shopify_product_id FROM review_invites WHERE shopify_order_id = ${shopifyOrderId}
  `
  return new Set(rows.map(r => r['shopify_product_id'] as string))
}

/** Scheduled invites whose send_after has passed — the daily cron sends these. */
export async function getDueScheduledInvites(limit = 200): Promise<ReviewInvite[]> {
  const rows = await sql`
    SELECT * FROM review_invites
    WHERE status = 'scheduled' AND send_after <= now()
    ORDER BY send_after ASC
    LIMIT ${limit}
  `
  return rows.map(r => rowToInvite(r as Record<string, unknown>))
}

/** Flip a scheduled invite to sent; sent_at resets so reminder timing counts from the real send. */
export async function markInviteSent(id: string): Promise<void> {
  await sql`
    UPDATE review_invites SET status = 'sent', sent_at = now() WHERE id = ${id}::uuid
  `
}

export async function getInviteByToken(token: string): Promise<ReviewInvite | null> {
  const rows = await sql`
    SELECT * FROM review_invites WHERE invite_token = ${token}::uuid
  `
  if (!rows[0]) return null
  return rowToInvite(rows[0] as Record<string, unknown>)
}

export async function markInviteClicked(token: string): Promise<void> {
  await sql`
    UPDATE review_invites
    SET clicked_at = COALESCE(clicked_at, now()), status = 'clicked'
    WHERE invite_token = ${token}::uuid AND status NOT IN ('completed', 'expired')
  `
}

export async function markInviteOpened(token: string): Promise<void> {
  await sql`
    UPDATE review_invites
    SET opened_at = COALESCE(opened_at, now()), status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END
    WHERE invite_token = ${token}::uuid
  `
}

export async function getPendingReminderInvites(): Promise<ReviewInvite[]> {
  const rows = await sql`
    SELECT * FROM review_invites
    WHERE sent_at < now() - interval '5 days'
      AND reminder_sent_at IS NULL
      AND status NOT IN ('scheduled', 'completed', 'expired')
  `
  return rows.map(r => rowToInvite(r as Record<string, unknown>))
}

export async function markReminderSent(id: string): Promise<void> {
  await sql`
    UPDATE review_invites SET reminder_sent_at = now() WHERE id = ${id}::uuid
  `
}

export async function getInviteStats(): Promise<{
  sent: number
  opened: number
  clicked: number
  completed: number
}> {
  const rows = await sql`
    SELECT
      COUNT(*) as sent,
      COUNT(*) FILTER (WHERE status IN ('opened','clicked','completed')) as opened,
      COUNT(*) FILTER (WHERE status IN ('clicked','completed')) as clicked,
      COUNT(*) FILTER (WHERE status = 'completed') as completed
    FROM review_invites
  `
  const r = rows[0] as Record<string, unknown>
  return {
    sent:      parseInt((r?.['sent']      as string) ?? '0', 10),
    opened:    parseInt((r?.['opened']    as string) ?? '0', 10),
    clicked:   parseInt((r?.['clicked']   as string) ?? '0', 10),
    completed: parseInt((r?.['completed'] as string) ?? '0', 10),
  }
}

export async function getPaginatedInvites(
  page = 1,
  perPage = 20,
): Promise<{ invites: ReviewInvite[]; total: number }> {
  const offset = (page - 1) * perPage
  const [rows, countRows] = await Promise.all([
    sql`
      SELECT * FROM review_invites
      ORDER BY sent_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `,
    sql`SELECT COUNT(*) as total FROM review_invites`,
  ])
  return {
    invites: rows.map(r => rowToInvite(r as Record<string, unknown>)),
    total:   parseInt((countRows[0]?.['total'] as string) ?? '0', 10),
  }
}

// ─── Settings ──────────────────────────────────────────────────────────────

export async function getReviewSettings(): Promise<ReviewSettings> {
  const rows = await sql`SELECT * FROM review_settings WHERE id = 1`
  const r = (rows[0] ?? {}) as Record<string, unknown>
  return {
    autoApprove:           (r['auto_approve'] as boolean) ?? false,
    spamThreshold:         parseFloat((r['spam_threshold'] as string) ?? '0.75'),
    minBodyLength:         (r['min_body_length'] as number) ?? 0,
    requireTitle:          (r['require_title'] as boolean) ?? false,
    inviteDelayDays:       (r['invite_delay_days'] as number) ?? 3,
    reminderDelayDays:     (r['reminder_delay_days'] as number) ?? 5,
    remindersEnabled:      (r['reminders_enabled'] as boolean) ?? true,
    reviewsPerPage:        (r['reviews_per_page'] as number) ?? 10,
    defaultSort:           (r['default_sort'] as string) ?? 'newest',
    showAiSummaries:       (r['show_ai_summaries'] as boolean) ?? true,
    showIncentivizedLabel: (r['show_incentivized_label'] as boolean) ?? true,
    digestEmail:           (r['digest_email'] as string | null) ?? null,
    webhookUrl:            (r['webhook_url'] as string | null) ?? null,
  }
}

export async function updateReviewSettings(settings: Partial<ReviewSettings>): Promise<void> {
  await sql`
    UPDATE review_settings SET
      auto_approve           = COALESCE(${settings.autoApprove ?? null}::boolean, auto_approve),
      spam_threshold         = COALESCE(${settings.spamThreshold ?? null}::numeric, spam_threshold),
      min_body_length        = COALESCE(${settings.minBodyLength ?? null}::int, min_body_length),
      require_title          = COALESCE(${settings.requireTitle ?? null}::boolean, require_title),
      invite_delay_days      = COALESCE(${settings.inviteDelayDays ?? null}::int, invite_delay_days),
      reminder_delay_days    = COALESCE(${settings.reminderDelayDays ?? null}::int, reminder_delay_days),
      reminders_enabled      = COALESCE(${settings.remindersEnabled ?? null}::boolean, reminders_enabled),
      reviews_per_page       = COALESCE(${settings.reviewsPerPage ?? null}::int, reviews_per_page),
      default_sort           = COALESCE(${settings.defaultSort ?? null}, default_sort),
      show_ai_summaries      = COALESCE(${settings.showAiSummaries ?? null}::boolean, show_ai_summaries),
      show_incentivized_label= COALESCE(${settings.showIncentivizedLabel ?? null}::boolean, show_incentivized_label),
      digest_email           = ${settings.digestEmail ?? null},
      webhook_url            = ${settings.webhookUrl ?? null},
      updated_at             = now()
    WHERE id = 1
  `
}

// ─── Export helpers ────────────────────────────────────────────────────────

export async function getReviewsForExport(filters: AdminReviewFilters = {}): Promise<Review[]> {
  const { status, productId } = filters
  const conditions: string[] = []
  const params: unknown[] = []
  let pIdx = 1

  if (status && status !== 'all') {
    conditions.push(`status = $${pIdx++}`)
    params.push(status)
  }
  if (productId) {
    conditions.push(`shopify_product_id = $${pIdx++}`)
    params.push(productId)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await sql(`SELECT * FROM reviews ${where} ORDER BY created_at DESC`, params)
  return rows.map(r => rowToReview(r as Record<string, unknown>))
}
