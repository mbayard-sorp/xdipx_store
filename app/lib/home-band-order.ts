/**
 * home-band-order.ts — the storefront homepage's slot order, as a pure module.
 *
 * Extracted from `StorefrontHome.tsx` (ticket #8414) so the renderer is no
 * longer the only thing that knows what a published layout resolves to. The
 * category healthcheck asserts that the panel deck reached the served HTML, and
 * it was deciding that from its own reading of `layout.sections` — a different
 * predicate from the one the renderer actually applies. Two readers, one field,
 * no shared code, so they drifted and the check went red against a page that
 * was behaving exactly as written. Anything that needs to know whether a slot
 * will render imports `resolveBandOrder` from here; nothing re-derives it.
 *
 * Nothing in this file may import React or a component: a cron path resolves
 * band order too, and pulling the storefront component graph into a serverless
 * healthcheck bundle to answer "is the deck placed" is exactly the coupling
 * this extraction removes. `StorefrontHome.tsx` re-exports every symbol below,
 * so existing importers are unaffected.
 */

/** Every separately-orderable band of the storefront shell.
 *
 *  The trust strip and the mood pills are deliberately absent: both render
 *  inside the hero band rather than as siblings of it, so they are the hero's
 *  content, not their own slot. */
export const BAND_NAMES = [
  'hero',
  'anchorGrid',
  'teamRails',
  'meetEmma',
  'wayfinder',
  'emmasEdit',
  'sensationMap',
  'couples',
  'stillDeciding',
  'notebook',
  'faq',
  'emailCapture',
] as const

export type BandName = (typeof BAND_NAMES)[number]

/** The shipped order. Rendered when Sanity supplies no layout, which is also
 *  what makes an unpublished layout document a safe no-op. */
export const DEFAULT_BAND_ORDER: BandName[] = [
  'hero',
  'anchorGrid',
  'teamRails',
  'meetEmma',
  'wayfinder',
  'emmasEdit',
  'sensationMap',
  'couples',
  'stillDeciding',
  'notebook',
  'faq',
  'emailCapture',
]

const KNOWN_BAND = new Set<string>(BAND_NAMES)

/** A renderable slot: a shell band, or the panel deck placed by the layout. */
export type HomeSlot = BandName | 'panelDeck'

/**
 * Turn a published layout into the slot order to render.
 *
 * The rules are all about never letting a content edit break the page: the
 * hero always leads (it owns the H1 and the LCP image, and nothing — not even
 * the deck — may sit above the largest paint element), a slot may appear at
 * most once, and anything this deploy does not recognise is dropped rather
 * than trusted. A layout that survives none of that is treated as no layout
 * at all, which renders the shipped order.
 *
 * The deck only OCCUPIES a slot here; whether it has anything to show is the
 * payload's business (`panelDeck` null renders nothing in that slot).
 *
 * `opts.anchorReplaced` is true when a live team rail has explicitly claimed the
 * anchor slot (`replacesAnchor`). Only then may a layout drop the `anchorGrid`
 * band; otherwise the band is forced back in (see the anchor guard below).
 */
export function resolveBandOrder(
  layout?: { sections: { _type: string; band?: string; enabled?: boolean }[] } | null,
  opts?: { anchorReplaced?: boolean },
): HomeSlot[] {
  const anchorReplaced = opts?.anchorReplaced === true

  const order: HomeSlot[] = (() => {
    if (!layout?.sections?.length) return DEFAULT_BAND_ORDER

    const seen = new Set<string>()
    const ordered: HomeSlot[] = []
    for (const section of layout.sections) {
      if (section.enabled === false) continue
      if (section._type === 'panelDeckSection') {
        if (!seen.has('panelDeck')) {
          seen.add('panelDeck')
          ordered.push('panelDeck')
        }
        continue
      }
      if (section._type !== 'homeBand') continue
      const band = section.band
      if (!band || !KNOWN_BAND.has(band) || seen.has(band)) continue
      seen.add(band)
      ordered.push(band as BandName)
    }

    // A layout with no usable band renders the shipped order — a deck marker
    // alone is not a homepage. But it is still a deliberate deck PLACEMENT, and
    // the shipped order cannot express one: `DEFAULT_BAND_ORDER` is typed
    // `BandName[]`, so falling back to it verbatim silently deleted the only
    // instruction the layout actually carried (#8414). The deck is re-added at
    // its documented position — directly below the headliner, which after the
    // anchor guard means immediately after `anchorGrid`, the same place the
    // hero-first guard already lands a deck published above the hero. Bands
    // fall back; the deck placement is honoured.
    if (!ordered.some(slot => slot !== 'panelDeck')) {
      if (!ordered.includes('panelDeck')) return DEFAULT_BAND_ORDER
      const at = DEFAULT_BAND_ORDER.indexOf('anchorGrid') + 1
      return [...DEFAULT_BAND_ORDER.slice(0, at), 'panelDeck', ...DEFAULT_BAND_ORDER.slice(at)]
    }

    // The hero is not reorderable. A layout that omits or demotes it would move
    // the largest paint element, so it is put back at the front rather than
    // honoured, and the page keeps its LCP guarantee whatever Sanity says.
    return ordered[0] === 'hero' ? ordered : ['hero', ...ordered.filter(b => b !== 'hero')]
  })()

  // Anchor guard, mirroring the hero-first guard. `anchorGrid` is the page's
  // bestseller wall. A bad layout publish (band disabled or dropped) or a rail
  // retirement must not silently delete it: unless a live rail has explicitly
  // taken the slot (`anchorReplaced`), the band is put back right after the
  // hero — its shipped position — rather than honouring its removal. The
  // DEFAULT order already carries it, so this only re-adds it when a layout
  // stripped it. The band itself renders null when it has nothing to show, so
  // forcing the slot back is safe even during a cold-KV outage.
  if (!anchorReplaced && !order.includes('anchorGrid')) {
    const at = order.indexOf('hero') + 1 // 0 when there is no hero (indexOf -1)
    return [...order.slice(0, at), 'anchorGrid', ...order.slice(at)]
  }
  return order
}

