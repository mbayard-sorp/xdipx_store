// Notebook redesign — category color identity map (art direction §5).
// guides carry the living accent (coral), comparisons carry emphasis (plum),
// care carries the quiet botanical (sage), wellness-basics stays neutral.
// Only known slugs (or legacy blogCategory.color values) map to an accent;
// everything else falls back to the neutral identity. Isomorphic.

export interface CategoryAccent {
  /** Kicker / accent text color class. */
  kicker: string
  /** Chip pill classes (tint bg + accent text). */
  chip: string
  /** 2px card top tick background class. */
  tick: string
  /** Soft wash background class for category page headers. */
  wash: string
  /** Accent text color class for headings on the wash. */
  heading: string
}

const NEUTRAL: CategoryAccent = {
  kicker: 'text-ink-3',
  chip: 'bg-paper-3 text-ink-2 border border-line',
  tick: 'bg-ink-3',
  wash: 'bg-paper-3',
  heading: 'text-ink',
}

const ACCENTS: Record<string, CategoryAccent> = {
  coral: {
    kicker: 'text-coral',
    chip: 'bg-coral-soft text-coral',
    tick: 'bg-coral',
    wash: 'bg-coral-soft',
    heading: 'text-coral',
  },
  plum: {
    kicker: 'text-plum',
    chip: 'bg-plum-soft text-plum',
    tick: 'bg-plum',
    wash: 'bg-plum-soft',
    heading: 'text-plum',
  },
  sage: {
    kicker: 'text-sage',
    chip: 'bg-sage/10 text-sage',
    tick: 'bg-sage',
    wash: 'bg-sage/10',
    heading: 'text-sage',
  },
  neutral: NEUTRAL,
}

const SLUG_MAP: Record<string, string> = {
  'guides': 'coral',
  'comparisons': 'plum',
  'care': 'sage',
  'wellness-basics': 'neutral',
}

// Legacy blogCategory.color radio values, mapped onto v3 accents.
const LEGACY_COLOR_MAP: Record<string, string> = {
  coral: 'coral',
  orange: 'coral',
  purple: 'plum',
  charcoal: 'neutral',
}

export function categoryAccent(slug?: string, color?: string): CategoryAccent {
  const key =
    (slug && SLUG_MAP[slug]) ??
    (color && LEGACY_COLOR_MAP[color]) ??
    'neutral'
  return ACCENTS[key] ?? NEUTRAL
}
