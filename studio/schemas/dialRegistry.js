// PDP redesign — sensation dial label registry (singleton).
// Per-product-type list of preferred dial labels Emma generates against.
// Editors revise as preferences shift; Haiku reads the current values at
// generation time and prefers (but is not constrained to) these labels.
//
// Field-name convention: camelCase. Hyphenated ProductTypeDial values map to:
//   cock-ring   → cockRing
//   book-media  → bookMedia
//   sex-machine → sexMachine
//
// Legacy fields (airPulsation, wand) stay for back-compat — Phase 1 collapsed
// them into `vibrator` as subtypes; the read path in app/lib/dial-registry.server.ts
// dedupes labels across the three when serving `vibrator`.
const labelArray = (description) => ({
  type: 'array',
  of: [{ type: 'string' }],
  ...(description ? { description } : {}),
})

export default {
  name: 'dialRegistry',
  title: 'Sensation dial labels',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton — no create/delete
  groups: [
    { name: 'core',     title: 'Core types',     default: true },
    { name: 'specialty', title: 'Specialty types' },
    { name: 'consumable', title: 'Consumables & wear' },
    { name: 'legacy',   title: 'Legacy (back-compat)' },
  ],
  fields: [
    // ── Core (most common product types) ──────────────────────────────────
    { name: 'vibrator', title: 'Vibrator labels', group: 'core',
      ...labelArray('Preferred dial dimensions for vibrators. Emma picks 5–6 per product.') },
    { name: 'dildo',    title: 'Dildo labels',    group: 'core', ...labelArray() },
    { name: 'anal',     title: 'Anal toy labels', group: 'core', ...labelArray() },
    { name: 'stroker',  title: 'Stroker labels',  group: 'core', ...labelArray() },
    { name: 'couples',  title: 'Couples toy labels', group: 'core', ...labelArray() },

    // ── Specialty / niche types ───────────────────────────────────────────
    { name: 'bondage',     title: 'Bondage labels',          group: 'specialty', ...labelArray() },
    { name: 'cockRing',    title: 'Cock-ring labels',        group: 'specialty', ...labelArray() },
    { name: 'harness',     title: 'Harness labels',          group: 'specialty', ...labelArray() },
    { name: 'extender',    title: 'Extender labels',         group: 'specialty', ...labelArray() },
    { name: 'pump',        title: 'Pump labels',             group: 'specialty', ...labelArray() },
    { name: 'sexMachine',  title: 'Sex-machine labels',      group: 'specialty', ...labelArray() },
    { name: 'novelty',     title: 'Novelty labels',          group: 'specialty', ...labelArray() },
    { name: 'bookMedia',   title: 'Book / media labels',     group: 'specialty', ...labelArray() },

    // ── Consumables + wellness + wear ─────────────────────────────────────
    { name: 'lube',     title: 'Lube labels',     group: 'consumable', ...labelArray() },
    { name: 'massage',  title: 'Massage labels',  group: 'consumable', ...labelArray() },
    { name: 'enhancer', title: 'Enhancer labels', group: 'consumable', ...labelArray() },
    { name: 'condom',   title: 'Condom labels',   group: 'consumable', ...labelArray() },
    { name: 'wellness', title: 'Wellness labels', group: 'consumable', ...labelArray() },
    { name: 'wear',     title: 'Wear labels',     group: 'consumable', ...labelArray() },

    // ── Legacy (Phase 1 collapsed into `vibrator`; kept for back-compat) ──
    { name: 'airPulsation', title: 'Air pulsation labels (legacy)', group: 'legacy',
      ...labelArray('Phase 1 collapsed air-pulsation into vibrator subtypes. Read path dedupes these into `vibrator`. Editing here is rarely needed.') },
    { name: 'wand',         title: 'Wand labels (legacy)',         group: 'legacy',
      ...labelArray('Phase 1 collapsed wand into vibrator subtypes. Read path dedupes these into `vibrator`. Editing here is rarely needed.') },
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
        title: 'Sensation dial labels',
        subtitle: `${filled} type(s) populated · ${total} label(s) total`,
      }
    },
  },
}
