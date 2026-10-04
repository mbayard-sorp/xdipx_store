/**
 * Klaviyo flows and templates client (Ad Studio v2 PR-F).
 *
 * Today's `klaviyo.server.ts` fires events and manages lists, and
 * `klaviyo-campaigns.server.ts` creates draft campaigns. Neither can touch
 * flows or templates. This module adds the typed helpers the browse
 * abandonment, cart abandonment and post-purchase flows need: list and get
 * flows, create a template (HTML plus text), create a flow with its trigger,
 * delays and email steps, and the header-asset picker the templates read
 * through event properties.
 *
 * Nothing here can send. Flows are always created with status `draft` and every
 * email action carries message status `draft`. Setting a flow live is a manual
 * owner step in Klaviyo (docs/store-team/klaviyo-flows.md). There is
 * deliberately no helper that changes a flow's status.
 *
 * The flows and templates endpoints are on revision 2026-07-15 (the revision the
 * Create Flow reference documents). The rest of the app stays on 2024-10-15.
 */

import {
  EMAIL_HEADER_PX,
  FLOW_EMAILS,
  FLOW_EVENT_PROPERTY_KEYS,
  flowTemplateName,
  renderFlowEmail,
  type FlowEmailSpec,
  type FlowSlug,
} from './klaviyo-flow-templates'

const KLAVIYO_BASE = 'https://a.klaviyo.com/api'
export const KLAVIYO_FLOWS_REVISION = '2026-07-15'

export const FLOW_NAMES: Record<FlowSlug, string> = {
  'browse-abandonment': 'xdipx Browse Abandonment',
  'cart-abandonment': 'xdipx Cart Abandonment',
  'post-purchase': 'xdipx Post-Purchase',
}

/**
 * The metric each flow triggers on. Names match what klaviyo.server.ts fires.
 * Cart abandonment triggers on Added to Cart, the one cart event that exists in
 * this Klaviyo account today (verified 2026-10-03). "Started Checkout" has never
 * fired (only the SMS cart-link path sends it) and "Viewed Product" has never
 * been sent by anything, so those metrics do not exist yet.
 */
export const FLOW_TRIGGER_METRICS: Record<FlowSlug, string> = {
  'browse-abandonment': 'Viewed Product',
  'cart-abandonment': 'Added to Cart',
  'post-purchase': 'Placed Order',
}

async function flowFetch<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      revision: KLAVIYO_FLOWS_REVISION,
      Authorization: `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY']}`,
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(`${KLAVIYO_BASE}${path}`, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`Klaviyo ${method} ${path} ${res.status}: ${text.slice(0, 1500)}`)
  return (text ? JSON.parse(text) : {}) as T
}

interface Resource<A = Record<string, unknown>> {
  type: string
  id: string
  attributes: A
}
interface ListResponse<A> {
  data: Resource<A>[]
  links?: { next?: string | null }
}

// ─── Flows ────────────────────────────────────────────────────────────────

export interface KlaviyoFlowSummary {
  id: string
  name: string
  status: string
  triggerType: string | null
}

/** Follows pagination so a name lookup never misses a flow past page one. */
export async function listFlows(): Promise<KlaviyoFlowSummary[]> {
  const out: KlaviyoFlowSummary[] = []
  let path: string | null = '/flows/?fields[flow]=name,status,trigger_type&page[size]=50'
  for (let i = 0; i < 20 && path; i++) {
    const res: ListResponse<{ name: string; status: string; trigger_type?: string }> = await flowFetch(path)
    for (const r of res.data ?? []) {
      out.push({ id: r.id, name: r.attributes.name, status: r.attributes.status, triggerType: r.attributes.trigger_type ?? null })
    }
    const next = res.links?.next
    path = next ? next.replace(KLAVIYO_BASE, '') : null
  }
  return out
}

export async function getFlow(id: string, withDefinition = true): Promise<Resource> {
  const q = withDefinition ? '?additional-fields[flow]=definition' : ''
  const res = await flowFetch<{ data: Resource }>(`/flows/${encodeURIComponent(id)}/${q}`)
  return res.data
}

// ─── Templates ────────────────────────────────────────────────────────────

export interface KlaviyoTemplateSummary {
  id: string
  name: string
}

