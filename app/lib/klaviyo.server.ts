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
