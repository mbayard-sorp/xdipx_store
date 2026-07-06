// Merch components v1 — 1e Curiosity chooser. New additive block.
// Tile pills filter the rail in place via ?preset= — every state must be a
// real server-rendered link (no dead ends, no JS-only filtering).
export default {
  name: 'curiosityChooser',
  title: 'Curiosity Chooser',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 12, hidden: true },

    { name: 'heading', title: 'Heading', type: 'string', description: 'e.g. "What are you curious about?"' },
    {
      name: 'emphasisWord',
      title: 'Emphasis word',
      type: 'string',
      description: 'The single word in the heading rendered italic plum via <em class="em">.',
    },

    {
      name: 'tiles',
      title: 'Tiles',
      type: 'array',
      description: 'Pill tiles. A tile that would return zero products should not be published — dead ends are prevented at data level.',
      validation: (Rule) => Rule.min(2).max(6),
      of: [
        {
          type: 'object',
          name: 'curiosityChooserTile',
          fields: [
            {
              name: 'label',
              title: 'Label',
              type: 'string',
              description: 'Pill label, ~16 chars max, e.g. "Quieter".',
              validation: (Rule) => Rule.required().max(24),
            },
            {
              name: 'presetSlug',
              title: 'Preset slug',
              type: 'string',
              description: 'Maps to ?preset= on the collection URL, e.g. "quieter".',
            },
            {
              name: 'productHandles',
              title: 'Explicit product handles (optional)',
              type: 'array',
              description: 'Overrides the preset-driven rail with an explicit manual list.',
              of: [{ type: 'string' }],
            },
            {
              name: 'narratorLine',
              title: 'Narrator line',
              type: 'string',
              description: 'Emma-voice line shown when this tile is selected, e.g. "Quieter, then. These keep it under the covers."',
            },
          ],
          preview: {
            select: { title: 'label', subtitle: 'presetSlug' },
          },
        },
      ],
    },
  ],
  preview: {
    select: { title: 'heading', active: 'active', tiles: 'tiles' },
    prepare({ title, active, tiles }) {
      const n = Array.isArray(tiles) ? tiles.length : 0
      return {
        title: title ?? '(no heading)',
        subtitle: `${n} tile${n !== 1 ? 's' : ''} · ${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
