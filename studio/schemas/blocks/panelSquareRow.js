// The square row: four evergreen category doors. Never merchandised away,
// never empty. Two to six render, four is the designed case.
export default {
  name: 'panelSquareRow',
  title: 'Square panel row',
  type: 'object',
  fields: [
    {
      name: 'items',
      title: 'Panels',
      type: 'array',
      of: [{ type: 'panelTile' }],
      description: 'Four is the designed case.',
      validation: (Rule) => Rule.required().min(2).max(6),
    },
  ],
  preview: {
    select: { a: 'items.0.label', b: 'items.1.label', items: 'items' },
    prepare: ({ a, b, items }) => {
      const n = Array.isArray(items) ? items.length : 0
      return {
        title: 'Square row',
        subtitle: [a, b, n > 2 ? `+${n - 2}` : null].filter(Boolean).join(' · '),
      }
    },
  },
}
