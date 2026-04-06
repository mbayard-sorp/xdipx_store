export default {
  name: 'testimonials',
  title: 'Testimonials',
  type: 'object',
  fields: [
    { name: 'active',  title: 'Active',  type: 'boolean', initialValue: true },
    { name: 'order',   title: 'Order',   type: 'number',  initialValue: 70 },
    { name: 'heading', title: 'Heading', type: 'string',  initialValue: 'What customers are saying ♥' },
    {
      name: 'items', title: 'Reviews', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'quote',    title: 'Quote',    type: 'text' },
          { name: 'author',   title: 'Author',   type: 'string' },
          { name: 'rating',   title: 'Rating (1–5)', type: 'number', initialValue: 5 },
          { name: 'verified', title: 'Verified Purchase', type: 'boolean', initialValue: true },
        ],
        preview: { select: { title: 'author', subtitle: 'quote' } },
      }],
    },
  ],
  preview: {
    select: { title: 'heading', active: 'active', order: 'order', items: 'items' },
    prepare({ title, active, order, items }) {
      const n = Array.isArray(items) ? items.length : 0
      return {
        title: title ?? '(no heading)',
        subtitle: `${n} review${n !== 1 ? 's' : ''} · Order ${order ?? 0} · ${active ? 'Visible' : 'Hidden'}`,
      }
    },
  },
}