export async function listTemplates(): Promise<KlaviyoTemplateSummary[]> {
  const out: KlaviyoTemplateSummary[] = []
  // The templates endpoint caps page size at 10.
  let path: string | null = '/templates/?fields[template]=name&page[size]=10'
  for (let i = 0; i < 100 && path; i++) {
    const res: ListResponse<{ name: string }> = await flowFetch(path)
    for (const r of res.data ?? []) out.push({ id: r.id, name: r.attributes.name })
    const next = res.links?.next
    path = next ? next.replace(KLAVIYO_BASE, '') : null
  }
  return out
}

export async function createTemplate(input: { name: string; html: string; text: string }): Promise<KlaviyoTemplateSummary> {
  const res = await flowFetch<{ data: Resource<{ name: string }> }>('/templates/', 'POST', {
    data: {
      type: 'template',
      attributes: { name: input.name, editor_type: 'CODE', html: input.html, text: input.text },
    },
  })
  return { id: res.data.id, name: res.data.attributes.name }
}

/** Overwrite a template's HTML and text. Used only by the setup script's --update-templates flag. */
export async function updateTemplate(id: string, input: { html: string; text: string }): Promise<void> {
  await flowFetch(`/templates/${encodeURIComponent(id)}/`, 'PATCH', {
    data: { type: 'template', id, attributes: { html: input.html, text: input.text } },
  })
}

// ─── Metrics ──────────────────────────────────────────────────────────────

/** Metric ids by name. A metric exists only after its first event arrives. */
export async function getMetricIdsByName(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let path: string | null = '/metrics/?fields[metric]=name'
  for (let i = 0; i < 20 && path; i++) {
    const res: ListResponse<{ name: string }> = await flowFetch(path)
    for (const r of res.data ?? []) map.set(r.attributes.name, r.id)
    const next = res.links?.next
    path = next ? next.replace(KLAVIYO_BASE, '') : null
  }
  return map
}

// ─── Flow definition ──────────────────────────────────────────────────────

export interface FlowBuildContext {
  /** Metric id of the trigger event. */
  triggerMetricId: string
  /** Metric id of Placed Order, for the "has not ordered since" filter. */
  placedOrderMetricId: string | null
  /** Klaviyo template id per FlowEmailSpec.key. */
  templateIds: Record<string, string>
  fromEmail: string
  fromLabel: string
}

export function emailsForFlow(flow: FlowSlug): FlowEmailSpec[] {
  return FLOW_EMAILS.filter(e => e.flow === flow)
}

/**
 * Flow filter: the profile has zero Placed Order events in the last 30 days.
 * Browse and cart abandonment use it so a buyer never gets a nudge for a thing
 * they already bought. Post-purchase has no filter (an order is its trigger).
 * `since starting the flow` is a Klaviyo UI option; the API exposes the
 * lookback form, which is the conservative superset for delays under 30 days.
 */
function notOrderedFilter(placedOrderMetricId: string): Record<string, unknown> {
  return {
    condition_groups: [
      {
        conditions: [
          {
            type: 'profile-metric',
            metric_id: placedOrderMetricId,
            measurement: 'count',
            measurement_filter: { type: 'numeric', operator: 'equals', value: 0 },
            timeframe_filter: { type: 'date', operator: 'in-the-last', quantity: 30, unit: 'day' },
            metric_filters: null,
          },
        ],
      },
    ],
  }
}

/**
 * Build the Create Flow request body for one flow. Pure, so it is unit-tested
 * and printed by the setup script's --dry-run. The Create Flow endpoint rejects
 * a `status` field on the flow and on email messages (verified against the live
 * API 2026-10-03) and documents that "all flows are created in a Draft status
 * by default", so the payload carries none and a new flow is always a draft.
 */
