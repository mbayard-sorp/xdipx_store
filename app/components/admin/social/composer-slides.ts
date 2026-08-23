/**
 * Pure slide-ordering reducer for the Composer's SlideStrip (Phase 3, #4938).
 * No React, no DOM: unit tested directly. 1 to 10 slides (Instagram's cap).
 */

export const SLIDE_MAX = 10
export const ALT_TEXT_MAX = 1000

export interface ComposerSlide {
  /** Stable client key; the asset id when known, else a temp key. */
  key: string
  url: string
  assetId: number | null
  altText: string
  /** Declared aspect for the thumb so the grid never shifts. */
  aspect?: string | null
}

export type SlideAction =
  | { type: 'add'; slides: ComposerSlide[] }
  | { type: 'remove'; key: string }
  | { type: 'move'; key: string; to: number }
  | { type: 'shift'; key: string; by: -1 | 1 }
  | { type: 'alt'; key: string; altText: string }
  | { type: 'replace'; slides: ComposerSlide[] }

export function slidesReducer(state: ComposerSlide[], action: SlideAction): ComposerSlide[] {
  switch (action.type) {
    case 'add': {
      const seen = new Set(state.map(s => s.url))
      const fresh = action.slides.filter(s => !seen.has(s.url))
      return [...state, ...fresh].slice(0, SLIDE_MAX)
    }
    case 'remove':
      return state.filter(s => s.key !== action.key)
    case 'move': {
      const from = state.findIndex(s => s.key === action.key)
      if (from < 0) return state
      const to = Math.max(0, Math.min(state.length - 1, action.to))
      if (to === from) return state
      const next = state.slice()
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item as ComposerSlide)
      return next
    }
    case 'shift': {
      const from = state.findIndex(s => s.key === action.key)
      if (from < 0) return state
      return slidesReducer(state, { type: 'move', key: action.key, to: from + action.by })
    }
    case 'alt':
      return state.map(s => s.key === action.key ? { ...s, altText: action.altText.slice(0, ALT_TEXT_MAX) } : s)
    case 'replace':
      return action.slides.slice(0, SLIDE_MAX)
    default:
      return state
  }
}

/** Build slides from a legacy row that has `mediaUrls` but no slide rows. */
export function slidesFromMediaUrls(urls: readonly string[] | null | undefined): ComposerSlide[] {
  return (urls ?? []).slice(0, SLIDE_MAX).map((url, i) => ({
    key: `url-${i}-${url}`, url, assetId: null, altText: '',
  }))
}

/** Serialise for the form post: the action rebuilds slide rows from this. */
export function serializeSlides(slides: readonly ComposerSlide[]): string {
  return JSON.stringify(slides.map(s => ({ url: s.url, assetId: s.assetId, altText: s.altText })))
}

/** The aria-live line read out after a keyboard reorder. */
export function reorderAnnouncement(position: number, total: number): string {
  return `Slide moved to position ${position} of ${total}`
}
