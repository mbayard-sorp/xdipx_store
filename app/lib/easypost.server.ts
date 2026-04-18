/**
 * EasyPost return-label purchase.
 *
 * Flow:
 *   1. Create Shipment (from=customer, to=Nalpac warehouse, parcel=dims/weight).
 *      EasyPost auto-fetches rates from all carriers enabled on the account.
 *   2. Pick the cheapest USPS Ground Advantage rate (fallback: cheapest overall).
 *   3. Buy the label — response contains PDF URL, tracking number, actual cost.
 *
 * Server-only. Never import from a client component.
 */

const EASYPOST_API = 'https://api.easypost.com/v2'

export interface EasyPostAddress {
  name?: string
  company?: string
  street1: string
  street2?: string
  city: string
  state: string
  zip: string
  country: string
  phone?: string
  email?: string
}

export interface EasyPostParcel {
  /** Inches. */
  length: number
  width:  number
  height: number
  /** Ounces. */
  weight: number
}

export interface EasyPostLabelResult {
  labelUrl:       string
  trackingNumber: string
  trackingUrl:    string | null
  costCents:      number
  carrier:        string
  service:        string
}

function authHeader(): string {
  const key = process.env['EASYPOST_API_KEY']
  if (!key) throw new Error('EASYPOST_API_KEY not set')
  // EasyPost uses HTTP Basic with key as username and empty password.
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64')
}

async function easypostFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${EASYPOST_API}${path}`, {
    ...init,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': authHeader(),
      ...(init.headers ?? {}),
    },
  })
  const body = await res.text()
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { parsed = body }
  if (!res.ok) {
    const err = parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed as { error: { message?: string; errors?: unknown } }).error
      : null
    const details = err?.errors ? ` — ${JSON.stringify(err.errors)}` : ''
    throw new Error(`EasyPost ${res.status}: ${err?.message ?? body.slice(0, 200)}${details}`)
  }
  return parsed as T
}

export type VerifyAddressResult =
  | { ok: true }
  | { ok: false; code: 'undeliverable' | 'incomplete' | 'unknown'; message: string }

/**
 * Ask EasyPost to verify an address is deliverable by USPS before we commit
 * to creating a Shopify return. Returns a structured result so callers can
 * show a user-friendly message.
 */
export async function verifyAddress(addr: EasyPostAddress): Promise<VerifyAddressResult> {
  try {
    const res = await easypostFetch<{
      verifications?: { delivery?: { success: boolean; errors?: { code: string; message: string }[] } }
    }>('/addresses', {
      method: 'POST',
      body: JSON.stringify({
        address: { ...addr, verify: ['delivery'] },
      }),
    })
    const delivery = res.verifications?.delivery
    if (!delivery || delivery.success) return { ok: true }
    const err = delivery.errors?.[0]
    return {
      ok: false,
      code: classifyAddressError(err?.code),
      message: err?.message ?? 'Address could not be verified.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/ADDRESS\.NOT_FOUND|Unable to verify address/i.test(msg)) {
      return { ok: false, code: 'undeliverable', message: 'Address not deliverable by USPS.' }
    }
    return { ok: false, code: 'unknown', message: msg }
  }
}

function classifyAddressError(code: string | undefined): 'undeliverable' | 'incomplete' | 'unknown' {
  if (!code) return 'unknown'
  if (/NOT_FOUND|UNDELIVERABLE/i.test(code)) return 'undeliverable'
  if (/INCOMPLETE|MISSING|REQUIRED/i.test(code)) return 'incomplete'
  return 'unknown'
}

interface EasyPostRate {
  id:       string
  carrier:  string
  service:  string
  rate:     string // dollars as string
}

interface EasyPostShipment {
  id:          string
  rates:       EasyPostRate[]
  postage_label: { label_url: string } | null
  tracking_code: string | null
  tracker:     { public_url: string | null } | null
  selected_rate: EasyPostRate | null
}

/** Create a shipment and buy a label in one call. Uses cheapest USPS Ground Advantage. */
export async function buyReturnLabel(input: {
  from:   EasyPostAddress
  to:     EasyPostAddress
  parcel: EasyPostParcel
}): Promise<EasyPostLabelResult> {
  const shipment = await easypostFetch<EasyPostShipment>('/shipments', {
    method: 'POST',
    body: JSON.stringify({
      shipment: {
        // For a return-shipping label the package physically moves
        // customer → warehouse. from_address = customer (sender),
        // to_address = warehouse (destination). We intentionally do NOT set
        // `is_return: true` because EasyPost swaps the label's rendered
        // addresses when that flag is on, printing the warehouse as the
        // sender — which is backwards for a customer-drops-off return.
        from_address: input.from,
        to_address:   input.to,
        parcel: {
          length: input.parcel.length,
          width:  input.parcel.width,
          height: input.parcel.height,
          weight: input.parcel.weight,
        },
      },
    }),
  })

  const rate = pickRate(shipment.rates)
  if (!rate) throw new Error('No shippable rate returned by EasyPost')

  const bought = await easypostFetch<EasyPostShipment>(`/shipments/${shipment.id}/buy`, {
    method: 'POST',
    body: JSON.stringify({ rate: { id: rate.id } }),
  })

  if (!bought.postage_label?.label_url) {
    throw new Error('EasyPost bought shipment but returned no label URL')
  }
  if (!bought.tracking_code) {
    throw new Error('EasyPost bought shipment but returned no tracking code')
  }

  return {
    labelUrl:       bought.postage_label.label_url,
    trackingNumber: bought.tracking_code,
    trackingUrl:    bought.tracker?.public_url ?? null,
    costCents:      Math.round(parseFloat(bought.selected_rate?.rate ?? rate.rate) * 100),
    carrier:        bought.selected_rate?.carrier ?? rate.carrier,
    service:        bought.selected_rate?.service ?? rate.service,
  }
}

function pickRate(rates: EasyPostRate[]): EasyPostRate | null {
  const usps = rates.filter(r => r.carrier === 'USPS')
  const ground = usps.find(r => /GroundAdvantage/i.test(r.service))
  if (ground) return ground
  if (usps.length > 0) return cheapest(usps)
  return rates.length > 0 ? cheapest(rates) : null
}

function cheapest(rates: EasyPostRate[]): EasyPostRate {
  return rates.reduce((a, b) => (parseFloat(a.rate) <= parseFloat(b.rate) ? a : b))
}

export function nalpacAddress(): EasyPostAddress {
  const street1 = process.env['NALPAC_WAREHOUSE_STREET1']
  const city    = process.env['NALPAC_WAREHOUSE_CITY']
  const state   = process.env['NALPAC_WAREHOUSE_STATE']
  const zip     = process.env['NALPAC_WAREHOUSE_ZIP']
  if (!street1 || !city || !state || !zip) {
    throw new Error('Nalpac warehouse address env vars not set')
  }
  const addr: EasyPostAddress = {
    name:    process.env['NALPAC_WAREHOUSE_NAME'] ?? 'Nalpac Returns',
    street1,
    city,
    state,
    zip,
    country: process.env['NALPAC_WAREHOUSE_COUNTRY'] ?? 'US',
  }
  const street2 = process.env['NALPAC_WAREHOUSE_STREET2']
  if (street2) addr.street2 = street2
  const phone = process.env['NALPAC_WAREHOUSE_PHONE']
  if (phone) addr.phone = phone
  return addr
}