export function buildFlowPayload(flow: FlowSlug, ctx: FlowBuildContext): Record<string, unknown> {
  const emails = emailsForFlow(flow)
  const actions: Record<string, unknown>[] = []
  let prevHours = 0
  emails.forEach((spec, i) => {
    const gap = Math.max(1, spec.delayHours - prevHours)
    prevHours = spec.delayHours
    const delayId = `delay-${i + 1}`
    const emailId = `email-${i + 1}`
    const nextDelay = i + 1 < emails.length ? `delay-${i + 2}` : null
    const useDays = gap % 24 === 0
    actions.push({
      temporary_id: delayId,
      type: 'time-delay',
      links: { next: emailId },
      data: { unit: useDays ? 'days' : 'hours', value: useDays ? gap / 24 : gap, secondary_value: 0, timezone: 'profile', delay_until_time: null, delay_until_weekdays: null },
    })
    actions.push({
      temporary_id: emailId,
      type: 'send-email',
      links: { next: nextDelay },
      data: {
        message: {
          name: `${FLOW_NAMES[flow]} ${spec.key}`,
          subject_line: spec.subjects[0],
          preview_text: spec.previews[0],
          from_email: ctx.fromEmail,
          from_label: ctx.fromLabel,
          reply_to_email: ctx.fromEmail,
          smart_sending_enabled: true,
          transactional: false,
          add_tracking_params: true,
          template_id: ctx.templateIds[spec.key],
        },
      },
    })
  })

  const definition: Record<string, unknown> = {
    triggers: [{ type: 'metric', id: ctx.triggerMetricId }],
    entry_action_id: 'delay-1',
    actions,
  }
  if (flow !== 'post-purchase' && ctx.placedOrderMetricId) {
    definition['profile_filter'] = notOrderedFilter(ctx.placedOrderMetricId)
  }
  return {
    data: {
      type: 'flow',
      attributes: { name: FLOW_NAMES[flow], definition },
    },
  }
}

/**
 * Create a flow. The API creates it as a draft (see buildFlowPayload); there is
 * no status-change helper by design. Create Flow is limited to 1 request per
 * second, so a 429 is retried after a pause.
 */
export async function createFlow(payload: Record<string, unknown>): Promise<{ id: string; name: string; status: string }> {
  let res: { data: Resource<{ name: string; status: string }> } | null = null
  for (let attempt = 0; attempt < 4 && !res; attempt++) {
    try {
      res = await flowFetch<{ data: Resource<{ name: string; status: string }> }>('/flows/', 'POST', payload)
    } catch (err) {
      if (attempt < 3 && err instanceof Error && / 429: /.test(err.message)) {
        await new Promise(r => setTimeout(r, 2000))
        continue
      }
      throw err
    }
  }
  if (!res) throw new Error('Klaviyo POST /flows/ gave no response')
  return { id: res.data.id, name: res.data.attributes.name, status: res.data.attributes.status }
}

// ─── Manual fallback ──────────────────────────────────────────────────────

/**
 * The exact clicks to build any flow by hand in Klaviyo. Used when the API
 * refuses flow creation (plan, scope, metric not yet seen) and printed in the
 * setup script's output, so the owner is never blocked on the API.
 */
export const MANUAL_FLOW_STEPS: Record<FlowSlug, string[]> = {
  'browse-abandonment': [
    'Klaviyo > Flows > Create flow > Build your own.',
    'Name it "xdipx Browse Abandonment". Trigger: Metric > Viewed Product. The metric does not exist until something sends the first Viewed Product event (see docs/store-team/klaviyo-flows.md, "Browse abandonment: wired, waiting on its first event").',
    'Flow filters: add "Placed Order zero times since starting this flow".',
    'Add Time delay: 4 hours.',
    'Add Email. Name "xdipx Browse Abandonment browse-4h". Subject and preview from variant 1 in docs/store-team/klaviyo-flows.md. Sender hello@xdipx.com, label xdipx.',
    'In the email, Content > Drag a Custom HTML block or choose the saved template "xdipx browse-abandonment browse-4h" (Templates > Saved).',
    'Leave the flow and the email in Draft. Review the preview with a test profile, then set Live.',
  ],
  'cart-abandonment': [
    'Klaviyo > Flows > Create flow > Build your own.',
    'Name it "xdipx Cart Abandonment". Trigger: Metric > Added to Cart. (Started Checkout has never fired, so it is not in the list yet; the Checkout Started metric in the account comes from another source and carries different properties.)',
    'Flow filters: add "Placed Order zero times since starting this flow".',
    'Add Time delay: 1 hour. Add Email using saved template "xdipx cart-abandonment cart-1h".',
    'Add Time delay: 23 hours (24 hours total). Add Email using saved template "xdipx cart-abandonment cart-24h".',
    'Leave in Draft. Review with a test profile, then set Live.',
  ],
  'post-purchase': [
    'Klaviyo > Flows > Create flow > Build your own.',
    'Name it "xdipx Post-Purchase". Trigger: Metric > Placed Order. No flow filter.',
    'Add Time delay: 3 days. Add Email using saved template "xdipx post-purchase post-3d".',
    'Add Time delay: 11 days (14 days total). Add Email using saved template "xdipx post-purchase post-14d".',
    'Leave in Draft. Review with a test profile, then set Live.',
  ],
}

