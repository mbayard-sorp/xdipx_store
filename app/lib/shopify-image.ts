/**
 * Shopify CDN image URL helpers. No secrets, safe to import from client
 * components. Shopify CDN auto-negotiates WebP/AVIF via the Accept header,
 * so we only need to hint dimensions to avoid shipping 2000px hero assets
 * to mobile viewports.
 */

function isShopifyCdn(url: string): boolean {
  return /cdn\.shopify\.com/.test(url)
}

export function shopifyImageUrl(url: string | null | undefined, width: number): string {
  if (!url) return ''
  if (!isShopifyCdn(url)) return url
  try {
    const u = new URL(url)
    u.searchParams.set('width', String(width))
    return u.toString()
  } catch {
    return url
  }
}

export function shopifyImageSrcSet(
  url: string | null | undefined,
  widths: number[] = [375, 640, 960, 1280],
): string | undefined {
  if (!url || !isShopifyCdn(url)) return undefined
  return widths.map(w => `${shopifyImageUrl(url, w)} ${w}w`).join(', ')
}
