import type { PanelSurface } from '~/types/cms'

/**
 * Surface token → rendering classes. Editors pick tokens, never hex; this map
 * is the only place a token becomes pixels, and every value is a doctrine
 * ground (docs/design-doctrine.md §4). No sage tint: the doctrine forecloses a
 * sage ground by name, and the deck takes its rhythm from the ink panel
 * instead (§7, one dark card per row).
 */
export interface SurfaceStyle {
  /** Panel background. */
  bg: string
  /** Primary text on that ground. */
  text: string
  /** Mark / arrow / kicker accent on that ground. */
  accent: string
  /** Secondary text (meta lines, blurbs). */
  muted: string
  /** Focus ring color needs to invert on dark grounds. */
  darkGround: boolean
}

// Kickers and marks are quiet chrome (§2: kickers set in ink-4, or white/70 on
// a dark ground) — coral is budgeted (§3, one primary per viewport) and is
// spent ONCE per deck, on the dark panel's CTA (see PanelLarge), never on
// accents. `plum` and `coral` grounds are off the §4 ground lock and their
// white/70 secondary lines fail AA on those fills, so the tokens alias to
// their tint equivalents rather than rendering a solid that the doctrine
// forbids (design-critic cold-start verdict, 2026-07-29).
// Every light panel is hairline-framed (§3 "cards get a hairline border-line";
// §6 "hairline-framed") so a tile whose fill matches the band never dissolves
// into it. Ink is borderless — it carries its own contrast.
const BLUSH: SurfaceStyle = { bg: 'bg-coral-soft border border-line', text: 'text-ink', accent: 'text-ink-4', muted: 'text-ink-3', darkGround: false }
const LILAC: SurfaceStyle = { bg: 'bg-plum-soft border border-line', text: 'text-ink', accent: 'text-ink-4', muted: 'text-ink-3', darkGround: false }

export const PANEL_SURFACES: Record<PanelSurface, SurfaceStyle> = {
  blush: BLUSH,
  lilac: LILAC,
  stone: { bg: 'bg-paper-3 border border-line', text: 'text-ink', accent: 'text-ink-4', muted: 'text-ink-3', darkGround: false },
  paper: { bg: 'bg-paper-2 border border-line', text: 'text-ink', accent: 'text-ink-4', muted: 'text-ink-3', darkGround: false },
  plum: LILAC,
  coral: BLUSH,
  ink: { bg: 'bg-ink', text: 'text-white', accent: 'text-white/70', muted: 'text-white/60', darkGround: true },
}

export function surfaceStyle(surface: PanelSurface | string | undefined): SurfaceStyle {
  return PANEL_SURFACES[(surface as PanelSurface) ?? 'stone'] ?? PANEL_SURFACES.stone
}

/**
 * Hover/focus behavior shared by every panel, per the handoff's states table:
 * ground darkens slightly, no lift, no shadow; 140ms ease-out; visible focus
 * ring that inverts on dark grounds. The mark/arrow nudge lives on the child
 * via `group-hover:translate-x-0.5`.
 */
export function panelInteractionClasses(dark: boolean): string {
  return [
    'group block transition duration-150 ease-out hover:brightness-[0.96]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-[3px]',
    dark ? 'focus-visible:ring-white' : 'focus-visible:ring-ink',
  ].join(' ')
}

/** Analytics coordinate for a panel anchor: {theme}/{row}/{item}/{label}. */
export function panelDataAttr(theme: string, row: number, item: number, label: string): string {
  return `${theme}/${row}/${item}/${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}
