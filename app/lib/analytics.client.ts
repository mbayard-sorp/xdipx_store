// Client-only GA4 analytics utilities.
// Uses .client.ts suffix so React Router tree-shakes this from server bundles.
// Never import from a .server.ts file.

type GtagCommand = 'config' | 'event' | 'consent' | 'set'

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: [GtagCommand, ...unknown[]]) => void
    fbq: (
      command: string,
      eventOrAction: string,
      params?: Record<string, unknown>,
      opts?: { eventID?: string },
    ) => void
  }
}

function gtag(...args: [GtagCommand, ...unknown[]]) {
  if (typeof window === 'undefined') return
  // Must call window.gtag (defined in root.tsx) which pushes `arguments`
  // (an Arguments object, not an Array). GA4's consent API only recognizes
  // commands pushed as Arguments — array-pushes are processed as plain
  // dataLayer events and never flip the consent state on the wire.
  if (typeof window.gtag === 'function') {
    window.gtag(...args)
    return
  }
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push(args)
}

export function pushToDataLayer(payload: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push(payload)
}

// ─── GA4 Item shape ───────────────────────────────────────────────────────────

export interface GA4Item {
  item_id: string
  item_name: string
  item_brand?: string
  item_category?: string
  price?: number
  quantity?: number
  index?: number
  item_variant?: string
  item_list_id?: string
  item_list_name?: string
  discount?: number
}

// ─── Consent ──────────────────────────────────────────────────────────────────

export function updateConsent(granted: boolean) {
  const state = granted ? 'granted' : 'denied'
  gtag('consent', 'update', {
    analytics_storage: state,
    ad_storage: state,
    ad_user_data: state,
    ad_personalization: state,
  })

  // Mirror consent state to the Meta Pixel (fbq is declared in meta-pixel.client.ts
  // but also available on window globally via the inline snippet in root.tsx).
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    window.fbq('consent', granted ? 'grant' : 'revoke')
  }

  // Write the server-readable consent cookie so getMarketingConsent() in
  // consent.server.ts can gate CAPI calls on subsequent requests.
  // The cookie name matches MARKETING_CONSENT_COOKIE in consent.server.ts.
  if (typeof document !== 'undefined') {
    const maxAge = 60 * 60 * 24 * 365 // 1 year
    const value  = encodeURIComponent(JSON.stringify({ marketing: granted }))
    document.cookie = `__xdipx_consent=${value}; path=/; max-age=${maxAge}; samesite=lax`
  }
}

// ─── Page views ───────────────────────────────────────────────────────────────

/**
 * GA4's page_view uses `page_location` (the absolute URL) and `page_title`.
 * `page_path` is a Universal Analytics field name (UA was sunset 2023-07-01)
 * that gtag.js/GA4 does not read, so sending it left GA4 to fall back to
 * whatever internal page_location it already had, corrupting the recorded
 * landing URL and making campaign query params unparseable.
 *
 * `url` must be the full absolute URL (build it with buildPageLocation from
 * the current origin/pathname/search) — never a bare path.
 */
export function trackPageView(url: string, title?: string) {
  gtag('event', 'page_view', {
    page_location: url,
    page_title: title ?? document.title,
  })
}

// ─── User properties ──────────────────────────────────────────────────────────

export function setUserProperties(props: { logged_in: boolean; customer_id_hash?: string }) {
  gtag('set', 'user_properties', props)
}

// ─── E-commerce: view_item ────────────────────────────────────────────────────

export function trackViewItem(item: GA4Item, value?: number, currency = 'USD') {
  gtag('event', 'view_item', {
    currency,
    value: value ?? item.price ?? 0,
    items: [item],
  })
}

// ─── E-commerce: view_item_list ───────────────────────────────────────────────

export function trackViewItemList(listId: string, listName: string, items: GA4Item[]) {
  gtag('event', 'view_item_list', {
    item_list_id: listId,
    item_list_name: listName,
    items,
  })
}

// ─── E-commerce: select_item ──────────────────────────────────────────────────

export function trackSelectItem(listId: string, listName: string, item: GA4Item, index: number) {
  gtag('event', 'select_item', {
    item_list_id: listId,
    item_list_name: listName,
    items: [{ ...item, index }],
  })
}

// ─── E-commerce: select_promotion ─────────────────────────────────────────────
// Native GA4 promotion params only (promotion_id, promotion_name, creative_slot,
// location_id all report for free), so a promotion click is measurable without
// registering a custom dimension. Used for the Nº 03 "Most picked" See-all links,
// which cta_click could not distinguish (its link_url dimension ships empty).

export function trackSelectPromotion(params: {
  promotionId: string
  promotionName: string
  creativeSlot?: string
  locationId?: string
}) {
  gtag('event', 'select_promotion', {
    promotion_id: params.promotionId,
    promotion_name: params.promotionName,
    creative_slot: params.creativeSlot,
    location_id: params.locationId,
  })
}

// ─── E-commerce: add_to_cart ──────────────────────────────────────────────────

export function trackAddToCart(item: GA4Item, value?: number, currency = 'USD') {
  gtag('event', 'add_to_cart', {
    currency,
    value: value ?? (item.price ?? 0) * (item.quantity ?? 1),
    items: [item],
  })
}

// ─── E-commerce: remove_from_cart ─────────────────────────────────────────────

