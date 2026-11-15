// Client-only. .client.ts suffix so React Router tree-shakes this from the
// server bundle. Never import from a .server.ts file.
//
// Fires once per sales-page load, after hydration, so the server-recorded
// request count (app/lib/ad-arrivals.server.ts, written from the loader)
// minus this beacon's count is visitors whose browser never ran any
// JavaScript on the page — bots, or a page that never finished loading.

export function fireSalesArrivalBeacon(): void {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
  const params = new URLSearchParams(window.location.search)
  const utmSource = params.get('utm_source')
  if (!utmSource) return
  const body = JSON.stringify({ utmSource, utmContent: params.get('utm_content') ?? '' })
  navigator.sendBeacon('/api/sales-arrival-beacon', new Blob([body], { type: 'application/json' }))
}
