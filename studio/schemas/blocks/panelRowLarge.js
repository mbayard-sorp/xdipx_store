// Pairs two large panels into one row. One item renders full-width.
export default {
  name: 'panelRowLarge',
  title: 'Large panel row',
  type: 'object',
  fields: [
    {
      name: 'items',
      title: 'Panels',
      type: 'array',
      of: [{ type: 'panelLarge' }],
      validation: (Rule) => Rule.required().min(1).max(2),
    },
  ],
  preview: {
    select: { a: 'items.0.label', b: 'items.1.label' },
    prepare: ({ a, b }) => ({
      title: 'Large row',
      subtitle: [a, b].filter(Boolean).join(' · '),
    }),
  },
}