export function trackRemoveFromCart(item: GA4Item, value?: number, currency = 'USD') {
  gtag('event', 'remove_from_cart', {
    currency,
    value: value ?? (item.price ?? 0) * (item.quantity ?? 1),
    items: [item],
  })
}

// ─── E-commerce: view_cart ────────────────────────────────────────────────────

export function trackViewCart(items: GA4Item[], value: number, currency = 'USD') {
  gtag('event', 'view_cart', { currency, value, items })
}

// ─── E-commerce: begin_checkout ───────────────────────────────────────────────

export function trackBeginCheckout(items: GA4Item[], value: number, currency = 'USD') {
  gtag('event', 'begin_checkout', { currency, value, items })
}

// ─── Lead capture: generate_lead ──────────────────────────────────────────────
// Fired on a successful email capture (EmailSubscribe). generate_lead is a GA4
// recommended event, so it reports natively; `lead_location` says which surface
// captured the address (home / pdp / category / notebook variants).
//
// NOTE for the launch checklist: lead_location must be registered as an
// event-scoped custom dimension in the GA4 admin (owner-only action) or the
// parameter is collected but unreadable in reports, like panel_click's were.

export type LeadLocation = 'home' | 'pdp' | 'category' | 'admin-gallery'

export function trackGenerateLead(location: LeadLocation) {
  gtag('event', 'generate_lead', { lead_location: location })
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function trackSearch(term: string) {
  gtag('event', 'search', { search_term: term })
}

export function trackViewSearchResults(term: string, count: number) {
  gtag('event', 'view_search_results', { search_term: term, results_count: count })
}

// ─── Account ──────────────────────────────────────────────────────────────────

export function trackLogin(method: string) {
  gtag('event', 'login', { method })
}

export function trackSignUp(method: string) {
  gtag('event', 'sign_up', { method })
}

// ─── Custom: Flash-sale events ────────────────────────────────────────────────

export function trackDealView(handle: string, title: string, price: number) {
  gtag('event', 'deal_view', { deal_handle: handle, deal_title: title, deal_price: price })
}

export function trackVaultBrowse(tab: string, page: number) {
  gtag('event', 'vault_browse', { vault_tab: tab, vault_page: page })
}

export function trackCtaClick(name: string, location: string) {
  gtag('event', 'cta_click', { cta_name: name, cta_location: location })
}

// ─── Custom: Home discovery (variant A/B) ─────────────────────────────────────

export function trackHomeVariantView(params: { variant: 'a' | 'b'; hadPriorSession: boolean }) {
  gtag('event', 'home_variant_view', {
    home_variant: params.variant,
    had_prior_session: params.hadPriorSession,
  })
}

/** Fired once per page view when a deep homepage band first enters the viewport. */
export function trackHomeScrollDepth(section: 'meet-emma' | 'couples') {
  gtag('event', 'home_scroll_depth', { home_section: section })
}

/**
 * Fired when a panel-deck door is clicked. `dataAttr` is the panel's
 * `data-panel` coordinate, `{theme}/{rowIndex}/{itemIndex}/{label}` — the DOM
 * attribute alone never reaches GA4, which is why this event exists.
 *
 * NOTE for the launch checklist: panel_id / panel_position / panel_kind /
 * panel_destination must be registered as event-scoped custom dimensions in
 * the GA4 admin (an owner-only action) or these parameters are collected but
 * unreadable in reports, exactly like home_scroll_depth's parameter was.
 */
export function trackPanelClick(dataAttr: string, href: string) {
  const [theme = '', row = '', item = '', label = ''] = dataAttr.split('/')
  gtag('event', 'panel_click', {
    panel_id: dataAttr,
    panel_position: `${row}/${item}`,
    panel_kind: theme,
    panel_label: label,
    panel_destination: href,
  })
}

export function trackChipToggle(params: {
  group: 'mood' | 'audience' | 'matters' | 'category'
  value: string
  on: boolean
}) {
  gtag('event', 'discovery_chip_toggle', {
    chip_group: params.group,
    chip_value: params.value,
    chip_on: params.on,
  })
}

export function trackEmmaLineSurface(params: {
  state: 'intro' | 'mood-only' | 'audience-only' | 'matters-only' | 'mood-audience' | 'mood-matters' | 'audience-matters' | 'full'
}) {
  gtag('event', 'emma_line_surface', { emma_state: params.state })
}

// ─── Custom: Notebook engagement ──────────────────────────────────────────────
// The redesign's outcome metrics: does the blog capture emails, route readers
// to PDPs, and hold attention? Read in the weekly content retro.

export function trackNotebookSubscribe(location: 'index' | 'post' | 'series' | 'glossary') {
  gtag('event', 'notebook_subscribe', { subscribe_location: location })
}

export function trackNotebookEmbedClick(params: { productHandle: string; postPath: string }) {
  gtag('event', 'notebook_embed_click', {
    product_handle: params.productHandle,
    post_path: params.postPath,
  })
}

export function trackNotebookSeriesClick(params: { seriesSlug: string; from: 'post' | 'rail' }) {
  gtag('event', 'notebook_series_click', {
    series_slug: params.seriesSlug,
    series_from: params.from,
  })
}

/** Fired once per threshold per page view as the reader scrolls a post. */
export function trackNotebookReadDepth(params: { postPath: string; percent: 25 | 50 | 75 | 100 }) {
  gtag('event', 'notebook_read_depth', {
    post_path: params.postPath,
    read_percent: params.percent,
  })
}
