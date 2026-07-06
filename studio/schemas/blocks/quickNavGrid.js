// Merch components v1 — 1g Category quick-nav grid. New additive block.
// Pure tint tiles, no images — the tint rotation itself is component shell,
// not a CMS slot. These are redundant with the nav menu by design, never the
// sole path to a category.
export default {
  name: 'quickNavGrid',
  title: 'Category Quick-Nav Grid',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 8, hidden: true },

    {
      name: 'tiles',
      title: 'Tiles',
      type: 'array',
      validation: (Rule) => Rule.min(4).max(6),
      of: [
        {
          type: 'object',
          name: 'quickNavTile',
          fields: [
            { name: 'label', title: 'Label', type: 'string', validation: (Rule) => Rule.required() },
            { name: 'link',  title: 'Collection link', type: 'string', validation: (Rule) => Rule.required() },
            {
              name: 'tintHint',
              title: 'Tint hint (optional)',
              type: 'string',
              description: 'Optional hint for which tint to use. The rotation itself is component shell — leave blank to let the component decide.',
              options: {
                list: [
                  { title: 'Coral soft', value: 'coral-soft' },
                  { title: 'Plum soft',  value: 'plum-soft'  },
                  { title: 'Paper 3',    value: 'paper-3'    },
                ],
              },
            },
          ],
          preview: {
            select: { title: 'label', subtitle: 'link' },
          },
        },
      ],
    },
  ],
  preview: {
    select: { active: 'active', tiles: 'tiles' },
    prepare({ active, tiles }) {
      const n = Array.isArray(tiles) ? tiles.length : 0
      return {
        title: 'Category Quick-Nav Grid',
        subtitle: `${n} tile${n !== 1 ? 's' : ''} · ${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
