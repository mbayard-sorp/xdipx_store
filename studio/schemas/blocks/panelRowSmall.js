// Pairs two small panels into one row. One item renders half-width, left-aligned.
export default {
  name: 'panelRowSmall',
  title: 'Small panel row',
  type: 'object',
  fields: [
    {
      name: 'items',
      title: 'Panels',
      type: 'array',
      of: [{ type: 'panelSmall' }],
      validation: (Rule) => Rule.required().min(1).max(2),
    },
  ],
  preview: {
    select: { a: 'items.0.label', b: 'items.1.label' },
    prepare: ({ a, b }) => ({
      title: 'Small row',
      subtitle: [a, b].filter(Boolean).join(' · '),
    }),
  },
}