// ─── Header asset selection ───────────────────────────────────────────────

export type HeaderKind = 'onskin' | 'packshot' | 'none'

export interface HeaderAsset {
  url: string | null
  kind: HeaderKind
  /** social_media_assets id when kind is onskin. */
  assetId?: number
}

/** Archetypes that carry a body in frame (on-skin and bodyscape), per the social library. */
export const ONSKIN_ARCHETYPES = ['cast', 'macro'] as const

interface LibraryCandidate {
  id: number
  url: string
  aspect: string | null
  visionVerdict?: { pass?: boolean } | null
}

export interface HeaderDeps {
  /** Rated-up (verdict up) library rows for a handle and archetype, newest first. */
  searchLovedAssets?: (handle: string, archetype: string) => Promise<LibraryCandidate[]>
  /** Position-0 Shopify image URL (already card-art-gated), or null. */
  positionZeroImage?: (handle: string) => Promise<string | null>
}

const ASPECT_RANK: Record<string, number> = { '16:9': 0, '4:3': 1, '1:1': 2, '4:5': 3, '3:4': 4, '9:16': 5 }

const defaultHeaderDeps: Required<HeaderDeps> = {
  searchLovedAssets: async (handle, archetype) => {
    const { listLibraryAssets } = await import('./social-studio.server')
    const page = await listLibraryAssets({
      q: '',
      tag: null,
      product: handle,
      cast: null,
      archetype,
      source: null,
      picked: null,
      before: null,
      archived: false,
      generationBatchId: null,
      dropped: false,
      feedback: 'loved',
      excludeProductIdentityBlocked: true,
    })
    return page.assets.map(a => ({
      id: a.id,
      url: a.url,
      aspect: a.aspect ?? null,
      visionVerdict: (a.visionVerdict as { pass?: boolean } | null) ?? null,
    }))
  },
  positionZeroImage: async handle => {
    const { getProductByHandle } = await import('./shopify.server')
    const p = await getProductByHandle(handle)
    return p?.images?.[0]?.url ?? null
  },
}

/**
 * Header art for one product's emails. Prefers a rated-up (verdict up)
 * on-skin or bodyscape frame of that exact handle from the social asset
 * library, which already passed the vision gate and the nudity definition; the
 * owned-email ceiling is the same one (instagram-campaigns.md section 3.2a
 * with 3.2c). Falls back to the product's position-0 Shopify image, which the
 * template sits on coral-soft. Returns kind 'none' when the product has no
 * usable image, and the template then renders a coral-soft block with the name.
 *
 * Preference among rated-up frames: a frame whose vision verdict did not fail,
 * wider aspects first (a 600px header wants landscape or square over a tall 4:5).
 *
 * Later source: the ads creative library (Ad Studio v2 PR-C, `ad_creatives`
 * with a rated-up verdict and lane `owned`) becomes the preferred source once
 * it exists. Swap it in here by trying it before the social library; callers
 * do not change.
 */
export async function pickHeaderAsset(productHandle: string, deps: HeaderDeps = {}): Promise<HeaderAsset> {
  const d = { ...defaultHeaderDeps, ...deps }
  for (const archetype of ONSKIN_ARCHETYPES) {
    let rows: LibraryCandidate[] = []
    try {
      rows = await d.searchLovedAssets(productHandle, archetype)
    } catch (err) {
      console.error('[klaviyo-flows] pickHeaderAsset library lookup failed (falling back):', err instanceof Error ? err.message : err)
    }
    const usable = rows
      .filter(r => !!r.url && r.visionVerdict?.pass !== false)
      .sort((a, b) => (ASPECT_RANK[a.aspect ?? '4:5'] ?? 9) - (ASPECT_RANK[b.aspect ?? '4:5'] ?? 9))
    const best = usable[0]
    if (best) return { url: best.url, kind: 'onskin', assetId: best.id }
  }
  let packshot: string | null = null
  try {
    packshot = await d.positionZeroImage(productHandle)
  } catch (err) {
    console.error('[klaviyo-flows] pickHeaderAsset packshot lookup failed:', err instanceof Error ? err.message : err)
  }
  return packshot ? { url: packshot, kind: 'packshot' } : { url: null, kind: 'none' }
}

