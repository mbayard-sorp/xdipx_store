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
export default {
  name: 'dialTaxonomy',
  title: 'Sensation dial taxonomy (rich)',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton — no create/delete
  fields: [
    {
      name: 'airPulsation',
      title: 'Air pulsation dimensions',
      type: 'array',
      of: [{ type: 'dialDimension' }],
      description: 'Each entry: a label, definition, and 1/3/5 scale examples.',
    },
    {
      name: 'vibrator',
      title: 'Vibrator dimensions',
      type: 'array',
      of: [{ type: 'dialDimension' }],
    },
    {
      name: 'wand',
      title: 'Wand dimensions',
      type: 'array',
      of: [{ type: 'dialDimension' }],
    },
    {
      name: 'lube',
      title: 'Lube / wellness dimensions',
      type: 'array',
      of: [{ type: 'dialDimension' }],
    },
    {
      name: 'wear',
      title: 'Wear dimensions',
      type: 'array',
      of: [{ type: 'dialDimension' }],
    },
  ],
  preview: {
    select: { air: 'airPulsation', vib: 'vibrator', wand: 'wand', lube: 'lube', wear: 'wear' },
    prepare: ({ air = [], vib = [], wand = [], lube = [], wear = [] }) => ({
      title: 'Sensation dial taxonomy',
      subtitle: `air ${air.length} · vib ${vib.length} · wand ${wand.length} · lube ${lube.length} · wear ${wear.length}`,
    }),
  },
}
