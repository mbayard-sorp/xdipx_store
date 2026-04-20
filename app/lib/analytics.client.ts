// Client-only GA4 analytics utilities.
// Uses .client.ts suffix so React Router tree-shakes this from server bundles.
// Never import from a .server.ts file.

type GtagCommand = 'config' | 'event' | 'consent' | 'set'

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: [GtagCommand, ...unknown[]]) => void
  }
}

function gtag(...args: [GtagCommand, ...unknown[]]) {
  if (typeof window === 'undefined') return
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
}

// ─── Page views ───────────────────────────────────────────────────────────────

export function trackPageView(path: string, title?: string) {
  gtag('event', 'page_view', {
    page_path: path,
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
