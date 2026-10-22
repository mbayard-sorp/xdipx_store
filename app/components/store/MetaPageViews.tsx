import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { trackFbPageView } from '~/lib/meta-pixel.client'

/**
 * One Meta PageView per page the visitor actually sees: the first render and
 * every client-side navigation after it. Mounted once in root.tsx so the
 * storefront and the curious.xdipx.com bridge share it.
 *
 * Until ticket #16688 the storefront fired no PageView at all; only the bridge
 * page did, and only after its cookie banner was accepted, so the dataset
 * showed 9 PageViews a week, all of them Shopify checkout events.
 *
 * Admin and API paths never fire. The search string is part of the key, so a
 * filter change on a collection counts as a new view the way GA4 counts it.
 */
export function MetaPageViews() {
  const location = useLocation()
  const last = useRef('')

  useEffect(() => {
    const key = location.pathname + location.search
    if (key === last.current) return
    last.current = key
    if (/^\/(admin|api)(\/|$)/.test(location.pathname)) return
    trackFbPageView()
  }, [location.pathname, location.search])

  return null
}
