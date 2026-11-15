/**
 * Whether GA4 starts on before the cookie banner is answered.
 *
 * Only US visitors on curious.xdipx.com (owner direction 2026-11-01). Those
 * pages are paid landing pages, and with storage denied GA4 kept almost none of
 * their traffic. Ad storage stays denied, the banner still shows, and "Essential
 * only" or a browser's Global Privacy Control turns GA4 back off. Everywhere else
 * the default is unchanged. The bridge route sends Vary: X-Vercel-IP-Country so
 * the CDN cannot hand a US copy to anyone else.
 */
export function analyticsOnByDefault(onBridgeHost: boolean, country: string | null): boolean {
  return onBridgeHost && country === 'US'
}

const REST = "ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'"

/** The inline consent default. Assumes the page's gtag stub is already defined. */
export function consentDefaultScript(analyticsOn: boolean): string {
  if (!analyticsOn) return `gtag('consent','default',{analytics_storage:'denied',${REST}});`
  return `var a='denied';try{if(!localStorage.getItem('xdipx_consent')&&!navigator.globalPrivacyControl){a='granted';window.__xdipxAnalyticsOn=true}}catch(e){}gtag('consent','default',{analytics_storage:a,${REST}});`
}

/**
 * GA4's direct (no-GTM) 'js'/'config' calls. Must run in the eager bootstrap
 * script, synchronously before React hydrates — never deferred behind
 * interaction/idle like `ga4ScriptTagLoad` below (ticket #19435). gtag.js
 * replays the dataLayer array in push order on load; an 'event' command
 * pushed ahead of its own 'config' command has no measurement ID to attach
 * to, so gtag.js drops it rather than sending a hit. Confirmed live on
 * curious.xdipx.com: Analytics.tsx's mount-effect page_view beat the old
 * deferred config call into the array, and never produced a network request
 * to google-analytics.com all session, while a later event (queued after
 * config) did.
 */
export function ga4DirectConfigScript(ga4Id: string): string {
  return `gtag('js',new Date());gtag('config','${ga4Id}',{send_page_view:false});`
}

/**
 * The (large) gtag.js script tag itself. Safe to defer behind interaction,
 * post-load idle, or a timeout for TBT, unlike `ga4DirectConfigScript`
 * above: loading the script late never drops an event, because the
 * dataLayer array is replayed in full, in order, once it arrives — only an
 * event queued ahead of its own config call is at risk.
 */
export function ga4ScriptTagLoad(ga4Id: string): string {
  return `inject('https://www.googletagmanager.com/gtag/js?id=${ga4Id}');`
}
