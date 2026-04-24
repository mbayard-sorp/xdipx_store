// PDP redesign — sensation dial label registry (singleton).
// Per-product-type list of preferred dial labels Emma generates against.
// Editors revise as preferences shift; Haiku reads the current values at
// generation time and prefers (but is not constrained to) these labels.
export default {
  name: 'dialRegistry',
  title: 'Sensation dial labels',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton — no create/delete
  fields: [
    {
      name: 'airPulsation',
      title: 'Air pulsation labels',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Preferred dial dimensions for air-pulsation toys. Emma picks 5–6 per product.',
    },
    {
      name: 'vibrator',
      title: 'Vibrator labels',
      type: 'array',
      of: [{ type: 'string' }],
    },
    {
      name: 'wand',
      title: 'Wand labels',
      type: 'array',
      of: [{ type: 'string' }],
    },
    {
      name: 'lube',
      title: 'Lube / wellness labels',
      type: 'array',
      of: [{ type: 'string' }],
    },
    {
      name: 'wear',
      title: 'Wear labels',
      type: 'array',
      of: [{ type: 'string' }],
    },
  ],
  preview: {
    select: { air: 'airPulsation', vib: 'vibrator', wand: 'wand', lube: 'lube', wear: 'wear' },
    prepare: ({ air = [], vib = [], wand = [], lube = [], wear = [] }) => ({
      title: 'Sensation dial labels',
      subtitle: `air ${air.length} · vib ${vib.length} · wand ${wand.length} · lube ${lube.length} · wear ${wear.length}`,
    }),
  },
}
