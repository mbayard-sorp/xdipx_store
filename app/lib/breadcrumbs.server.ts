import type { ShopifyMenuItem } from './shopify.server'

export interface BreadcrumbCrumb {
  label: string
  /** Absolute URL for SEO/JSON-LD. Omitted when the source menu item has no URL. */
  url?: string
  /** App-relative path for in-app `<Link to>` navigation. Omitted when no URL. */
  href?: string
}

const SITE_ORIGIN = 'https://xdipx.com'

/**
 * Convert a Shopify menu URL (which may be absolute against the storefront,
 * a collection GID, or already a path) into a relative app path. Returns
 * undefined if the URL is empty or unusable.
 */
function toAppPath(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined
  // Already a relative path
  if (rawUrl.startsWith('/')) return rawUrl
  try {
    const u = new URL(rawUrl)
    return u.pathname + u.search
  } catch {
    return undefined
  }
}

/**
 * Find the path through the main-menu tree that ends at a node whose URL
 * resolves to one of the product's collection handles. Returns the menu
 * path from top-level → matched leaf, or null if no match.
 *
 * Why deepest match: a product in `/collections/vibrators` (a leaf under
 * "Pleasure" → "Vibrators") should produce 3 levels, not stop at "Pleasure".
 */
function findMenuPath(
  menu: ShopifyMenuItem[],
  collectionHandles: Set<string>,
): ShopifyMenuItem[] | null {
  let best: ShopifyMenuItem[] | null = null
  const walk = (items: ShopifyMenuItem[], trail: ShopifyMenuItem[]) => {
    for (const item of items) {
      const next = [...trail, item]
      const path = toAppPath(item.url)
      // Match if this menu item links to a collection the product belongs to.
      const handleMatch = path?.startsWith('/collections/')
        ? path.replace('/collections/', '').split(/[?#]/)[0]
        : undefined
      if (handleMatch && collectionHandles.has(handleMatch)) {
        if (!best || next.length > best.length) best = next
      }
      if (item.items?.length) walk(item.items, next)
    }
  }
  walk(menu, [])
  return best
}

interface ResolveOpts {
  menu: ShopifyMenuItem[]
  productCollectionHandles: string[]
  productTitle: string
  productHandle: string
}

/**
 * Build the PDP breadcrumb trail.
 *
 * Hierarchy: Home > {top-level menu category} > … > {leaf collection} > {Product}
 *
 * - Top-level menu items with no URL render as plain text (label only).
 * - If no menu collection contains this product, collapses to `Home > {Product}`
 *   (we never link breadcrumbs to /search because /search is noindex —
 *   linking BreadcrumbList items to a noindex page weakens the signal).
 */
export function resolveBreadcrumbs({
  menu,
  productCollectionHandles,
  productTitle,
  productHandle,
}: ResolveOpts): BreadcrumbCrumb[] {
  const home: BreadcrumbCrumb = { label: 'Home', url: SITE_ORIGIN + '/', href: '/' }
  const product: BreadcrumbCrumb = {
    label: productTitle,
    url: `${SITE_ORIGIN}/products/${productHandle}`,
    href: `/products/${productHandle}`,
  }

  const handles = new Set(productCollectionHandles.filter(Boolean))
  if (handles.size === 0 || menu.length === 0) {
    return [home, product]
  }

  const path = findMenuPath(menu, handles)
  if (!path || path.length === 0) {
    return [home, product]
  }

  const middle: BreadcrumbCrumb[] = path.map(item => {
    const href = toAppPath(item.url)
    if (href) return { label: item.title, url: SITE_ORIGIN + href, href }
    return { label: item.title }
  })

  return [home, ...middle, product]
}
