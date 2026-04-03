const BASE = 'https://a.klaviyo.com/api'

async function klaviyoFetch<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept:         'application/json',
      'content-type': 'application/json',
      revision:       '2024-10-15',
      Authorization:  `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY']}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Klaviyo API error ${res.status}: ${text}`)
  }
  if (res.status === 204) return {} as T
  return res.json() as Promise<T>
}

export async function subscribeToList(listId: string, email: string, firstName?: string): Promise<void> {
  await klaviyoFetch('/profile-subscription-bulk-create-jobs/', 'POST', {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [{
            type: 'profile',
            attributes: {
              email,
              first_name: firstName ?? '',
              subscriptions: {
                email: { marketing: { consent: 'SUBSCRIBED' } },
              },
            },
          }],
        },
      },
      relationships: {
        list: { data: { type: 'list', id: listId } },
      },
    },
  })
}

export async function subscribeToDailyDeal(email: string, firstName?: string): Promise<void> {
  const listId = process.env['KLAVIYO_LIST_ID_DAILY_DEAL']!
  await subscribeToList(listId, email, firstName)
}

export async function subscribeToWaitlist(email: string, productHandle: string): Promise<void> {
  const listId = process.env['KLAVIYO_LIST_ID_WAITLIST']!
  await klaviyoFetch('/profile-subscription-bulk-create-jobs/', 'POST', {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [{
            type: 'profile',
            attributes: {
              email,
              properties: { waitlist_product: productHandle },
              subscriptions: {
                email: { marketing: { consent: 'SUBSCRIBED' } },
              },
            },
          }],
        },
      },
      relationships: {
        list: { data: { type: 'list', id: listId } },
      },
    },
  })
}

export async function trackEvent(
  email: string,
  eventName: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await klaviyoFetch('/events/', 'POST', {
    data: {
      type: 'event',
      attributes: {
        metric:  { data: { type: 'metric', attributes: { name: eventName } } },
        profile: { data: { type: 'profile', attributes: { email } } },
        properties,
      },
    },
  })
}

// ─── Review events ─────────────────────────────────────────────────────────

/**
 * Fire when a new review is submitted.
 * Triggers the "Review Submitted" Klaviyo flow.
 */
export async function trackReviewSubmitted(params: {
  email: string
  reviewerName: string
  shopifyProductId: string
  rating: number
  reviewId: string
  isVerifiedPurchase: boolean
}): Promise<void> {
  await trackEvent(params.email, 'Review Submitted', {
    reviewer_name:        params.reviewerName,
    shopify_product_id:   params.shopifyProductId,
    rating:               params.rating,
    review_id:            params.reviewId,
    is_verified_purchase: params.isVerifiedPurchase,
    submitted_at:         new Date().toISOString(),
  })
}

/**
 * Fire when a review is approved and published.
 * Can trigger a "Your review is live!" email.
 */
export async function trackReviewApproved(params: {
  email: string
  reviewerName: string
  shopifyProductId: string
  reviewId: string
}): Promise<void> {
  await trackEvent(params.email, 'Review Approved', {
    reviewer_name:      params.reviewerName,
    shopify_product_id: params.shopifyProductId,
    review_id:          params.reviewId,
    approved_at:        new Date().toISOString(),
  })
}

/**
 * Fire when a review invite is sent.
 * Triggers the "Review Request" Klaviyo flow.
 */
export async function trackReviewInviteSent(params: {
  email: string
  reviewerName: string
  shopifyProductId: string
  shopifyOrderId: string
  inviteToken: string
}): Promise<void> {
  await trackEvent(params.email, 'Review Invite Sent', {
    reviewer_name:      params.reviewerName,
    shopify_product_id: params.shopifyProductId,
    shopify_order_id:   params.shopifyOrderId,
    invite_token:       params.inviteToken,
    invite_url:         `https://xdipx.com/api/reviews/invite/${params.inviteToken}`,
    sent_at:            new Date().toISOString(),
  })
}

/**
 * Fire when a review invite reminder is sent.
 */
export async function trackReviewReminderSent(params: {
  email: string
  reviewerName: string
  shopifyProductId: string
  inviteToken: string
}): Promise<void> {
  await trackEvent(params.email, 'Review Reminder Sent', {
    reviewer_name:      params.reviewerName,
    shopify_product_id: params.shopifyProductId,
    invite_token:       params.inviteToken,
    invite_url:         `https://xdipx.com/api/reviews/invite/${params.inviteToken}`,
    reminder_at:        new Date().toISOString(),
  })
}

export async function triggerDailyDealEmail(deal: {
  title: string
  tagline: string
  dealPrice: number
  msrp: number
  handle: string
  imageUrl: string
  subjectLine: string
}): Promise<void> {
  // Fire a "Deal Activated" event — Klaviyo flow picks it up
  await klaviyoFetch('/events/', 'POST', {
    data: {
      type: 'event',
      attributes: {
        metric:  { data: { type: 'metric', attributes: { name: 'Daily Deal Activated' } } },
        profile: { data: { type: 'profile', attributes: { email: 'broadcast@xdipx.com' } } },
        properties: { ...deal },
      },
    },
  })
}
