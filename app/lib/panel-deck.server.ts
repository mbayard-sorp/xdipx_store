/**
 * Panel deck resolver — turns `singleton.panelDeck` into the renderable
 * `ResolvedPanelDeck` that rides the homepage payload blob.
 *
 * The one non-obvious job here is destination validation. A panel's collection
 * handle is a string an agent or editor typed; a typo would ship a door to a
 * 404 on the highest-traffic page of the site. So collection destinations are
 * checked against the live Shopify collection list at BUILD time, and a panel
 * whose door leads nowhere (unknown handle, or a collection with zero
 * products) is dropped with a warning rather than rendered. The deck degrades
 * panel by panel, never as a whole.
 *
 * Server-only. Never import from a client component.
 */

import { getClient } from '~/lib/sanity.server'
import { getCollectionList } from '~/lib/shopify.server'
import type {
  PanelDeckTheme,
  PanelSurface,
  ResolvedPanelDeck,
  ResolvedPanelLarge,
  ResolvedPanelRow,
  ResolvedPanelSmall,
  ResolvedPanelTile,
} from '~/types/cms'

const PANEL_DECK_GROQ = `
  *[_id == "singleton.panelDeck"][0]{
    eyebrow, theme, showOrdinals,
    rows[]{
      _type, _key,
      items[]{
        _key, label, surface, mark, kicker, blurb, ctaLabel, meta, figure,
        "imageUrl": image.asset->url,
        "imageAlt": image.alt,
        link{
          kind, collectionHandle, route,
          "articleSlug": article->slug.current,
          "articlePublished": article->status == "published"
        }
      }
    }
  }
`

interface RawPanelLink {
  kind?: 'collection' | 'article' | 'route'
  collectionHandle?: string
  route?: string
  articleSlug?: string
  articlePublished?: boolean
}

interface RawPanelItem {
  _key?: string
  label?: string
  surface?: string
  mark?: string
  kicker?: string
  blurb?: string
  ctaLabel?: string
  meta?: string
  figure?: string
  imageUrl?: string
  imageAlt?: string
  link?: RawPanelLink
}

interface RawPanelRow {
  _type?: string
  _key?: string
  items?: RawPanelItem[]
}

const SURFACES: PanelSurface[] = ['blush', 'lilac', 'stone', 'paper', 'plum', 'coral', 'ink']
const THEMES: PanelDeckTheme[] = ['tint', 'photo', 'ruled']

/**
 * Resolve a panel's destination to an href, or null when the door would lead
 * nowhere. `liveHandles` carries only collections that exist AND have stock to
 * show; a door to an empty aisle is as broken as a door to a 404.
 */
function resolveHref(link: RawPanelLink | undefined, liveHandles: Set<string> | null): string | null {
  if (!link?.kind) return null
  switch (link.kind) {
    case 'collection': {
      const handle = link.collectionHandle?.trim()
      if (!handle) return null
      // When the collection list itself was unavailable we let handles through
      // unvalidated: a Shopify hiccup at warm time must not strip every door
      // off the deck.
      if (liveHandles && !liveHandles.has(handle)) return null
      return `/collections/${handle}`
    }
    case 'article': {
      if (!link.articleSlug || link.articlePublished === false) return null
      return `/notebook/${link.articleSlug}`
    }
    case 'route': {
      const route = link.route?.trim()
      return route && route.startsWith('/') ? route : null
    }
    default:
      return null
  }
}

function baseTile(item: RawPanelItem, href: string): ResolvedPanelTile {
  return {
    key: item._key ?? `${item.label}-${href}`,
    label: item.label?.trim() ?? '',
    surface: SURFACES.includes(item.surface as PanelSurface) ? (item.surface as PanelSurface) : 'stone',
    mark: item.mark ?? null,
    imageUrl: item.imageUrl ?? null,
    imageAlt: item.imageAlt ?? null,
    href,
  }
}

export async function getPanelDeck(preview = false): Promise<ResolvedPanelDeck | null> {
  const client = getClient(false, preview)
  if (!client) return null

  let raw: {
    eyebrow?: string
    theme?: string
    showOrdinals?: boolean
    rows?: RawPanelRow[]
  } | null = null
  try {
    raw = await client.fetch(PANEL_DECK_GROQ)
  } catch (err) {
    console.error('[panel-deck] fetch failed:', err)
    return null
  }
  if (!raw?.rows?.length) return null

  // Live collection handles for destination validation. Failure degrades to
  // "validate nothing" rather than "drop everything".
  let liveHandles: Set<string> | null = null
  try {
    const collections = await getCollectionList()
    liveHandles = new Set(
      collections
        .filter(c => c.productsCount === null || c.productsCount > 0)
        .map(c => c.handle),
    )
  } catch (err) {
    console.warn('[panel-deck] collection list unavailable, skipping handle validation:', err)
  }

  const rows: ResolvedPanelRow[] = []
  for (const row of raw.rows) {
    const rowKey = row._key ?? `row-${rows.length}`
    const resolveItems = <T extends ResolvedPanelTile>(
      decorate: (item: RawPanelItem, tile: ResolvedPanelTile) => T,
    ): T[] =>
      (row.items ?? []).flatMap(item => {
        const href = resolveHref(item.link, liveHandles)
        if (!href || !item.label?.trim()) {
          console.warn(
            `[panel-deck] dropping panel "${item.label ?? '(unlabelled)'}": ` +
              (item.label?.trim() ? 'destination missing, dead, or empty' : 'no label'),
          )
          return []
        }
        return [decorate(item, baseTile(item, href))]
      })

    switch (row._type) {
      case 'panelSquareRow': {
        const items = resolveItems(( _item, tile) => tile)
        if (items.length > 0) rows.push({ kind: 'square', key: rowKey, items })
        break
      }
      case 'panelRowLarge': {
        const items = resolveItems<ResolvedPanelLarge>((item, tile) => ({
          ...tile,
          kicker: item.kicker?.trim() || null,
          blurb: item.blurb?.trim() || null,
          ctaLabel: item.ctaLabel?.trim() || null,
        }))
        if (items.length > 0) rows.push({ kind: 'large', key: rowKey, items })
        break
      }
      case 'panelRowSmall': {
        const items = resolveItems<ResolvedPanelSmall>((item, tile) => ({
          ...tile,
          meta: item.meta?.trim() || null,
          figure: item.figure?.trim() || null,
        }))
        if (items.length > 0) rows.push({ kind: 'small', key: rowKey, items })
        break
      }
      default:
        break
    }
  }

  if (rows.length === 0) return null

  return {
    eyebrow: raw.eyebrow?.trim() || null,
    theme: THEMES.includes(raw.theme as PanelDeckTheme) ? (raw.theme as PanelDeckTheme) : 'tint',
    showOrdinals: raw.showOrdinals === true,
    rows,
  }
}
