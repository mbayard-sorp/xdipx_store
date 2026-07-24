const BASE = 'https://a.klaviyo.com/api'

async function klaviyoFetch<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      accept:         'application/json',
      'content-type': 'application/json',
      revision:       '2024-10-15',
      Authorization:  `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY']}`,
    },
  }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Klaviyo API error ${res.status}: ${text}`)
  }
  if (res.status === 204 || res.status === 202) return {} as T
  const text = await res.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

/**
 * Subscribe a profile to a list. Optional `properties` are custom profile
 * properties (e.g. signup_source, utm_source) set via the bulk-subscribe
 * payload's profile attributes, so attribution lands in the same call.
 */
export async function subscribeToList(
  listId: string,
  email: string,
  firstName?: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const profileAttrs: Record<string, unknown> = {
    email,
    subscriptions: {
      email: { marketing: { consent: 'SUBSCRIBED' } },
    },
  }
  if (firstName) profileAttrs.first_name = firstName
  if (properties && Object.keys(properties).length > 0) profileAttrs.properties = properties

  await klaviyoFetch('/profile-subscription-bulk-create-jobs/', 'POST', {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [{ type: 'profile', attributes: profileAttrs }],
        },
      },
      relationships: {
        list: { data: { type: 'list', id: listId } },
      },
    },
  })
}

export async function subscribeToDailyDeal(
  email: string,
  firstName?: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const listId = process.env['KLAVIYO_LIST_ID_DAILY_DEAL']!
  await subscribeToList(listId, email, firstName, properties)
}

export async function subscribeToWaitlist(email: string, productHandle: string): Promise<void> {
  const listId = process.env['KLAVIYO_LIST_ID_WAITLIST']!

  // Subscribe profile to the waitlist list
  await klaviyoFetch('/profile-subscription-bulk-create-jobs/', 'POST', {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [{
            type: 'profile',
            attributes: {
              email,
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

  // Track which product they want so we can notify them later
  await trackEvent(email, 'Waitlist Signup', { product_handle: productHandle })
}

export async function trackEvent(
  email: string,
  eventName: string,
  properties: Record<string, unknown>,
  opts: { uniqueId?: string } = {},
): Promise<void> {
  const attributes: Record<string, unknown> = {
    metric:  { data: { type: 'metric', attributes: { name: eventName } } },
    profile: { data: { type: 'profile', attributes: { email } } },
    properties,
  }
  // Klaviyo dedupes events sharing a unique_id, so a retried webhook or a repeat
  // checkout click does not double-count.
  if (opts.uniqueId) attributes['unique_id'] = opts.uniqueId
  await klaviyoFetch('/events/', 'POST', { data: { type: 'event', attributes } })
}

interface LineItemInfo { productHandle?: string; productTitle?: string; variantId?: string; price?: number; quantity?: number }

/**
 * Cart/checkout/order lifecycle events. These are the trigger metrics for
 * abandoned-cart, browse-abandonment, and post-purchase Klaviyo flows, which
 * could not fire before because the headless storefront never sent them. All
 * swallow-and-log: analytics must never break a cart action or an order webhook.
 * Events need a profile identifier, so anonymous carts produce no event.
 */
export async function trackAddedToCart(email: string, item: LineItemInfo & { cartId?: string }): Promise<void> {
  try {
    await trackEvent(email, 'Added to Cart', { ...item })
  } catch (err) {
    console.error('[klaviyo] trackAddedToCart failed:', err instanceof Error ? err.message : err)
  }
}

export async function trackStartedCheckout(email: string, params: { cartId: string; value: number; currency: string; items: LineItemInfo[]; uniqueId?: string }): Promise<void> {
  try {
    const opts = params.uniqueId ? { uniqueId: params.uniqueId } : {}
    await trackEvent(email, 'Started Checkout', { cartId: params.cartId, value: params.value, currency: params.currency, items: params.items }, opts)
  } catch (err) {
    console.error('[klaviyo] trackStartedCheckout failed:', err instanceof Error ? err.message : err)
  }
}

export async function trackPlacedOrder(email: string, params: { orderId: string; orderNumber?: string | number; value: number; currency: string; items: LineItemInfo[]; attribution?: Record<string, string> }): Promise<void> {
  try {
    await trackEvent(
      email,
      'Placed Order',
      // Optional attribution props (utm_source etc., extracted from the order's
      // note_attributes by the webhook) ride along on the event.
      { orderId: params.orderId, orderNumber: params.orderNumber, value: params.value, currency: params.currency, items: params.items, ...(params.attribution ?? {}) },
      { uniqueId: `placed_order_${params.orderId}` },
    )
  } catch (err) {
    console.error('[klaviyo] trackPlacedOrder failed:', err instanceof Error ? err.message : err)
  }
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

// ─── Preference management (Phase 0B) ─────────────────────────────────────
//
// These functions back the /account/preferences surface: look up a profile,
// inspect its current list memberships across the two app-managed lists
// (Daily Deal + Waitlist), and diff-apply subscribe/unsubscribe changes.

/** All list IDs this app manages. Filters out any that are not configured. */
function knownListIds(): string[] {
  const ids = [
    process.env['KLAVIYO_LIST_ID_DAILY_DEAL'],
    process.env['KLAVIYO_LIST_ID_WAITLIST'],
  ]
  return ids.filter((id): id is string => !!id)
}

/**
 * Look up a Klaviyo profile by email. Returns `{ id }` or null if no match.
 * Uses GET /api/profiles/?filter=equals(email,"…") (v2024-10-15).
 */
export async function getProfileByEmail(
  email: string,
): Promise<{ id: string } | null> {
  try {
    // Klaviyo filter language requires the value to be a quoted string.
    // The URL-encoded equivalent of `filter=equals(email,"foo@bar.com")`.
    const filter = `equals(email,"${email}")`
    const path = `/profiles/?filter=${encodeURIComponent(filter)}`
    const res = await klaviyoFetch<{
      data?: {
        id: string
        type: string
        attributes: { email: string }
      }[]
    }>(path, 'GET')
    const first = res.data?.[0]
    return first ? { id: first.id } : null
  } catch (err) {
    // Swallow 404 → null; rethrow would prevent /account/preferences from loading.
    console.error('[klaviyo.getProfileByEmail] failed:', err)
    return null
  }
}

/**
 * List IDs (not names) that the profile is currently subscribed to,
 * across the app's known lists (Daily Deal + Waitlist).
 * Returns an array like [{ listId, subscribed }].
 *
 * If the profile does not exist, returns every known list with
 * `subscribed: false` so the UI can still render.
 */
export async function getProfileSubscriptions(
  email: string,
): Promise<{ listId: string; subscribed: boolean }[]> {
  const known = knownListIds()
  if (known.length === 0) return []

  const profile = await getProfileByEmail(email)
  if (!profile) {
    return known.map(listId => ({ listId, subscribed: false }))
  }

  try {
    const res = await klaviyoFetch<{
      data?: { type: string; id: string }[]
    }>(`/profiles/${profile.id}/relationships/lists/`, 'GET')

    const memberships = new Set((res.data ?? []).map(d => d.id))
    return known.map(listId => ({
      listId,
      subscribed: memberships.has(listId),
    }))
  } catch (err) {
    console.error('[klaviyo.getProfileSubscriptions] failed:', err)
    return known.map(listId => ({ listId, subscribed: false }))
  }
}

/**
 * Unsubscribe a single profile from a single list.
 * Uses POST /api/profile-subscription-bulk-delete-jobs/ (v2024-10-15).
 */
export async function unsubscribeFromList(
  listId: string,
  email: string,
): Promise<void> {
  await klaviyoFetch('/profile-subscription-bulk-delete-jobs/', 'POST', {
    data: {
      type: 'profile-subscription-bulk-delete-job',
      attributes: {
        profiles: {
          data: [{ type: 'profile', attributes: { email } }],
        },
      },
      relationships: {
        list: { data: { type: 'list', id: listId } },
      },
    },
  })
}

/**
 * Diff-apply a set of list-subscription updates for a profile.
 * Calls subscribeToList / unsubscribeFromList per entry.
 * Swallows per-entry errors so one failure doesn't block the rest —
 * the failure is logged and we continue.
 */
export async function updatePreferences(
  email: string,
  updates: { listId: string; subscribed: boolean }[],
): Promise<void> {
  for (const { listId, subscribed } of updates) {
    try {
      if (subscribed) {
        await subscribeToList(listId, email)
      } else {
        await unsubscribeFromList(listId, email)
      }
    } catch (err) {
      console.error(
        `[klaviyo.updatePreferences] failed for list=${listId} subscribed=${subscribed}:`,
        err,
      )
    }
  }
}

/**
 * Unsubscribe from every list the app knows about
 * (KLAVIYO_LIST_ID_DAILY_DEAL + KLAVIYO_LIST_ID_WAITLIST).
 * Used by "Unsubscribe from all" and account-delete flows.
 * Swallows individual failures.
 */
export async function unsubscribeAll(email: string): Promise<void> {
  for (const listId of knownListIds()) {
    try {
      await unsubscribeFromList(listId, email)
    } catch (err) {
      console.error(
        `[klaviyo.unsubscribeAll] failed for list=${listId}:`,
        err,
      )
    }
  }
}

/**
 * Update custom profile properties on a Klaviyo profile.
 * Used by the "Tell us about you" profile section to sync
 * gender_identity, relationship_status, date_of_birth, anniversaries.
 * Swallows errors so a Klaviyo outage never blocks the DB save.
 */
export async function updateProfileProperties(
  email: string,
  properties: Record<string, string | null>,
): Promise<void> {
  try {
    const profile = await getProfileByEmail(email)
    if (!profile) {
      console.warn('[klaviyo.updateProfileProperties] no profile found for', email)
      return
    }
    await klaviyoFetch(`/profiles/${profile.id}/`, 'PATCH', {
      data: {
        type: 'profile',
        id: profile.id,
        attributes: { properties },
      },
    })
  } catch (err) {
    console.error('[klaviyo.updateProfileProperties] failed:', err)
  }
}

// ─── Wishlist events & sync ─────────────────────────────────────────────────

type WishlistItemInfo = {
  productHandle: string
  productTitle?: string
  price?: string | number
  listName?: string
}

export async function trackWishlistAdded(email: string, item: WishlistItemInfo): Promise<void> {
  try {
    await trackEvent(email, 'Added to Wishlist', {
      product_handle: item.productHandle,
      product_title:  item.productTitle ?? null,
      price:          item.price ?? null,
      list_name:      item.listName ?? null,
      added_at:       new Date().toISOString(),
    })
  } catch (err) {
    console.error('[klaviyo.trackWishlistAdded] failed:', err)
  }
}

export async function trackWishlistRemoved(email: string, item: { productHandle: string; listName?: string }): Promise<void> {
  try {
    await trackEvent(email, 'Removed from Wishlist', {
      product_handle: item.productHandle,
      list_name:      item.listName ?? null,
      removed_at:     new Date().toISOString(),
    })
  } catch (err) {
    console.error('[klaviyo.trackWishlistRemoved] failed:', err)
  }
}

/**
 * Sync the customer's current wishlist state to their Klaviyo profile so flows
 * can segment on wishlist_count / filter by wishlist_handles.
 * Accepts a wider property shape than updateProfileProperties (arrays + numbers).
 */
export async function syncWishlistProfileProperty(
  email: string,
  handles: string[],
): Promise<void> {
  try {
    const profile = await getProfileByEmail(email)
    if (!profile) {
      console.warn('[klaviyo.syncWishlistProfileProperty] no profile found for', email)
      return
    }
    await klaviyoFetch(`/profiles/${profile.id}/`, 'PATCH', {
      data: {
        type: 'profile',
        id: profile.id,
        attributes: {
          properties: {
            wishlist_handles: handles,
            wishlist_count:   handles.length,
          },
        },
      },
    })
  } catch (err) {
    console.error('[klaviyo.syncWishlistProfileProperty] failed:', err)
  }
}
