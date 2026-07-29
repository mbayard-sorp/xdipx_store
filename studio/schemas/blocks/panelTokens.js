// Panel deck token lists — single source of truth shared by schema validation
// and the front-end surface map (app/components/home/panels).
//
// Grounds are the ones the design doctrine already ships (docs/design-doctrine.md
// §4 ground lock). The handoff proposed a fifth pale tint, `sageTint #E8EDE6`;
// it is deliberately NOT here. The doctrine forecloses a sage ground by name
// ("sage is an accent color, never a ground"), so admitting it needs a versioned
// doctrine amendment from the owner, not a token invented in a component schema.
// Rhythm comes from the ink panel instead (doctrine §7, "one dark card per row").

export const SURFACES = [
  { title: 'Blush (coral-soft)', value: 'blush' },
  { title: 'Lilac (plum-soft)', value: 'lilac' },
  { title: 'Stone (paper-3)', value: 'stone' },
  { title: 'Paper', value: 'paper' },
  { title: 'Plum (solid)', value: 'plum' },
  { title: 'Coral (solid)', value: 'coral' },
  { title: 'Ink (solid)', value: 'ink' },
]

/** Squares never take a saturated ground: a solid fill on a 160px tile blows the coral budget. */
export const TINTS = ['blush', 'lilac', 'stone', 'paper']

export const TINT_SURFACES = SURFACES.filter((s) => TINTS.includes(s.value))

export const MARKS = [
  'waves',
  'rings',
  'torso',
  'garment',
  'compass',
  'burst',
  'notebook',
  'tag',
]

// Navigational affordances only. The voice charter's CTA whitelist
// (docs/emma-voice.md) governs action CTAs and is unchanged; a charter-governed
// "navigational CTA" tier is pending the owner's codify (2026-07-29). Until then
// panels ship with the already-shipped bare affordance.
export const CTA_LABELS = ['See all →', 'Take a peek →']
