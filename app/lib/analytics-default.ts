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
