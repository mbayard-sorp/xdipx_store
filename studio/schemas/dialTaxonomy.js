// PDP redesign — rich sensation dial taxonomy (singleton, additive).
//
// Companion to the older `dialRegistry` doc — that one stores a flat label list
// per product type for back-compat. This one stores per-dimension definitions
// + 1/3/5 scale documentation so the generator can produce consistent values.
//
// Editors curate here when they want to define what a value MEANS (e.g. for a
// wand, "Intensity 3 = mid-rumble suitable for over-clothes use, 5 = deep
// rumble that's almost too much over bare skin"). The bulk-import orchestrator
// reads this taxonomy when present and falls back to the older registry when
// it's empty — so adding entries is purely additive.
//
// Field-name convention: camelCase. Hyphenated ProductTypeDial values map to:
//   cock-ring   → cockRing
//   book-media  → bookMedia
//   sex-machine → sexMachine
//
// Legacy fields (airPulsation, wand) stay for back-compat — Phase 1 collapsed
// them into `vibrator` as subtypes; the read path dedupes labels across the
// three when serving `vibrator`.
const dimArray = (description) => ({
  type: 'array',
  of: [{ type: 'dialDimension' }],
  ...(description ? { description } : {}),
})

export default {
  name: 'dialTaxonomy',
  title: 'Sensation dial taxonomy (rich)',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton — no create/delete
  groups: [
    { name: 'core',      title: 'Core types',     default: true },
    { name: 'specialty', title: 'Specialty types' },
    { name: 'consumable', title: 'Consumables & wear' },
    { name: 'legacy',    title: 'Legacy (back-compat)' },
  ],
  fields: [
    // ── Core ──────────────────────────────────────────────────────────────
    { name: 'vibrator', title: 'Vibrator dimensions', group: 'core',
      ...dimArray('Each entry: a label, definition, and 1/3/5 scale examples.') },
    { name: 'dildo',    title: 'Dildo dimensions',    group: 'core', ...dimArray() },
    { name: 'anal',     title: 'Anal toy dimensions', group: 'core', ...dimArray() },
    { name: 'stroker',  title: 'Stroker dimensions',  group: 'core', ...dimArray() },
    { name: 'couples',  title: 'Couples toy dimensions', group: 'core', ...dimArray() },

    // ── Specialty ─────────────────────────────────────────────────────────
    { name: 'bondage',     title: 'Bondage dimensions',          group: 'specialty', ...dimArray() },
    { name: 'cockRing',    title: 'Cock-ring dimensions',        group: 'specialty', ...dimArray() },
    { name: 'harness',     title: 'Harness dimensions',          group: 'specialty', ...dimArray() },
    { name: 'extender',    title: 'Extender dimensions',         group: 'specialty', ...dimArray() },
    { name: 'pump',        title: 'Pump dimensions',             group: 'specialty', ...dimArray() },
    { name: 'sexMachine',  title: 'Sex-machine dimensions',      group: 'specialty', ...dimArray() },
    { name: 'novelty',     title: 'Novelty dimensions',          group: 'specialty', ...dimArray() },
    { name: 'bookMedia',   title: 'Book / media dimensions',     group: 'specialty', ...dimArray() },

    // ── Consumables + wellness + wear ─────────────────────────────────────
    { name: 'lube',     title: 'Lube dimensions',     group: 'consumable', ...dimArray() },
    { name: 'massage',  title: 'Massage dimensions',  group: 'consumable', ...dimArray() },
    { name: 'enhancer', title: 'Enhancer dimensions', group: 'consumable', ...dimArray() },
    { name: 'condom',   title: 'Condom dimensions',   group: 'consumable', ...dimArray() },
    { name: 'wellness', title: 'Wellness dimensions', group: 'consumable', ...dimArray() },
    { name: 'wear',     title: 'Wear dimensions',     group: 'consumable', ...dimArray() },

    // ── Legacy ────────────────────────────────────────────────────────────
    { name: 'airPulsation', title: 'Air pulsation dimensions (legacy)', group: 'legacy',
      ...dimArray('Phase 1 collapsed air-pulsation into vibrator subtypes. Read path dedupes these into `vibrator`.') },
    { name: 'wand',         title: 'Wand dimensions (legacy)',          group: 'legacy',
      ...dimArray('Phase 1 collapsed wand into vibrator subtypes. Read path dedupes these into `vibrator`.') },
  ],
  preview: {
    select: {
      vib: 'vibrator', dildo: 'dildo', anal: 'anal', stroker: 'stroker', couples: 'couples',
      bondage: 'bondage', cockRing: 'cockRing', harness: 'harness', extender: 'extender',
      pump: 'pump', sexMachine: 'sexMachine', novelty: 'novelty', bookMedia: 'bookMedia',
      lube: 'lube', massage: 'massage', enhancer: 'enhancer', condom: 'condom',
      wellness: 'wellness', wear: 'wear', air: 'airPulsation', wand: 'wand',
    },
    prepare: (sel) => {
      const total = Object.values(sel).reduce(
        (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
        0,
      )
      const filled = Object.entries(sel).filter(([, arr]) => Array.isArray(arr) && arr.length > 0).length
      return {
        title: 'Sensation dial taxonomy',
        subtitle: `${filled} type(s) populated · ${total} dimension(s) total`,
      }
    },
  },
}
