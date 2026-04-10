export default {
  name: 'bonusDeal',
  title: 'Bonus Deal',
  type: 'object',
  fields: [
    { name: 'active',  title: 'Active',  type: 'boolean', initialValue: true },
    { name: 'order',   title: 'Order',   type: 'number',  initialValue: 50 },
    { name: 'heading', title: 'Heading', type: 'string',  description: 'Defaults to "Because one deal is never enough."' },
    { name: 'eyebrow', title: 'Eyebrow', type: 'string',  description: 'Defaults to "Bonus Deal"' },
  ],
  preview: {
    select: { title: 'heading', active: 'active', order: 'order' },
    prepare({ title, active, order }) {
      return {
        title: title || 'Because one deal is never enough.',
        subtitle: `${active ? '✅' : '⛔'} Order: ${order ?? '—'}`,
      }
    },
  },
}
