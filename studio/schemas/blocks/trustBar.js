import { bgStyleField } from '../../lib/bgStyleField'

export default {
  name: 'trustBar',
  title: 'Trust Bar',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 50, hidden: true },
    bgStyleField({ initialValue: 'white' }),
    {
      name: 'items',
      title: 'Linked Trust Items',
      description: 'Link Trust Item documents (or create new ones inline). Drag to reorder.',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'trustItem' }] }],
      validation: (Rule) => Rule.min(1).error('Add at least one trust item.'),
    },
  ],
  preview: {
    select: { active: 'active', order: 'order', items: 'items' },
    prepare: ({ active, order, items }) => {
      const n = Array.isArray(items) ? items.length : 0
      return {
        title: 'Trust Bar',
        subtitle: `${n} item${n === 1 ? '' : 's'} · ${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
