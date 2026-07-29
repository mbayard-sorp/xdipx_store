import type { ReactElement, SVGProps } from 'react'

/**
 * Panel deck mark set — eight line-geometry glyphs from the Panel Deck Handoff v1.0.
 *
 * 24x24 viewBox, currentColor stroke, no fills, so a panel's surface token
 * recolors the mark. Marks are the empty-state fallback for a panel: they
 * render when no product cutout image is set (owner direction 2026-07-29).
 */

export const MARK_NAMES = [
  'waves',
  'rings',
  'torso',
  'garment',
  'compass',
  'burst',
  'notebook',
  'tag',
] as const

export type MarkName = (typeof MARK_NAMES)[number]

export function isMarkName(value: unknown): value is MarkName {
  return typeof value === 'string' && (MARK_NAMES as readonly string[]).includes(value)
}

type MarkProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'fill'> & {
  size?: number
}

function markBase({ size = 24, strokeWidth = 1.5, ...rest }: MarkProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...rest,
  }
}

function Waves(props: MarkProps) {
  return (
    <svg {...markBase(props)}>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 5.5a6.5 6.5 0 0 1 0 13" />
      <path d="M12 1.8a10.2 10.2 0 0 1 0 20.4" />
    </svg>
  )
}

function Rings(props: MarkProps) {
  return (
    <svg {...markBase(props)}>
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </svg>
  )
}

function Torso(props: MarkProps) {
  return (
    <svg {...markBase(props)}>
      <path d="M5 21c0-6 3.1-9 7-9s7 3 7 9" />
      <circle cx="12" cy="6" r="3.4" />
    </svg>
  )
}

function Garment(props: MarkProps) {
  return (
    <svg {...markBase(props)}>
      <path d="M4 8h16l-2.2 12H6.2L4 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  )
}

function Compass(props: MarkProps) {
  return (
    <svg {...markBase(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.2 8.8l-1.9 4.5-4.5 1.9 1.9-4.5 4.5-1.9Z" />
    </svg>
  )
}

function Burst(props: MarkProps) {
  return (
    <svg {...markBase(props)}>
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
    </svg>
  )
}

function Notebook(props: MarkProps) {
  return (
    <svg {...markBase(props)}>
      <path d="M5 4h14v16H5z" />
      <path d="M9 9h6M9 13h6" />
    </svg>
  )
}

function Tag(props: MarkProps) {
  return (
    <svg {...markBase(props)}>
      <path d="M4 4h8l8 8-8 8-8-8V4Z" />
      <circle cx="8.5" cy="8.5" r="1.3" />
    </svg>
  )
}

export const PANEL_MARKS: Record<MarkName, (props: MarkProps) => ReactElement> = {
  waves: Waves,
  rings: Rings,
  torso: Torso,
  garment: Garment,
  compass: Compass,
  burst: Burst,
  notebook: Notebook,
  tag: Tag,
}

export function PanelMark({ name, ...props }: MarkProps & { name: MarkName }) {
  const Glyph = PANEL_MARKS[name]
  return Glyph ? <Glyph {...props} /> : null
}