/**
 * The header URL the email actually loads. Every header source today (social
 * library frames rehosted to Shopify Files, and position-0 packshots) is on the
 * Shopify CDN, which crops on request. Asking it for a square at 2x the plate
 * (EMAIL_HEADER_PX) means the email's image plate is the same height for every
 * product and sharp on retina screens, whatever aspect the source frame was.
 * A URL on any other host is returned unchanged. Pure, so it is unit-tested.
 */
export function emailHeaderImageUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  if (u.hostname !== 'cdn.shopify.com' && !u.hostname.endsWith('.myshopify.com')) return url
  const size = String(EMAIL_HEADER_PX * 2)
  u.searchParams.set('width', size)
  u.searchParams.set('height', size)
  u.searchParams.set('crop', 'center')
  return u.toString()
}

// ─── Event properties ─────────────────────────────────────────────────────

export interface FlowEventProps {
  ProductName: string
  ProductURL: string
  ProductHandle: string
  ProductType?: string
  HeaderImageURL?: string
  HeaderKind: HeaderKind
}

/**
 * Which act paragraph a product gets (a key of ACT_BLOCKS), inferred from its
 * title and Shopify tags. The Storefront Product type does not carry the
 * product_type_dial metafield, and the dial's own taxonomy has no air-pulsation
 * or wand value, so this reads the words the catalog already uses. Undefined
 * means the template's generic paragraph. Pure, so it is unit-tested.
 */
export function inferProductType(title: string, tags: string[] = []): string | undefined {
  const hay = `${title} ${tags.join(' ')}`.toLowerCase()
  if (/\b(lube|lubricant|moisturi[sz]er|glide)\b/.test(hay)) return 'lube'
  if (/\b(air[- ]?pulsation|pulsation|sonic|suction|womanizer|sona|lipstick pleasure)\b/.test(hay)) return 'air-pulsation'
  if (/\bwand\b/.test(hay)) return 'wand'
  if (/\b(wearable|panty|panties|remote[- ]?control)\b/.test(hay)) return 'wear'
  if (/\b(vibrator|bullet|rabbit|g-?spot|dildo)\b/.test(hay)) return 'vibrator'
  return undefined
}

/**
 * Properties the flow templates read, keyed by FLOW_EVENT_PROPERTY_KEYS. Spread
 * these into the Viewed Product, Added to Cart, Started Checkout and Placed
 * Order events. Returns null when the product cannot be resolved, so a caller
 * sends its event unchanged rather than failing. Never throws.
 */
export async function flowEventProps(
  productHandle: string,
  deps: HeaderDeps & { product?: (handle: string) => Promise<{ title: string; tags?: string[] } | null> } = {},
): Promise<FlowEventProps | null> {
  try {
    const getProduct =
      deps.product ??
      (async (h: string) => {
        const { getProductByHandle } = await import('./shopify.server')
        return getProductByHandle(h)
      })
    const product = await getProduct(productHandle)
    if (!product) return null
    const header = await pickHeaderAsset(productHandle, deps)
    const keys = FLOW_EVENT_PROPERTY_KEYS
    const props: FlowEventProps = {
      [keys.name]: product.title,
      [keys.url]: `https://xdipx.com/products/${productHandle}`,
      [keys.handle]: productHandle,
      [keys.headerKind]: header.kind,
    } as FlowEventProps
    const type = inferProductType(product.title, product.tags ?? [])
    if (type) props.ProductType = type
    if (header.url) props.HeaderImageURL = emailHeaderImageUrl(header.url)
    return props
  } catch (err) {
    console.error('[klaviyo-flows] flowEventProps failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Resolve a Shopify product GID or numeric id to a handle (Admin REST). */
export async function handleFromProductId(productId: string): Promise<string | null> {
  const { getProductHandleById } = await import('./shopify.server')
  return getProductHandleById(productId)
}

export { flowTemplateName, renderFlowEmail, FLOW_EMAILS }
