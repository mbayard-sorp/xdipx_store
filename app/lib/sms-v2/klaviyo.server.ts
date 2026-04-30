/**
 * app/lib/sms-v2/klaviyo.server.ts
 *
 * SMS-channel Klaviyo subscription helpers for the v2 pipeline.
 *
 * Uses the same Klaviyo API client pattern as app/lib/klaviyo.server.ts
 * (direct HTTPS fetch to Klaviyo REST API v2024-10-15).
 *
 * List ID is configured via KLAVIYO_SMS_LIST_ID env var.
 * Failure is always non-fatal — callers should catch or fire-and-forget.
 */

const BASE = 'https://a.klaviyo.com/api'

async function klaviyoFetch<T>(
  path: string,
  method = 'POST',
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      accept:         'application/json',
      'content-type': 'application/json',
      revision:       '2024-10-15',
      Authorization:  `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY'] ?? ''}`,
    },
  }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Klaviyo SMS API error ${res.status}: ${text}`)
  }
  if (res.status === 204 || res.status === 202) return {} as T
  const text = await res.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

export interface SmsSubscribeOpts {
  /** Attribution source tag — stored in the profile's properties. */
  source: string
  /** When the subscriber confirmed consent. */
  consentTimestamp: Date
}

/**
 * Subscribe an E.164 phone number to the SMS marketing list.
 *
 * Uses Klaviyo's /profile-subscription-bulk-create-jobs/ endpoint with
 * sms marketing consent. List ID comes from KLAVIYO_SMS_LIST_ID env var.
 *
 * Throws on API error — callers should treat failure as non-fatal.
 */
export async function subscribeToSms(
  phone: string,
  opts: SmsSubscribeOpts,
): Promise<void> {
  const listId = process.env['KLAVIYO_SMS_LIST_ID']
  if (!listId) {
    console.warn('[klaviyo-sms] KLAVIYO_SMS_LIST_ID not set — skipping SMS subscribe')
    return
  }

  const apiKey = process.env['KLAVIYO_API_KEY']
  if (!apiKey) {
    console.warn('[klaviyo-sms] KLAVIYO_API_KEY not set — skipping SMS subscribe')
    return
  }

  await klaviyoFetch('/profile-subscription-bulk-create-jobs/', 'POST', {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [
            {
              type: 'profile',
              attributes: {
                phone_number: phone,
                properties: {
                  sms_source: opts.source,
                  sms_consent_at: opts.consentTimestamp.toISOString(),
                },
                subscriptions: {
                  sms: {
                    marketing: {
                      consent: 'SUBSCRIBED',
                      consented_at: opts.consentTimestamp.toISOString(),
                    },
                  },
                },
              },
            },
          ],
        },
      },
      relationships: {
        list: { data: { type: 'list', id: listId } },
      },
    },
  })
}
